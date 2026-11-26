import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../env";
import type { ClientSession } from "../types";
import {
  brandLogoUrl,
  clientRegisteredTeamEmail,
  supportTicketCreatedClient,
  supportTicketCreatedTeam,
  supportTicketReplyTeam,
} from "../lib/emails";
import { clientIp, fail, ok } from "../lib/http";
import { allowRequest } from "../lib/ratelimit";
import { sendLoggedEmail } from "../lib/notify";
import { setSessionCookies } from "../lib/session";
import { authDb, db } from "../lib/supabase";
import {
  listAttachments,
  normalizeUrl,
  saveAttachment,
  statusLabel,
  supportNotifyRecipients,
} from "../lib/support";
import { verifyTurnstile } from "../lib/turnstile";
import { clientRegisterSchema, ticketCreateSchema, ticketReplySchema } from "../lib/validate";
import { clientCanWrite, requireClient } from "../middleware/auth";

const clientRoutes = new Hono<Env>();

function session(c: Context<Env>): ClientSession {
  return c.get("client") as ClientSession;
}

function titleCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function fire(c: Context<Env>, task: Promise<unknown>) {
  try {
    c.executionCtx.waitUntil(task);
  } catch {
    void task;
  }
}

/* ------------------------------------------------------------------ */
/* Public: invites & registration                                      */
/* ------------------------------------------------------------------ */

clientRoutes.get("/invite/:code", async (c) => {
  const client = db(c.env);
  const { data: invite } = await client
    .from("client_invites")
    .select("email,role,used,expires_at,org_id")
    .eq("id", c.req.param("code"))
    .maybeSingle();

  if (!invite) return fail(c, "Invite not found", 404);

  const { data: org } = await client
    .from("client_orgs")
    .select("name,status,support_enabled")
    .eq("id", invite.org_id)
    .maybeSingle();

  const expired = invite.expires_at
    ? new Date(invite.expires_at).getTime() < Date.now()
    : false;
  const valid = !invite.used && !expired && Boolean(org);

  return ok(c, {
    email: invite.email,
    role: invite.role,
    orgName: org?.name ?? null,
    valid,
    reason: invite.used ? "used" : expired ? "expired" : !org ? "org_missing" : null,
  });
});

clientRoutes.post("/register", zValidator("json", clientRegisterSchema), async (c) => {
  const body = c.req.valid("json");
  const ip = clientIp(c) ?? "unknown";
  if (!(await allowRequest(c.env.AUTH_RATE_LIMITER, `client-register:${ip}`))) {
    return fail(c, "Too many registration attempts. Please try again shortly.", 429);
  }

  const turnstile = await verifyTurnstile(
    c.env.TURNSTILE_SECRET_KEY,
    body.turnstileToken,
    ip,
    c.env.ENVIRONMENT === "production",
  );
  if (!turnstile.success) return fail(c, "Human verification failed", 400);

  const client = db(c.env);
  const auth = authDb(c.env);

  const { data: invite, error: inviteError } = await client
    .from("client_invites")
    .select("*")
    .eq("id", body.inviteCode)
    .eq("used", false)
    .maybeSingle();
  if (inviteError) return fail(c, inviteError.message, 500);
  if (!invite) return fail(c, "This invite is invalid or has already been used", 400);
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return fail(c, "This invite has expired", 400);
  }
  if (invite.email && invite.email.toLowerCase() !== body.email.toLowerCase()) {
    return fail(c, "This invite is for a different email address", 400);
  }

  const { data: org } = await client
    .from("client_orgs")
    .select("id,name,status")
    .eq("id", invite.org_id)
    .maybeSingle();
  if (!org) return fail(c, "This organisation no longer exists", 400);
  if (org.status === "archived") return fail(c, "This organisation is no longer active", 400);

  const { data: created, error: createError } = await auth.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
    user_metadata: body.fullName ? { full_name: body.fullName } : undefined,
  });
  if (createError || !created.user) {
    return fail(c, createError?.message ?? "Could not create account", 400);
  }

  const { error: memberError } = await client.from("client_members").insert({
    org_id: invite.org_id,
    user_id: created.user.id,
    email: body.email,
    full_name: body.fullName ?? null,
    role: invite.role ?? "member",
    status: "active",
  });
  if (memberError) {
    await auth.auth.admin.deleteUser(created.user.id).catch(() => undefined);
    return fail(c, "This account is already linked to a client portal", 409);
  }

  await client
    .from("client_invites")
    .update({ used: true, used_at: new Date().toISOString(), used_by: created.user.id })
    .eq("id", invite.id);

  const { data: sessionData } = await auth.auth.signInWithPassword({
    email: body.email,
    password: body.password,
  });
  if (sessionData.session) setSessionCookies(c, sessionData.session);

  const appUrl = (c.env.APP_URL ?? "").replace(/\/$/, "");
  for (const to of supportNotifyRecipients(c.env)) {
    fire(
      c,
      sendLoggedEmail(c.env, {
        to,
        ...clientRegisteredTeamEmail({
          orgName: org.name,
          userName: body.fullName ?? null,
          email: body.email,
          registeredAt: new Date().toISOString(),
          portalUrl: `${appUrl}/ops`,
          logoUrl: brandLogoUrl(c.env.ASSET_URL),
        }),
        template: "support.client_registered_team",
      }),
    );
  }

  return ok(
    c,
    {
      user: { id: created.user.id, email: body.email },
      org: { id: org.id, name: org.name },
    },
    201,
  );
});

