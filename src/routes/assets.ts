import { Hono } from "hono";
import type { Env } from "../env";
import { LOGO_PNG_BYTES } from "../lib/logoData";

const assets = new Hono<Env>();

// Public: serves brand assets referenced by transactional emails so they do not
// depend on the marketing site (keeps previews working fully offline).
assets.get("/logo.png", (c) =>
  c.body(LOGO_PNG_BYTES.buffer as ArrayBuffer, 200, {
    "Content-Type": "image/png",
    "Cache-Control": "public, max-age=86400, immutable",
  }),
);

export default assets;
