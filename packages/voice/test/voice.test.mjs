import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { writeFileSync, existsSync } from "node:fs";
import { PiperVoice, speakable } from "../dist/index.js";

test("speakable strips markdown and code", () => {
  const s = speakable("# Plan\n\n1. **Inbox** first\n2. See [docs](https://x.y)\n\n```js\nconsole.log(1)\n```\nUse `pnpm dev`.");
  assert.equal(s, "Plan. Inbox first. See docs. (code shown on screen). Use pnpm dev.");
  assert.doesNotMatch(speakable("Visit https://example.com now"), /https/);
  const long = speakable("This is a sentence. ".repeat(200), 300);
  assert.ok(long.length < 340 && long.endsWith("The rest is on screen."));
});

function fakeSpawn(stdout, code = 0, seen = []) {
  return (bin, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let input = "";
    child.stdin = { end: (t) => { input = t; seen.push({ bin, args, input, opts }); setImmediate(() => { const f = args[args.indexOf("--output_file") + 1]; if (stdout.length) writeFileSync(f, stdout); child.emit("close", code); }); } };
    return child;
  };
}

test("synthesize pipes one line to piper and returns WAV", async () => {
  const seen = [];
  const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(60)]);
  const v = new PiperVoice({ bin: "/opt/piper/piper", model: "/v/alan.onnx" }, fakeSpawn(wav, 0, seen));
  const out = await v.synthesize("Hello,\n  sir.");
  assert.equal(out.subarray(0, 4).toString(), "RIFF");
  assert.equal(seen[0].input, "Hello, sir.\n");
  assert.deepEqual(seen[0].args.slice(0, 3), ["--model", "/v/alan.onnx", "--output_file"]);
  assert.match(seen[0].args[3], /jarvis-voice-.*\.wav$/);
  assert.equal(existsSync(seen[0].args[3]), false, "temp file is cleaned up");
  assert.equal(seen[0].opts.cwd, "/opt/piper");
});

test("synthesize passes speaker and pace when set", async () => {
  const seen = [];
  const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(60)]);
  await new PiperVoice({ bin: "p", model: "m", speaker: 3, lengthScale: 0.9 }, fakeSpawn(wav, 0, seen)).synthesize("hi");
  assert.deepEqual(seen[0].args.slice(-4), ["--length_scale", "0.9", "--speaker", "3"]);
});

test("synthesize rejects on failure, empty text or non-WAV output", async () => {
  await assert.rejects(new PiperVoice({ bin: "p", model: "m" }, fakeSpawn(Buffer.alloc(0), 1)).synthesize("hi"), /exited with 1/);
  await assert.rejects(new PiperVoice({ bin: "p", model: "m" }, fakeSpawn(Buffer.from("nope"))).synthesize("hi"), /no audio/);
  await assert.rejects(new PiperVoice({ bin: "p", model: "m" }).synthesize("   "), /Nothing to say/);
});

import { mkdtempSync, writeFileSync as wf, readFileSync as rf } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { VoiceLibrary } from "../dist/index.js";

function voicesDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "voices-"));
  for (const v of ["en_GB-northern_english_male-medium", "en_GB-jenny_dioco-medium", "en_GB-semaine-medium", "xx_XX-mystery-low"]) {
    wf(path.join(dir, `${v}.onnx`), "");
    const multi = v.includes("semaine");
    wf(path.join(dir, `${v}.onnx.json`), JSON.stringify(multi ? { num_speakers: 4, speaker_id_map: { prudence: 0, spike: 1, obadiah: 2, poppy: 3 } } : { num_speakers: 1 }));
  }
  return dir;
}

test("VoiceLibrary lists installed voices, female first, with curated speakers", () => {
  const lib = new VoiceLibrary({ dir: voicesDir(), bin: "piper", fallback: "en_GB-northern_english_male-medium" });
  const opts = lib.options();
  assert.deepEqual(opts.map((o) => o.id), [
    "en_GB-jenny_dioco-medium",
    "en_GB-semaine-medium#poppy",
    "en_GB-semaine-medium#prudence",
    "en_GB-northern_english_male-medium",
    "en_GB-semaine-medium#obadiah",
    "en_GB-semaine-medium#spike",
    "xx_XX-mystery-low",
  ]);
  assert.equal(opts[0].label, "Jenny");
  assert.equal(lib.current(), "en_GB-northern_english_male-medium");
});

test("VoiceLibrary selects, remembers and speaks with the right model and speaker", async () => {
  const dir = voicesDir();
  const made = [];
  const makeVoice = (model, speaker) => ({ available: () => true, synthesize: async (t) => (made.push({ model: path.basename(model), speaker, t }), Buffer.from("RIFF")) });
  const lib = new VoiceLibrary({ dir, bin: "piper", fallback: "en_GB-semaine-medium#3", makeVoice });
  assert.equal(lib.current(), "en_GB-semaine-medium#poppy", "numeric speaker is normalised to its name");
  lib.select("en_GB-semaine-medium#prudence");
  assert.equal(JSON.parse(rf(path.join(dir, "selected.json"), "utf8")).voice, "en_GB-semaine-medium#prudence");
  await lib.synthesize("hello");
  await lib.synthesize("preview", "en_GB-jenny_dioco-medium");
  assert.deepEqual(made, [
    { model: "en_GB-semaine-medium.onnx", speaker: 0, t: "hello" },
    { model: "en_GB-jenny_dioco-medium.onnx", speaker: undefined, t: "preview" },
  ]);
  assert.throws(() => lib.select("en_GB-nope-medium"), /isn't installed/);
  assert.equal(new VoiceLibrary({ dir, bin: "piper", fallback: "x", makeVoice }).current(), "en_GB-semaine-medium#prudence", "choice survives restart");
});
