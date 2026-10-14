import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { Env } from "../env";
import { logActivity } from "../lib/audit";
import { hashIp } from "../lib/crypto";
import { brandLogoUrl, leadConfirmationEmail, leadNotificationEmail } from "../lib/emails";
import { clientIp, fail, ok } from "../lib/http";
import { sendLoggedEmail } from "../lib/notify";
import { db } from "../lib/supabase";
import { verifyTurnstile } from "../lib/turnstile";
import { leadCreateSchema, leadUpdateSchema } from "../lib/validate";
import { requireAdmin } from "../middleware/auth";

const leads = new Hono<Env>();

// Public: create a lead from any website form.
leads.post("/", zValidator("json", leadCreateSchema), async (c) => {
  const body = c.req.valid("json");
  const ip = clientIp(c);

  const turnstile = await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY, body.turnstileToken, ip);
  if (!turnstile.success) {
    return fail(c, "Human verification failed. Please refresh and try again.", 400);
  }

  const client = db(c.env);
  const { data, error } = await client
    .from("leads")
    .insert({
      name: body.name,
      email: body.email,
      phone: body.phone ?? null,
      company: body.company ?? null,
      website: body.website ?? null,
      preferred_contact_method: body.preferredContactMethod ?? null,
      service: body.service ?? null,
      budget: body.budget ?? null,
      message: body.message ?? null,
      category: body.category ?? "general",
      form_type: body.formType ?? "contact",
      source: body.source ?? {},
      extra: body.fields ?? {},
      turnstile_ok: turnstile.success,
      ip_hash: await hashIp(ip, c.env.SUPABASE_SERVICE_ROLE_KEY),
      user_agent: c.req.header("User-Agent") ?? null,
    })
    .select("id, created_at")
    .single();

  if (error) {
    console.error("[leads.create]", error);
    return fail(c, "We could not save your request. Please try again.", 500);
  }

  if (c.env.NOTIFY_EMAIL_TO) {
    const portalUrl = `${(c.env.APP_URL ?? "").replace(/\/$/, "")}/ops`;
    const email = leadNotificationEmail(
      {
        name: body.name,
        email: body.email,
        phone: body.phone,
        company: body.company,
        service: body.service,
        budget: body.budget,
        category: body.category,
        formType: body.formType,
        message: body.message,
      },
      { portalUrl, logoUrl: brandLogoUrl(c.env.APP_URL) },
    );
    await sendLoggedEmail(c.env, {
      to: c.env.NOTIFY_EMAIL_TO,
      replyTo: body.email,
      subject: email.subject,
      html: email.html,
      template: "lead_notification",
    });
  }

  // Acknowledge the enquiry to the person who submitted it.
  if (body.email) {
    const confirmation = leadConfirmationEmail(
      {
        name: body.name,
        email: body.email,
        phone: body.phone,
        company: body.company,
        service: body.service,
        budget: body.budget,
        category: body.category,
        formType: body.formType,
        message: body.message,
      },
      { logoUrl: brandLogoUrl(c.env.APP_URL), siteUrl: c.env.APP_URL },
    );
    await sendLoggedEmail(c.env, {
      to: body.email,
      replyTo: c.env.NOTIFY_EMAIL_TO,
      subject: confirmation.subject,
      html: confirmation.html,
      template: "lead_confirmation",
    });
  }

  return ok(c, { id: data.id, createdAt: data.created_at }, 201);
});

// Admin: list with search + status filter + pagination.
leads.get("/", requireAdmin, async (c) => {
  const client = db(c.env);
  const status = c.req.query("status");
  const search = c.req.query("search")?.trim();
  const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") ?? "25") || 25));

  let query = client
    .from("leads")
    .select(
      "id,name,email,phone,company,website,preferred_contact_method,service,budget,message,category,form_type,source,extra,status,internal_notes,created_at,updated_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false });

  if (status && status !== "all") query = query.eq("status", status);
  if (search) query = query.textSearch("search_vector", search, { type: "websearch", config: "simple" });

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query.range(from, from + pageSize - 1);
  if (error) return fail(c, error.message, 500);

  return ok(c, { items: data ?? [], total: count ?? 0, page, pageSize });
});

leads.get("/:id", requireAdmin, async (c) => {
  const { data, error } = await db(c.env)
    .from("leads")
    .select("*")
    .eq("id", c.req.param("id"))
    .maybeSingle();
  if (error) return fail(c, error.message, 500);
  if (!data) return fail(c, "Lead not found", 404);
  return ok(c, data);
});

leads.patch("/:id", requireAdmin, zValidator("json", leadUpdateSchema), async (c) => {
  const admin = c.get("admin");
  const body = c.req.valid("json");
  const id = c.req.param("id");

  const patch: Record<string, unknown> = {};
  if (body.status !== undefined) patch.status = body.status;
  if (body.internalNotes !== undefined) patch.internal_notes = body.internalNotes;
  if (Object.keys(patch).length === 0) return fail(c, "Nothing to update", 400);

  const { data, error } = await db(c.env).from("leads").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) return fail(c, error.message, 500);
  if (!data) return fail(c, "Lead not found", 404);

  await logActivity(c, admin, { action: "lead.updated", entity: "lead", entityId: id, metadata: patch });
  return ok(c, data);
});

leads.delete("/:id", requireAdmin, async (c) => {
  const admin = c.get("admin");
  const id = c.req.param("id");
  const { error } = await db(c.env).from("leads").delete().eq("id", id);
  if (error) return fail(c, error.message, 500);
  await logActivity(c, admin, { action: "lead.deleted", entity: "lead", entityId: id });
  return ok(c, { id });
});

export default leads;
