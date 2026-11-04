"use client";

/** Encodes mono float samples as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

/** Resamples decoded audio to 16 kHz mono, which every speech-to-text engine accepts. */
async function toSpeechWav(blob: Blob): Promise<ArrayBuffer> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const rate = 16_000;
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    return encodeWav(rendered.getChannelData(0), rate);
  } finally {
    void ctx.close();
  }
}

/** Push-to-talk microphone capture with a live input level. */
export class MicRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private ctx: AudioContext | null = null;
  private raf = 0;
  private startedAt = 0;

  static supported(): boolean {
    return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
  }

  async start(onLevel?: (level: number) => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream);
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start();
    this.startedAt = Date.now();
    if (onLevel) {
      this.ctx = new AudioContext();
      const analyser = Object.assign(this.ctx.createAnalyser(), { fftSize: 512 });
      this.ctx.createMediaStreamSource(this.stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const x of data) sum += ((x - 128) / 128) ** 2;
        onLevel(Math.min(1, Math.sqrt(sum / data.length) * 5));
        this.raf = requestAnimationFrame(tick);
      };
      tick();
    }
  }

  /** Stops recording and returns a 16 kHz WAV, or null for a too-short tap. */
  async stop(): Promise<ArrayBuffer | null> {
    const rec = this.recorder;
    if (!rec) return null;
    const ended = new Promise<void>((r) => (rec.onstop = () => r()));
    if (rec.state !== "inactive") rec.stop();
    await ended;
    this.release();
    if (Date.now() - this.startedAt < 400 || !this.chunks.length) return null;
    return toSpeechWav(new Blob(this.chunks, { type: rec.mimeType }));
  }

  cancel() {
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.release();
  }

  private release() {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.stream = null;
    this.ctx = null;
    this.recorder = null;
  }
}

const UNLOCK_KEY = "friday.voiceid.unlock";

export function getUnlock(): string | null {
  try {
    return sessionStorage.getItem(UNLOCK_KEY);
  } catch {
    return null;
  }
}

export function setUnlock(token: string | null) {
  try {
    if (token) sessionStorage.setItem(UNLOCK_KEY, token);
    else sessionStorage.removeItem(UNLOCK_KEY);
  } catch {
    /* ignore */
  }
}

/** Thrown when voice ID didn't recognise the speaker. */
export class AccessDeniedError extends Error {
  constructor(readonly pinAvailable: boolean, readonly score?: number) {
    super("Access denied");
    this.name = "AccessDeniedError";
  }
}

export async function transcribe(wav: ArrayBuffer): Promise<{ text: string; engine: string; speaker?: { name: string | null; via: string } }> {
  const unlock = getUnlock();
  const res = await fetch("/api/transcribe", {
    method: "POST",
    headers: { "Content-Type": "audio/wav", ...(unlock && { "x-friday-unlock": unlock }) },
    body: wav,
  });
  const body = (await res.json().catch(() => ({}))) as { text?: string; engine?: string; error?: string; denied?: boolean; pinAvailable?: boolean; score?: number; speaker?: { name: string | null; via: string } };
  if (res.status === 403 && body.denied) throw new AccessDeniedError(!!body.pinAvailable, body.score);
  if (!res.ok) throw new Error(body.error || `Voice input failed (${res.status})`);
  return { text: (body.text ?? "").trim(), engine: body.engine ?? "", speaker: body.speaker };
}

/** Records a clip and returns its WAV (for voice ID enrollment), or null if it was too short. */
export async function recordFor(ms: number, onLevel?: (l: number) => void): Promise<ArrayBuffer | null> {
  const r = new MicRecorder();
  await r.start(onLevel);
  await new Promise((res) => setTimeout(res, ms));
  return r.stop();
}
