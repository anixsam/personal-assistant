/** Reads a PCM WAV (8/16/32-bit int or 32-bit float, any channels) into mono float samples in [-1, 1]. */
export function decodeWav(buf: Buffer): { samples: Float32Array; sampleRate: number } {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("Not a WAV file");
  let off = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    let size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") {
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === "data") {
      if (!fmt) throw new Error("WAV data before format");
      if (size === 0 || size === 0xffffffff || body + size > buf.length) size = buf.length - body; // streamed WAVs
      const bytes = fmt.bits / 8;
      const frames = Math.floor(size / (bytes * fmt.channels));
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < fmt.channels; c++) {
          const p = body + (i * fmt.channels + c) * bytes;
          if (fmt.format === 3 && fmt.bits === 32) sum += buf.readFloatLE(p);
          else if (fmt.bits === 16) sum += buf.readInt16LE(p) / 32768;
          else if (fmt.bits === 32) sum += buf.readInt32LE(p) / 2147483648;
          else if (fmt.bits === 8) sum += (buf.readUInt8(p) - 128) / 128;
          else throw new Error(`Unsupported WAV: ${fmt.bits}-bit`);
        }
        out[i] = sum / fmt.channels;
      }
      return { samples: out, sampleRate: fmt.rate };
    }
    off = body + size + (size % 2);
  }
  throw new Error("WAV has no audio data");
}

/** Linear-interpolation resampler (enough for speech features at 16 kHz). */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const n = Math.floor((samples.length * to) / from);
  const out = new Float32Array(n);
  const ratio = from / to;
  for (let i = 0; i < n; i++) {
    const x = i * ratio;
    const j = Math.floor(x);
    const f = x - j;
    out[i] = (samples[j] ?? 0) * (1 - f) + (samples[j + 1] ?? samples[j] ?? 0) * f;
  }
  return out;
}

/** Drops leading/trailing near-silence so short clips carry mostly speech. Returns the voiced length in seconds too. */
export function trimSilence(samples: Float32Array, sampleRate: number, threshold = 0.01): { samples: Float32Array; voicedSeconds: number } {
  const win = Math.floor(sampleRate * 0.02);
  const loud: boolean[] = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let s = 0;
    for (let k = i; k < i + win; k++) s += samples[k] * samples[k];
    loud.push(Math.sqrt(s / win) > threshold);
  }
  const first = loud.indexOf(true);
  const last = loud.lastIndexOf(true);
  if (first < 0) return { samples: new Float32Array(0), voicedSeconds: 0 };
  const voiced = loud.filter(Boolean).length;
  return { samples: samples.subarray(first * win, (last + 1) * win), voicedSeconds: (voiced * win) / sampleRate };
}
