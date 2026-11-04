import { existsSync } from "node:fs";
import { fbank } from "./fbank.js";
import { decodeWav, resample, trimSilence } from "./wav.js";

/** Turns a voice recording into a fixed-size, L2-normalised speaker embedding. */
export interface Embedder {
  available(): boolean;
  embed(wav: Buffer): Promise<Float32Array>;
}

export class VoiceIdError extends Error {
  constructor(message: string, readonly code: "not_setup" | "too_short" | "bad_audio" = "bad_audio") {
    super(message);
    this.name = "VoiceIdError";
  }
}

export function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na * nb) || 1);
}

/** Minimum speech needed for a reliable voiceprint. */
export const MIN_VOICED_SECONDS = 1.0;

/** Decodes, resamples to 16 kHz, trims silence and computes fbank features ready for the model. */
export function prepare(wav: Buffer): { data: Float32Array; frames: number; bins: number } {
  let audio: { samples: Float32Array; sampleRate: number };
  try {
    audio = decodeWav(wav);
  } catch (e) {
    throw new VoiceIdError(e instanceof Error ? e.message : "Could not read the recording");
  }
  const pcm = resample(audio.samples, audio.sampleRate, 16000);
  const { samples, voicedSeconds } = trimSilence(pcm, 16000);
  if (voicedSeconds < MIN_VOICED_SECONDS) throw new VoiceIdError("Too little speech in that recording. Say a full sentence.", "too_short");
  return fbank(samples, { sampleRate: 16000 });
}

/**
 * Speaker embeddings from a WeSpeaker / 3D-Speaker ONNX model (input `feats` [1, T, 80],
 * output a 192–512 dim embedding), run locally with onnxruntime-node. Nothing leaves the machine.
 */
export class OnnxSpeakerEmbedder implements Embedder {
  private session: Promise<{ run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>; inputNames: readonly string[]; outputNames: readonly string[] }> | null = null;

  constructor(private readonly modelPath: string) {}

  available(): boolean {
    return existsSync(this.modelPath);
  }

  private load() {
    this.session ??= (async () => {
      const ort = await import("onnxruntime-node");
      return (await ort.InferenceSession.create(this.modelPath)) as never;
    })();
    return this.session;
  }

  async embed(wav: Buffer): Promise<Float32Array> {
    if (!this.available()) throw new VoiceIdError("Voice ID isn't set up. Run pnpm voice:setup --voiceid.", "not_setup");
    const feats = prepare(wav);
    const ort = await import("onnxruntime-node");
    const s = await this.load();
    const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", feats.data, [1, feats.frames, feats.bins]) });
    return normalize(Float32Array.from(out[s.outputNames[0]].data));
  }
}
