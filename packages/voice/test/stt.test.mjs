import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { NimAsr, WhisperCpp, SpeechToText, cleanTranscript } from "../dist/index.js";

const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(40)]);

test("NimAsr posts the WAV as multipart and returns the text", async () => {
  const seen = [];
  const asr = new NimAsr({ url: "http://nim/v1/audio/transcriptions", apiKey: "k" }, async (url, init) => {
    seen.push({ url, init, file: init.body.get("file"), language: init.body.get("language") });
    return new Response(JSON.stringify({ text: " Hello Friday " }), { status: 200 });
  });
  assert.equal(await asr.transcribe(wav), "Hello Friday");
  assert.equal(seen[0].init.headers.Authorization, "Bearer k");
  assert.equal(seen[0].file.type, "audio/wav");
  assert.equal(seen[0].language, "en-US");
  const bad = new NimAsr({ url: "u" }, async () => new Response("nope", { status: 503 }));
  await assert.rejects(bad.transcribe(wav), /NIM ASR failed \(503\)/);
});

test("WhisperCpp runs whisper-cli and reads the .txt output", async () => {
  const seen = [];
  const spawner = (bin, args) => {
    seen.push({ bin, args });
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => {
      writeFileSync(args[args.indexOf("-of") + 1] + ".txt", " [BLANK_AUDIO]\n What's the weather,\n boss? \n");
      child.emit("close", 0);
    });
    return child;
  };
  const w = new WhisperCpp({ bin: "whisper-cli", model: "m.bin" }, spawner);
  assert.equal(await w.transcribe(wav), "What's the weather, boss?");
  assert.deepEqual(seen[0].args.slice(0, 2), ["-m", "m.bin"]);
  assert.ok(seen[0].args.includes("-otxt"));
});

test("SpeechToText tries NIM first and falls back to whisper", async () => {
  const eng = (name, ok, text = name) => ({ name, available: () => ok !== null, transcribe: async () => { if (!ok) throw new Error(`${name} down`); return text; } });
  assert.deepEqual(await new SpeechToText([eng("nim", true), eng("whisper", true)]).transcribe(wav), { text: "nim", engine: "nim" });
  assert.deepEqual(await new SpeechToText([eng("nim", false), eng("whisper", true)]).transcribe(wav), { text: "whisper", engine: "whisper" });
  const none = new SpeechToText([eng("nim", null)]);
  assert.equal(none.available(), false);
  await assert.rejects(none.transcribe(wav), /voice:setup --stt/);
  await assert.rejects(new SpeechToText([eng("nim", false)]).transcribe(wav), /nim: nim down/);
});

test("cleanTranscript", () => {
  assert.equal(cleanTranscript("(music) Hi [Music]\nthere"), "Hi there");
});
