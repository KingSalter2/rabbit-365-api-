import type { Bindings } from "../env";
import { sendEmail } from "./resend";
import { db } from "./supabase";

export type LoggedEmail = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  template?: string;
};

const DEFAULT_FROM = "Rabbit 365 <no-reply@emails.rabbit365.co.za>";

/** Send an email via Resend and record the attempt in `email_outbox`. */
export async function sendLoggedEmail(env: Bindings, input: LoggedEmail): Promise<void> {
  const client = db(env);
  try {
    const result = await sendEmail(env.RESEND_API_KEY, env.EMAIL_FROM ?? DEFAULT_FROM, {
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      replyTo: input.replyTo,
    });

    await client.from("email_outbox").insert({
      to_email: input.to,
      reply_to: input.replyTo ?? null,
      subject: input.subject,
      body: input.html ?? input.text ?? null,
      template: input.template ?? null,
      status: result ? "sent" : "queued",
      provider_id: result?.id ?? null,
      sent_at: result ? new Date().toISOString() : null,
    });
  } catch (error) {
    try {
      await client.from("email_outbox").insert({
        to_email: input.to,
        subject: input.subject,
        template: input.template ?? null,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // swallow — outbox logging is best effort
    }
  }
}
