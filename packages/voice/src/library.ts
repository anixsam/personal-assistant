import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PiperVoice } from "./piper.js";

export type VoiceGender = "female" | "male" | "unknown";

/** One pickable voice: a Piper model, plus a speaker for multi-speaker models. */
export interface VoiceOption {
  /** `<model>` or `<model>#<speaker name>`. */
  id: string;
  label: string;
  description: string;
  gender: VoiceGender;
}

interface Known {
  label: string;
  description: string;
  gender: VoiceGender;
}

// Friendly names for stock Piper voices. Multi-speaker models list only these curated speakers.
const KNOWN: Record<string, Known> = {
  "en_GB-alan-medium": { label: "Alan", description: "British man, deep and formal", gender: "male" },
  "en_GB-alan-low": { label: "Alan (light)", description: "British man, deep and formal", gender: "male" },
  "en_GB-northern_english_male-medium": { label: "Northern", description: "Northern English man, warm and relaxed", gender: "male" },
  "en_GB-jenny_dioco-medium": { label: "Jenny", description: "British woman, warm and soft", gender: "female" },
  "en_GB-cori-high": { label: "Cori", description: "British woman, clear and bright", gender: "female" },
  "en_GB-cori-medium": { label: "Cori", description: "British woman, clear and bright", gender: "female" },
  "en_GB-southern_english_female-low": { label: "Southern", description: "Southern English woman, soft", gender: "female" },
  "en_GB-alba-medium": { label: "Alba", description: "Scottish woman, gentle", gender: "female" },
  "en_GB-semaine-medium#poppy": { label: "Poppy", description: "British woman, bright and cheerful", gender: "female" },
  "en_GB-semaine-medium#prudence": { label: "Prudence", description: "British woman, calm and composed", gender: "female" },
  "en_GB-semaine-medium#spike": { label: "Spike", description: "British man, lively", gender: "male" },
  "en_GB-semaine-medium#obadiah": { label: "Obadiah", description: "British man, low and slow", gender: "male" },
  "en_GB-vctk-medium#p228": { label: "VCTK 228", description: "Southern English woman, friendly", gender: "female" },
  "en_GB-vctk-medium#p236": { label: "VCTK 236", description: "English woman, warm", gender: "female" },
  "en_GB-vctk-medium#p225": { label: "VCTK 225", description: "Southern English woman, light", gender: "female" },
  "en_GB-vctk-medium#p240": { label: "VCTK 240", description: "Southern English woman, gentle", gender: "female" },
  "en_GB-vctk-medium#p288": { label: "VCTK 288", description: "Irish woman, warm", gender: "female" },
  "en_GB-vctk-medium#p295": { label: "VCTK 295", description: "Irish woman, soft", gender: "female" },
  "en_GB-vctk-medium#p266": { label: "VCTK 266", description: "Irish woman, bright", gender: "female" },
  "en_GB-vctk-medium#p313": { label: "VCTK 313", description: "Irish woman, calm", gender: "female" },
  "en_GB-vctk-medium#p226": { label: "VCTK 226", description: "Surrey man, polished", gender: "male" },
  "en_GB-vctk-medium#p232": { label: "VCTK 232", description: "Southern English man, friendly", gender: "male" },
  "en_GB-vctk-medium#p254": { label: "VCTK 254", description: "Surrey man, crisp", gender: "male" },
  "en_GB-vctk-medium#p258": { label: "VCTK 258", description: "Southern English man, smooth", gender: "male" },
};

const MAX_UNKNOWN_SPEAKERS = 8;

export interface VoiceLibraryOptions {
  /** Folder holding `<voice>.onnx` + `<voice>.onnx.json` files (./voices). */
  dir: string;
  /** Piper executable. */
  bin: string;
  /** Voice used until one is picked, e.g. "en_GB-northern_english_male-medium" or "en_GB-vctk-medium#p228". */
  fallback: string;
  lengthScale?: number;
  /** Where the picked voice is remembered. Defaults to <dir>/selected.json. */
  stateFile?: string;
  /** Builds the synthesizer for one model/speaker (tests pass a fake). */
  makeVoice?: (model: string, speaker?: number) => { available(): boolean; synthesize(text: string): Promise<Buffer> };
}

