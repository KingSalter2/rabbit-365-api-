import type { AdminUser, SessionUser } from "./types";

export interface Bindings {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
  APP_URL?: string;
  NOTIFY_EMAIL_TO?: string;
  EMAIL_FROM?: string;
  SUPERADMIN_EMAIL?: string;
  ENVIRONMENT?: string;
}

export interface Variables {
  user: SessionUser | null;
  admin: AdminUser | null;
}

export interface Env {
  Bindings: Bindings;
  Variables: Variables;
}
