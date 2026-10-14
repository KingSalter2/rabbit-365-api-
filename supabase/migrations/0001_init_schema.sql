-- =============================================================
-- Rabbit 365 — initial schema
-- Applied via Supabase SQL editor or `supabase db push`.
-- The API uses the service_role key and is the ONLY writer/reader;
-- the frontend never talks to Postgres directly.
-- =============================================================

-- ------------------------------------------------------------------
-- leads: every public form submission (contact + all service dialogs)
-- ------------------------------------------------------------------
create table if not exists public.leads (
  id                        bigint generated always as identity primary key,
  name                      text        not null,
  email                     text        not null,
  phone                     text,
  company                   text,
  website                   text,
  preferred_contact_method  text,
  service                   text,
  budget                    numeric(12, 2),
  message                   text,
  category                  text        not null default 'general',
  form_type                 text        not null default 'contact',
  source                    jsonb       not null default '{}'::jsonb,
  extra                     jsonb       not null default '{}'::jsonb,
  status                    text        not null default 'new'
                              check (status in ('new', 'contacted', 'won', 'lost', 'archived')),
  internal_notes            text,
  turnstile_ok              boolean     not null default false,
  ip_hash                   text,
  user_agent                text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  search_vector             tsvector generated always as (
                              to_tsvector(
                                'simple',
                                coalesce(name, '') || ' ' ||
                                coalesce(email, '') || ' ' ||
                                coalesce(company, '') || ' ' ||
                                coalesce(service, '') || ' ' ||
                                coalesce(phone, '')
                              )
                            ) stored
);

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_status_idx     on public.leads (status);
create index if not exists leads_category_idx   on public.leads (category);
create index if not exists leads_email_idx      on public.leads (lower(email));
create index if not exists leads_search_idx     on public.leads using gin (search_vector);

-- ------------------------------------------------------------------
-- quotations: client-facing quotes, referenced by id in share links
-- ------------------------------------------------------------------
create table if not exists public.quotations (
  id                uuid        primary key default gen_random_uuid(),
  quote_number      text        not null unique,
  title             text        not null,
  project           text,
  status            text        not null default 'draft'
                      check (status in ('draft', 'sent', 'accepted', 'rejected')),
  currency          text        not null default 'R',
  client_name       text        not null default '',
  client_company    text,
  client_email      text,
  client_phone      text,
  client_address    text,
  prepared_by       text,
  valid_until       date,
  notes             text,
  terms             text[]      not null default '{}',
  subtotal          numeric(12, 2) not null default 0,
  discount          numeric(12, 2) not null default 0,
  total             numeric(12, 2) not null default 0,
  accepted_at       timestamptz,
  accepted_by_name  text,
  accepted_ip       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  search_vector     tsvector generated always as (
                      to_tsvector(
                        'simple',
                        coalesce(quote_number, '') || ' ' ||
                        coalesce(title, '') || ' ' ||
                        coalesce(project, '') || ' ' ||
                        coalesce(client_name, '') || ' ' ||
                        coalesce(client_company, '')
                      )
                    ) stored
);

create index if not exists quotations_created_at_idx on public.quotations (created_at desc);
create index if not exists quotations_status_idx     on public.quotations (status);
create index if not exists quotations_client_email_idx on public.quotations (lower(client_email));
create index if not exists quotations_search_idx     on public.quotations using gin (search_vector);

-- ------------------------------------------------------------------
-- quotation_scope_sections: ordered scope blocks per quotation
-- ------------------------------------------------------------------
create table if not exists public.quotation_scope_sections (
  id            bigint generated always as identity primary key,
  quotation_id  uuid    not null references public.quotations (id) on delete cascade,
  position      integer not null default 0,
  title         text    not null,
  items         text[]  not null default '{}'
);

create index if not exists quotation_scope_quotation_idx
  on public.quotation_scope_sections (quotation_id, position);

-- ------------------------------------------------------------------
-- quotation_items: pricing lines per quotation
-- ------------------------------------------------------------------
create table if not exists public.quotation_items (
  id            bigint generated always as identity primary key,
  quotation_id  uuid    not null references public.quotations (id) on delete cascade,
  position      integer not null default 0,
  description   text    not null default '',
  amount        numeric(12, 2) not null default 0,
  kind          text    not null default 'regular'
                  check (kind in ('regular', 'discount', 'total'))
);

create index if not exists quotation_items_quotation_idx
  on public.quotation_items (quotation_id, position);

-- ------------------------------------------------------------------
-- admin_users: portal users, linked to Supabase auth.users
-- ------------------------------------------------------------------
create table if not exists public.admin_users (
  id          uuid        primary key references auth.users (id) on delete cascade,
  email       text        not null,
  role        text        not null default 'admin'
                check (role in ('superadmin', 'admin')),
  full_name   text,
  last_login_at timestamptz,
  created_at  timestamptz not null default now()
);

create unique index if not exists admin_users_email_idx on public.admin_users (lower(email));

-- ------------------------------------------------------------------
-- admin_invites: single-use invite codes created by a superadmin
-- ------------------------------------------------------------------
create table if not exists public.admin_invites (
  id          uuid        primary key default gen_random_uuid(),
  email       text        not null,
  role        text        not null default 'admin'
                check (role in ('superadmin', 'admin')),
  invited_by  uuid        references public.admin_users (id) on delete set null,
  used        boolean     not null default false,
  used_at     timestamptz,
  used_by     uuid        references public.admin_users (id) on delete set null,
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- only one pending invite per email
create unique index if not exists admin_invites_pending_email_idx
  on public.admin_invites (lower(email)) where used = false;
create index if not exists admin_invites_email_idx on public.admin_invites (lower(email));

-- ------------------------------------------------------------------
-- email_outbox: audit/log of transactional emails sent via Resend
-- ------------------------------------------------------------------
create table if not exists public.email_outbox (
  id              bigint generated always as identity primary key,
  to_email        text        not null,
  reply_to        text,
  subject         text        not null,
  body            text,
  template        text,
  status          text        not null default 'queued'
                    check (status in ('queued', 'sent', 'failed')),
  provider_id     text,
  error           text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);

create index if not exists email_outbox_created_at_idx on public.email_outbox (created_at desc);
create index if not exists email_outbox_status_idx     on public.email_outbox (status);

-- ------------------------------------------------------------------
-- activity_log: lightweight audit trail for the portal
-- ------------------------------------------------------------------
create table if not exists public.activity_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid        references public.admin_users (id) on delete set null,
  actor_email text,
  action      text        not null,
  entity      text,
  entity_id   text,
  metadata    jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists activity_log_created_at_idx on public.activity_log (created_at desc);
create index if not exists activity_log_entity_idx     on public.activity_log (entity, entity_id);
