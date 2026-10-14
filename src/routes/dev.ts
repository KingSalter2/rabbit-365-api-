import { Hono } from "hono";
import type { Env } from "../env";
import { renderSampleEmail, SAMPLE_EMAILS } from "../lib/emailSamples";

const dev = new Hono<Env>();

// Disabled entirely outside development.
dev.use("*", async (c, next) => {
  if ((c.env.ENVIRONMENT ?? "development") === "production") {
    return c.text("Not found", 404);
  }
  await next();
});

dev.get("/emails/:name", (c) => {
  const email = renderSampleEmail(c.req.param("name"), c.env.APP_URL ?? "");
  if (!email) return c.text("Unknown template", 404);
  return c.html(email.html);
});

dev.get("/emails", (c) => {
  const base = c.env.APP_URL ?? "";
  const cards = SAMPLE_EMAILS.map((t) => {
    const email = renderSampleEmail(t.key, base)!;
    return `
      <section style="margin:0 0 40px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 auto 10px;max-width:600px">
          <h2 style="margin:0;font-size:16px;color:#0F172A">${t.label}</h2>
          <code style="font-size:12px;color:#64748B">subject: ${email.subject.replace(/</g, "&lt;")}</code>
        </div>
        <iframe src="/dev/emails/${t.key}" style="width:100%;max-width:640px;height:760px;border:1px solid #E2E8F0;border-radius:12px;background:#fff;display:block;margin:0 auto"></iframe>
      </section>`;
  }).join("");

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Rabbit 365 · Email previews</title>
  <style>
    body { margin:0; background:#F4F6F8; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#0F172A; }
    header { background:#14181F; color:#fff; padding:24px 20px; text-align:center; }
    header h1 { margin:0; font-size:18px; }
    header p { margin:6px 0 0; font-size:13px; color:#94A3B8; }
    main { padding:32px 20px 64px; }
  </style>
</head>
<body>
  <header>
    <h1>Rabbit 365 · Transactional email previews</h1>
    <p>Rendered from src/lib/emails.ts · dev only</p>
  </header>
  <main>${cards}</main>
</body>
</html>`);
});

export default dev;
