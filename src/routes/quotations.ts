import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env";
import { logActivity } from "../lib/audit";
import {
  brandLogoUrl,
  quotationAcceptanceClientEmail,
  quotationAcceptedTeamEmail,
  quotationProgressEmail,
} from "../lib/emails";
import { clientIp, fail, ok } from "../lib/http";
import { sendLoggedEmail } from "../lib/notify";
import { defaultProgressRows, PROJECT_STATUS_LABELS } from "../lib/progress";
import { generateQuoteNumber } from "../lib/quoteNumber";
import { getBanking, type BankingDetails } from "../lib/settings";
import { db } from "../lib/supabase";
import { computeTotals, type PricedItem } from "../lib/totals";
import { verifyTurnstile } from "../lib/turnstile";
import { quotationAcceptSchema, quotationInputSchema, quotationProgressSchema } from "../lib/validate";
import { requireAdmin } from "../middleware/auth";

const quotations = new Hono<Env>();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type QuotationRow = Record<string, any>;
type SectionRow = Record<string, any>;
type ItemRow = Record<string, any>;

function serializeQuotation(
  q: QuotationRow,
  sections: SectionRow[],
  items: ItemRow[],
  progress: SectionRow[],
  banking: BankingDetails | null,
) {
  return {
    id: q.id,
    quoteNumber: q.quote_number,
    title: q.title,
    project: q.project ?? "",
    status: q.status,
    currency: q.currency,
    client: {
      name: q.client_name ?? "",
      company: q.client_company ?? undefined,
      email: q.client_email ?? undefined,
      phone: q.client_phone ?? undefined,
      address: q.client_address ?? undefined,
    },
    preparedBy: q.prepared_by ?? undefined,
    validUntil: q.valid_until ?? undefined,
    notes: q.notes ?? undefined,
    terms: q.terms ?? [],
    scope: sections.map((s) => ({ title: s.title, items: s.items ?? [] })),
    items: items.map((i) => ({
      description: i.description,
      amount: Number(i.amount),
      kind: i.kind,
    })),
    subtotal: Number(q.subtotal),
    discount: Number(q.discount),
    total: Number(q.total),
    acceptedAt: q.accepted_at ?? undefined,
    projectStatus: q.project_status ?? undefined,
    banking: banking ?? undefined,
    progress: progress.map((p) => ({
      position: p.position,
      label: p.label,
      description: p.description ?? undefined,
      status: p.status,
      note: p.note ?? undefined,
      completedAt: p.completed_at ?? undefined,
      updatedAt: p.updated_at,
    })),
    createdAt: q.created_at,
    updatedAt: q.updated_at,
  };
}

function serializeListRow(q: QuotationRow) {
  return {
    id: q.id,
    quoteNumber: q.quote_number,
    title: q.title,
    project: q.project ?? "",
    status: q.status,
    currency: q.currency,
    client: { name: q.client_name ?? "", company: q.client_company ?? undefined },
    total: Number(q.total),
    validUntil: q.valid_until ?? undefined,
    createdAt: q.created_at,
    updatedAt: q.updated_at,
  };
}

async function loadQuotation(client: SupabaseClient, id: string) {
  const { data: q, error } = await client.from("quotations").select("*").eq("id", id).maybeSingle();
  if (error || !q) return null;

  const [{ data: sections }, { data: items }, { data: progress }] = await Promise.all([
    client
      .from("quotation_scope_sections")
      .select("*")
      .eq("quotation_id", id)
      .order("position", { ascending: true }),
    client.from("quotation_items").select("*").eq("quotation_id", id).order("position", { ascending: true }),
    client.from("quotation_progress").select("*").eq("quotation_id", id).order("position", { ascending: true }),
  ]);

  const banking = q.status === "accepted" ? await getBanking(client) : null;
  return serializeQuotation(q, sections ?? [], items ?? [], progress ?? [], banking);
}

async function replaceChildren(
  client: SupabaseClient,
  quotationId: string,
  input: { scope: { title: string; items: string[] }[]; items: PricedItem[] },
) {
  await client.from("quotation_scope_sections").delete().eq("quotation_id", quotationId);
  await client.from("quotation_items").delete().eq("quotation_id", quotationId);

  if (input.scope.length) {
    await client.from("quotation_scope_sections").insert(
      input.scope.map((section, index) => ({
        quotation_id: quotationId,
        position: index,
        title: section.title,
        items: section.items,
      })),
    );
  }
  if (input.items.length) {
    await client.from("quotation_items").insert(
      input.items.map((item, index) => ({
        quotation_id: quotationId,
        position: index,
        description: item.description,
        amount: item.amount,
        kind: item.kind,
      })),
    );
  }
}

