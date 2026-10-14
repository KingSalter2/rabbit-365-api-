import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "./env";
import { fail } from "./lib/http";
import { withUser } from "./middleware/auth";
import authRoutes from "./routes/auth";
import assets from "./routes/assets";
import dev from "./routes/dev";
import emails from "./routes/emails";
import health from "./routes/health";
import leads from "./routes/leads";
import quotations from "./routes/quotations";

const app = new Hono<Env>();

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
app.route("/api/emails", emails);

app.route("/dev", dev);

app.notFound((c) => fail(c, "Not found", 404));

export default app;
