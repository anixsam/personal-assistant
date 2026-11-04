import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

/** One speech-to-text engine. Input is a WAV file (16 kHz mono works everywhere). */
export interface Transcriber {
  readonly name: string;
  available(): boolean;
  transcribe(wav: Buffer, signal?: AbortSignal): Promise<string>;
}

export class SttError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SttError";
  }
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface NimAsrOptions {
  /** HTTP transcription endpoint of an NVIDIA Speech NIM (e.g. http://localhost:9000/v1/audio/transcriptions). */
  url: string;
  apiKey?: string;
  language?: string;
  model?: string;
  timeoutMs?: number;
}

/** NVIDIA NIM ASR (Parakeet) over its HTTP API (`/v1/audio/transcriptions`, multipart upload). */
export class NimAsr implements Transcriber {
  readonly name = "nim";
  constructor(private readonly opts: NimAsrOptions, private readonly fetcher: FetchLike = fetch) {}

  available(): boolean {
    return !!this.opts.url;
  }

  async transcribe(wav: Buffer, signal?: AbortSignal): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "speech.wav");
    form.append("language", this.opts.language ?? "en-US");
    if (this.opts.model) form.append("model", this.opts.model);
    const timeout = AbortSignal.timeout(this.opts.timeoutMs ?? 30_000);
    const res = await this.fetcher(this.opts.url, {
      method: "POST",
      body: form,
      headers: this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {},
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) throw new SttError(`NIM ASR failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const body = (await res.json()) as { text?: string };
    return (body.text ?? "").trim();
  }
}

export interface WhisperOptions {
  /** whisper.cpp CLI (whisper-cli). */
  bin: string;
  /** ggml model file, e.g. ggml-base.en.bin. */
  model: string;
  /** Language code, or "auto". */
  language?: string;
  threads?: number;
  timeoutMs?: number;
}

type Spawner = typeof spawn;

/** Local, offline speech-to-text with whisper.cpp. */
export class WhisperCpp implements Transcriber {
  readonly name = "whisper";
  constructor(private readonly opts: WhisperOptions, private readonly spawner: Spawner = spawn) {}

  available(): boolean {
    return existsSync(this.opts.model) && (existsSync(this.opts.bin) || !path.isAbsolute(this.opts.bin));
  }

  transcribe(wav: Buffer, signal?: AbortSignal): Promise<string> {
    const base = path.join(tmpdir(), `friday-stt-${randomUUID()}`);
    writeFileSync(`${base}.wav`, wav);
    const args = ["-m", this.opts.model, "-f", `${base}.wav`, "-l", this.opts.language ?? "en", "-nt", "-np", "-otxt", "-of", base];
    if (this.opts.threads) args.push("-t", String(this.opts.threads));
    const cleanup = () => {
      rmSync(`${base}.wav`, { force: true });
      rmSync(`${base}.txt`, { force: true });
    };
    return new Promise((resolve, reject) => {
      const child = this.spawner(this.opts.bin, args, {
        stdio: ["ignore", "ignore", "pipe"],
        cwd: path.isAbsolute(this.opts.bin) ? path.dirname(this.opts.bin) : undefined,
        windowsHide: true,
        signal,
      });
      const timer = setTimeout(() => child.kill(), this.opts.timeoutMs ?? 60_000);
      let stderr = "";
      child.stderr?.on("data", (d) => (stderr = (stderr + d).slice(-1000)));
      child.on("error", (e) => {
        clearTimeout(timer);
        cleanup();
        reject(new SttError(`Could not start whisper.cpp (${e.message}). Run pnpm voice:setup --stt.`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        try {
          if (code !== 0) return reject(new SttError(`whisper.cpp exited with ${code}: ${stderr.trim().slice(-300)}`));
          const text = existsSync(`${base}.txt`) ? readFileSync(`${base}.txt`, "utf8") : "";
          resolve(cleanTranscript(text));
        } finally {
          cleanup();
        }
      });
    });
  }
}

/** Joins lines and drops whisper's non-speech markers like [BLANK_AUDIO] or (music). */
export function cleanTranscript(text: string): string {
  return text
    .replace(/\[[^\]]*\]|\((?:music|silence|inaudible|noise)[^)]*\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tries each available engine in order (NIM first), falling back to the next one on failure. */
export class SpeechToText {
  constructor(private readonly engines: Transcriber[]) {}

  engineNames(): string[] {
    return this.engines.filter((e) => e.available()).map((e) => e.name);
  }

  available(): boolean {
    return this.engineNames().length > 0;
  }

  async transcribe(wav: Buffer, signal?: AbortSignal): Promise<{ text: string; engine: string }> {
    const errors: string[] = [];
    for (const e of this.engines.filter((x) => x.available())) {
      try {
        return { text: await e.transcribe(wav, signal), engine: e.name };
      } catch (err) {
        if (signal?.aborted) throw err;
        errors.push(`${e.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    throw new SttError(errors.length ? errors.join("; ") : "Speech-to-text isn't set up. Run pnpm voice:setup --stt.");
  }
}

/** Where `pnpm voice:setup --stt` puts whisper.cpp: finds whisper-cli anywhere under voices/whisper. */
export function defaultWhisperPaths(repoRoot: string, model = "ggml-base.en.bin") {
  const dir = path.join(repoRoot, "voices", "whisper");
  const names = process.platform === "win32" ? ["whisper-cli.exe", "main.exe"] : ["whisper-cli", "main"];
  const find = (d: string, depth: number): string | undefined => {
    if (!existsSync(d) || depth > 3) return undefined;
    for (const n of names) if (existsSync(path.join(d, n))) return path.join(d, n);
    for (const e of readdirSync(d)) {
      const p = path.join(d, e);
      if (statSync(p).isDirectory()) {
        const hit = find(p, depth + 1);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  return { bin: find(dir, 0) ?? names[0], model: path.join(repoRoot, "voices", model) };
}
