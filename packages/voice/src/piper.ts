import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export interface PiperOptions {
  /** Path to the piper executable. */
  bin: string;
  /** Path to the .onnx voice model (its .onnx.json config must sit next to it). */
  model: string;
  /** Speaking speed: below 1 is faster, above 1 slower. */
  lengthScale?: number;
  timeoutMs?: number;
}

export class VoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceError";
  }
}

type Spawner = typeof spawn;

/** Text-to-speech with Piper (local, offline). Returns WAV bytes. */
export class PiperVoice {
  constructor(private readonly opts: PiperOptions, private readonly spawner: Spawner = spawn) {}

  /** True when the piper binary and voice model are both on disk. */
  available(): boolean {
    return existsSync(this.opts.model) && (existsSync(this.opts.bin) || !path.isAbsolute(this.opts.bin));
  }

  synthesize(text: string): Promise<Buffer> {
    const line = text.replace(/\s+/g, " ").trim();
    if (!line) return Promise.reject(new VoiceError("Nothing to say"));
    const args = ["--model", this.opts.model, "--output_file", "-", "--quiet"];
    if (this.opts.lengthScale) args.push("--length_scale", String(this.opts.lengthScale));
    return new Promise((resolve, reject) => {
      const child = this.spawner(this.opts.bin, args, {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: this.opts.timeoutMs ?? 60_000,
        // Piper's shared libraries live next to the binary.
        cwd: path.isAbsolute(this.opts.bin) ? path.dirname(this.opts.bin) : undefined,
        windowsHide: true,
      });
      const chunks: Buffer[] = [];
      let stderr = "";
      child.stdout?.on("data", (d: Buffer) => chunks.push(d));
      child.stderr?.on("data", (d) => (stderr += d));
      child.on("error", (e) => reject(new VoiceError(`Could not start piper (${e.message}). Run pnpm voice:setup.`)));
      child.on("close", (code) => {
        const wav = Buffer.concat(chunks);
        if (code !== 0) return reject(new VoiceError(`piper exited with ${code}: ${stderr.trim().slice(-300)}`));
        if (wav.length < 44 || wav.subarray(0, 4).toString("ascii") !== "RIFF") return reject(new VoiceError("piper returned no audio"));
        resolve(wav);
      });
      child.stdin?.end(line + "\n");
    });
  }
}

/** Default locations used by `pnpm voice:setup` (relative to the repo root). */
export function defaultVoicePaths(repoRoot: string, voice = "en_GB-alan-medium") {
  const exe = process.platform === "win32" ? "piper.exe" : "piper";
  return { bin: path.join(repoRoot, "voices", "piper", exe), model: path.join(repoRoot, "voices", `${voice}.onnx`) };
}
