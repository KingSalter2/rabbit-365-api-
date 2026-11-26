import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../env";
import { logActivity } from "../lib/audit";
import { brandLogoUrl, mfaOtpEmail, passwordResetEmail } from "../lib/emails";
import { clientIp, fail, ok } from "../lib/http";
import { sendLoggedEmail } from "../lib/notify";
import { generateOtpCode, hashOtp } from "../lib/otp";
import { allowRequest } from "../lib/ratelimit";
import { verifyPassword } from "../lib/reauth";
import {
  clearPendingMfaCookie,
  clearSessionCookies,
  getAdminUser,
  getPendingMfa,
  getPendingMfaToken,
  getSessionUser,
  revokeCurrentSession,
  setPendingMfa,
  setSessionCookies,
} from "../lib/session";
import { authDb, db, userAuthDb } from "../lib/supabase";
import { verifyTurnstile } from "../lib/turnstile";
import {
  forgotPasswordSchema,
  inviteCreateSchema,
  loginSchema,
  mfaChallengeSchema,
  mfaEmailSendSchema,
  mfaEmailVerifySchema,
  mfaEnrollSchema,
  mfaPreferenceSchema,
  mfaVerifySchema,
  reauthSchema,
  registerSchema,
  resetPasswordSchema,
} from "../lib/validate";
import { requireAdmin, requireSuperadmin } from "../middleware/auth";

const auth = new Hono<Env>();

function turnstileRequired(env: Env["Bindings"]): boolean {
  return env.ENVIRONMENT === "production";
}

function passwordResetRedirect(c: Context<Env>, portal: "admin" | "client"): string {
  const base = (c.env.APP_URL ?? new URL(c.req.url).origin).replace(/\/$/, "");
  return `${base}/reset-password?portal=${portal}`;
}

