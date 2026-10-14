-- =============================================================
-- Project progress tracking
-- Once a client accepts a quotation, a project begins. Until the
-- deposit is received the project sits in `awaiting_deposit`; the
-- team drives it through in_progress -> completed, or cancels it.
-- Progress is shown on the client's quotation link.
-- =============================================================

alter table public.quotations
  add column if not exists project_status text
    check (project_status in ('awaiting_deposit', 'in_progress', 'completed', 'cancelled'));

create table if not exists public.quotation_progress (
  id            bigint generated always as identity primary key,
  quotation_id  uuid    not null references public.quotations (id) on delete cascade,
  position      integer not null default 0,
  label         text    not null,
  description   text,
  status        text    not null default 'pending'
                  check (status in ('pending', 'in_progress', 'done')),
  note          text,
  completed_at  timestamptz,
  updated_at    timestamptz not null default now()
);

create index if not exists quotation_progress_quotation_idx
  on public.quotation_progress (quotation_id, position);

alter table public.quotation_progress enable row level security;

revoke all on public.quotation_progress from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant usage on all sequences in schema public to service_role;
