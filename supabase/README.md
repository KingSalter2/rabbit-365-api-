# Rabbit 365 API — Supabase

All database schema lives here. The **only** client of this database is the
Hono API (using the `service_role` key). The website/admin frontend never
connects to Supabase directly.

## Apply the schema

**Option A — Supabase SQL editor (quickest)**
1. Open your project → SQL Editor.
2. Run the files in `migrations/` **in order**: `0001`, `0002`, `0003`.

**Option B — Supabase CLI**
```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

## Tables

| Table | Purpose |
| --- | --- |
| `leads` | Every public form submission |
| `quotations` | Client quotes (shareable by `id`) |
| `quotation_scope_sections` | Ordered scope blocks per quote |
| `quotation_items` | Pricing lines per quote |
| `admin_users` | Portal users (linked to `auth.users`) |
| `admin_invites` | Single-use invite codes |
| `email_outbox` | Log of transactional emails (Resend) |
| `activity_log` | Audit trail |

## Security model

- RLS is **enabled** on every table with **no policies** → anon/authenticated
  are denied by default (fail-closed).
- Table privileges for `anon`/`authenticated` are revoked.
- The API's `service_role` key bypasses RLS; it never leaves the server.

## Auth

Portal auth uses **Supabase Auth** (email/password). Passwords are managed by
Supabase; we never store them. `admin_users` holds the role mapping.
