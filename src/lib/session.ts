import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env } from "../env";
import type { AdminUser, AdminRole, ClientRole, ClientSession, SessionUser } from "../types";
import { authDb, db } from "./supabase";

const ACCESS_COOKIE = "rb365_access";
const REFRESH_COOKIE = "rb365_refresh";
const MFA_ACCESS_COOKIE = "rb365_mfa_access";
const ACCESS_MAX_AGE = 60 * 60; // 1 hour
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const MFA_ACCESS_MAX_AGE = 60 * 5; // 5 minutes

function isSecure(c: Context<Env>): boolean {
  return new URL(c.req.url).protocol === "https:";
}

function readAal(token: string): "aal1" | "aal2" {
  try {
    const payload = token.split(".")[1];
    if (!payload) return "aal1";
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const json = JSON.parse(atob(padded)) as { aal?: unknown };
    return json.aal === "aal2" ? "aal2" : "aal1";
  } catch {
    return "aal1";
  }
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
  deleteCookie(c, MFA_ACCESS_COOKIE, { path: "/" });
}

/** Store a short-lived, non-session token while an MFA challenge is pending. */
export function setPendingMfaCookie(c: Context<Env>, accessToken: string) {
  setCookie(c, MFA_ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure: isSecure(c),
    sameSite: "Lax",
    path: "/",
    maxAge: MFA_ACCESS_MAX_AGE,
  });
}

export function getPendingMfaToken(c: Context<Env>): string | null {
  return getCookie(c, MFA_ACCESS_COOKIE) ?? null;
}

export function clearPendingMfaCookie(c: Context<Env>) {
  deleteCookie(c, MFA_ACCESS_COOKIE, { path: "/" });
}

/** Revoke the current session server-side before clearing cookies. */
export async function revokeCurrentSession(c: Context<Env>): Promise<void> {
  const client = authDb(c.env);
  let access = getCookie(c, ACCESS_COOKIE);

  if (!access) {
    const refresh = getCookie(c, REFRESH_COOKIE);
    if (refresh) {
      const { data } = await client.auth.refreshSession({ refresh_token: refresh });
      access = data.session?.access_token;
    }
  }

  if (access) {
    try {
      await client.auth.admin.signOut(access, "local");
    } catch {
      // Best effort: cookies are still cleared below.
    }
  }
  clearSessionCookies(c);
}

/** Resolve the current user from the session cookies (auto-refreshing). */
export async function getSessionUser(c: Context<Env>): Promise<SessionUser | null> {
  const client = authDb(c.env);

  const access = getCookie(c, ACCESS_COOKIE);
  if (access) {
    const { data } = await client.auth.getUser(access);
    if (data.user) {
      return {
        id: data.user.id,
        email: data.user.email ?? null,
        accessToken: access,
        aal: readAal(access),
      };
    }
  }

  const refresh = getCookie(c, REFRESH_COOKIE);
  if (refresh) {
    const { data, error } = await client.auth.refreshSession({ refresh_token: refresh });
    if (!error && data.session) {
      setSessionCookies(c, {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      return {
        id: data.session.user.id,
        email: data.session.user.email ?? null,
        accessToken: data.session.access_token,
        aal: readAal(data.session.access_token),
      };
    }
    clearSessionCookies(c);
  }

  return null;
}

type ClientMemberRow = {
  id: string;
  org_id: string;
  email: string;
  role: ClientRole;
  status: string;
  full_name: string | null;
};

type ClientOrgRow = {
  id: string;
  name: string;
  status: "active" | "suspended" | "archived";
  support_enabled: boolean;
};

/** Resolve the signed-in client user and their organisation. */
export async function getClientUser(c: Context<Env>): Promise<ClientSession | null> {
  const session = await getSessionUser(c);
  if (!session) return null;

  const client = db(c.env);
  const { data: member } = await client
    .from("client_members")
    .select("id,org_id,email,role,status,full_name")
    .eq("user_id", session.id)
    .maybeSingle();

  if (!member) return null;
  const row = member as ClientMemberRow;
  if (row.status !== "active") return null;

  const { data: org } = await client
    .from("client_orgs")
    .select("id,name,status,support_enabled")
    .eq("id", row.org_id)
    .maybeSingle();
  if (!org) return null;
  const orgRow = org as ClientOrgRow;

  return {
    userId: session.id,
    email: session.email ?? row.email,
    memberId: row.id,
    orgId: orgRow.id,
    orgName: orgRow.name,
    role: row.role,
    fullName: row.full_name,
    orgStatus: orgRow.status,
    supportEnabled: orgRow.support_enabled,
  };
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
