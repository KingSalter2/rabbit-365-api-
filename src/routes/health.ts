import { Hono } from "hono";
import type { Env } from "../env";
import { ok } from "../lib/http";

const health = new Hono<Env>();

health.get("/", (c) =>
  ok(c, {
    status: "ok",
    service: "rabbit365-api",
    environment: c.env.ENVIRONMENT ?? "unknown",
    time: new Date().toISOString(),
  }),
);

export default health;
