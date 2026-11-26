export function generateOtpCode(): string { return String(Math.floor(100000 + Math.random() * 900000)); }
export async function hashOtp(userId: string, purpose: string, code: string, secret: string): Promise<string> {
  const data = new TextEncoder().encode(userId + ":" + purpose + ":" + code + ":" + secret);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
