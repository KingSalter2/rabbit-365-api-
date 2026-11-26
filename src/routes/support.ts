import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../env";
import type { AdminUser } from "../types";
import { logActivity } from "../lib/audit";
import {
  brandLogoUrl,
  clientInviteEmail,
  supportTicketReplyClient,
  supportTicketStatusClient,
} from "../lib/emails";
import { clientIp, fail, ok } from "../lib/http";
import { sendLoggedEmail } from "../lib/notify";
import { allowRequest } from "../lib/ratelimit";
import { verifyPassword } from "../lib/reauth";
import { authDb, db } from "../lib/supabase";
import {
  listAttachments,
  normalizeUrl,
  orgRecipients,
  removeOrgAttachments,
  saveAttachment,
  statusLabel,
} from "../lib/support";
import {
  clientInviteCreateSchema,
  clientMemberUpdateSchema,
  clientOrgSchema,
  clientOrgUpdateSchema,
  clientSiteSchema,
  clientSiteUpdateSchema,
  reauthSchema,
  ticketAgentReplySchema,
  ticketUpdateSchema,
} from "../lib/validate";
import { requireAdmin, requireSuperadmin } from "../middleware/auth";

const support = new Hono<Env>();

support.use("*", requireAdmin);

function admin(c: Context<Env>): AdminUser {
  return c.get("admin") as AdminUser;
}

function fire(c: Context<Env>, task: Promise<unknown>) {
  try {
    c.executionCtx.waitUntil(task);
  } catch {
    void task;
  }
}

function titleCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/* ------------------------------------------------------------------ */
/* Stats & queue                                                       */
/* ------------------------------------------------------------------ */

support.get("/agents", async (c) => {
  const { data, error } = await db(c.env)
    .from("admin_users")
    .select("id,email,full_name,role")
    .order("email", { ascending: true });
  if (error) return fail(c, error.message, 500);
  return ok(c, { items: data ?? [] });
});

support.get("/stats", async (c) => {
  const client = db(c.env);
  const { data: tickets } = await client
    .from("support_tickets")
    .select("status,assigned_to,last_message_at");

  const rows = (tickets ?? []) as { status: string; assigned_to: string | null }[];
  const counts: Record<string, number> = {
    open: 0,
    in_progress: 0,
    waiting_on_client: 0,
    resolved: 0,
    closed: 0,
  };
  let unassigned = 0;
  let total = 0;
  for (const row of rows) {
    total += 1;
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    if (
      !row.assigned_to &&
      (row.status === "open" || row.status === "in_progress" || row.status === "waiting_on_client")
    ) {
      unassigned += 1;
    }
  }

  const { data: orgs } = await client
    .from("client_orgs")
    .select("id")
    .neq("status", "archived");

  const { data: recent } = await client
    .from("support_tickets")
    .select("id,number,subject,status,priority,last_message_at,client_orgs(name)")
    .order("last_message_at", { ascending: false })
    .limit(5);

  return ok(c, {
    counts: { ...counts, total, unassigned, orgs: (orgs ?? []).length },
    active: counts.open + counts.in_progress + counts.waiting_on_client,
    recent: (recent ?? []).map((row: Record<string, unknown>) => {
      const org = row.client_orgs as { name?: string } | null;
      const rest = { ...row };
      delete rest.client_orgs;
      return { ...rest, orgName: org?.name ?? null };
    }),
  });
});

