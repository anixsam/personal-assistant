"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Play, Square } from "lucide-react";
import { voicePlayer, type VoiceState } from "@/lib/voice";
import { cn } from "@/lib/utils";

interface VoiceOption {
  id: string;
  label: string;
  description: string;
  gender: "female" | "male" | "unknown";
}

const SAMPLE = "Hi, I'm Friday. Everything's running smoothly. Shall I take a look at your day?";
type Filter = "all" | "female" | "male";

/** Lists installed voices; Play previews one, Use makes it Friday's voice. */
export function VoicePicker() {
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [play, setPlay] = useState<{ state: VoiceState; messageId: string | null }>({ state: "idle", messageId: null });

  useEffect(() => {
    fetch("/api/voices")
      .then((r) => r.json())
      .then((d: { current: string | null; voices: VoiceOption[] }) => {
        setVoices(d.voices ?? []);
        setCurrent(d.current);
      })
      .catch(() => setError("Could not load voices"))
      .finally(() => setLoaded(true));
    return voicePlayer.subscribe((s) => setPlay(s));
  }, []);

  function preview(id: string) {
    if (play.messageId === `voice:${id}` && play.state !== "idle") return voicePlayer.stop();
    setError(null);
    voicePlayer.speak(SAMPLE, `voice:${id}`, id).catch((e) => setError(e instanceof Error ? e.message : "Preview failed"));
  }

  async function use(id: string) {
    setSaving(id);
    setError(null);
    try {
      const res = await fetch("/api/voices", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voice: id }) });
      const d = (await res.json()) as { current?: string; error?: string };
      if (!res.ok) throw new Error(d.error || `Failed (${res.status})`);
      setCurrent(d.current ?? id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change voice");
    } finally {
      setSaving(null);
    }
  }

  const shown = voices.filter((v) => filter === "all" || v.gender === filter);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(["all", "female", "male"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs capitalize transition-colors",
              filter === f ? "border-accent/60 bg-accent/10 text-fg" : "border-line text-muted hover:text-fg",
            )}
          >
            {f}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted">Press Play to hear a voice, then Use to switch.</span>
      </div>
      {error && <p className="mb-3 text-sm text-bad">{error}</p>}
      {loaded && !voices.length && (
        <p className="text-sm text-muted">
          No voices installed yet. Run <code>pnpm voice:setup</code>, then restart Friday.
        </p>
      )}
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((v) => {
          const active = v.id === current;
          const busy = play.messageId === `voice:${v.id}` ? play.state : "idle";
          return (
            <li
              key={v.id}
              className={cn("flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5", active ? "border-accent/60 bg-accent/5" : "border-line")}
            >
              <button
                onClick={() => preview(v.id)}
                aria-label={busy === "idle" ? `Play ${v.label}` : `Stop ${v.label}`}
                className="grid size-9 shrink-0 place-items-center rounded-full border border-accent/40 text-accent hover:bg-accent/10"
              >
                {busy === "loading" ? <Loader2 size={15} className="animate-spin" /> : busy === "speaking" ? <Square size={13} /> : <Play size={15} />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{v.label}</div>
                <div className="truncate text-xs text-muted">{v.description}</div>
              </div>
              {active ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-accent">
                  <Check size={14} /> In use
                </span>
              ) : (
                <button
                  onClick={() => use(v.id)}
                  disabled={saving !== null}
                  className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:border-accent/50 hover:text-fg disabled:opacity-50"
                >
                  {saving === v.id ? "Saving…" : "Use"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
