"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Mic, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { MicRecorder, getUnlock, recordFor } from "@/lib/recorder";
import { fmtAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

interface VoiceIdState {
  available: boolean;
  setup?: string | null;
  enabled?: boolean;
  threshold?: number;
  hasPin?: boolean;
  prints?: { userId: string; name: string; samples: number; enrolledAt: string }[];
  recent?: { at: string; outcome: "accepted" | "denied" | "pin"; name?: string; score: number }[];
}

const PHRASES = [
  "Hey Friday, what's on my calendar today?",
  "Remind me to check my emails after lunch.",
  "Open my latest project and tell me what changed.",
];
const CLIP_MS = 4000;

/** Owner voiceprint enrollment, on/off, match threshold, PIN fallback and the recent access log. */
export function VoiceIdPanel() {
  const [s, setS] = useState<VoiceIdState | null>(null);
  const [name, setName] = useState("Anix");
  const [step, setStep] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [pin, setPin] = useState("");
  const [authPin, setAuthPin] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setS((await (await fetch("/api/voiceid")).json()) as VoiceIdState);
    } catch {
      setS({ available: false, setup: "Could not reach the Friday server" });
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  const auth = (): Record<string, string> => {
    const h: Record<string, string> = {};
    const u = getUnlock();
    if (u) h["x-friday-unlock"] = u;
    if (authPin) h["x-friday-pin"] = authPin;
    return h;
  };

  async function call(url: string, init: RequestInit) {
    const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), ...auth() } });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error((body.error as string) || `Failed (${res.status})`);
    return body;
  }

  async function recordPhrase(i: number) {
    setMsg(null);
    setRecording(true);
    try {
      const wav = await recordFor(CLIP_MS, setLevel);
      if (!wav) throw new Error("That was too short. Try again.");
      const r = (await call(`/api/voiceid/enroll?user=owner&name=${encodeURIComponent(name || "Owner")}`, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: wav,
      })) as { done: boolean; consistency?: number };
      if (r.done) {
        setStep(null);
        setMsg({ tone: "ok", text: `Voice saved. Voice ID is on. Match consistency ${Math.round((r.consistency ?? 0) * 100)}%.` });
        await load();
      } else setStep(i + 1);
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : "Recording failed" });
    } finally {
      setRecording(false);
      setLevel(0);
    }
  }

  async function test() {
    setMsg(null);
    setRecording(true);
    try {
      const wav = await recordFor(3000, setLevel);
      if (!wav) throw new Error("That was too short.");
      const r = (await call("/api/voiceid/verify", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav })) as { accepted: boolean; name?: string; score: number };
      setMsg(r.accepted ? { tone: "ok", text: `Recognised ${r.name} (match ${Math.round(r.score * 100)}%).` } : { tone: "bad", text: `Not recognised (match ${Math.round(r.score * 100)}%).` });
      await load();
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setRecording(false);
      setLevel(0);
    }
  }

  async function settings(patch: Record<string, unknown>, ok?: string) {
    setMsg(null);
    try {
      await call("/api/voiceid/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      if (ok) setMsg({ tone: "ok", text: ok });
      await load();
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : "Could not save" });
    }
  }

  async function remove(userId: string) {
    try {
      await call(`/api/voiceid/prints/${userId}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : "Could not remove" });
    }
  }

  if (!s) return <p className="text-sm text-muted">Loading…</p>;
  if (!s.available)
    return (
      <p className="text-sm text-muted">
        {s.setup ?? "Voice ID isn't set up."} It runs on your machine; only a voiceprint (numbers, not the recording) is saved.
      </p>
    );

  const owner = s.prints?.find((p) => p.userId === "owner");
  const canMic = MicRecorder.supported();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {s.enabled ? <ShieldCheck size={18} className="text-ok" /> : <ShieldOff size={18} className="text-muted" />}
        <span className="text-sm">{s.enabled ? "On: only recognised voices can talk to Friday" : "Off: anyone can talk to Friday"}</span>
        {!!s.prints?.length && (
          <button onClick={() => settings({ enabled: !s.enabled })} className="ml-auto rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:text-fg">
            Turn {s.enabled ? "off" : "on"}
          </button>
        )}
      </div>

      {s.hasPin && (
        <label className="flex items-center gap-2 text-xs text-muted">
          PIN to make changes
          <input
            value={authPin}
            onChange={(e) => setAuthPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            type="password"
            inputMode="numeric"
            className="w-24 rounded border border-line bg-bg px-2 py-1 text-center tracking-[0.3em] outline-none focus:border-accent/60"
            aria-label="PIN to make changes"
          />
        </label>
      )}

      <div className="rounded-lg border border-line p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          {owner ? `${owner.name}'s voice` : "Enroll your voice"}
          {owner && <span className="text-xs font-normal text-muted">saved {fmtAgo(owner.enrolledAt)}</span>}
          {owner && (
            <button onClick={() => remove("owner")} aria-label="Remove voiceprint" className="ml-auto text-muted hover:text-bad">
              <Trash2 size={14} />
            </button>
          )}
        </div>
        {step === null ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Your name"
              className="w-32 rounded border border-line bg-bg px-2 py-1 text-sm outline-none focus:border-accent/60"
            />
            <button disabled={!canMic} onClick={() => setStep(0)} className="rounded-md border border-accent/40 px-3 py-1 text-xs text-accent hover:bg-accent/10 disabled:opacity-50">
              {owner ? "Re-enroll" : "Start"} (3 short phrases)
            </button>
            {owner && (
              <button disabled={recording || !canMic} onClick={test} className="rounded-md border border-line px-3 py-1 text-xs text-muted hover:text-fg disabled:opacity-50">
                {recording ? "Listening…" : "Test my voice"}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs text-muted">
              Phrase {step + 1} of {PHRASES.length}. Press Record and read it out normally (about 4 seconds).
            </div>
            <div className="hud-panel rounded-md px-3 py-2 text-sm">“{PHRASES[step]}”</div>
            <div className="flex items-center gap-2">
              <button
                disabled={recording}
                onClick={() => recordPhrase(step)}
                className={cn("inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-xs", recording ? "border-accent bg-accent/20 text-accent" : "border-accent/40 text-accent hover:bg-accent/10")}
              >
                {recording ? <Loader2 size={13} className="animate-spin" /> : <Mic size={13} />}
                {recording ? "Recording…" : "Record"}
              </button>
              {recording && <span className="h-1.5 w-24 overflow-hidden rounded bg-line"><span className="block h-full bg-accent" style={{ width: `${Math.round(level * 100)}%` }} /></span>}
              <button onClick={() => setStep(null)} className="ml-auto text-xs text-muted hover:text-fg">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {!!s.prints?.length && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="rounded-lg border border-line p-3 text-xs text-muted">
            <div className="mb-1 flex justify-between">
              <span>Match needed</span>
              <span className="tabular-nums text-fg">{Math.round((s.threshold ?? 0.5) * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.3}
              max={0.8}
              step={0.01}
              defaultValue={s.threshold}
              onPointerUp={(e) => settings({ threshold: Number((e.target as HTMLInputElement).value) })}
              onKeyUp={(e) => settings({ threshold: Number((e.target as HTMLInputElement).value) })}
              className="w-full accent-[var(--color-accent)]"
              aria-label="Match needed"
            />
            <div className="mt-1">Higher is stricter. Lower it if Friday often turns you away.</div>
          </label>
          <form
            className="rounded-lg border border-line p-3 text-xs text-muted"
            onSubmit={(e) => {
              e.preventDefault();
              void settings({ pin }, pin ? "PIN saved." : "PIN removed.").then(() => setPin(""));
            }}
          >
            <div className="mb-1">{s.hasPin ? "Change the PIN" : "Set a PIN"} (fallback when your voice isn't recognised)</div>
            <div className="flex gap-2">
              <input
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                type="password"
                inputMode="numeric"
                placeholder="4–8 digits"
                className="w-28 rounded border border-line bg-bg px-2 py-1 text-center tracking-[0.3em] outline-none focus:border-accent/60"
                aria-label="New PIN"
              />
              <button disabled={pin.length > 0 && pin.length < 4} className="rounded-md border border-line px-2.5 py-1 hover:text-fg disabled:opacity-50">
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      {msg && <p className={cn("text-sm", msg.tone === "ok" ? "text-ok" : "text-bad")}>{msg.tone === "ok" && <Check size={14} className="mr-1 inline" />}{msg.text}</p>}

      <div>
        <div className="mb-1.5 text-xs text-muted">Recent voice checks</div>
        {s.recent?.length ? (
          <ul className="divide-y divide-line text-sm">
            {s.recent.slice(0, 8).map((e, i) => (
              <li key={i} className="flex items-center gap-2 py-1.5">
                <span className={cn("font-hud text-[11px] tracking-[0.15em]", e.outcome === "denied" ? "text-bad" : "text-ok")}>
                  {e.outcome === "denied" ? "ACCESS DENIED" : e.outcome === "pin" ? "PIN UNLOCK" : "ACCEPTED"}
                </span>
                <span className="truncate text-muted">{e.name ?? ""}</span>
                <span className="ml-auto shrink-0 text-xs tabular-nums text-muted">
                  {e.outcome !== "pin" && `${Math.round(e.score * 100)}% · `}
                  {fmtAgo(e.at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">None yet.</p>
        )}
      </div>
    </div>
  );
}
