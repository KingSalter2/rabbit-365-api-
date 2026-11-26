import type { RateLimiter } from "../env";

/**
 * Cloudflare Rate Limiting binding helper. Limits are best-effort and scoped
 * per Cloudflare location. When the binding is absent (local dev) or the
 * platform call fails, requests are allowed rather than locking everyone out.
 */
export async function allowRequest(
  limiter: RateLimiter | undefined,
  key: string,
): Promise<boolean> {
  if (!limiter) return true;
  try {
    const result = await limiter.limit({ key });
    return result.success;
  } catch (err) {
    console.error("[ratelimit] check failed", err);
    return true;
  }
}
