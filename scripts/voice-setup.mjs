#!/usr/bin/env node
// Downloads the Piper text-to-speech engine and Jarvis's stock British voice (en_GB-alan-medium)
// into ./voices. Run once: pnpm voice:setup
// Extra stock voices: pnpm voice:setup en_GB-northern_english_male-medium en_GB-cori-high
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "voices");
const voices = process.argv.slice(2).length ? process.argv.slice(2) : [process.env.PIPER_VOICE || "en_GB-alan-medium"];
const PIPER = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/";
const archives = {
  "win32-x64": "piper_windows_amd64.zip",
  "linux-x64": "piper_linux_x86_64.tar.gz",
  "linux-arm64": "piper_linux_aarch64.tar.gz",
  "darwin-x64": "piper_macos_x64.tar.gz",
  "darwin-arm64": "piper_macos_aarch64.tar.gz",
};

async function download(url, dest) {
  if (existsSync(dest) && statSync(dest).size > 0) return console.log(`  already have ${path.basename(dest)}`);
  console.log(`  downloading ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  renameSync(tmp, dest);
}

mkdirSync(dir, { recursive: true });

// 1. Piper engine
const key = `${process.platform}-${process.arch}`;
const archive = archives[key];
if (!archive) throw new Error(`No Piper build for ${key}. Install piper yourself and set PIPER_BIN.`);
const exe = path.join(dir, "piper", process.platform === "win32" ? "piper.exe" : "piper");
console.log("Piper engine:");
if (existsSync(exe)) {
  console.log("  already installed");
} else {
  const file = path.join(dir, archive);
  await download(PIPER + archive, file);
  // tar handles .zip too on Windows 10+ (bsdtar).
  execFileSync("tar", ["-xf", file, "-C", dir], { stdio: "inherit" });
  rmSync(file, { force: true });
  if (!existsSync(exe)) throw new Error(`Extracted archive but ${exe} is missing`);
}

// 2. Voice models + configs (stock Piper voices from rhasspy/piper-voices)
for (const voice of voices) {
  const [lang, regionName, quality] = [voice.split("_")[0], voice.split("-")[0], voice.split("-").pop()];
  const speaker = voice.split("-")[1];
  const base = `https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/${lang}/${regionName}/${speaker}/${quality}/${voice}`;
  console.log(`Voice ${voice}:`);
  await download(`${base}.onnx`, path.join(dir, `${voice}.onnx`));
  await download(`${base}.onnx.json`, path.join(dir, `${voice}.onnx.json`));
}

console.log(`\nDone. Voice files are in ${dir}. Set PIPER_VOICE in .env to pick one, then restart Jarvis (pnpm dev).`);
