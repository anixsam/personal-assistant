import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fbank, decodeWav, resample, trimSilence, VoiceprintStore, OnnxSpeakerEmbedder, cosine, normalize, hashPin, checkPin, PinGuard, prepare } from "../dist/index.js";

function wav16(samples, rate = 16000) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), 44 + i * 2));
  return b;
}
const tone = (hz, secs, rate = 16000, amp = 0.3) => Float32Array.from({ length: secs * rate }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));

test("decodeWav, resample and trimSilence", () => {
  const { samples, sampleRate } = decodeWav(wav16([0, 0.5, -0.5]));
  assert.equal(sampleRate, 16000);
  assert.ok(Math.abs(samples[1] - 0.5) < 1e-3);
  assert.throws(() => decodeWav(Buffer.from("nope")), /Not a WAV/);
  assert.equal(resample(new Float32Array(22050), 22050, 16000).length, 16000);
  const padded = new Float32Array([...new Float32Array(8000), ...tone(300, 1), ...new Float32Array(8000)]);
  const t = trimSilence(padded, 16000);
  assert.ok(Math.abs(t.samples.length - 16000) <= 640);
  assert.ok(t.voicedSeconds > 0.9 && t.voicedSeconds < 1.1);
});

test("fbank: 100 frames per second, energy peaks in the right mel bin", () => {
  const low = fbank(tone(300, 1), { cmn: false });
  const high = fbank(tone(3000, 1), { cmn: false });
  assert.equal(low.frames, 98);
  assert.equal(low.bins, 80);
  const peak = (f) => { let b = 0; for (let i = 1; i < 80; i++) if (f.data[10 * 80 + i] > f.data[10 * 80 + b]) b = i; return b; };
  assert.ok(peak(low) < 20 && peak(high) > 40, `peaks ${peak(low)} ${peak(high)}`);
  const cmn = fbank(tone(300, 1));
  let m = 0; for (let f = 0; f < cmn.frames; f++) m += cmn.data[f * 80 + 5];
  assert.ok(Math.abs(m / cmn.frames) < 1e-4, "mean removed");
});

test("prepare refuses recordings with too little speech", () => {
  assert.throws(() => prepare(wav16(new Float32Array(16000))), /Too little speech/);
  assert.ok(prepare(wav16(tone(200, 2))).frames > 100);
});

test("PIN hashing, checking and lockout", () => {
  const h = hashPin("4821");
  assert.ok(checkPin("4821", h));
  assert.ok(!checkPin("1111", h));
  assert.ok(!checkPin("4821", undefined));
  assert.throws(() => hashPin("12"), /4 to 8 digits/);
  const g = new PinGuard(2, 1000);
  g.result(false, 0); g.result(false, 0);
  assert.ok(g.locked(500));
  assert.ok(!g.locked(1500));
});

// Fake embedder: the "voice" is the tone frequency, so recordings of the same tone match.
const fakeEmbedder = { available: () => true, embed: async (wav) => { const { samples } = decodeWav(wav); const f = fbank(samples, { cmn: false }); const v = new Float32Array(80); for (let i = 0; i < f.data.length; i++) v[i % 80] += f.data[i]; return normalize(v.map((x, i) => x - v.reduce((a, b) => a + b) / 80)); } };

test("VoiceprintStore: enroll 3 phrases, identify, deny strangers, persist, remove", async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "vid-")), "voiceprints.json");
  const store = new VoiceprintStore(file, fakeEmbedder);
  assert.equal(store.settings().enabled, false);
  for (let i = 1; i <= 3; i++) {
    const r = await store.enroll("owner", "Anix", wav16(tone(220 + i, 2)));
    assert.equal(r.collected, i);
    assert.equal(r.done, i === 3);
  }
  assert.equal(store.settings().enabled, true, "first voiceprint turns voice ID on");
  const me = await store.identify(wav16(tone(221, 2)));
  assert.equal(me.accepted, true);
  assert.equal(me.name, "Anix");
  store.updateSettings({ threshold: 0.999 });
  const stranger = await store.identify(wav16(tone(2600, 2)));
  assert.equal(stranger.accepted, false);
  assert.equal(store.recent()[0].outcome, "denied");
  const again = new VoiceprintStore(file, fakeEmbedder);
  assert.deepEqual(again.prints().map((p) => p.name), ["Anix"]);
  assert.equal(again.settings().threshold, 0.999);
  assert.ok(!("vector" in again.prints()[0]), "vectors are not exposed");
  assert.throws(() => again.updateSettings({ threshold: 2 }), /between 0 and 1/);
  again.remove("owner");
  assert.equal(again.settings().enabled, false);
});

// Real-model check: set VOICEID_TEST_MODEL to the .onnx and VOICEID_TEST_WAVS to a folder of s<speaker>_<n>.wav files.
const model = process.env.VOICEID_TEST_MODEL;
const wavs = process.env.VOICEID_TEST_WAVS;
test("real model separates speakers", { skip: !(model && wavs && existsSync(model)) && "set VOICEID_TEST_MODEL and VOICEID_TEST_WAVS" }, async () => {
  const e = new OnnxSpeakerEmbedder(model);
  const files = readdirSync(wavs).filter((f) => /^s\d+_\d+\.wav$/.test(f));
  const emb = Object.fromEntries(await Promise.all(files.map(async (f) => [f, await e.embed(readFileSync(path.join(wavs, f)))])));
  let sameMin = 1, diffMax = -1;
  for (const a of files) for (const b of files) if (a < b) {
    const s = cosine(emb[a], emb[b]);
    if (a.split("_")[0] === b.split("_")[0]) sameMin = Math.min(sameMin, s); else diffMax = Math.max(diffMax, s);
  }
  assert.ok(sameMin > 0.5 && diffMax < 0.5, `same min ${sameMin.toFixed(3)}, different max ${diffMax.toFixed(3)}`);
});
