import type { AdminUser, ClientSession, SessionUser } from "./types";

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Bindings {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_WEBHOOK_SECRET?: string;
  APP_URL?: string;
  ASSET_URL?: string;
  NOTIFY_EMAIL_TO?: string;
  SUPPORT_NOTIFY_EMAILS?: string;
  EMAIL_FROM?: string;
  SUPERADMIN_EMAIL?: string;
  ENVIRONMENT?: string;
  AUTH_RATE_LIMITER?: RateLimiter;
  CONTACT_RATE_LIMITER?: RateLimiter;
}

export interface Variables {
  user: SessionUser | null;
  admin: AdminUser | null;
  client: ClientSession | null;
}

export interface Env {
  Bindings: Bindings;
  Variables: Variables;
}
