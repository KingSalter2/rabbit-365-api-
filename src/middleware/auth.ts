import { createMiddleware } from "hono/factory";
import type { Env } from "../env";
import { fail } from "../lib/http";
import { db } from "../lib/supabase";
import { getAdminUser, getClientUser, getSessionUser } from "../lib/session";
export const withUser = createMiddleware<Env>(async (c, next) => {
  c.set("user", await getSessionUser(c));
  await next();
});

export const requireAuth = createMiddleware<Env>(async (c, next) => {
  const user = c.get("user") ?? (await getSessionUser(c));
  if (!user) return fail(c, "Unauthorized", 401);
  c.set("user", user);
  await next();
});

export const requireAdmin = createMiddleware<Env>(async (c, next) => {
  const admin = await getAdminUser(c);
  if (!admin) return fail(c, "Unauthorized", 401);
  c.set("admin", admin);
  await next();
});

export const requireSuperadmin = createMiddleware<Env>(async (c, next) => {
  const admin = await getAdminUser(c);
  if (!admin) return fail(c, "Unauthorized", 401);
  if (admin.role !== "superadmin") return fail(c, "Forbidden", 403);

  const user = c.get("user") ?? (await getSessionUser(c));
  if (!user) return fail(c, "Unauthorized", 401);
  if (user.aal !== "aal2") {
    const { data } = await db(c.env).from("admin_users").select("mfa_method").eq("id", admin.id).maybeSingle();
    const method = data?.mfa_method === "email" ? "email" : "totp";
    if (method !== "email") return fail(c, "Multi-factor authentication required", 403, { code: "mfa_required" });
  }

  c.set("admin", admin);
  await next();
});

/** Requires a signed-in, active client member. */
export const requireClient = createMiddleware<Env>(async (c, next) => {
  const client = await getClientUser(c);
  if (!client) return fail(c, "Unauthorized", 401);
  c.set("client", client);
  await next();
});

/** Client route guard for actions that need an active, enabled support plan. */
export function clientCanWrite(client: { orgStatus: string; supportEnabled: boolean }): boolean {
  return client.orgStatus === "active" && client.supportEnabled;
}
