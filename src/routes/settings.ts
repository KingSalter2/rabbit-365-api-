import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { Env } from "../env";
import { logActivity } from "../lib/audit";
import { clientIp, fail, ok } from "../lib/http";
import { allowRequest } from "../lib/ratelimit";
import { verifyPassword } from "../lib/reauth";
import { getBanking, saveBanking, type BankingDetails } from "../lib/settings";
import { db } from "../lib/supabase";
import { bankingUpdateSchema } from "../lib/validate";
import { requireSuperadmin } from "../middleware/auth";

const settings = new Hono<Env>();

function maskAccount(value: string): string {
  return value ? `••••${value.slice(-4)}` : "";
}

function masked(banking: BankingDetails): BankingDetails {
  return { ...banking, accountNumber: maskAccount(banking.accountNumber) };
}

// Superadmin: read company banking details.
settings.get("/banking", requireSuperadmin, async (c) => {
  const banking = await getBanking(db(c.env));
  return ok(c, { banking });
});

// Superadmin: save company banking details, with password confirmation.
settings.put(
  "/banking",
  requireSuperadmin,
  zValidator("json", bankingUpdateSchema),
  async (c) => {
    const admin = c.get("admin");
    if (!admin) return fail(c, "Unauthorized", 401);

    const ip = clientIp(c) ?? "unknown";
    if (!(await allowRequest(c.env.AUTH_RATE_LIMITER, `reauth:${ip}`))) {
      return fail(c, "Too many attempts. Please try again shortly.", 429);
    }

    const { password, ...input } = c.req.valid("json");
    if (!(await verifyPassword(c, admin.email, password))) {
      return fail(c, "Password confirmation failed", 403);
    }

    const before = await getBanking(db(c.env));
    const after = await saveBanking(db(c.env), input);

    await logActivity(c, admin, {
      action: "settings.banking_updated",
      entity: "settings",
      entityId: "banking",
      metadata: { before: masked(before), after: masked(after) },
    });
    return ok(c, { banking: after });
  },
);

export default settings;
