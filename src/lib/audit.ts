import type { Context } from "hono";
import type { Env } from "../env";
import type { AdminUser } from "../types";
import { db } from "./supabase";

export type AuditEntry = {
  action: string;
  entity?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
};

export async function logActivity(
  c: Context<Env>,
  admin: AdminUser | null,
  entry: AuditEntry,
): Promise<void> {
  try {
    await db(c.env).from("activity_log").insert({
      actor_id: admin?.id ?? null,
      actor_email: admin?.email ?? null,
      action: entry.action,
      entity: entry.entity ?? null,
      entity_id: entry.entityId ?? null,
      metadata: entry.metadata ?? {},
    });
  } catch {
    // activity logging must never break the request
  }
}
