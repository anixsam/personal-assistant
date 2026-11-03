import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PiperVoice, defaultVoicePaths } from "@jarvis/voice";
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

// Voice: files from `pnpm voice:setup` live in <repo>/voices. PIPER_BIN / PIPER_MODEL override them.
const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const voiceName = env.PIPER_VOICE || "en_GB-alan-medium";
const defaults = defaultVoicePaths(repoRoot, voiceName);
const piperBin = env.PIPER_BIN && isAbsolute(env.PIPER_BIN) && existsSync(env.PIPER_BIN) ? env.PIPER_BIN : existsSync(defaults.bin) ? defaults.bin : env.PIPER_BIN || defaults.bin;
const piper = new PiperVoice({ bin: piperBin, model: env.PIPER_MODEL || defaults.model, lengthScale: Number(env.PIPER_LENGTH_SCALE) || undefined });
const voice = Object.assign(piper, { voiceName });
if (!piper.available()) console.warn("Voice not set up: run `pnpm voice:setup` for spoken replies.");

const port = Number(env.PORT) || 8787;
const app = createApp({ router, delegates, voice, corsOrigin: env.CORS_ORIGIN || "http://localhost:3000" });

serve({ fetch: app.fetch, port, hostname: env.HOST || "127.0.0.1" }, (info) => {
  console.log(`Jarvis server listening on http://${info.address}:${info.port}`);
});
