import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { VoiceLibrary, defaultVoicePaths } from "@jarvis/voice";
import { serve } from "@hono/node-server";
import { JarvisRouter, NimClient, loadNimConfig } from "@jarvis/router";
import { createApp } from "./app.js";
import { ClaudeDelegate } from "./delegates/claude.js";
import { ClaudeCodeDelegate } from "./delegates/claude-code.js";
import { McpClaudeCodeDelegate } from "./delegates/claude-code-mcp.js";
import type { Delegate, Delegates } from "./delegates/types.js";
import { McpHub, mcpConfigsFromEnv } from "./mcp/hub.js";

// Load the repo-root .env when present (Node 22+).
for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  if (existsSync(p)) {
    process.loadEnvFile(p);
    break;
  }
}

const env = process.env;
const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

// MCP servers (files, GitHub, Claude Code). Each starts only when configured; see mcp/hub.ts.
const hub = new McpHub(mcpConfigsFromEnv(env, repoRoot));
void hub.start().then(() => {
  for (const s of hub.status()) console.log(`MCP ${s.name}: ${s.status}${s.detail ? ` (${s.detail})` : ""}`);
});
const router = new JarvisRouter(new NimClient(loadNimConfig()), { toolbox: hub });

const delegates: Delegates = {};
if (env.ANTHROPIC_API_KEY) {
  delegates.claude = new ClaudeDelegate(undefined, { model: env.CLAUDE_MODEL || undefined });
} else {
  console.warn("ANTHROPIC_API_KEY not set: handoffs to Claude are disabled.");
}
if (env.CLAUDE_CODE_CWD) {
  const cli = new ClaudeCodeDelegate({
    cwd: env.CLAUDE_CODE_CWD,
    bin: env.CLAUDE_CODE_BIN || undefined,
    permissionMode: env.CLAUDE_CODE_PERMISSION_MODE || undefined,
  });
  // Prefer the claude-code MCP server (live progress); fall back to running the CLI directly.
  const viaMcp = new McpClaudeCodeDelegate((tool, args, signal) => hub.callOn("claude-code", tool, args, signal));
  const claudeCode: Delegate = { run: (h, signal, onProgress) => (hub.isOnline("claude-code") ? viaMcp : cli).run(h, signal, onProgress) };
  delegates["claude-code"] = claudeCode;
} else {
  console.warn("CLAUDE_CODE_CWD not set: handoffs to Claude Code are disabled.");
}

// Voice: files from `pnpm voice:setup` live in <repo>/voices. PIPER_BIN / PIPER_MODEL override them.
const voiceName = env.PIPER_VOICE || "en_GB-northern_english_male-medium";
const defaults = defaultVoicePaths(repoRoot, voiceName);
const piperBin = env.PIPER_BIN && isAbsolute(env.PIPER_BIN) && existsSync(env.PIPER_BIN) ? env.PIPER_BIN : existsSync(defaults.bin) ? defaults.bin : env.PIPER_BIN || defaults.bin;
const voice = new VoiceLibrary({
  dir: dirname(env.PIPER_MODEL || defaults.model),
  bin: piperBin,
  fallback: env.PIPER_MODEL ? basename(env.PIPER_MODEL, ".onnx") : env.PIPER_SPEAKER ? `${voiceName}#${env.PIPER_SPEAKER}` : voiceName,
  lengthScale: Number(env.PIPER_LENGTH_SCALE) || undefined,
});
if (!voice.available()) console.warn("Voice not set up: run `pnpm voice:setup` for spoken replies.");

const port = Number(env.PORT) || 8787;
const app = createApp({ router, delegates, voice, mcpStatus: () => hub.status(), corsOrigin: env.CORS_ORIGIN || "http://localhost:3000" });

serve({ fetch: app.fetch, port, hostname: env.HOST || "127.0.0.1" }, (info) => {
  console.log(`Friday server listening on http://${info.address}:${info.port}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => void hub.close().finally(() => process.exit(0)));
}