support.get("/tickets", async (c) => {
  const client = db(c.env);
  const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(c.req.query("limit") ?? "25", 10) || 25));
  const from = (page - 1) * limit;

  let query = client
    .from("support_tickets")
    .select("*, client_orgs(id,name), client_sites(label,url)", { count: "exact" })
    .order("last_message_at", { ascending: false })
    .range(from, from + limit - 1);

  const status = (c.req.query("status") ?? "").trim();
  if (status === "active") {
    query = query.in("status", ["open", "in_progress", "waiting_on_client"]);
  } else if (status && status !== "all") {
    const list = status.split(",").filter(Boolean);
    if (list.length) query = query.in("status", list);
  }

  const priority = (c.req.query("priority") ?? "").trim();
  if (priority && priority !== "all") query = query.eq("priority", priority);

  const orgId = (c.req.query("orgId") ?? "").trim();
  if (orgId) query = query.eq("org_id", orgId);

  const assignee = (c.req.query("assignedTo") ?? "").trim();
  if (assignee === "me") query = query.eq("assigned_to", admin(c).id);
  else if (assignee === "unassigned") query = query.is("assigned_to", null);
  else if (assignee) query = query.eq("assigned_to", assignee);

  const term = (c.req.query("q") ?? "").replace(/[,%()]/g, " ").trim();
  if (term) query = query.or(`subject.ilike.%${term}%,number.ilike.%${term}%`);

  const { data, error, count } = await query;
  if (error) return fail(c, error.message, 500);

  const items = (data ?? []).map((row: Record<string, unknown>) => {
    const org = row.client_orgs as { id?: string; name?: string } | null;
    const site = row.client_sites as { label?: string; url?: string } | null;
    const rest = { ...row };
    delete rest.client_orgs;
    delete rest.client_sites;
    return {
      ...rest,
      orgName: org?.name ?? null,
      siteLabel: site?.label ?? null,
      siteUrl: site?.url ?? null,
    };
  });

  return ok(c, { items, page, limit, total: count ?? items.length });
});

support.get("/tickets/:id", async (c) => {
  const client = db(c.env);
  const id = c.req.param("id");

  const { data: ticket } = await client
    .from("support_tickets")
    .select("*, client_orgs(id,name,contact_email), client_sites(label,url)")
    .eq("id", id)
    .maybeSingle();
  if (!ticket) return fail(c, "Ticket not found", 404);

  const { data: messages } = await client
    .from("support_messages")
    .select("*")
    .eq("ticket_id", id)
    .order("created_at", { ascending: true });

  const { data: events } = await client
    .from("support_events")
    .select("*")
    .eq("ticket_id", id)
    .order("created_at", { ascending: true });

  const attachments = await listAttachments(client, id);

  const row = ticket as Record<string, unknown>;
  const org = row.client_orgs as { id?: string; name?: string; contact_email?: string } | null;
  const site = row.client_sites as { label?: string; url?: string } | null;
  const rest = { ...row };
  delete rest.client_orgs;
  delete rest.client_sites;

  return ok(c, {
    ticket: {
      ...rest,
      orgName: org?.name ?? null,
      orgContactEmail: org?.contact_email ?? null,
      siteLabel: site?.label ?? null,
      siteUrl: site?.url ?? null,
    },
    messages: messages ?? [],
    events: events ?? [],
    attachments,
  });
});

support.patch("/tickets/:id", zValidator("json", ticketUpdateSchema), async (c) => {
  const client = db(c.env);
  const me = admin(c);
  const id = c.req.param("id");
  const body = c.req.valid("json");

  const { data: ticket } = await client
    .from("support_tickets")
    .select("*, client_orgs(name,contact_email), client_sites(label,url)")
    .eq("id", id)
    .maybeSingle();
  if (!ticket) return fail(c, "Ticket not found", 404);

  const patch: Record<string, unknown> = {};
  if (body.status !== undefined) patch.status = body.status;
  if (body.priority !== undefined) patch.priority = body.priority;
  if (body.category !== undefined) patch.category = body.category;
  if (body.assignedTo !== undefined) patch.assigned_to = body.assignedTo;
  if (body.relatedQuotationId !== undefined) {
    patch.related_quotation_id = body.relatedQuotationId;
  }
  const now = new Date().toISOString();
  let statusChanged = false;
  if (body.status && body.status !== ticket.status) {
    statusChanged = true;
    if (body.status === "resolved") patch.resolved_at = now;
    if (body.status === "closed") patch.closed_at = now;
    if (body.status === "open" || body.status === "in_progress") {
      patch.resolved_at = null;
      patch.closed_at = null;
    }
    if (body.status === "waiting_on_client") {
      patch.waiting_since = now;
      patch.reminder_sent_at = null;
    } else {
      patch.waiting_since = null;
      patch.reminder_sent_at = null;
    }
  }

  const { data: updated, error } = await client
    .from("support_tickets")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !updated) return fail(c, error?.message ?? "Could not update ticket", 500);

  const changes: { type: string; from: string | null; to: string | null }[] = [];
  if (body.status && body.status !== ticket.status) {
    changes.push({ type: "status_changed", from: ticket.status, to: body.status });
  }
  if (body.priority && body.priority !== ticket.priority) {
    changes.push({ type: "priority_changed", from: ticket.priority, to: body.priority });
  }
  if (body.assignedTo !== undefined && body.assignedTo !== ticket.assigned_to) {
    changes.push({
      type: "assigned",
      from: ticket.assigned_to ?? null,
      to: body.assignedTo ?? null,
    });
  }
  for (const change of changes) {
    await client.from("support_events").insert({
      ticket_id: id,
      actor_type: "agent",
      actor_id: me.id,
      type: change.type,
      from_value: change.from,
      to_value: change.to,
    });
  }

  if (statusChanged && body.status) {
    const org = ticket.client_orgs as { name?: string; contact_email?: string } | null;
    const site = ticket.client_sites as { label?: string; url?: string } | null;
    const appUrl = (c.env.APP_URL ?? "").replace(/\/$/, "");
    const recipients = await orgRecipients(client, ticket.org_id, org?.contact_email);
    for (const recipient of recipients) {
      fire(
        c,
        sendLoggedEmail(c.env, {
          to: recipient.email,
          ...supportTicketStatusClient({
            appUrl,
            ticketId: id,
            number: ticket.number,
            subject: ticket.subject,
            orgName: org?.name ?? "",
            siteLabel: site?.label ?? null,
            siteUrl: site?.url ? normalizeUrl(site.url) : null,
            category: titleCase(ticket.category),
            priority: titleCase(ticket.priority),
            status: statusLabel(body.status),
            clientName: recipient.fullName ?? undefined,
            logoUrl: brandLogoUrl(c.env.ASSET_URL),
          }),
          replyTo: "info@rabbit365.co.za",
          template: "support.ticket_status_client",
        }),
      );
    }
  }

  await logActivity(c, me, {
    action: "support.ticket_updated",
    entity: "support_ticket",
    entityId: id,
    metadata: { ...body },
  });

  return ok(c, { ticket: updated });
});

