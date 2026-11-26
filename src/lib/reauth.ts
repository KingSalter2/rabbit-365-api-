import type { Context } from "hono";
import type { Env } from "../env";
import { authDb } from "./supabase";

/**
 * Verify the signed-in admin's password without disturbing their current
 * session. The temporary session created for verification is revoked
 * immediately.
 */
export async function verifyPassword(
  c: Context<Env>,
  email: string,
  password: string,
): Promise<boolean> {
  const auth = authDb(c.env);
  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  if (error || !data.session) return false;

  try {
    await auth.auth.admin.signOut(data.session.access_token, "local");
  } catch {
    // The temporary session expires on its own if revocation fails.
  }
  return true;
}