/* ------------------------------------------------------------------ */
/* Authed client                                                       */
/* ------------------------------------------------------------------ */

clientRoutes.get("/me", requireClient, async (c) => {
  const me = session(c);
  const { data: sites } = await db(c.env)
    .from("client_sites")
    .select("id,label,url,status")
    .eq("org_id", me.orgId)
    .neq("status", "archived")
    .order("created_at", { ascending: true });

  return ok(c, { client: me, sites: sites ?? [] });
});

clientRoutes.get("/tickets", requireClient, async (c) => {
  const me = session(c);
  const { data, error } = await db(c.env)
    .from("support_tickets")
    .select(
      "id,number,subject,status,priority,category,site_id,last_message_at,created_at,updated_at,client_sites(label)",
    )
    .eq("org_id", me.orgId)
    .order("last_message_at", { ascending: false });

  if (error) return fail(c, error.message, 500);
  const items = (data ?? []).map((row: Record<string, unknown>) => {
    const site = row.client_sites as { label?: string } | null;
    const rest = { ...row };
    delete rest.client_sites;
    return { ...rest, siteLabel: site?.label ?? null };
  });
  return ok(c, { items });
});

clientRoutes.post("/tickets", requireClient, zValidator("json", ticketCreateSchema), async (c) => {
  const me = session(c);
  if (!clientCanWrite(me)) {
    return fail(c, "Support is not enabled for this account. Please contact us.", 403);
  }

  const body = c.req.valid("json");
  const client = db(c.env);

  let site: { id: string; label: string; url: string } | null = null;
  if (body.siteId) {
    const { data } = await client
      .from("client_sites")
      .select("id,label,url")
      .eq("id", body.siteId)
      .eq("org_id", me.orgId)
      .maybeSingle();
    if (!data) return fail(c, "Website not found", 404);
    site = data;
  }

  const { data: ticket, error: ticketError } = await client
    .from("support_tickets")
    .insert({
      org_id: me.orgId,
      site_id: site?.id ?? null,
      created_by: me.memberId,
      subject: body.subject,
      category: body.category,
      priority: body.priority,
      status: "open",
    })
    .select("*")
    .single();
  if (ticketError || !ticket) return fail(c, ticketError?.message ?? "Could not create ticket", 500);

  const { data: message, error: messageError } = await client
    .from("support_messages")
    .insert({
      ticket_id: ticket.id,
      author_type: "client",
      author_id: me.userId,
      author_name: me.fullName ?? me.email,
      body: body.body,
      is_internal: false,
    })
    .select("*")
    .single();
  if (messageError) return fail(c, messageError.message, 500);

  await client
    .from("support_tickets")
    .update({ last_message_at: message.created_at })
    .eq("id", ticket.id);

  await client.from("support_events").insert({
    ticket_id: ticket.id,
    actor_type: "client",
    actor_id: me.userId,
    type: "created",
    to_value: "open",
  });

  const appUrl = (c.env.APP_URL ?? "").replace(/\/$/, "");
  const emailData = {
    appUrl,
    ticketId: ticket.id,
    number: ticket.number,
    subject: ticket.subject,
    orgName: me.orgName,
    siteLabel: site?.label ?? null,
    siteUrl: site ? normalizeUrl(site.url) : null,
    category: titleCase(body.category),
    priority: titleCase(body.priority),
    status: "Open",
    authorName: me.fullName ?? me.email,
    clientName: me.fullName ?? me.email,
    message: body.body,
    logoUrl: brandLogoUrl(c.env.ASSET_URL),
  };

  fire(
    c,
    sendLoggedEmail(c.env, {
      to: me.email,
      ...supportTicketCreatedClient(emailData),
      replyTo: "info@rabbit365.co.za",
      template: "support.ticket_created_client",
    }),
  );
  for (const to of supportNotifyRecipients(c.env)) {
    fire(
      c,
      sendLoggedEmail(c.env, {
        to,
        ...supportTicketCreatedTeam(emailData),
        template: "support.ticket_created_team",
      }),
    );
  }

  return ok(c, { ticket: { ...ticket, siteLabel: site?.label ?? null }, message }, 201);
});

clientRoutes.get("/tickets/:id", requireClient, async (c) => {
  const me = session(c);
  const client = db(c.env);
  const id = c.req.param("id");

  const { data: ticket } = await client
    .from("support_tickets")
    .select("*, client_sites(label,url)")
    .eq("id", id)
    .eq("org_id", me.orgId)
    .maybeSingle();
  if (!ticket) return fail(c, "Ticket not found", 404);

  const { data: messages } = await client
    .from("support_messages")
    .select("id,author_type,author_name,body,created_at")
    .eq("ticket_id", id)
    .eq("is_internal", false)
    .order("created_at", { ascending: true });

  const attachments = await listAttachments(client, id);

  const row = ticket as Record<string, unknown>;
  const site = row.client_sites as { label?: string; url?: string } | null;
  const rest = { ...row };
  delete rest.client_sites;

  return ok(c, {
    ticket: { ...rest, siteLabel: site?.label ?? null, siteUrl: site?.url ?? null },
    messages: messages ?? [],
    attachments,
  });
});

