#!/usr/bin/env node
// Checks that Friday is ready to run: pnpm preflight
// Prints only whether things are set or installed, never the values of keys in .env.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const voices = path.join(root, "voices");
let problems = 0;
let warnings = 0;

const ok = (msg) => console.log(`  ok    ${msg}`);
const warn = (msg, fix) => (warnings++, console.log(`  warn  ${msg}${fix ? `\n        -> ${fix}` : ""}`));
const bad = (msg, fix) => (problems++, console.log(`  FAIL  ${msg}${fix ? `\n        -> ${fix}` : ""}`));

/** Names of keys in .env that have a non-empty value (values are never kept or printed). */
function envKeysSet(file) {
  const set = new Set();
  if (!existsSync(file)) return set;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && m[2].replace(/^["']|["']$/g, "").trim()) set.add(m[1]);
  }
  return set;
}

const portFree = (port) =>
  new Promise((res) => {
    const s = createServer()
      .once("error", () => res(false))
      .once("listening", () => s.close(() => res(true)))
      .listen(port, "127.0.0.1");
  });

const has = (dir, re) => existsSync(dir) && readdirSync(dir, { recursive: true }).some((f) => re.test(String(f)));

console.log("Friday preflight\n\nTools:");
const [major, minor] = process.versions.node.split(".").map(Number);
if (major > 22 || (major === 22 && minor >= 13)) ok(`Node ${process.versions.node}`);
else bad(`Node ${process.versions.node} is too old (saved history needs node:sqlite)`, "Install Node 22.13 or newer (Node 24 LTS recommended)");
try {
  const v = execFileSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["--version"], { encoding: "utf8", shell: process.platform === "win32" }).trim();
  if (v.startsWith("10.")) ok(`pnpm ${v}`);
  else warn(`pnpm ${v} (Friday pins pnpm 10)`, "npm i -g pnpm@10.28.0");
} catch {
  bad("pnpm not found", "npm i -g pnpm@10.28.0");
}

console.log("\nProject:");
if (existsSync(path.join(root, "node_modules"))) ok("dependencies installed");
else bad("dependencies not installed", "pnpm install");
const built = ["packages/router", "packages/voice", "packages/voiceid", "apps/server"].every((p) => existsSync(path.join(root, p, "dist")));
if (built) ok("packages built");
else warn("packages not built yet", "pnpm build (pnpm dev also builds them)");

console.log("\nSettings (.env):");
const envFile = path.join(root, ".env");
const keys = envKeysSet(envFile);
if (!existsSync(envFile)) bad(".env is missing", "Copy .env.example to .env and add NVIDIA_API_KEY");
else {
  ok(".env found");
  if (keys.has("NVIDIA_API_KEY")) ok("NVIDIA_API_KEY is set (NIM answers first)");
  else bad("NVIDIA_API_KEY is empty", "Add your NVIDIA NIM key to .env (build.nvidia.com)");
  if (keys.has("ANTHROPIC_API_KEY")) ok("ANTHROPIC_API_KEY is set (Claude handoffs)");
  else warn("ANTHROPIC_API_KEY is empty: handoffs to Claude are off");
  if (keys.has("CLAUDE_CODE_CWD")) ok("CLAUDE_CODE_CWD is set (Claude Code handoffs)");
  else warn("CLAUDE_CODE_CWD is empty: handoffs to Claude Code are off");
  if (keys.has("JARVIS_FS_ROOT")) ok("filesystem tools on");
  if (keys.has("GITHUB_TOKEN")) ok("GitHub tools on");
}

console.log("\nVoice:");
if (has(voices, /piper(\.exe)?$/)) ok("Piper installed (spoken replies)");
else warn("Piper not installed: Friday stays silent", "pnpm voice:setup");
if (has(voices, /\.onnx\.json$/)) ok("a Piper voice is installed");
else warn("no Piper voice installed", "pnpm voice:setup");
if (has(voices, /^(.*[\\/])?(whisper-cli|main)(\.exe)?$/) || keys.has("WHISPER_BIN") || keys.has("NIM_ASR_URL")) ok("speech-to-text available (mic button)");
else warn("speech-to-text not installed: no mic button", "pnpm voice:setup --stt");
if (existsSync(path.join(voices, "ggml-base.en.bin")) || keys.has("WHISPER_MODEL") || keys.has("NIM_ASR_URL")) ok("speech model present");
else warn("whisper speech model missing", "pnpm voice:setup --stt");
if (existsSync(path.join(voices, "wespeaker_en_voxceleb_CAM++.onnx")) || keys.has("VOICEID_MODEL")) ok("voice ID model present");
else warn("voice ID model missing: Access denied checks are off", "pnpm voice:setup --voiceid");

console.log("\nPorts:");
for (const [port, what] of [
  [8787, "server"],
  [3000, "chat UI"],
]) {
  if (await portFree(port)) ok(`${port} free (${what})`);
  else warn(`${port} is in use (${what})`, "Friday may already be running, or stop whatever uses that port");
}

console.log(`\n${problems ? `${problems} problem(s)` : "No problems"}${warnings ? `, ${warnings} warning(s)` : ""}. ${problems ? "Fix the FAIL lines, then run pnpm dev." : "Run pnpm dev, then open http://localhost:3000"}`);
process.exitCode = problems ? 1 : 0;
