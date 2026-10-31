-- =============================================================
-- Support follow-ups: waiting-on-client reminders & auto-close
--
-- waiting_since     -> when the ticket entered waiting_on_client
-- reminder_sent_at  -> when the 3-business-day reminder was sent
--
-- A daily cron sends one reminder after 3 business days and closes
-- the ticket 7 days later. Client replies reopen closed tickets.
-- =============================================================

alter table public.support_tickets
  add column if not exists waiting_since    timestamptz,
  add column if not exists reminder_sent_at timestamptz;

-- Existing waiting tickets start their clock from their last update.
update public.support_tickets
  set waiting_since = updated_at
  where status = 'waiting_on_client' and waiting_since is null;

create index if not exists support_tickets_waiting_idx
  on public.support_tickets (waiting_since)
  where status = 'waiting_on_client';
