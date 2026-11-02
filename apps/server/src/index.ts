import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { JarvisRouter, NimClient, loadNimConfig } from "@jarvis/router";
import { createApp } from "./app.js";
import { ClaudeDelegate } from "./delegates/claude.js";
import { ClaudeCodeDelegate } from "./delegates/claude-code.js";
import type { Delegates } from "./delegates/types.js";

// Load the repo-root .env when present (Node 22+).
for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(p)) {
    process.loadEnvFile(p);
    break;
  }
}

const env = process.env;
const router = new JarvisRouter(new NimClient(loadNimConfig()));

const delegates: Delegates = {};
if (env.ANTHROPIC_API_KEY) {
  delegates.claude = new ClaudeDelegate(undefined, { model: env.CLAUDE_MODEL || undefined });
} else {
  console.warn("ANTHROPIC_API_KEY not set: handoffs to Claude are disabled.");
}
if (env.CLAUDE_CODE_CWD) {
  delegates["claude-code"] = new ClaudeCodeDelegate({
    cwd: env.CLAUDE_CODE_CWD,
    bin: env.CLAUDE_CODE_BIN || undefined,
    permissionMode: env.CLAUDE_CODE_PERMISSION_MODE || undefined,
  });
} else {
  console.warn("CLAUDE_CODE_CWD not set: handoffs to Claude Code are disabled.");
}

const port = Number(env.PORT) || 8787;
const app = createApp({ router, delegates, corsOrigin: env.CORS_ORIGIN || "http://localhost:3000" });

serve({ fetch: app.fetch, port, hostname: env.HOST || "127.0.0.1" }, (info) => {
  console.log(`Jarvis server listening on http://${info.address}:${info.port}`);
});
