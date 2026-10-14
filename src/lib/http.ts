import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Env } from "../env";

export function ok<T>(c: Context<Env>, data: T, status: ContentfulStatusCode = 200) {
  return c.json({ ok: true as const, data }, status);
}

export function fail(
  c: Context<Env>,
  error: string,
  status: ContentfulStatusCode = 400,
  extra?: Record<string, unknown>,
) {
  return c.json({ ok: false as const, error, ...(extra ?? {}) }, status);
}

export function clientIp(c: Context<Env>): string | undefined {
  return (
    c.req.header("CF-Connecting-IP") ??
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ??
    undefined
  );
}
