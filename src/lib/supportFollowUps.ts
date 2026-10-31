import type { Bindings } from "../env";
import {
  brandLogoUrl,
  supportTicketAutoClosedClient,
  supportTicketReminderClient,
} from "./emails";
import { sendLoggedEmail } from "./notify";
import { db } from "./supabase";
import { normalizeUrl, orgRecipients, statusLabel } from "./support";

const DAY_MS = 86_400_000;
const REMINDER_BUSINESS_DAYS = 3;
const AUTO_CLOSE_DAYS = 7;

type FollowUpRow = {
  id: string;
  number: string;
  subject: string;
  org_id: string;
  category: string;
  priority: string;
  status: string;
  waiting_since: string | null;
  reminder_sent_at: string | null;
  resolved_at: string | null;
  client_orgs: { name?: string; contact_email?: string | null } | null;
  client_sites: { label?: string; url?: string | null } | null;
};

function titleCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ") : value;
}

/** Whole weekdays elapsed between two dates (UTC date boundaries). */
function businessDaysBetween(from: string, to: Date): number {
  const start = new Date(from);
  if (Number.isNaN(start.getTime())) return 0;
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  let days = 0;
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
  return days;
}

function ticketEmailData(row: FollowUpRow, appUrl: string, logoUrl: string) {
  return {
    appUrl,
    ticketId: row.id,
    number: row.number,
    subject: row.subject,
    orgName: row.client_orgs?.name ?? "",
    siteLabel: row.client_sites?.label ?? null,
    siteUrl: row.client_sites?.url ? normalizeUrl(row.client_sites.url) : null,
    category: titleCase(row.category),
    priority: titleCase(row.priority),
    logoUrl,
  };
}

/**
 * Daily follow-up job:
 *  - after 3 business days in `waiting_on_client`, email one reminder
 *  - 7 days after that reminder, close the ticket
 * Client replies clear `waiting_since` and reopen closed tickets.
 */
export async function runSupportFollowUps(env: Bindings): Promise<void> {
  const client = db(env);
  const now = new Date();
  const appUrl = (env.APP_URL ?? "").replace(/\/$/, "");
  const logoUrl = brandLogoUrl(env.ASSET_URL);

  const { data, error } = await client
    .from("support_tickets")
    .select(
      "id,number,subject,org_id,category,priority,status,waiting_since,reminder_sent_at,resolved_at,client_orgs(name,contact_email),client_sites(label,url)",
    )
    .eq("status", "waiting_on_client")
    .not("waiting_since", "is", null)
    .order("waiting_since", { ascending: true })
    .limit(200);

  if (error) {
    console.error("[support-followups] could not load tickets", error.message);
    return;
  }

  for (const row of (data ?? []) as FollowUpRow[]) {
    if (!row.reminder_sent_at) {
      if (businessDaysBetween(row.waiting_since ?? "", now) < REMINDER_BUSINESS_DAYS) continue;

      const claimed = await client
        .from("support_tickets")
        .update({ reminder_sent_at: now.toISOString() })
        .eq("id", row.id)
        .eq("status", "waiting_on_client")
        .is("reminder_sent_at", null)
        .select("id")
        .maybeSingle();
      if (claimed.error || !claimed.data) continue;

      const recipients = await orgRecipients(client, row.org_id, row.client_orgs?.contact_email);
      for (const recipient of recipients) {
        await sendLoggedEmail(env, {
          to: recipient.email,
          ...supportTicketReminderClient({
            ...ticketEmailData(row, appUrl, logoUrl),
            status: statusLabel("waiting_on_client"),
            clientName: recipient.fullName ?? undefined,
          }),
          replyTo: "info@rabbit365.co.za",
          template: "support.ticket_reminder_client",
        });
      }

      await client.from("support_events").insert({
        ticket_id: row.id,
        actor_type: "system",
        type: "reminder_sent",
        to_value: "3 business days",
      });
      continue;
    }

    const remindedAt = new Date(row.reminder_sent_at).getTime();
    if (Number.isNaN(remindedAt) || now.getTime() - remindedAt < AUTO_CLOSE_DAYS * DAY_MS) {
      continue;
    }

    const closedAt = now.toISOString();
    const closed = await client
      .from("support_tickets")
      .update({
        status: "closed",
        closed_at: closedAt,
        resolved_at: row.resolved_at ?? closedAt,
        waiting_since: null,
        reminder_sent_at: null,
      })
      .eq("id", row.id)
      .eq("status", "waiting_on_client")
      .select("id")
      .maybeSingle();
    if (closed.error || !closed.data) continue;

    await client.from("support_events").insert({
      ticket_id: row.id,
      actor_type: "system",
      type: "status_changed",
      from_value: "waiting_on_client",
      to_value: "closed",
    });

    const recipients = await orgRecipients(client, row.org_id, row.client_orgs?.contact_email);
    for (const recipient of recipients) {
      await sendLoggedEmail(env, {
        to: recipient.email,
        ...supportTicketAutoClosedClient({
          ...ticketEmailData(row, appUrl, logoUrl),
          status: statusLabel("closed"),
          clientName: recipient.fullName ?? undefined,
        }),
        replyTo: "info@rabbit365.co.za",
        template: "support.ticket_auto_closed_client",
      });
    }
  }
}