support.post(
  "/tickets/:id/messages",
  zValidator("json", ticketAgentReplySchema),
  async (c) => {
    const client = db(c.env);
    const me = admin(c);
    const id = c.req.param("id");
    const body = c.req.valid("json");

    const { data: ticket } = await client
      .from("support_tickets")
      .select("*, client_orgs(name,contact_email), client_sites(label,url)")
      .eq("id", id)
      .maybeSingle();
    if (!ticket) return fail(c, "Ticket not found", 404);

    const isInternal = Boolean(body.isInternal);
    const { data: message, error } = await client
      .from("support_messages")
      .insert({
        ticket_id: id,
        author_type: "agent",
        author_id: me.id,
        author_name: me.fullName ?? me.email,
        body: body.body,
        is_internal: isInternal,
      })
      .select("*")
      .single();
    if (error || !message) return fail(c, error?.message ?? "Could not send reply", 500);

    if (!isInternal) {
      const resolving = Boolean(body.resolve);
      const nextStatus = resolving
        ? "resolved"
        : ticket.status === "open" || ticket.status === "in_progress"
          ? "waiting_on_client"
          : ticket.status;
      const patch: Record<string, unknown> = { last_message_at: message.created_at };
      if (nextStatus !== ticket.status) patch.status = nextStatus;
      if (!ticket.first_response_at) patch.first_response_at = message.created_at;
      if (nextStatus === "waiting_on_client") {
        patch.waiting_since = message.created_at;
        patch.reminder_sent_at = null;
      } else {
        patch.waiting_since = null;
        patch.reminder_sent_at = null;
      }
      if (resolving) {
        patch.resolved_at = ticket.resolved_at ?? message.created_at;
        patch.closed_at = null;
      }
      await client.from("support_tickets").update(patch).eq("id", id);

      if (nextStatus !== ticket.status) {
        await client.from("support_events").insert({
          ticket_id: id,
          actor_type: "agent",
          actor_id: me.id,
          type: "status_changed",
          from_value: ticket.status,
          to_value: nextStatus,
        });
      }

      const org = ticket.client_orgs as { name?: string; contact_email?: string } | null;
      const site = ticket.client_sites as { label?: string; url?: string } | null;
      const appUrl = (c.env.APP_URL ?? "").replace(/\/$/, "");
      const recipients = await orgRecipients(client, ticket.org_id, org?.contact_email);
      for (const recipient of recipients) {
        fire(
          c,
          sendLoggedEmail(c.env, {
            to: recipient.email,
            ...supportTicketReplyClient({
              appUrl,
              ticketId: id,
              number: ticket.number,
              subject: ticket.subject,
              orgName: org?.name ?? "",
              siteLabel: site?.label ?? null,
              siteUrl: site?.url ? normalizeUrl(site.url) : null,
              category: titleCase(ticket.category),
              priority: titleCase(ticket.priority),
              status: statusLabel(nextStatus),
              authorName: me.fullName ?? me.email,
              clientName: recipient.fullName ?? undefined,
              message: body.body,
              resolved: resolving,
              logoUrl: brandLogoUrl(c.env.ASSET_URL),
            }),
            replyTo: "info@rabbit365.co.za",
            template: "support.ticket_reply_client",
          }),
        );
      }
    }

    await logActivity(c, me, {
      action: isInternal ? "support.note_added" : "support.reply_sent",
      entity: "support_ticket",
      entityId: id,
    });

    return ok(c, { message }, 201);
  },
);

