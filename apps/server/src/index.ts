import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { JarvisRouter, NimClient, loadNimConfig } from "@jarvis/router";
import { createApp } from "./app.js";

// Load the repo-root .env when present (Node 22+).
for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(p)) {
    process.loadEnvFile(p);
    break;
  }
}

const router = new JarvisRouter(new NimClient(loadNimConfig()));
const port = Number(process.env.PORT) || 8787;
const app = createApp({ router, corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3000" });

serve({ fetch: app.fetch, port, hostname: process.env.HOST || "127.0.0.1" }, (info) => {
  console.log(`Jarvis server listening on http://${info.address}:${info.port}`);
});
