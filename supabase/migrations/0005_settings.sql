-- =============================================================
-- Settings: company-wide key/value store.
-- Used for banking details shown to accepted clients and in
-- payment emails. Managed from the admin portal (Settings tab).
-- =============================================================

create table if not exists public.settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.settings enable row level security;

revoke all on public.settings from anon, authenticated;