support.post("/tickets/:id/attachments", async (c) => {
  const client = db(c.env);
  const me = admin(c);
  const id = c.req.param("id");

  const { data: ticket } = await client
    .from("support_tickets")
    .select("id,org_id")
    .eq("id", id)
    .maybeSingle();
  if (!ticket) return fail(c, "Ticket not found", 404);

  const form = await c.req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") return fail(c, "No file uploaded", 400);

  const result = await saveAttachment({
    client,
    orgId: ticket.org_id,
    ticketId: id,
    file: file as File,
    uploadedBy: me.id,
  });
  if (result.error || !result.attachment) {
    return fail(c, result.error ?? "Could not upload file", 400);
  }
  return ok(c, { attachment: result.attachment }, 201);
});

/* ------------------------------------------------------------------ */
/* Organisations                                                       */
/* ------------------------------------------------------------------ */

support.get("/orgs", async (c) => {
  const client = db(c.env);
  const { data: orgs, error } = await client
    .from("client_orgs")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return fail(c, error.message, 500);

  const ids = (orgs ?? []).map((org: { id: string }) => org.id);
  const [sites, members, tickets] = await Promise.all([
    ids.length
      ? client.from("client_sites").select("org_id,status").in("org_id", ids)
      : Promise.resolve({ data: [] }),
    ids.length
      ? client.from("client_members").select("org_id,status").in("org_id", ids)
      : Promise.resolve({ data: [] }),
    ids.length
      ? client.from("support_tickets").select("org_id,status").in("org_id", ids)
      : Promise.resolve({ data: [] }),
  ]);

  const siteCount = new Map<string, number>();
  for (const row of (sites.data ?? []) as { org_id: string; status: string }[]) {
    if (row.status !== "archived") siteCount.set(row.org_id, (siteCount.get(row.org_id) ?? 0) + 1);
  }
  const memberCount = new Map<string, number>();
  for (const row of (members.data ?? []) as { org_id: string; status: string }[]) {
    if (row.status === "active") memberCount.set(row.org_id, (memberCount.get(row.org_id) ?? 0) + 1);
  }
  const openCount = new Map<string, number>();
  for (const row of (tickets.data ?? []) as { org_id: string; status: string }[]) {
    if (row.status === "open" || row.status === "in_progress" || row.status === "waiting_on_client") {
      openCount.set(row.org_id, (openCount.get(row.org_id) ?? 0) + 1);
    }
  }

  return ok(c, {
    items: (orgs ?? []).map((org: { id: string }) => ({
      ...org,
      siteCount: siteCount.get(org.id) ?? 0,
      memberCount: memberCount.get(org.id) ?? 0,
      openTickets: openCount.get(org.id) ?? 0,
    })),
  });
});