function titleCase(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The installed Piper voices, which one is in use, and synthesis with any of them. */
export class VoiceLibrary {
  private selected: string;
  private readonly voices = new Map<string, { available(): boolean; synthesize(text: string): Promise<Buffer> }>();
  private readonly stateFile: string;

  constructor(private readonly opts: VoiceLibraryOptions) {
    this.stateFile = opts.stateFile ?? path.join(opts.dir, "selected.json");
    let saved: string | undefined;
    try {
      saved = (JSON.parse(readFileSync(this.stateFile, "utf8")) as { voice?: string }).voice;
    } catch {
      /* nothing saved yet */
    }
    this.selected = saved && this.resolve(saved) ? saved : this.normalize(opts.fallback);
  }

  /** Voices on disk, in a stable order (female first, then by label). */
  options(): VoiceOption[] {
    if (!existsSync(this.opts.dir)) return [];
    const out: VoiceOption[] = [];
    for (const file of readdirSync(this.opts.dir).filter((f) => f.endsWith(".onnx")).sort()) {
      const model = file.slice(0, -".onnx".length);
      const speakers = this.speakerMap(model);
      if (!speakers) {
        const k = KNOWN[model];
        out.push({ id: model, label: k?.label ?? titleCase(model.split("-")[1] ?? model), description: k?.description ?? model, gender: k?.gender ?? "unknown" });
        continue;
      }
      const curated = Object.keys(KNOWN).filter((id) => id.startsWith(`${model}#`) && id.split("#")[1] in speakers);
      const ids = curated.length ? curated : Object.keys(speakers).slice(0, MAX_UNKNOWN_SPEAKERS).map((s) => `${model}#${s}`);
      for (const id of ids) {
        const k = KNOWN[id];
        out.push({ id, label: k?.label ?? titleCase(id.split("#")[1]), description: k?.description ?? `${model}, speaker ${id.split("#")[1]}`, gender: k?.gender ?? "unknown" });
      }
    }
    const rank = { female: 0, male: 1, unknown: 2 };
    return out.sort((a, b) => rank[a.gender] - rank[b.gender] || a.label.localeCompare(b.label));
  }

  current(): string {
    return this.selected;
  }

  currentOption(): VoiceOption | undefined {
    return this.options().find((o) => o.id === this.selected);
  }

  get voiceName(): string {
    return this.selected;
  }

  /** Picks the voice used for replies and remembers it across restarts. */
  select(id: string): void {
    if (!this.resolve(id)) throw new Error(`Voice "${id}" isn't installed`);
    this.selected = id;
    mkdirSync(path.dirname(this.stateFile), { recursive: true });
    writeFileSync(this.stateFile, JSON.stringify({ voice: id }, null, 2));
  }

  available(): boolean {
    return this.get(this.selected)?.available() ?? false;
  }

  /** Speaks with the selected voice, or with `id` (for previews). */
  synthesize(text: string, id = this.selected): Promise<Buffer> {
    const v = this.get(id);
    if (!v) return Promise.reject(new Error(`Voice "${id}" isn't installed`));
    return v.synthesize(text);
  }

  private speakerMap(model: string): Record<string, number> | null {
    try {
      const cfg = JSON.parse(readFileSync(path.join(this.opts.dir, `${model}.onnx.json`), "utf8")) as {
        num_speakers?: number;
        speaker_id_map?: Record<string, number>;
      };
      return (cfg.num_speakers ?? 1) > 1 && cfg.speaker_id_map && Object.keys(cfg.speaker_id_map).length ? cfg.speaker_id_map : null;
    } catch {
      return null;
    }
  }

  /** Turns "model#3" (a speaker number, as PIPER_SPEAKER gives it) into "model#<speaker name>". */
  private normalize(id: string): string {
    const [name, speaker] = id.split("#");
    if (!speaker || !/^\d+$/.test(speaker)) return id;
    const map = this.speakerMap(name) ?? {};
    const found = Object.entries(map).find(([, n]) => n === Number(speaker));
    return found ? `${name}#${found[0]}` : id;
  }

  /** Model path and speaker number for an option id, or null when it isn't installed. */
  private resolve(id: string): { model: string; speaker?: number } | null {
    const [name, speakerName] = id.split("#");
    const model = path.join(this.opts.dir, `${name}.onnx`);
    if (!existsSync(model)) return null;
    if (!speakerName) return { model };
    const speaker = this.speakerMap(name)?.[speakerName];
    return speaker === undefined ? null : { model, speaker };
  }

  private get(id: string) {
    let v = this.voices.get(id);
    if (!v) {
      const r = this.resolve(id);
      if (!r) return undefined;
      v = this.opts.makeVoice
        ? this.opts.makeVoice(r.model, r.speaker)
        : new PiperVoice({ bin: this.opts.bin, model: r.model, speaker: r.speaker, lengthScale: this.opts.lengthScale });
      this.voices.set(id, v);
    }
    return v;
  }
}
