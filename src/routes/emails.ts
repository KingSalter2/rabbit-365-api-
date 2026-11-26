import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { Env } from "../env";
import { logActivity } from "../lib/audit";
import { renderSampleEmail, SAMPLE_EMAILS } from "../lib/emailSamples";
import { funeralOutreachEmail } from "../lib/emails";
import { fail, ok } from "../lib/http";
import { sendLoggedEmail } from "../lib/notify";
import { getBanking } from "../lib/settings";
import { db } from "../lib/supabase";
import { outreachSendSchema } from "../lib/validate";
import { requireAdmin } from "../middleware/auth";

const emails = new Hono<Env>();

// Admin: preview the transactional email templates with sample data.
emails.get("/preview", requireAdmin, async (c) => {
  const base = c.env.APP_URL ?? "https://www.rabbit365.co.za";
  const banking = await getBanking(db(c.env));
  const items = SAMPLE_EMAILS.map((t) => {
    const email = renderSampleEmail(t.key, base, banking);
    return {
      key: t.key,
      label: t.label,
      description: t.description,
      subject: email?.subject ?? "",
      html: email?.html ?? "",
    };
  });
  return ok(c, { items });
});

const OUTBOX_SELECT_BASE = "id,to_email,subject,template,status,provider_id,error,created_at,sent_at";
const OUTBOX_SELECT_EXT = `${OUTBOX_SELECT_BASE},last_event_at,delivered_at,bounced_at,complained_at,opened_at,clicked_at,opened_count,clicked_count`;
const OUTBOX_SELECT_DETAIL = `${OUTBOX_SELECT_EXT},body,reply_to`;

function mapOutboxRow(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    toEmail: row.to_email,
    subject: row.subject,
    template: row.template,
    status: row.status,
    providerId: row.provider_id ?? null,
    error: row.error ?? null,
    createdAt: row.created_at,
    sentAt: row.sent_at ?? null,
    lastEventAt: row.last_event_at ?? null,
    deliveredAt: row.delivered_at ?? null,
    bouncedAt: row.bounced_at ?? null,
    complainedAt: row.complained_at ?? null,
    openedAt: (row.opened_at as string | null | undefined) ?? null,
    clickedAt: (row.clicked_at as string | null | undefined) ?? null,
    openedCount: Number(row.opened_count ?? 0),
    clickedCount: Number(row.clicked_count ?? 0),
    body: (row.body as string | null | undefined) ?? null,
    replyTo: (row.reply_to as string | null | undefined) ?? null,
  };
}

emails.get("/outbox", requireAdmin, async (c) => {
  const client = db(c.env);
  const url = new URL(c.req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? "25") || 25));
  const status = url.searchParams.get("status")?.trim();
  const q = url.searchParams.get("q")?.trim();

  const run = (select: string) => {
    let query = client.from("email_outbox").select(select, { count: "exact" }).order("created_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
    if (status && status !== "all") query = query.eq("status", status);
    if (q) {
      const like = `%${q.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
      query = query.or(`to_email.ilike.${like},subject.ilike.${like},template.ilike.${like}`);
    }
    return query;
  };

  let { data, error, count } = await run(OUTBOX_SELECT_EXT);
  if (error && /column .* does not exist/i.test(error.message)) {
    ({ data, error, count } = await run(OUTBOX_SELECT_BASE));
  }
  if (error) return fail(c, error.message, 500);

  return ok(c, {
    items: ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => mapOutboxRow(row)),
    total: count ?? 0,
    page,
    pageSize,
  });
});

emails.get("/outbox/:id", requireAdmin, async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return fail(c, "Invalid email id", 400);
  const client = db(c.env);
  let { data, error } = await client.from("email_outbox").select(OUTBOX_SELECT_DETAIL).eq("id", id).maybeSingle();
  if (error && /column .* does not exist/i.test(error.message)) {
    ({ data, error } = await client.from("email_outbox").select(OUTBOX_SELECT_BASE).eq("id", id).maybeSingle());
  }
  if (error) return fail(c, error.message, 500);
  if (!data) return fail(c, "Email not found", 404);
  return ok(c, { item: mapOutboxRow(data as unknown as Record<string, unknown>) });
});

emails.post("/outreach/send", requireAdmin, zValidator("json", outreachSendSchema), async (c) => {
  const admin = c.get("admin");
  const body = c.req.valid("json");
  const base = c.env.APP_URL ?? "https://www.rabbit365.co.za";
  const logoUrl = `${base.replace(/\/$/, "")}/api/assets/logo.png`;

  const email = body.businessName
    ? (() => {
        const rendered = funeralOutreachEmail({
          businessName: body.businessName ?? "[Business Name]",
          observation: body.observation ?? "",
          logoUrl,
        });
        const subject = body.subject?.trim() || rendered.subject;
        const safeSubject = subject.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] ?? ch));
        const contentHtml = body.messageHtml?.trim() || "";
        const html = contentHtml
          ? rendered.html.replace(
              /<td class="rb-body"[^>]*>[\s\S]*?<\/td>\s*<\/tr>\s*<tr>\s*<td class="rb-footer"/,
              `<td class="rb-body" style="padding:44px 56px 48px"><h1 class="rb-h1" style="margin:0 0 20px;font-size:30px;line-height:38px;font-weight:800;letter-spacing:-0.4px;color:#0F172A">${safeSubject}</h1>${contentHtml}</td></tr><tr><td class="rb-footer"`,
            )
          : rendered.html.replace(/<h1 class="rb-h1"[^>]*>[\s\S]*?<\/h1>/, `<h1 class="rb-h1" style="margin:0 0 20px;font-size:30px;line-height:38px;font-weight:800;letter-spacing:-0.4px;color:#0F172A">${safeSubject}</h1>`).replace(/<title>[\s\S]*?<\/title>/, `<title>${safeSubject}</title>`);
        return { subject, html: body.subject?.trim() && !contentHtml ? html : html };
      })()
    : { subject: body.subject, html: body.html ?? "" };

  if (!email.html) return fail(c, "Missing email content", 400);

  await sendLoggedEmail(c.env, {
    to: body.to,
    subject: email.subject,
    html: email.html,
    text: body.text,
    template: "funeral-outreach",
  });

  const client = db(c.env);
  const { data } = await client
    .from("email_outbox")
    .select(
      "id,to_email,subject,template,status,provider_id,error,created_at,sent_at,last_event_at,delivered_at,bounced_at,complained_at",
    )
    .eq("to_email", body.to)
    .eq("template", "funeral-outreach")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  await logActivity(c, admin, {
    action: "email.outreach.sent",
    entity: "email_outbox",
    entityId: data?.id ? String(data.id) : undefined,
    metadata: { to: body.to, subject: body.subject },
  });

  return ok(c, {
    item: data
      ? {
          id: Number(data.id),
          toEmail: data.to_email,
          subject: data.subject,
          template: data.template,
          status: data.status,
          providerId: data.provider_id,
          error: data.error,
          createdAt: data.created_at,
          sentAt: data.sent_at,
          lastEventAt: data.last_event_at,
          deliveredAt: data.delivered_at,
          bouncedAt: data.bounced_at,
          complainedAt: data.complained_at,
        }
      : null,
  });
});

export default emails;