function rowFromInput(input: ReturnType<typeof quotationInputSchema.parse>, totals: { subtotal: number; discount: number; total: number }) {
  const row: Record<string, unknown> = {
    title: input.title,
    project: input.project ?? null,
    status: input.status ?? "draft",
    currency: input.currency ?? "R",
    client_name: input.client.name ?? "",
    client_company: input.client.company ?? null,
    client_email: input.client.email ?? null,
    client_phone: input.client.phone ?? null,
    client_address: input.client.address ?? null,
    prepared_by: input.preparedBy ?? null,
    valid_until: input.validUntil ?? null,
    notes: input.notes ?? null,
    terms: input.terms,
    subtotal: totals.subtotal,
    discount: totals.discount,
    total: totals.total,
  };
  if (input.createdAt) row.created_at = input.createdAt;
  return row;
}

// Admin: list.
quotations.get("/", requireAdmin, async (c) => {
  const client = db(c.env);
  const status = c.req.query("status");
  const search = c.req.query("search")?.trim();
  const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") ?? "25") || 25));

  let query = client
    .from("quotations")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  if (status && status !== "all") query = query.eq("status", status);
  if (search) query = query.textSearch("search_vector", search, { type: "websearch", config: "simple" });

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query.range(from, from + pageSize - 1);
  if (error) return fail(c, error.message, 500);

  return ok(c, {
    items: (data ?? []).map(serializeListRow),
    total: count ?? 0,
    page,
    pageSize,
  });
});

// Admin: create.
quotations.post("/", requireAdmin, zValidator("json", quotationInputSchema), async (c) => {
  const admin = c.get("admin");
  const input = c.req.valid("json");
  const client = db(c.env);

  const totals = computeTotals(input.items);
  const quoteNumber = input.quoteNumber ?? generateQuoteNumber();

  const { data: created, error } = await client
    .from("quotations")
    .insert({ quote_number: quoteNumber, ...rowFromInput(input, totals) })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return fail(c, "That quote number already exists", 409);
    return fail(c, error.message, 500);
  }

  await replaceChildren(client, created.id, input);
  const full = await loadQuotation(client, created.id);
  await logActivity(c, admin, { action: "quotation.created", entity: "quotation", entityId: created.id });
  return ok(c, full, 201);
});

// Public: fetch a quotation by id (used by the client share link).
quotations.get("/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return fail(c, "Quotation not found", 404);
  const full = await loadQuotation(db(c.env), id);
  if (!full) return fail(c, "Quotation not found", 404);
  return ok(c, full);
});

// Admin: update.
quotations.put("/:id", requireAdmin, zValidator("json", quotationInputSchema), async (c) => {
  const admin = c.get("admin");
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return fail(c, "Quotation not found", 404);

  const input = c.req.valid("json");
  const client = db(c.env);
  const totals = computeTotals(input.items);

  const patch = rowFromInput(input, totals);
  if (input.quoteNumber) {
    (patch as Record<string, unknown>).quote_number = input.quoteNumber;
  }

  const { data: updated, error } = await client
    .from("quotations")
    .update(patch)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return fail(c, error.message, 500);
  if (!updated) return fail(c, "Quotation not found", 404);

  await replaceChildren(client, id, input);
  const full = await loadQuotation(client, id);
  await logActivity(c, admin, { action: "quotation.updated", entity: "quotation", entityId: id });
  return ok(c, full);
});

// Admin: delete.
quotations.delete("/:id", requireAdmin, async (c) => {
  const admin = c.get("admin");
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return fail(c, "Quotation not found", 404);

  const { error } = await db(c.env).from("quotations").delete().eq("id", id);
  if (error) return fail(c, error.message, 500);
  await logActivity(c, admin, { action: "quotation.deleted", entity: "quotation", entityId: id });
  return ok(c, { id });
});

