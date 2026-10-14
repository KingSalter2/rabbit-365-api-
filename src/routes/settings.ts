import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { Env } from "../env";
import { ok } from "../lib/http";
import { getBanking, saveBanking } from "../lib/settings";
import { db } from "../lib/supabase";
import { bankingSchema } from "../lib/validate";
import { requireAdmin } from "../middleware/auth";

const settings = new Hono<Env>();

// Admin: read company banking details.
settings.get("/banking", requireAdmin, async (c) => {
  const banking = await getBanking(db(c.env));
  return ok(c, { banking });
});

// Admin: save company banking details.
settings.put("/banking", requireAdmin, zValidator("json", bankingSchema), async (c) => {
  const banking = await saveBanking(db(c.env), c.req.valid("json"));
  return ok(c, { banking });
});

export default settings;
