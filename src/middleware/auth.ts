import { createMiddleware } from "hono/factory";
import type { Env } from "../env";
import { fail } from "../lib/http";
import { getAdminUser, getSessionUser } from "../lib/session";

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
  c.set("admin", admin);
  await next();
});