clientRoutes.post(
  "/tickets/:id/messages",
  requireClient,
  zValidator("json", ticketReplySchema),
  async (c) => {
    const me = session(c);
    if (!clientCanWrite(me)) {
      return fail(c, "Support is not enabled for this account. Please contact us.", 403);
    }

    const body = c.req.valid("json");
    const client = db(c.env);
    const id = c.req.param("id");

    const { data: ticket } = await client
      .from("support_tickets")
      .select("id,number,subject,status,site_id,client_sites(label,url)")
      .eq("id", id)
      .eq("org_id", me.orgId)
      .maybeSingle();
    if (!ticket) return fail(c, "Ticket not found", 404);

    const { data: message, error } = await client
      .from("support_messages")
      .insert({
        ticket_id: id,
        author_type: "client",
        author_id: me.userId,
        author_name: me.fullName ?? me.email,
        body: body.body,
        is_internal: false,
      })
      .select("*")
      .single();
    if (error || !message) return fail(c, error?.message ?? "Could not send reply", 500);

    const reopen = ticket.status === "resolved" || ticket.status === "closed";
    const nextStatus = reopen
      ? "open"
      : ticket.status === "waiting_on_client"
        ? "in_progress"
        : ticket.status;

    await client
      .from("support_tickets")
      .update({
        last_message_at: message.created_at,
        status: nextStatus,
        resolved_at: reopen ? null : undefined,
        closed_at: reopen ? null : undefined,
        waiting_since: null,
        reminder_sent_at: null,
      })
      .eq("id", id);

    if (nextStatus !== ticket.status) {
      await client.from("support_events").insert({
        ticket_id: id,
        actor_type: "client",
        actor_id: me.userId,
        type: "status_changed",
        from_value: ticket.status,
        to_value: nextStatus,
      });
    }

    const site = ticket.client_sites as { label?: string; url?: string } | null;
    const appUrl = (c.env.APP_URL ?? "").replace(/\/$/, "");
    const emailData = {
      appUrl,
      ticketId: id,
      number: ticket.number,
      subject: ticket.subject,
      orgName: me.orgName,
      siteLabel: site?.label ?? null,
      siteUrl: site?.url ? normalizeUrl(site.url) : null,
      category: "",
      priority: "",
      status: statusLabel(nextStatus),
      authorName: me.fullName ?? me.email,
      message: body.body,
      logoUrl: brandLogoUrl(c.env.ASSET_URL),
    };
    for (const to of supportNotifyRecipients(c.env)) {
      fire(
        c,
        sendLoggedEmail(c.env, {
          to,
          ...supportTicketReplyTeam(emailData),
          template: "support.ticket_reply_team",
        }),
      );
    }

    return ok(c, { message, status: nextStatus }, 201);
  },
);

clientRoutes.post("/tickets/:id/attachments", requireClient, async (c) => {
  const me = session(c);
  if (!clientCanWrite(me)) {
    return fail(c, "Support is not enabled for this account. Please contact us.", 403);
  }
  const client = db(c.env);
  const id = c.req.param("id");

  const { data: ticket } = await client
    .from("support_tickets")
    .select("id")
    .eq("id", id)
    .eq("org_id", me.orgId)
    .maybeSingle();
  if (!ticket) return fail(c, "Ticket not found", 404);

  const form = await c.req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") return fail(c, "No file uploaded", 400);

  const result = await saveAttachment({
    client,
    orgId: me.orgId,
    ticketId: id,
    file: file as File,
    uploadedBy: me.userId,
  });
  if (result.error || !result.attachment) {
    return fail(c, result.error ?? "Could not upload file", 400);
  }

  return ok(c, { attachment: result.attachment }, 201);
});

clientRoutes.post("/tickets/:id/close", requireClient, async (c) => {
  const me = session(c);
  const client = db(c.env);
  const id = c.req.param("id");

  const { data: ticket } = await client
    .from("support_tickets")
    .select("id,status")
    .eq("id", id)
    .eq("org_id", me.orgId)
    .maybeSingle();
  if (!ticket) return fail(c, "Ticket not found", 404);
  if (ticket.status === "closed") return ok(c, { ticket });

  const now = new Date().toISOString();
  const { data: updated, error } = await client
    .from("support_tickets")
    .update({
      status: "closed",
      closed_at: now,
      resolved_at: now,
      waiting_since: null,
      reminder_sent_at: null,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !updated) return fail(c, error?.message ?? "Could not close ticket", 500);

  await client.from("support_events").insert({
    ticket_id: id,
    actor_type: "client",
    actor_id: me.userId,
    type: "status_changed",
    from_value: ticket.status,
    to_value: "closed",
  });

  return ok(c, { ticket: updated });
});

export default clientRoutes;
