import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { Env } from "../env";
import { logActivity } from "../lib/audit";
import { clientIp, fail, ok } from "../lib/http";
import { clearSessionCookies, getAdminUser, setSessionCookies } from "../lib/session";
import { authDb, db } from "../lib/supabase";
import { verifyTurnstile } from "../lib/turnstile";
import { inviteCreateSchema, loginSchema, registerSchema } from "../lib/validate";
import { requireAdmin, requireSuperadmin } from "../middleware/auth";

const auth = new Hono<Env>();

// Public: log in.
auth.post("/login", zValidator("json", loginSchema), async (c) => {
  const body = c.req.valid("json");
  const turnstile = await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY, body.turnstileToken, clientIp(c));
  if (!turnstile.success) return fail(c, "Human verification failed", 400);

  const auth = authDb(c.env);
  const { data, error } = await auth.auth.signInWithPassword({
    email: body.email,
    password: body.password,
  });
  if (error || !data.session || !data.user) return fail(c, "Invalid email or password", 401);

  const client = db(c.env);
  const superEmail = (c.env.SUPERADMIN_EMAIL ?? "").trim().toLowerCase();
  const { data: existing } = await client
    .from("admin_users")
    .select("id")
    .eq("id", data.user.id)
    .maybeSingle();

  const isSuper = Boolean(data.user.email && superEmail && data.user.email.toLowerCase() === superEmail);
  if (!existing && !isSuper) {
    return fail(c, "This account does not have portal access", 403);
  }
  if (!existing && isSuper && data.user.email) {
    await client
      .from("admin_users")
      .upsert({ id: data.user.id, email: data.user.email, role: "superadmin" });
  }

  await client
    .from("admin_users")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", data.user.id);

  setSessionCookies(c, data.session);
  return ok(c, { user: { id: data.user.id, email: data.user.email } });
});

// Public: register using an invite code.
auth.post("/register", zValidator("json", registerSchema), async (c) => {
  const body = c.req.valid("json");
  const turnstile = await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY, body.turnstileToken, clientIp(c));
  if (!turnstile.success) return fail(c, "Human verification failed", 400);

  const client = db(c.env);
  const auth = authDb(c.env);
  const { data: invite, error: inviteError } = await client
    .from("admin_invites")
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

  const { data: created, error: createError } = await auth.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
  });
  if (createError || !created.user) {
    return fail(c, createError?.message ?? "Could not create account", 400);
  }

  await client.from("admin_users").insert({
    id: created.user.id,
    email: body.email,
    role: invite.role ?? "admin",
    full_name: body.fullName ?? null,
  });
  await client
    .from("admin_invites")
    .update({ used: true, used_at: new Date().toISOString(), used_by: created.user.id })
    .eq("id", invite.id);

  const { data: sessionData } = await auth.auth.signInWithPassword({
    email: body.email,
    password: body.password,
  });
  if (sessionData.session) setSessionCookies(c, sessionData.session);

  return ok(c, { user: { id: created.user.id, email: body.email } }, 201);
});

// Public: validate an invite code (for the register screen).
auth.get("/invite/:code", async (c) => {
  const { data } = await db(c.env)
    .from("admin_invites")
    .select("email,role,used,expires_at")
    .eq("id", c.req.param("code"))
    .maybeSingle();
  if (!data) return fail(c, "Invite not found", 404);
  const expired = data.expires_at ? new Date(data.expires_at).getTime() < Date.now() : false;
  return ok(c, { email: data.email, role: data.role, valid: !data.used && !expired });
});

// Authed: current admin.
auth.get("/me", requireAdmin, (c) => ok(c, { admin: c.get("admin") }));

// Authed: log out.
auth.post("/logout", (c) => {
  clearSessionCookies(c);
  return ok(c, {});
});

// Superadmin: list invites.
auth.get("/invites", requireSuperadmin, async (c) => {
  const { data, error } = await db(c.env)
    .from("admin_invites")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return fail(c, error.message, 500);
  return ok(c, { items: data ?? [] });
});

// Superadmin: create an invite.
auth.post("/invites", requireSuperadmin, zValidator("json", inviteCreateSchema), async (c) => {
  const admin = await getAdminUser(c);
  const body = c.req.valid("json");
  const days = body.expiresInDays ?? 7;
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();

  const { data, error } = await db(c.env)
    .from("admin_invites")
    .insert({
      email: body.email,
      role: body.role ?? "admin",
      invited_by: admin?.id ?? null,
      expires_at: expiresAt,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") return fail(c, "There is already a pending invite for this email", 409);
    return fail(c, error.message, 500);
  }

  const appUrl = (c.env.APP_URL ?? "").replace(/\/$/, "");
  const link = `${appUrl}/ops?mode=register&invite=${data.id}`;
  await logActivity(c, admin, {
    action: "invite.created",
    entity: "admin_invite",
    entityId: data.id,
    metadata: { email: body.email, role: body.role ?? "admin" },
  });
  return ok(c, { invite: data, link }, 201);
});

// Superadmin: revoke an invite.
auth.delete("/invites/:id", requireSuperadmin, async (c) => {
  const admin = await getAdminUser(c);
  const id = c.req.param("id");
  const { error } = await db(c.env).from("admin_invites").delete().eq("id", id);
  if (error) return fail(c, error.message, 500);
  await logActivity(c, admin, { action: "invite.deleted", entity: "admin_invite", entityId: id });
  return ok(c, { id });
});

export default auth;