support.post("/orgs", zValidator("json", clientOrgSchema), async (c) => {
  const client = db(c.env);
  const me = admin(c);
  const body = c.req.valid("json");

  const base = slugify(body.slug || body.name);
  let slug = base || `client-${Date.now()}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: existing } = await client
      .from("client_orgs")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!existing) break;
    slug = `${base || "client"}-${attempt + 2}`;
  }

  const { data, error } = await client
    .from("client_orgs")
    .insert({
      name: body.name,
      slug,
      primary_contact_name: body.primaryContactName ?? null,
      contact_email: body.contactEmail ?? null,
      contact_phone: body.contactPhone ?? null,
      notes: body.notes ?? null,
      related_quotation_id: body.relatedQuotationId ?? null,
      status: body.status ?? "active",
      support_enabled: body.supportEnabled ?? true,
      created_by: me.id,
    })
    .select("*")
    .single();
  if (error || !data) {
    if (error?.code === "23505") return fail(c, "A client with this slug already exists", 409);
    return fail(c, error?.message ?? "Could not create client", 500);
  }

  await logActivity(c, me, {
    action: "support.client_created",
    entity: "client_org",
    entityId: data.id,
    metadata: { name: body.name },
  });

  return ok(c, { org: data }, 201);
});

support.get("/orgs/:id", async (c) => {
  const client = db(c.env);
  const id = c.req.param("id");

  const { data: org } = await client.from("client_orgs").select("*").eq("id", id).maybeSingle();
  if (!org) return fail(c, "Client not found", 404);

  const [sites, members, invites, tickets] = await Promise.all([
    client.from("client_sites").select("*").eq("org_id", id).order("created_at"),
    client.from("client_members").select("*").eq("org_id", id).order("created_at"),
    client
      .from("client_invites")
      .select("*")
      .eq("org_id", id)
      .eq("used", false)
      .order("created_at", { ascending: false }),
    client
      .from("support_tickets")
      .select("id,number,subject,status,priority,last_message_at")
      .eq("org_id", id)
      .order("last_message_at", { ascending: false })
      .limit(20),
  ]);

  return ok(c, {
    org,
    sites: sites.data ?? [],
    members: members.data ?? [],
    invites: invites.data ?? [],
    tickets: tickets.data ?? [],
  });
});

support.patch("/orgs/:id", zValidator("json", clientOrgUpdateSchema), async (c) => {
  const client = db(c.env);
  const me = admin(c);
  const body = c.req.valid("json");
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.slug !== undefined) patch.slug = body.slug;
  if (body.primaryContactName !== undefined) {
    patch.primary_contact_name = body.primaryContactName;
  }
  if (body.contactEmail !== undefined) patch.contact_email = body.contactEmail;
  if (body.contactPhone !== undefined) patch.contact_phone = body.contactPhone;
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.relatedQuotationId !== undefined) {
    patch.related_quotation_id = body.relatedQuotationId;
  }
  if (body.status !== undefined) patch.status = body.status;
  if (body.supportEnabled !== undefined) patch.support_enabled = body.supportEnabled;

  const { data, error } = await client
    .from("client_orgs")
    .update(patch)
    .eq("id", c.req.param("id"))
    .select("*")
    .maybeSingle();
  if (error) return fail(c, error.message, 500);
  if (!data) return fail(c, "Client not found", 404);

  await logActivity(c, me, {
    action: "support.client_updated",
    entity: "client_org",
    entityId: data.id,
    metadata: { ...body },
  });
  return ok(c, { org: data });
});

support.delete(
  "/orgs/:id",
  requireSuperadmin,
  zValidator("json", reauthSchema),
  async (c) => {
    const client = db(c.env);
    const auth = authDb(c.env);
    const me = admin(c);
    const id = c.req.param("id");

    const ip = clientIp(c) ?? "unknown";
    if (!(await allowRequest(c.env.AUTH_RATE_LIMITER, `reauth:${ip}`))) {
      return fail(c, "Too many attempts. Please try again shortly.", 429);
    }
    if (!(await verifyPassword(c, me.email, c.req.valid("json").password))) {
      return fail(c, "Password confirmation failed", 403);
    }

    const { data: org } = await client
      .from("client_orgs")
      .select("id,name")
      .eq("id", id)
      .maybeSingle();
    if (!org) return fail(c, "Client not found", 404);

    const { data: members } = await client
      .from("client_members")
      .select("user_id")
      .eq("org_id", id);
    const userIds = ((members ?? []) as { user_id: string }[])
      .map((member) => member.user_id)
      .filter(Boolean);

    let adminIds = new Set<string>();
    if (userIds.length) {
      const { data: admins } = await client
        .from("admin_users")
        .select("id")
        .in("id", userIds);
      adminIds = new Set(((admins ?? []) as { id: string }[]).map((row) => row.id));
    }

    await removeOrgAttachments(client, id).catch(() => undefined);

    let deletedUsers = 0;
    for (const userId of userIds) {
      if (adminIds.has(userId)) continue;
      const { error } = await auth.auth.admin.deleteUser(userId);
      if (!error) deletedUsers += 1;
    }

    const { error } = await client.from("client_orgs").delete().eq("id", id);
    if (error) return fail(c, error.message, 500);

    await logActivity(c, me, {
      action: "support.client_deleted",
      entity: "client_org",
      entityId: id,
      metadata: { name: org.name, deletedUsers },
    });

    return ok(c, { id, name: org.name, deletedUsers });
  },
);

support.post("/orgs/:id/sites", zValidator("json", clientSiteSchema), async (c) => {
  const body = c.req.valid("json");
  const { data, error } = await db(c.env)
    .from("client_sites")
    .insert({
      org_id: c.req.param("id"),
      label: body.label,
      url: normalizeUrl(body.url),
      status: body.status ?? "live",
    })
    .select("*")
    .single();
  if (error || !data) return fail(c, error?.message ?? "Could not add website", 500);
  return ok(c, { site: data }, 201);
});

support.patch("/sites/:id", zValidator("json", clientSiteUpdateSchema), async (c) => {
  const body = c.req.valid("json");
  const patch: Record<string, unknown> = { ...body };
  if (body.url) patch.url = normalizeUrl(body.url);
  const { data, error } = await db(c.env)
    .from("client_sites")
    .update(patch)
    .eq("id", c.req.param("id"))
    .select("*")
    .maybeSingle();
  if (error) return fail(c, error.message, 500);
  if (!data) return fail(c, "Website not found", 404);
  return ok(c, { site: data });
});

support.delete("/sites/:id", async (c) => {
  const { error } = await db(c.env).from("client_sites").delete().eq("id", c.req.param("id"));
  if (error) return fail(c, error.message, 500);
  return ok(c, { id: c.req.param("id") });
});

support.post("/orgs/:id/invites", zValidator("json", clientInviteCreateSchema), async (c) => {
  const client = db(c.env);
  const me = admin(c);
  const body = c.req.valid("json");
  const orgId = c.req.param("id");

  const { data: org } = await client
    .from("client_orgs")
    .select("id,name,status")
    .eq("id", orgId)
    .maybeSingle();
  if (!org) return fail(c, "Client not found", 404);

  const days = body.expiresInDays ?? 14;
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();

  const { data, error } = await client
    .from("client_invites")
    .insert({
      org_id: orgId,
      email: body.email,
      role: body.role ?? "member",
      invited_by: me.id,
      expires_at: expiresAt,
    })
    .select("*")
    .single();
  if (error || !data) {
    if (error?.code === "23505") {
      return fail(c, "There is already a pending invite for this email", 409);
    }
    return fail(c, error?.message ?? "Could not create invite", 500);
  }

  const appUrl = (c.env.APP_URL ?? "").replace(/\/$/, "");
  const link = `${appUrl}/support/register?invite=${data.id}`;

  fire(
    c,
    sendLoggedEmail(c.env, {
      to: body.email,
      ...clientInviteEmail({
        orgName: org.name,
        email: body.email,
        inviteUrl: link,
        expiresAt,
        invitedByName: me.fullName ?? me.email,
        logoUrl: brandLogoUrl(c.env.ASSET_URL),
      }),
      replyTo: "info@rabbit365.co.za",
      template: "support.client_invite",
    }),
  );

  await logActivity(c, me, {
    action: "support.client_invite_created",
    entity: "client_invite",
    entityId: data.id,
    metadata: { email: body.email, orgId },
  });

  return ok(c, { invite: data, link }, 201);
});

support.delete("/invites/:id", async (c) => {
  const me = admin(c);
  const id = c.req.param("id");
  const { error } = await db(c.env).from("client_invites").delete().eq("id", id);
  if (error) return fail(c, error.message, 500);
  await logActivity(c, me, {
    action: "support.client_invite_deleted",
    entity: "client_invite",
    entityId: id,
  });
  return ok(c, { id });
});

support.patch("/members/:id", zValidator("json", clientMemberUpdateSchema), async (c) => {
  const me = admin(c);
  const body = c.req.valid("json");
  const { data, error } = await db(c.env)
    .from("client_members")
    .update(body)
    .eq("id", c.req.param("id"))
    .select("*")
    .maybeSingle();
  if (error) return fail(c, error.message, 500);
  if (!data) return fail(c, "Member not found", 404);

  await logActivity(c, me, {
    action: "support.client_member_updated",
    entity: "client_member",
    entityId: data.id,
    metadata: { ...body },
  });
  return ok(c, { member: data });
});

export default support;
