-- 0010_admin_mfa_methods.sql
-- Add MFA method preference and email OTP storage for admin portal.

alter table public.admin_users
  add column if not exists mfa_method text not null default 'totp'
    check (mfa_method in ('totp', 'email'));

create table if not exists public.admin_email_otps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  purpose text not null check (purpose in ('login', 'verify')),
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  attempts int not null default 0,
  max_attempts int not null default 5,
  created_at timestamptz not null default now()
);

create index if not exists admin_email_otps_user_purpose_idx
  on public.admin_email_otps (user_id, purpose, created_at desc);
create index if not exists admin_email_otps_expires_idx
  on public.admin_email_otps (expires_at);
