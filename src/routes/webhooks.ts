import { Hono } from "hono";
import { Webhook } from "svix";
import type { Env } from "../env";
import { db } from "../lib/supabase";

const webhooks = new Hono<Env>();

type ResendEvent = {
  type?: string;
  created_at?: string;
  data?: { email_id?: string; [key: string]: unknown };
};

const HANDLED = new Set([
  "email.delivered",
  "email.delivery_delayed",
  "email.bounced",
  "email.complained",
  "email.opened",
  "email.clicked",
]);

webhooks.post("/resend", async (c) => {
  try {
    const secret = c.env.RESEND_WEBHOOK_SECRET;
    if (!secret) return c.json({ ok: false, error: "Webhook secret not configured" }, 503);

    const payload = await c.req.text();
    const headers = {
      "svix-id": c.req.header("svix-id") ?? "",
      "svix-timestamp": c.req.header("svix-timestamp") ?? "",
      "svix-signature": c.req.header("svix-signature") ?? "",
    };

    let event: ResendEvent;
    try {
      new Webhook(secret).verify(payload, headers);
      event = JSON.parse(payload) as ResendEvent;
    } catch {
      return c.json({ ok: false, error: "Invalid signature or payload" }, 400);
    }

    const type = event.type ?? "";
    const emailId = event.data?.email_id;
    if (!HANDLED.has(type) || !emailId) return c.json({ ok: true, ignored: true });

    const client = db(c.env);
    let { data: row, error: findError } = await client
      .from("email_outbox")
      .select("id,status,event_data,opened_count,clicked_count")
      .eq("provider_id", emailId)
      .maybeSingle();
    if (findError && /column .* does not exist/i.test(findError.message)) {
      ({ data: row, error: findError } = await client
        .from("email_outbox")
        .select("id,status,event_data")
        .eq("provider_id", emailId)
        .maybeSingle());
    }
    if (findError) return c.json({ ok: false, error: findError.message }, 500);
    if (!row) return c.json({ ok: true, ignored: true, reason: "provider_id_not_found" });

    const at = event.created_at ?? new Date().toISOString();
    const patch: Record<string, unknown> = { last_event_at: at };
    const eventData = row.event_data && typeof row.event_data === "object" && !Array.isArray(row.event_data)
      ? { ...(row.event_data as Record<string, unknown>) }
      : {};
    eventData[type] = event;

    if (type === "email.delivered") { patch.status = "delivered"; patch.delivered_at = at; }
    else if (type === "email.delivery_delayed") { patch.status = "delivery_delayed"; }
    else if (type === "email.bounced") { patch.status = "bounced"; patch.bounced_at = at; }
    else if (type === "email.complained") { patch.status = "complained"; patch.complained_at = at; }
    else if (type === "email.opened") { patch.opened_at = at; patch.opened_count = Number((row as any).opened_count ?? 0) + 1; }
    else if (type === "email.clicked") { patch.clicked_at = at; patch.clicked_count = Number((row as any).clicked_count ?? 0) + 1; }
    patch.event_data = eventData;

    let { error: updateError } = await client.from("email_outbox").update(patch).eq("id", row.id);
    if (updateError && /column .* does not exist/i.test(updateError.message)) {
      delete patch.opened_at; delete patch.clicked_at; delete patch.opened_count; delete patch.clicked_count;
      ({ error: updateError } = await client.from("email_outbox").update(patch).eq("id", row.id));
    }
    if (updateError) return c.json({ ok: false, error: updateError.message }, 500);

    return c.json({ ok: true });
  } catch (err) {
    console.error("[webhook/resend]", err);
    return c.json({ ok: false, error: err instanceof Error ? err.message : "Internal Server Error" }, 500);
  }
});

export default webhooks;
