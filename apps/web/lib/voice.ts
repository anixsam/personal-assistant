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
  private fxInput: AudioNode | null = null;
  /** "Studio" effect: light room reverb, gentle shimmer and presence, for a movie-AI feel. */
  fx = false;
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

  /** Builds (once) the studio effect chain feeding `out` and returns its input node. */
  private studioChain(ctx: AudioContext, out: AudioNode): AudioNode {
    if (this.fxInput) return this.fxInput;
    const input = ctx.createGain();
    // Clean up rumble and add a little presence so the voice sounds "produced".
    const hp = Object.assign(ctx.createBiquadFilter(), { type: "highpass" as BiquadFilterType });
    hp.frequency.value = 110;
    const presence = Object.assign(ctx.createBiquadFilter(), { type: "peaking" as BiquadFilterType });
    presence.frequency.value = 3200;
    presence.Q.value = 0.9;
    presence.gain.value = 3;
    const air = Object.assign(ctx.createBiquadFilter(), { type: "highshelf" as BiquadFilterType });
    air.frequency.value = 8000;
    air.gain.value = 2;
    input.connect(hp).connect(presence).connect(air);

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 3;
    comp.attack.value = 0.005;
    comp.release.value = 0.15;
    comp.connect(out);

    const dry = ctx.createGain();
    dry.gain.value = 0.9;
    air.connect(dry).connect(comp);

    // Small bright room: a synthetic decaying-noise impulse response (no samples needed).
    const len = Math.floor(ctx.sampleRate * 0.9);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    const reverb = Object.assign(ctx.createConvolver(), { buffer: ir });
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    air.connect(reverb).connect(wet).connect(comp);

    // Gentle shimmer: a short modulated delay (chorus) mixed in quietly.
    const delay = ctx.createDelay(0.05);
    delay.delayTime.value = 0.014;
    const lfo = Object.assign(ctx.createOscillator(), { type: "sine" as OscillatorType });
    lfo.frequency.value = 0.35;
    const depth = ctx.createGain();
    depth.gain.value = 0.0018;
    lfo.connect(depth).connect(delay.delayTime);
    lfo.start();
    const chorus = ctx.createGain();
    chorus.gain.value = 0.18;
    air.connect(delay).connect(chorus).connect(comp);

    this.fxInput = input;
    return input;
  }

  /** Speaks `text`; resolves when playback ends or is stopped. */
  async speak(text: string, messageId: string | null = null, voiceId?: string): Promise<void> {
    this.stop();
    const abort = new AbortController();
    this.abort = abort;
    this.set("loading", messageId);
    try {
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(voiceId ? { text, voice: voiceId } : { text }),
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
      src.connect(this.fx ? this.studioChain(this.ctx, this.analyser) : this.analyser);
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
