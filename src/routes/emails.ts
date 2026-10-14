import { Hono } from "hono";
import type { Env } from "../env";
import { renderSampleEmail, SAMPLE_EMAILS } from "../lib/emailSamples";
import { ok } from "../lib/http";
import { requireAdmin } from "../middleware/auth";

const emails = new Hono<Env>();

// Admin: preview the transactional email templates with sample data.
emails.get("/preview", requireAdmin, (c) => {
  const base = c.env.APP_URL ?? "https://www.rabbit365.co.za";
  const items = SAMPLE_EMAILS.map((t) => {
    const email = renderSampleEmail(t.key, base);
    return {
      key: t.key,
      label: t.label,
      description: t.description,
      subject: email?.subject ?? "",
      html: email?.html ?? "",
    };
  });
  return ok(c, { items });
});

export default emails;
