import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cosine, normalize, type Embedder, VoiceIdError } from "./embedder.js";

export interface Voiceprint {
  userId: string;
  name: string;
  /** Averaged, normalised embedding. */
  vector: number[];
  samples: number;
  enrolledAt: string;
}

export interface VoiceIdSettings {
  /** Cosine similarity needed to accept a speaker (0–1). */
  threshold: number;
  /** When false, spoken requests are not checked (voice ID is off). */
  enabled: boolean;
  /** scrypt hash of the fallback PIN, `salt:hash` in hex. */
  pinHash?: string;
}

export interface AccessEvent {
  at: string;
  outcome: "accepted" | "denied" | "pin";
  userId?: string;
  name?: string;
  score: number;
}

interface FileShape {
  settings: VoiceIdSettings;
  prints: Voiceprint[];
}

export const DEFAULT_THRESHOLD = 0.5;
/** Phrases an enrollment needs. */
export const ENROLL_SAMPLES = 3;

/**
 * Voiceprints and settings, saved as JSON next to the app (data/voiceprints.json). Only embeddings are
 * stored, never the recordings. Also keeps an in-memory log of recent access checks for the dashboard.
 */
export class VoiceprintStore {
  private data: FileShape;
  private readonly log: AccessEvent[] = [];
  /** Embeddings collected so far for an enrollment in progress. */
  private readonly pending = new Map<string, Float32Array[]>();

  constructor(private readonly file: string, private readonly embedder: Embedder) {
    this.data = { settings: { threshold: DEFAULT_THRESHOLD, enabled: false }, prints: [] };
    if (existsSync(file)) {
      try {
        const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<FileShape>;
        this.data = { settings: { ...this.data.settings, ...raw.settings }, prints: raw.prints ?? [] };
      } catch {
        /* start fresh if the file is unreadable */
      }
    }
  }

  private save() {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }

  available(): boolean {
    return this.embedder.available();
  }

  settings(): VoiceIdSettings {
    return this.data.settings;
  }

  updateSettings(patch: Partial<Pick<VoiceIdSettings, "threshold" | "enabled" | "pinHash">>) {
    if (patch.threshold !== undefined && !(patch.threshold > 0 && patch.threshold < 1)) throw new VoiceIdError("Threshold must be between 0 and 1");
    if (patch.enabled && !this.data.prints.length) throw new VoiceIdError("Enroll a voice before turning voice ID on");
    this.data.settings = { ...this.data.settings, ...patch };
    this.save();
  }

  prints(): Omit<Voiceprint, "vector">[] {
    return this.data.prints.map(({ vector: _v, ...p }) => p);
  }

  /** Adds one enrollment phrase. After ENROLL_SAMPLES phrases the voiceprint is saved (replacing any old one). */
  async enroll(userId: string, name: string, wav: Buffer): Promise<{ collected: number; needed: number; done: boolean; consistency?: number }> {
    const emb = await this.embedder.embed(wav);
    const got = [...(this.pending.get(userId) ?? []), emb];
    if (got.length < ENROLL_SAMPLES) {
      this.pending.set(userId, got);
      return { collected: got.length, needed: ENROLL_SAMPLES, done: false };
    }
    this.pending.delete(userId);
    const mean = new Float32Array(emb.length);
    for (const e of got) for (let i = 0; i < e.length; i++) mean[i] += e[i] / got.length;
    const vector = normalize(mean);
    const consistency = Math.min(...got.map((e) => cosine(e, vector)));
    this.data.prints = [...this.data.prints.filter((p) => p.userId !== userId), { userId, name, vector: Array.from(vector), samples: got.length, enrolledAt: new Date().toISOString() }];
    // First enrollment turns voice ID on.
    if (this.data.prints.length === 1) this.data.settings.enabled = true;
    this.save();
    return { collected: got.length, needed: ENROLL_SAMPLES, done: true, consistency: Math.round(consistency * 100) / 100 };
  }

  cancelEnrollment(userId: string) {
    this.pending.delete(userId);
  }

  remove(userId: string) {
    this.data.prints = this.data.prints.filter((p) => p.userId !== userId);
    if (!this.data.prints.length) this.data.settings.enabled = false;
    this.save();
  }

  /** Checks a recording against every voiceprint. */
  async identify(wav: Buffer): Promise<{ accepted: boolean; userId?: string; name?: string; score: number }> {
    const emb = await this.embedder.embed(wav);
    let best: { p: Voiceprint; s: number } | null = null;
    for (const p of this.data.prints) {
      const s = cosine(emb, p.vector);
      if (!best || s > best.s) best = { p, s };
    }
    const score = Math.round((best?.s ?? 0) * 1000) / 1000;
    const accepted = !!best && best.s >= this.data.settings.threshold;
    this.record({ at: new Date().toISOString(), outcome: accepted ? "accepted" : "denied", userId: accepted ? best!.p.userId : undefined, name: accepted ? best!.p.name : undefined, score });
    return accepted ? { accepted, userId: best!.p.userId, name: best!.p.name, score } : { accepted, score };
  }

  record(e: AccessEvent) {
    this.log.unshift(e);
    this.log.length = Math.min(this.log.length, 100);
  }

  recent(limit = 20): AccessEvent[] {
    return this.log.slice(0, limit);
  }
}
