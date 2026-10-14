const RESEND_URL = "https://api.resend.com/emails";

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
};

export type SendEmailResult = { id: string } | null;

/**
 * Send an email via Resend. Returns null (and does nothing) when no key is
 * configured so local development doesn't fail.
 */
export async function sendEmail(
  apiKey: string | undefined,
  from: string,
  input: SendEmailInput,
): Promise<SendEmailResult> {
  if (!apiKey) return null;

  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(input.to) ? input.to : [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
      reply_to: input.replyTo,
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend error ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as { id: string };
}
