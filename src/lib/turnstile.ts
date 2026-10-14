const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileResult = {
  success: boolean;
  skipped?: boolean;
  errorCodes?: string[];
};

/**
 * Server-side Turnstile verification.
 * If no secret is configured (local dev), verification is skipped.
 */
export async function verifyTurnstile(
  secret: string | undefined,
  token: string | undefined,
  ip?: string,
): Promise<TurnstileResult> {
  if (!secret) return { success: true, skipped: true };
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
