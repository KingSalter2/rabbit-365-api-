-- =============================================================
-- Row Level Security
-- The frontend never touches Postgres directly. All data access
-- happens through the Hono API using the service_role key, which
-- BYPASSES RLS. So we enable RLS and define NO policies, meaning
-- the anon/authenticated roles are denied by default (fail-closed).
-- =============================================================

alter table public.leads                     enable row level security;
alter table public.quotations                enable row level security;
alter table public.quotation_scope_sections  enable row level security;
alter table public.quotation_items           enable row level security;
alter table public.admin_users               enable row level security;
alter table public.admin_invites             enable row level security;
alter table public.email_outbox              enable row level security;
alter table public.activity_log              enable row level security;

-- Defense in depth: strip table access from the public roles entirely.
-- (service_role keeps access.)
revoke all on public.leads                    from anon, authenticated;
revoke all on public.quotations               from anon, authenticated;
revoke all on public.quotation_scope_sections from anon, authenticated;
revoke all on public.quotation_items          from anon, authenticated;
revoke all on public.admin_users              from anon, authenticated;
revoke all on public.admin_invites            from anon, authenticated;
revoke all on public.email_outbox             from anon, authenticated;
revoke all on public.activity_log             from anon, authenticated;

-- Sequences (identity columns) also need locking down.
revoke all on all sequences in schema public from anon, authenticated;
grant usage on all sequences in schema public to service_role;
