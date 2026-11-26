import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Bindings, Env } from "./env";
import { fail } from "./lib/http";
import { runSupportFollowUps } from "./lib/supportFollowUps";
import { withUser } from "./middleware/auth";
import authRoutes from "./routes/auth";
import assets from "./routes/assets";
import clientRoutes from "./routes/client";
import dev from "./routes/dev";
import emails from "./routes/emails";
import health from "./routes/health";
import leads from "./routes/leads";
import quotations from "./routes/quotations";
import settings from "./routes/settings";
import supportRoutes from "./routes/support";
import webhooks from "./routes/webhooks";

const app = new Hono<Env>();

app.use("*", async (c, next) => {
  try {
    await next();
  } finally {
    c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    const path = new URL(c.req.url).pathname;
    if (path.startsWith("/api/") && !path.startsWith("/api/assets/")) {
      c.header("Cache-Control", "no-store");
    }
  }
});

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return fail(c, err.message || "Request error", err.status);
  }
  console.error("[api] unhandled error", err);
  return fail(c, "Internal Server Error", 500);
});

app.use("/api/*", withUser);

app.route("/api/health", health);
app.route("/api/assets", assets);
app.route("/api/auth", authRoutes);
app.route("/api/leads", leads);
app.route("/api/quotations", quotations);
app.route("/api/settings", settings);
app.route("/api/emails", emails);
app.route("/api/client", clientRoutes);
app.route("/api/support", supportRoutes);
app.route("/api/webhooks", webhooks);

app.route("/dev", dev);

app.notFound((c) => fail(c, "Not found", 404));

export default {
  fetch: app.fetch,
  scheduled(_event, env, ctx) {
    ctx.waitUntil(runSupportFollowUps(env));
  },
} satisfies ExportedHandler<Bindings>;
