import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NimAsr, SpeechToText, VoiceLibrary, WhisperCpp, defaultVoicePaths, defaultWhisperPaths } from "@jarvis/voice";
import { serve } from "@hono/node-server";
import { JarvisRouter, NimClient, loadNimConfig } from "@jarvis/router";
import { DEFAULT_VOICEID_MODEL, OnnxSpeakerEmbedder, VoiceprintStore } from "@jarvis/voiceid";
import { OWNER_ID, UserStore } from "./users.js";
import { FridayDb } from "./db.js";
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

// Voice input: NIM ASR (Parakeet) when NIM_ASR_URL is set, then local whisper.cpp from `pnpm voice:setup --stt`.
const whisper = defaultWhisperPaths(repoRoot, env.WHISPER_MODEL || undefined);
const stt = new SpeechToText([
  new NimAsr({ url: env.NIM_ASR_URL ?? "", apiKey: env.NIM_ASR_API_KEY || env.NVIDIA_API_KEY, language: env.STT_LANGUAGE || "en-US" }),
  new WhisperCpp({ bin: env.WHISPER_BIN || whisper.bin, model: env.WHISPER_MODEL_PATH || whisper.model, language: (env.STT_LANGUAGE || "en").slice(0, 2) }),
]);
if (!stt.available()) console.warn("Voice input not set up: run `pnpm voice:setup --stt` (or set NIM_ASR_URL).");

// Voice ID: speaker embeddings computed locally; voiceprints (not recordings) saved in data/voiceprints.json.
const voiceId = new VoiceprintStore(
  env.VOICEID_STORE || resolve(repoRoot, "data", "voiceprints.json"),
  new OnnxSpeakerEmbedder(env.VOICEID_MODEL || resolve(repoRoot, "voices", DEFAULT_VOICEID_MODEL.file)),
);
if (!voiceId.available()) console.warn("Voice ID not set up: run `pnpm voice:setup --voiceid` to recognise your voice.");

// Users and roles (data/users.json). The owner is created on first run, named after the enrolled voice if any.
const users = new UserStore(env.USERS_STORE || resolve(repoRoot, "data", "users.json"), voiceId.prints().find((p) => p.userId === OWNER_ID)?.name || env.FRIDAY_OWNER_NAME || "Owner");

// Saved history: conversations, dashboard numbers and handoffs in data/friday.db (FRIDAY_DB to move it).
const db = new FridayDb(env.FRIDAY_DB || resolve(repoRoot, "data", "friday.db"));

const port = Number(env.PORT) || 8787;
const app = createApp({ router, db, delegates, voice, stt, voiceId, users, mcpStatus: () => hub.status(), corsOrigin: env.CORS_ORIGIN || "http://localhost:3000" });

serve({ fetch: app.fetch, port, hostname: env.HOST || "127.0.0.1" }, (info) => {
  console.log(`Friday server listening on http://${info.address}:${info.port}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => void hub.close().finally(() => (db.close(), process.exit(0))));
}
