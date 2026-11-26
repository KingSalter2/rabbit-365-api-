-- Add open/click tracking for Resend email webhooks.
alter table public.email_outbox
  add column if not exists opened_at timestamptz,
  add column if not exists clicked_at timestamptz,
  add column if not exists opened_count integer not null default 0,
  add column if not exists clicked_count integer not null default 0;
