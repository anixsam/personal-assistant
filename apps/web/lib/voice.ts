"use client";

export type VoiceState = "idle" | "loading" | "speaking";

type Listener = (s: { state: VoiceState; messageId: string | null; level: number }) => void;

/** Plays spoken replies from /api/speak and exposes a live loudness level for the HUD. */
export class VoicePlayer {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private raf = 0;
  private abort: AbortController | null = null;
  private listeners = new Set<Listener>();
  state: VoiceState = "idle";
  messageId: string | null = null;
  level = 0;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  private snapshot() {
    return { state: this.state, messageId: this.messageId, level: this.level };
  }

  private emit() {
    for (const l of this.listeners) l(this.snapshot());
  }

  private set(state: VoiceState, messageId: string | null) {
    this.state = state;
    this.messageId = messageId;
    if (state !== "speaking") this.level = 0;
    this.emit();
  }

  stop() {
    this.abort?.abort();
    this.abort = null;
    try {
      this.source?.stop();
    } catch {
      /* already stopped */
    }
    this.source = null;
    cancelAnimationFrame(this.raf);
    this.set("idle", null);
  }

  /** Speaks `text`; resolves when playback ends or is stopped. */
  async speak(text: string, messageId: string | null = null): Promise<void> {
    this.stop();
    const abort = new AbortController();
    this.abort = abort;
    this.set("loading", messageId);
    try {
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: abort.signal,
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || `Voice failed (${res.status})`);
      const data = await res.arrayBuffer();
      if (abort.signal.aborted) return;
      this.ctx ??= new AudioContext();
      if (this.ctx.state === "suspended") await this.ctx.resume();
      const buffer = await this.ctx.decodeAudioData(data);
      if (abort.signal.aborted) return;
      this.analyser ??= Object.assign(this.ctx.createAnalyser(), { fftSize: 512 });
      this.analyser.connect(this.ctx.destination);
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.analyser);
      this.source = src;
      this.set("speaking", messageId);
      const samples = new Uint8Array(this.analyser.fftSize);
      const tick = () => {
        if (!this.analyser || this.state !== "speaking") return;
        this.analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const v of samples) sum += ((v - 128) / 128) ** 2;
        this.level = Math.min(1, Math.sqrt(sum / samples.length) * 4);
        this.emit();
        this.raf = requestAnimationFrame(tick);
      };
      tick();
      await new Promise<void>((resolve) => {
        src.onended = () => resolve();
        abort.signal.addEventListener("abort", () => resolve());
        src.start();
      });
      if (this.source === src) {
        cancelAnimationFrame(this.raf);
        this.source = null;
        this.set("idle", null);
      }
    } catch (e) {
      if (abort.signal.aborted) return;
      this.set("idle", null);
      throw e;
    }
  }
}

export const voicePlayer = typeof window === "undefined" ? (null as unknown as VoicePlayer) : new VoicePlayer();
