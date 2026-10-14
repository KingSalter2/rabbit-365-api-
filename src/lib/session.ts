import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env } from "../env";
import type { AdminUser, AdminRole, SessionUser } from "../types";
import { authDb, db } from "./supabase";

const ACCESS_COOKIE = "rb365_access";
const REFRESH_COOKIE = "rb365_refresh";
const ACCESS_MAX_AGE = 60 * 60; // 1 hour
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function isSecure(c: Context<Env>): boolean {
  return new URL(c.req.url).protocol === "https:";
}

export function setSessionCookies(
  c: Context<Env>,
  session: { access_token: string; refresh_token: string },
) {
  const secure = isSecure(c);
  setCookie(c, ACCESS_COOKIE, session.access_token, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    maxAge: ACCESS_MAX_AGE,
  });
  setCookie(c, REFRESH_COOKIE, session.refresh_token, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    maxAge: REFRESH_MAX_AGE,
  });
}

export function clearSessionCookies(c: Context<Env>) {
  deleteCookie(c, ACCESS_COOKIE, { path: "/" });
  deleteCookie(c, REFRESH_COOKIE, { path: "/" });
}

/** Resolve the current user from the session cookies (auto-refreshing). */
export async function getSessionUser(c: Context<Env>): Promise<SessionUser | null> {
  const client = authDb(c.env);

  const access = getCookie(c, ACCESS_COOKIE);
  if (access) {
    const { data } = await client.auth.getUser(access);
    if (data.user) return { id: data.user.id, email: data.user.email ?? null };
  }

  const refresh = getCookie(c, REFRESH_COOKIE);
  if (refresh) {
    const { data, error } = await client.auth.refreshSession({ refresh_token: refresh });
    if (!error && data.session) {
      setSessionCookies(c, {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      return { id: data.session.user.id, email: data.session.user.email ?? null };
    }
    clearSessionCookies(c);
  }

  return null;
}

type AdminRow = { id: string; email: string; role: AdminRole; full_name: string | null };

function toAdmin(row: AdminRow): AdminUser {
  return { id: row.id, email: row.email, role: row.role, fullName: row.full_name };
}

/** Resolve a signed-in portal admin (auto-provisioning the superadmin). */
export async function getAdminUser(c: Context<Env>): Promise<AdminUser | null> {
  const session = await getSessionUser(c);
  if (!session) return null;

  const client = db(c.env);
  const { data } = await client
    .from("admin_users")
    .select("id,email,role,full_name")
    .eq("id", session.id)
    .maybeSingle();

  if (data) return toAdmin(data as AdminRow);

  const superEmail = (c.env.SUPERADMIN_EMAIL ?? "").trim().toLowerCase();
  if (session.email && superEmail && session.email.toLowerCase() === superEmail) {
    const { data: created } = await client
      .from("admin_users")
      .upsert({ id: session.id, email: session.email, role: "superadmin" })
      .select("id,email,role,full_name")
      .single();
    if (created) return toAdmin(created as AdminRow);
  }

  return null;
}