async function getAdminMfaMethod(c: Context<Env>, userId: string): Promise<"totp"|"email"> {
  const { data } = await db(c.env).from("admin_users").select("mfa_method").eq("id", userId).maybeSingle();
  return data?.mfa_method === "email" ? "email" : "totp";
}
function otpSecret(c: Context<Env>) { return c.env.SUPABASE_SERVICE_ROLE_KEY; }
async function sendEmailOtp(c: Context<Env>, userId: string, email: string, purpose: "login"|"verify") {
  const code = generateOtpCode();
  const codeHash = await hashOtp(userId, purpose, code, otpSecret(c));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const client = db(c.env);
  await client.from("admin_email_otps").delete().eq("user_id", userId).eq("purpose", purpose).is("consumed_at", null);
  const { error } = await client.from("admin_email_otps").insert({ user_id: userId, email, purpose, code_hash: codeHash, expires_at: expiresAt, max_attempts: 5 });
  if (error) throw new Error(error.message);
  const msg = mfaOtpEmail({ code, purpose, logoUrl: brandLogoUrl(c.env.ASSET_URL) });
  await sendLoggedEmail(c.env, { to: email, subject: msg.subject, html: msg.html, template: `admin-mfa-otp-${purpose}`, storeBody: false });
}
async function verifyEmailOtp(c: Context<Env>, userId: string, purpose: "login"|"verify", code: string) {
  const client = db(c.env);
  const { data } = await client.from("admin_email_otps").select("id,code_hash,expires_at,attempts,max_attempts").eq("user_id", userId).eq("purpose", purpose).is("consumed_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return { ok: false as const, message: "Verification code not found or expired." };
  if (new Date(data.expires_at).getTime() < Date.now()) return { ok: false as const, message: "Verification code expired. Request a new code." };
  if ((data.attempts ?? 0) >= (data.max_attempts ?? 5)) return { ok: false as const, message: "Too many invalid attempts. Request a new code." };
  const expected = await hashOtp(userId, purpose, code, otpSecret(c));
  if (expected !== data.code_hash) { await client.from("admin_email_otps").update({ attempts: (data.attempts ?? 0) + 1 }).eq("id", data.id); return { ok: false as const, message: "Invalid verification code." }; }
  await client.from("admin_email_otps").update({ consumed_at: new Date().toISOString() }).eq("id", data.id);
  return { ok: true as const };
}
async function verifyMfaAdmin(c: Context<Env>) {
  const me = c.get("admin");
  if (!me) return null;
  const { data } = await authDb(c.env).auth.admin.mfa.listFactors({ userId: me.id });
  return data?.factors ?? [];
}

// Public: log in.
auth.post("/login", zValidator("json", loginSchema), async (c) => {
  const body = c.req.valid("json");
  const ip = clientIp(c) ?? "unknown";
  if (!(await allowRequest(c.env.AUTH_RATE_LIMITER, `login:${ip}:${body.email.toLowerCase()}`))) {
    return fail(c, "Too many sign-in attempts. Please try again shortly.", 429);
  }

  const turnstile = await verifyTurnstile(
    c.env.TURNSTILE_SECRET_KEY,
    body.turnstileToken,
    ip,
    turnstileRequired(c.env),
  );
  if (!turnstile.success) return fail(c, "Human verification failed", 400);

  const authClient = authDb(c.env);
  const { data, error } = await authClient.auth.signInWithPassword({
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
  const isAdmin = Boolean(existing) || isSuper;

  if (!isAdmin) {
    const { data: member } = await client
      .from("client_members")
      .select("id,status")
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (!member || member.status !== "active") {
      return fail(c, "This account does not have portal access", 403);
    }
  } else {
    if (!existing && isSuper && data.user.email) {
      await client
        .from("admin_users")
        .upsert({ id: data.user.id, email: data.user.email, role: "superadmin" });
    }

    const mfaMethod = await getAdminMfaMethod(c, data.user.id);
    if (mfaMethod === "totp") {
      const { data: factors } = await authClient.auth.admin.mfa.listFactors({ userId: data.user.id });
      const verifiedFactor = factors?.factors.find((factor) => factor.factor_type === "totp" && factor.status === "verified");
      if (verifiedFactor) {
        const userClient = userAuthDb(c.env, data.session.access_token);
        const challenge = await userClient.auth.mfa.challenge({ factorId: verifiedFactor.id });
        if (challenge.error || !challenge.data) return fail(c, "Could not start multi-factor verification. Please try again.", 500);
        clearSessionCookies(c);
        setPendingMfa(c, data.session);
        return ok(c, { mfaRequired: true, method: "totp", factorId: verifiedFactor.id, challengeId: challenge.data.id });
      }
    } else {
      clearSessionCookies(c);
      setPendingMfa(c, data.session);
      await sendEmailOtp(c, data.user.id, data.user.email ?? body.email, "login");
      return ok(c, { mfaRequired: true, method: "email" });
    }

    await client
      .from("admin_users")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", data.user.id);
  }

  clearPendingMfaCookie(c);
  setSessionCookies(c, data.session);
  return ok(c, { user: { id: data.user.id, email: data.user.email } });
});

// Public: complete a pending TOTP multi-factor login challenge.
auth.post("/login/mfa", zValidator("json", mfaVerifySchema), async (c) => {
  const body = c.req.valid("json");
  const ip = clientIp(c) ?? "unknown";
  if (!(await allowRequest(c.env.AUTH_RATE_LIMITER, `mfa:${ip}`))) return fail(c, "Too many verification attempts. Please try again shortly.", 429);
  const pending = getPendingMfaToken(c);
  if (!pending) return fail(c, "Your verification session expired. Please sign in again.", 401);
  const userClient = userAuthDb(c.env, pending);
  const { data, error } = await userClient.auth.mfa.verify({ factorId: body.factorId, challengeId: body.challengeId, code: body.code });
  if (error || !data.access_token) return fail(c, "Invalid or expired authentication code", 401);
  setSessionCookies(c, { access_token: data.access_token, refresh_token: data.refresh_token });
  clearPendingMfaCookie(c);
  await db(c.env).from("admin_users").update({ last_login_at: new Date().toISOString() }).eq("id", data.user.id);
  return ok(c, { user: { id: data.user.id, email: data.user.email ?? null } });
});

// Public: send/resend email OTP for pending admin login.
auth.post("/login/mfa/email/send", async (c) => {
  const ip = clientIp(c) ?? "unknown";
  if (!(await allowRequest(c.env.AUTH_RATE_LIMITER, `mfa-email-send:${ip}`))) return fail(c, "Too many requests. Please try again shortly.", 429);
  const pending = getPendingMfaToken(c);
  if (!pending) return fail(c, "Your verification session expired. Please sign in again.", 401);
  const { data: userData, error } = await authDb(c.env).auth.getUser(pending);
  if (error || !userData.user?.email) return fail(c, "Your verification session expired. Please sign in again.", 401);
  await sendEmailOtp(c, userData.user.id, userData.user.email, "login");
  return ok(c, { sent: true });
});

// Public: verify email OTP for pending admin login.
auth.post("/login/mfa/email/verify", zValidator("json", mfaEmailVerifySchema), async (c) => {
  const body = c.req.valid("json");
  const ip = clientIp(c) ?? "unknown";
  if (!(await allowRequest(c.env.AUTH_RATE_LIMITER, `mfa-email-verify:${ip}`))) return fail(c, "Too many verification attempts. Please try again shortly.", 429);
  const pending = getPendingMfaToken(c);
  if (!pending) return fail(c, "Your verification session expired. Please sign in again.", 401);
  const authClient = authDb(c.env);
  const { data: userData, error } = await authClient.auth.getUser(pending);
  if (error || !userData.user?.email) return fail(c, "Your verification session expired. Please sign in again.", 401);
  const result = await verifyEmailOtp(c, userData.user.id, "login", body.code);
  if (!result.ok) return fail(c, result.message, 401);
  const pendingMfa = getPendingMfa(c);
  if (!pendingMfa) return fail(c, "Your verification session expired. Please sign in again.", 401);
  let accessToken = pendingMfa.accessToken;
  let refreshToken = pendingMfa.refreshToken;
  if (refreshToken) {
    const refreshed = await authClient.auth.refreshSession({ refresh_token: refreshToken });
    if (refreshed.data.session) { accessToken = refreshed.data.session.access_token; refreshToken = refreshed.data.session.refresh_token; }
  }
  if (refreshToken) setSessionCookies(c, { access_token: accessToken, refresh_token: refreshToken });
  clearPendingMfaCookie(c);
  await db(c.env).from("admin_users").update({ last_login_at: new Date().toISOString() }).eq("id", userData.user.id);
  return ok(c, { user: { id: userData.user.id, email: userData.user.email } });
});

// Public: register using an invite code.
auth.post("/register", zValidator("json", registerSchema), async (c) => {
  const body = c.req.valid("json");
  const ip = clientIp(c) ?? "unknown";
  if (!(await allowRequest(c.env.AUTH_RATE_LIMITER, `register:${ip}`))) {
    return fail(c, "Too many registration attempts. Please try again shortly.", 429);
  }

  const turnstile = await verifyTurnstile(
    c.env.TURNSTILE_SECRET_KEY,
    body.turnstileToken,
    ip,
    turnstileRequired(c.env),
  );
  if (!turnstile.success) return fail(c, "Human verification failed", 400);

  const client = db(c.env);
  const authClient = authDb(c.env);
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

  const { data: created, error: createError } = await authClient.auth.admin.createUser({
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

  const { data: sessionData } = await authClient.auth.signInWithPassword({
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

// Authed: log out and revoke the current session.
auth.post("/logout", async (c) => {
  await revokeCurrentSession(c);
  return ok(c, {});
});

// Public: request a password reset link. Never reveals whether the account exists.
auth.post("/forgot-password", zValidator("json", forgotPasswordSchema), async (c) => {
  const body = c.req.valid("json");
  const ip = clientIp(c) ?? "unknown";
  if (!(await allowRequest(c.env.AUTH_RATE_LIMITER, `forgot:${ip}:${body.email.toLowerCase()}`))) {
    return fail(c, "Too many reset attempts. Please try again shortly.", 429);
  }

  const turnstile = await verifyTurnstile(
    c.env.TURNSTILE_SECRET_KEY,
    body.turnstileToken,
    ip,
    turnstileRequired(c.env),
  );
  if (!turnstile.success) return fail(c, "Human verification failed", 400);

  const portal = body.portal ?? "client";
  const resetMessage = "If an account exists for that email, a password reset link has been sent.";
  const { data: link, error } = await authDb(c.env).auth.admin.generateLink({
    type: "recovery",
    email: body.email,
    options: { redirectTo: passwordResetRedirect(c, portal) },
  });

  if (error || !link?.user || !link.properties?.action_link) {
    console.error("Password reset link generation failed:", error?.message ?? "No action link");
    return ok(c, { message: resetMessage });
  }

  const superEmail = (c.env.SUPERADMIN_EMAIL ?? "").trim().toLowerCase();
  const isSuper =
    Boolean(link.user.email) && Boolean(superEmail) && link.user.email!.toLowerCase() === superEmail;
  const client = db(c.env);

  if (portal === "admin") {
    const { data: admin, error: adminError } = await client
      .from("admin_users")
      .select("id")
      .eq("id", link.user.id)
      .maybeSingle();

    if (adminError) {
      console.error("Password reset admin lookup failed:", adminError.message);
      return ok(c, { message: resetMessage });
    }
    if (!admin && !isSuper) return ok(c, { message: resetMessage });
  } else {
    const { data: member, error: memberError } = await client
      .from("client_members")
      .select("status")
      .eq("user_id", link.user.id)
      .maybeSingle();

    if (memberError) {
      console.error("Password reset client lookup failed:", memberError.message);
      return ok(c, { message: resetMessage });
    }
    if (!member || member.status !== "active") return ok(c, { message: resetMessage });
  }

  const content = passwordResetEmail({
    resetUrl: link.properties.action_link,
    portal,
    email: body.email,
    logoUrl: brandLogoUrl(c.env.ASSET_URL ?? c.env.APP_URL),
  });

  await sendLoggedEmail(c.env, {
    to: body.email,
    subject: content.subject,
    html: content.html,
    template: `password-reset-${portal}`,
    storeBody: false,
  });

  return ok(c, { message: resetMessage });
});

auth.post("/reset-password", zValidator("json", resetPasswordSchema), async (c) => {
  const body = c.req.valid("json");
  const ip = clientIp(c) ?? "unknown";
  if (!(await allowRequest(c.env.AUTH_RATE_LIMITER, `reset:${ip}`))) {
    return fail(c, "Too many reset attempts. Please try again shortly.", 429);
  }

  const client = authDb(c.env);
  let access = body.accessToken;
  const { data: current } = await client.auth.getUser(access);
  let user = current.user;

  if (!user && body.refreshToken) {
    const { data: refreshed, error } = await client.auth.refreshSession({
      refresh_token: body.refreshToken,
    });
    if (!error && refreshed.session) {
      access = refreshed.session.access_token;
      user = refreshed.session.user;
    }
  }

  if (!user) return fail(c, "This reset link is invalid or has expired.", 401);

  const { error } = await userAuthDb(c.env, access).auth.updateUser({
    password: body.password,
  });
  if (error) return fail(c, error.message, 400);

  try {
    await client.auth.admin.signOut(access, "global");
  } catch {
    // Password is already changed; session revocation is best effort.
  }
  clearSessionCookies(c);

  return ok(c, { message: "Your password has been updated. You can sign in now." });
});

/* ------------------------------------------------------------------ */
/* Multi-factor authentication                                         */
/* ------------------------------------------------------------------ */

// Admin: current MFA state for the signed-in admin.
auth.get("/mfa", requireAdmin, async (c) => {
  const me = c.get("admin");
  if (!me) return fail(c, "Unauthorized", 401);
  const user = c.get("user") ?? (await getSessionUser(c));
  const factors = await verifyMfaAdmin(c);
  const method = await getAdminMfaMethod(c, me.id);
  return ok(c, {
    aal: user?.aal ?? "aal1",
    required: me.role === "superadmin",
    method,
    factors: (factors ?? []).map((factor) => ({
      id: factor.id,
      friendlyName: factor.friendly_name ?? null,
      factorType: factor.factor_type,
      status: factor.status,
      createdAt: factor.created_at,
    })),
  });
});

auth.put("/mfa/preference", requireAdmin, zValidator("json", mfaPreferenceSchema), async (c) => {
  const me = c.get("admin"); if (!me) return fail(c, "Unauthorized", 401);
  const body = c.req.valid("json");
  if (body.method === "totp") {
    const factors = await verifyMfaAdmin(c);
    const hasTotp = (factors ?? []).some((f) => f.factor_type === "totp" && f.status === "verified");
    if (!hasTotp) return fail(c, "Set up and verify an authenticator app before selecting TOTP.", 400);
  }
  const { error } = await db(c.env).from("admin_users").update({ mfa_method: body.method }).eq("id", me.id);
  if (error) return fail(c, error.message, 500);
  await logActivity(c, me, { action: "auth.mfa_preference", entity: "admin_user", entityId: me.id, metadata: { method: body.method } });
  return ok(c, { method: body.method });
});

auth.post("/mfa/email/send", requireAdmin, zValidator("json", mfaEmailSendSchema), async (c) => {
  const me = c.get("admin"); if (!me) return fail(c, "Unauthorized", 401);
  const ip = clientIp(c) ?? "unknown";
  if (!(await allowRequest(c.env.AUTH_RATE_LIMITER, `mfa-email-send:${ip}:${me.id}`))) return fail(c, "Too many requests. Please try again shortly.", 429);
  await sendEmailOtp(c, me.id, me.email, c.req.valid("json").purpose);
  return ok(c, { sent: true });
});

auth.post("/mfa/email/verify", requireAdmin, zValidator("json", mfaEmailVerifySchema), async (c) => {
  const me = c.get("admin"); if (!me) return fail(c, "Unauthorized", 401);
  const body = c.req.valid("json");
  const result = await verifyEmailOtp(c, me.id, body.purpose, body.code);
  if (!result.ok) return fail(c, result.message, 401);
  return ok(c, { verified: true, method: await getAdminMfaMethod(c, me.id) });
});

// Admin: start TOTP enrolment.
auth.post("/mfa/enroll", requireAdmin, zValidator("json", mfaEnrollSchema), async (c) => {
  const user = c.get("user") ?? (await getSessionUser(c));
  if (!user?.accessToken) return fail(c, "Unauthorized", 401);

  const body = c.req.valid("json");
  const userClient = userAuthDb(c.env, user.accessToken);
  const { data, error } = await userClient.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: body.friendlyName ?? "Authenticator app",
  });
  if (error) return fail(c, error.message, 400);
  if (!data.totp) return fail(c, "Could not create an authenticator secret", 400);

  return ok(c, {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
  });
});

// Admin: create an MFA challenge for a factor.
auth.post("/mfa/challenge", requireAdmin, zValidator("json", mfaChallengeSchema), async (c) => {
  const user = c.get("user") ?? (await getSessionUser(c));
  if (!user?.accessToken) return fail(c, "Unauthorized", 401);

  const userClient = userAuthDb(c.env, user.accessToken);
  const { data, error } = await userClient.auth.mfa.challenge({
    factorId: c.req.valid("json").factorId,
  });
  if (error) return fail(c, error.message, 400);
  return ok(c, { challengeId: data.id });
});

// Admin: verify a challenge and promote the current session to AAL2.
auth.post("/mfa/verify", requireAdmin, zValidator("json", mfaVerifySchema), async (c) => {
  const user = c.get("user") ?? (await getSessionUser(c));
  if (!user?.accessToken) return fail(c, "Unauthorized", 401);

  const userClient = userAuthDb(c.env, user.accessToken);
  const { data, error } = await userClient.auth.mfa.verify(c.req.valid("json"));
  if (error || !data.access_token) {
    return fail(c, "Invalid or expired authentication code", 401);
  }

  setSessionCookies(c, {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  await logActivity(c, c.get("admin"), {
    action: "auth.mfa_verified",
    entity: "admin_user",
    entityId: user.id,
  });
  return ok(c, { aal: "aal2" });
});

// Admin: remove an MFA factor. Requires the current password.
auth.delete(
  "/mfa/factors/:id",
  requireAdmin,
  zValidator("json", reauthSchema),
  async (c) => {
    const me = c.get("admin");
    if (!me) return fail(c, "Unauthorized", 401);
    const user = c.get("user") ?? (await getSessionUser(c));
    if (!user || user.aal !== "aal2") {
      return fail(c, "Multi-factor authentication required", 403, { code: "mfa_required" });
    }
    const body = c.req.valid("json");
    if (!(await verifyPassword(c, me.email, body.password))) {
      return fail(c, "Password confirmation failed", 403);
    }

    const factorId = c.req.param("id");
    const authClient = authDb(c.env);
    const { data: listed } = await authClient.auth.admin.mfa.listFactors({ userId: me.id });
    if (!listed?.factors.some((factor) => factor.id === factorId)) {
      return fail(c, "Authentication factor not found", 404);
    }

    const { error } = await authClient.auth.admin.mfa.deleteFactor({
      userId: me.id,
      id: factorId,
    });
    if (error) return fail(c, error.message, 400);

    await logActivity(c, me, {
      action: "auth.mfa_removed",
      entity: "admin_user",
      entityId: me.id,
      metadata: { factorId },
    });
    clearSessionCookies(c);
    return ok(c, { id: factorId });
  },
);

/* ------------------------------------------------------------------ */
/* Admin accounts                                                      */
/* ------------------------------------------------------------------ */

// Superadmin: list admin accounts.
auth.get("/admins", requireSuperadmin, async (c) => {
  const { data, error } = await db(c.env)
    .from("admin_users")
    .select("id,email,role,full_name,last_login_at,created_at")
    .order("email", { ascending: true });
  if (error) return fail(c, error.message, 500);
  return ok(c, { items: data ?? [] });
});

// Superadmin: remove an admin account.
auth.delete(
  "/admins/:id",
  requireSuperadmin,
  zValidator("json", reauthSchema),
  async (c) => {
    const me = c.get("admin");
    if (!me) return fail(c, "Unauthorized", 401);

    const targetId = c.req.param("id");
    if (targetId === me.id) {
      return fail(c, "You cannot remove your own admin access", 400);
    }

    const body = c.req.valid("json");
    if (!(await verifyPassword(c, me.email, body.password))) {
      return fail(c, "Password confirmation failed", 403);
    }

    const client = db(c.env);
    const { data: target } = await client
      .from("admin_users")
      .select("id,email,role")
      .eq("id", targetId)
      .maybeSingle();
    if (!target) return fail(c, "Admin not found", 404);
    if (target.role === "superadmin") {
      return fail(c, "The superadmin account cannot be removed", 403);
    }

    const superEmail = (c.env.SUPERADMIN_EMAIL ?? "").trim().toLowerCase();
    if (superEmail && String(target.email).toLowerCase() === superEmail) {
      return fail(c, "The superadmin account cannot be removed", 403);
    }

    const { error: deleteError } = await client
      .from("admin_users")
      .delete()
      .eq("id", targetId);
    if (deleteError) return fail(c, deleteError.message, 500);

    const { data: membership } = await client
      .from("client_members")
      .select("id")
      .eq("user_id", targetId)
      .maybeSingle();

    let authUserDeleted = false;
    if (!membership) {
      const { error } = await authDb(c.env).auth.admin.deleteUser(targetId);
      authUserDeleted = !error;
    }

    await logActivity(c, me, {
      action: "admin.removed",
      entity: "admin_user",
      entityId: targetId,
      metadata: { email: target.email, authUserDeleted },
    });
    return ok(c, { id: targetId, authUserDeleted });
  },
);

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
