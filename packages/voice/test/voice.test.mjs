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