// Admin: update project progress / lifecycle for an accepted quotation.
quotations.put("/:id/progress", requireAdmin, zValidator("json", quotationProgressSchema), async (c) => {
  const admin = c.get("admin");
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return fail(c, "Quotation not found", 404);

  const input = c.req.valid("json");
  const client = db(c.env);

  const { data: existing, error: loadErr } = await client
    .from("quotations")
    .select("id,status")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) return fail(c, loadErr.message, 500);
  if (!existing) return fail(c, "Quotation not found", 404);
  if (existing.status !== "accepted") return fail(c, "Only accepted quotations have progress", 400);

  const nowIso = new Date().toISOString();

  if (input.steps) {
    await client.from("quotation_progress").delete().eq("quotation_id", id);
    if (input.steps.length) {
      await client.from("quotation_progress").insert(
        input.steps.map((step, index) => ({
          quotation_id: id,
          position: step.position ?? index,
          label: step.label,
          description: step.description ?? null,
          status: step.status,
          note: step.note ?? null,
          completed_at: step.status === "done" ? nowIso : null,
          updated_at: nowIso,
        })),
      );
    }
  }

  if (input.projectStatus) {
    await client.from("quotations").update({ project_status: input.projectStatus }).eq("id", id);
  }

  const full = await loadQuotation(client, id);
  await logActivity(c, admin, { action: "quotation.progress_updated", entity: "quotation", entityId: id });

  // Email the client the new progress (unless explicitly silenced).
  if (full && full.client.email && input.notifyClient !== false) {
    const statusLabel =
      (full.projectStatus && PROJECT_STATUS_LABELS[full.projectStatus as keyof typeof PROJECT_STATUS_LABELS]) ||
      "Updated";
    const email = quotationProgressEmail({
      clientName: full.client.name,
      quoteNumber: full.quoteNumber,
      title: full.title,
      statusLabel,
      steps: full.progress.map((p) => ({
        label: p.label,
        description: p.description,
        status: p.status,
      })),
      note: input.note,
      quotationUrl: `${(c.env.APP_URL ?? "").replace(/\/$/, "")}/quotation/${id}`,
      banking: full.projectStatus === "awaiting_deposit" ? full.banking : null,
      reference: full.quoteNumber,
      logoUrl: brandLogoUrl(c.env.ASSET_URL),
    });
    await sendLoggedEmail(c.env, {
      to: full.client.email,
      replyTo: c.env.NOTIFY_EMAIL_TO,
      subject: email.subject,
      html: email.html,
      template: "quotation_progress",
    });
  }

  return ok(c, full);
});

// Public: accept a quotation.
quotations.post("/:id/accept", zValidator("json", quotationAcceptSchema), async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return fail(c, "Quotation not found", 404);

  const body = c.req.valid("json");
  const ip = clientIp(c);
  const turnstile = await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY, body.turnstileToken, ip);
  if (!turnstile.success) return fail(c, "Human verification failed", 400);

  const client = db(c.env);
  const { data: existing } = await client
    .from("quotations")
    .select("id,status,quote_number,title")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return fail(c, "Quotation not found", 404);

  const firstAcceptance = existing.status !== "accepted";
  if (firstAcceptance) {
    await client
      .from("quotations")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        accepted_by_name: body.name ?? null,
        accepted_ip: ip ?? null,
        project_status: "awaiting_deposit",
      })
      .eq("id", id);

    // Seed the standard project stages (all pending) if none exist yet.
    const { count } = await client
      .from("quotation_progress")
      .select("id", { count: "exact", head: true })
      .eq("quotation_id", id);
    if (!count) {
      await client.from("quotation_progress").insert(defaultProgressRows(id));
    }
  }

  const full = await loadQuotation(client, id);
  if (!full) return fail(c, "Quotation not found", 404);

  if (firstAcceptance) {
    const acceptedByName = body.name?.trim() || full.client.name || "The client";
    const total = `${full.currency}${Number(full.total).toLocaleString("en-ZA", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
    const acceptedAt = new Date().toLocaleString("en-ZA");
    const portalUrl = `${(c.env.APP_URL ?? "").replace(/\/$/, "")}/ops`;
    const logoUrl = brandLogoUrl(c.env.ASSET_URL);

    // Notify the Rabbit 365 team that the client has accepted.
    if (c.env.NOTIFY_EMAIL_TO) {
      const email = quotationAcceptedTeamEmail({
        quoteNumber: full.quoteNumber,
        title: full.title,
        acceptedByName,
        company: full.client.company,
        clientEmail: full.client.email,
        total,
        acceptedAt,
        portalUrl,
        logoUrl,
      });
      await sendLoggedEmail(c.env, {
        to: c.env.NOTIFY_EMAIL_TO,
        replyTo: full.client.email || undefined,
        subject: email.subject,
        html: email.html,
        template: "quotation_accepted",
      });
    }

    // Confirm the acceptance to the client (using the email on the quotation).
    if (full.client.email) {
      const email = quotationAcceptanceClientEmail({
        clientName: full.client.name || acceptedByName,
        quoteNumber: full.quoteNumber,
        title: full.title,
        total,
        acceptedAt,
        quotationUrl: `${(c.env.APP_URL ?? "").replace(/\/$/, "")}/quotation/${id}`,
        banking: full.banking,
        reference: full.quoteNumber,
        logoUrl,
      });
      await sendLoggedEmail(c.env, {
        to: full.client.email,
        subject: email.subject,
        html: email.html,
        template: "quotation_acceptance_confirmation",
      });
    }
  }

  return ok(c, full);
});

export default quotations;
