-- Extend email_outbox for outreach sending and Resend webhook delivery tracking.

alter table public.email_outbox
  drop constraint if exists email_outbox_status_check;

alter table public.email_outbox
  add constraint email_outbox_status_check
  check (status in (
    'queued',
    'sent',
    'delivered',
    'delivery_delayed',
    'bounced',
    'complained',
    'failed'
  ));

alter table public.email_outbox
  add column if not exists last_event_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists bounced_at timestamptz,
  add column if not exists complained_at timestamptz,
  add column if not exists event_data jsonb not null default '{}'::jsonb;

create index if not exists email_outbox_provider_id_idx on public.email_outbox (provider_id);
create index if not exists email_outbox_template_idx on public.email_outbox (template);
