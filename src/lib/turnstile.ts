const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileResult = {
  success: boolean;
  skipped?: boolean;
  errorCodes?: string[];
};

/**
 * Server-side Turnstile verification.
 * Without a secret, validation is skipped in local/dev but fails closed in
 * production so missing configuration cannot silently remove protection.
 */
export async function verifyTurnstile(
  secret: string | undefined,
  token: string | undefined,
  ip?: string,
  required = false,
): Promise<TurnstileResult> {
  if (!secret) {
    return required
      ? { success: false, errorCodes: ["missing-secret"] }
      : { success: true, skipped: true };
  }
  if (!token) return { success: false, errorCodes: ["missing-input-response"] };

  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);

  try {
    const res = await fetch(VERIFY_URL, { method: "POST", body });
    const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    return { success: Boolean(data.success), errorCodes: data["error-codes"] };
  } catch {
    return { success: false, errorCodes: ["verification-request-failed"] };
  }
}
