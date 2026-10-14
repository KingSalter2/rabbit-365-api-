import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Bindings } from "../env";

let dbCached: SupabaseClient | null = null;
let dbCachedKey = "";

/**
 * Server-side Supabase client using the service_role key, for database access.
 * This key BYPASSES row level security and must never reach the browser.
 *
 * Do NOT call `.auth.signInWithPassword` / `refreshSession` on this client:
 * doing so attaches the signed-in user's JWT as the Authorization header and
 * causes subsequent queries to run under RLS instead of the service role.
 * Use `authDb()` for GoTrue operations instead.
 */
export function db(env: Bindings): SupabaseClient {
  const key = `${env.SUPABASE_URL}::${env.SUPABASE_SERVICE_ROLE_KEY}`;
  if (dbCached && dbCachedKey === key) return dbCached;
  dbCached = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  dbCachedKey = key;
  return dbCached;
}

let authCached: SupabaseClient | null = null;
let authCachedKey = "";

/**
 * Dedicated client for Supabase Auth (GoTrue) operations: sign-in, refresh,
 * user lookups and admin user creation. Kept separate from `db()` so that
 * attaching a user session cannot leak into database requests.
 */
export function authDb(env: Bindings): SupabaseClient {
  const key = `${env.SUPABASE_URL}::${env.SUPABASE_SERVICE_ROLE_KEY}`;
  if (authCached && authCachedKey === key) return authCached;
  authCached = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  authCachedKey = key;
  return authCached;
}
