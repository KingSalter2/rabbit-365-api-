# Rabbit 365 API

Hono API on Cloudflare Workers. It is the **only** thing that talks to
Supabase. The website and admin portal are pure clients of this API — no
database queries, keys, or business rules live on the frontend.

## Stack

- **Hono** on **Cloudflare Workers**
- **Supabase** (Postgres + Auth)
- **Resend** for transactional email
- **Cloudflare Turnstile** verified server-side

## Endpoints

Base path: `/api`

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | public | Health check |
| POST | `/leads` | public + Turnstile | Submit a website form |
| GET | `/leads` | admin | List leads (search/status/pagination) |
| GET | `/leads/:id` | admin | Get a lead |
| PATCH | `/leads/:id` | admin | Update status / notes |
| DELETE | `/leads/:id` | admin | Delete a lead |
| POST | `/auth/login` | public + Turnstile | Log in (sets httpOnly cookies) |
| POST | `/auth/register` | public + Turnstile | Register with an invite code |
| GET | `/auth/invite/:code` | public | Validate an invite |
| GET | `/auth/me` | admin | Current admin + role |
| POST | `/auth/logout` | admin | Log out |
| GET | `/auth/invites` | superadmin | List invites |
| POST | `/auth/invites` | superadmin | Create an invite |
| DELETE | `/auth/invites/:id` | superadmin | Revoke an invite |
| GET | `/quotations` | admin | List quotations |
| POST | `/quotations` | admin | Create a quotation |
| GET | `/quotations/:id` | public | Fetch a quotation (client link) |
| PUT | `/quotations/:id` | admin | Update a quotation |
| DELETE | `/quotations/:id` | admin | Delete a quotation |
| POST | `/quotations/:id/accept` | public + Turnstile | Accept a quotation |
| GET | `/emails/preview` | admin | Preview transactional email templates |
| GET | `/assets/logo.png` | public | Brand logo referenced by emails |

Responses are `{ "ok": true, "data": ... }` or `{ "ok": false, "error": "..." }`.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in Supabase (+ optional Turnstile/Resend)
npm run dev                       # http://localhost:8787
```

> Note: `wrangler dev` reads local Worker secrets from **`.dev.vars`**, not
> `.env`. In production these are set with `wrangler secret put`.

The website dev server (`rabbit-365`) proxies `/api/*` to `:8787`, so
everything stays same-origin and cookie auth just works.

If `TURNSTILE_SECRET_KEY` or `RESEND_API_KEY` are unset locally, verification
and email are skipped (handy for development).

## Database

Schema lives in [`supabase/`](./supabase). See `supabase/README.md`.

## Emails

All transactional email HTML lives in `src/lib/emails.ts` (brand layout +
templates); **Resend is only the transport**. Templates:

- `leadNotificationEmail` — new website enquiry (to the team)
- `leadConfirmationEmail` — enquiry acknowledgement (to the person who submitted)
- `quotationAcceptedTeamEmail` — client accepted (to the team)
- `quotationAcceptanceClientEmail` — confirmation (to the client)

Preview them in the admin portal (**Emails** tab at `/ops`) or via the dev-only
raw preview at `/dev/emails`. The brand logo is embedded and served from
`/api/assets/logo.png`, so previews and sent mail never depend on the marketing
site being reachable.

## Deploy

```bash
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put TURNSTILE_SECRET_KEY
wrangler secret put RESEND_API_KEY
npm run deploy
```

`wrangler.jsonc` routes `www.rabbit365.co.za/api/*` to this Worker; the static
site keeps serving the rest of the domain.

## Supabase Auth setup

1. Authentication → Providers → enable **Email**.
2. (Optional) turn off "Confirm email" — the API creates confirmed users via
   the admin API for invites.
3. Create your first superadmin by setting `SUPERADMIN_EMAIL` in
   `wrangler.jsonc` and logging in with that email (it is auto-provisioned).
