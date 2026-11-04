/**
 * Kaldi-compatible log mel filterbank features (as used by WeSpeaker / sherpa-onnx speaker models):
 * 25 ms frames every 10 ms, DC removal, 0.97 pre-emphasis, Hamming window, 512-point FFT power
 * spectrum, 80 mel bins from 20 Hz to Nyquist, log, then per-utterance mean normalisation (CMN).
 * Input samples are floats in [-1, 1]; they are scaled to the int16 range as Kaldi expects.
 */
export interface FbankOptions {
  sampleRate?: number;
  numMelBins?: number;
  frameLengthMs?: number;
  frameShiftMs?: number;
  lowFreq?: number;
  /** Subtract the mean of each bin over the utterance. */
  cmn?: boolean;
  window?: "hamming" | "povey";
}

const EPS = 1.1920928955078125e-7; // FLT_EPSILON

function melScale(f: number) {
  return 1127 * Math.log(1 + f / 700);
}

const bankCache = new Map<string, { start: number; weights: Float32Array }[]>();

function melBanks(numBins: number, fftSize: number, rate: number, low: number, high: number) {
  const key = `${numBins}/${fftSize}/${rate}/${low}/${high}`;
  const hit = bankCache.get(key);
  if (hit) return hit;
  const nfft = fftSize / 2;
  const lowMel = melScale(low);
  const highMel = melScale(high);
  const delta = (highMel - lowMel) / (numBins + 1);
  const banks: { start: number; weights: Float32Array }[] = [];
  for (let b = 0; b < numBins; b++) {
    const left = lowMel + b * delta;
    const center = left + delta;
    const right = center + delta;
    const w = new Float32Array(nfft);
    let start = -1;
    let end = -1;
    for (let i = 0; i < nfft; i++) {
      const mel = melScale((i * rate) / fftSize);
      if (mel > left && mel < right) {
        w[i] = mel <= center ? (mel - left) / (center - left) : (right - mel) / (right - center);
        if (start < 0) start = i;
        end = i;
      }
    }
    banks.push({ start: Math.max(0, start), weights: start < 0 ? new Float32Array(0) : w.slice(start, end + 1) });
  }
  bankCache.set(key, banks);
  return banks;
}

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Returns features as a flat Float32Array of frames × bins (row-major) plus the frame count. */
export function fbank(samples: Float32Array, opts: FbankOptions = {}): { data: Float32Array; frames: number; bins: number } {
  const rate = opts.sampleRate ?? 16000;
  const bins = opts.numMelBins ?? 80;
  const flen = Math.round((rate * (opts.frameLengthMs ?? 25)) / 1000);
  const shift = Math.round((rate * (opts.frameShiftMs ?? 10)) / 1000);
  let fftSize = 1;
  while (fftSize < flen) fftSize <<= 1;
  const frames = samples.length >= flen ? 1 + Math.floor((samples.length - flen) / shift) : 0;
  const banks = melBanks(bins, fftSize, rate, opts.lowFreq ?? 20, rate / 2);
  const window = new Float64Array(flen);
  for (let i = 0; i < flen; i++) {
    const c = Math.cos((2 * Math.PI * i) / (flen - 1));
    window[i] = opts.window === "povey" ? Math.pow(0.5 - 0.5 * c, 0.85) : 0.54 - 0.46 * c;
  }
  const data = new Float32Array(frames * bins);
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const power = new Float64Array(fftSize / 2);

  for (let f = 0; f < frames; f++) {
    const off = f * shift;
    let mean = 0;
    for (let i = 0; i < flen; i++) mean += samples[off + i] * 32768;
    mean /= flen;
    re.fill(0);
    im.fill(0);
    let prev = samples[off] * 32768 - mean;
    for (let i = 0; i < flen; i++) {
      const x = samples[off + i] * 32768 - mean;
      re[i] = (x - 0.97 * (i === 0 ? x : prev)) * window[i];
      prev = x;
    }
    fft(re, im);
    for (let i = 0; i < fftSize / 2; i++) power[i] = re[i] * re[i] + im[i] * im[i];
    for (let b = 0; b < bins; b++) {
      const { start, weights } = banks[b];
      let e = 0;
      for (let k = 0; k < weights.length; k++) e += weights[k] * power[start + k];
      data[f * bins + b] = Math.log(Math.max(e, EPS));
    }
  }

  if (opts.cmn !== false && frames > 0) {
    for (let b = 0; b < bins; b++) {
      let m = 0;
      for (let f = 0; f < frames; f++) m += data[f * bins + b];
      m /= frames;
      for (let f = 0; f < frames; f++) data[f * bins + b] -= m;
    }
  }
  return { data, frames, bins };
}
