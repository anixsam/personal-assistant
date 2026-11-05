"use client";

import { useState } from "react";
import { Lock, ShieldX, X } from "lucide-react";
import { setUnlock } from "@/lib/recorder";

/** Shown when voice ID doesn't recognise the speaker. Offers the PIN fallback when one is set. */
export function AccessDenied({ pinAvailable, onClose }: { pinAvailable: boolean; onClose: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/voiceid/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
      const body = (await res.json()) as { unlock?: string; error?: string };
      if (!res.ok || !body.unlock) throw new Error(body.error || "Wrong PIN");
      setUnlock(body.unlock);
      window.dispatchEvent(new Event("friday:identity"));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wrong PIN");
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="alert" className="hud-panel relative mx-auto mb-3 max-w-md rounded-md border-bad/50 bg-bad/10 px-4 py-3 text-center">
      <button onClick={onClose} aria-label="Close" className="absolute right-2 top-2 text-muted hover:text-fg">
        <X size={14} />
      </button>
      <div className="font-hud flex items-center justify-center gap-2 text-lg font-bold tracking-[0.35em] text-bad">
        <ShieldX size={20} /> ACCESS DENIED
      </div>
      <p className="mt-1 text-xs text-muted">Voice not recognised.</p>
      {pinAvailable && (
        <form onSubmit={unlock} className="mt-3 flex items-center justify-center gap-2">
          <Lock size={14} className="text-muted" />
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            inputMode="numeric"
            type="password"
            autoComplete="off"
            placeholder="PIN"
            aria-label="PIN"
            className="w-28 rounded border border-line bg-bg px-2 py-1 text-center text-sm tracking-[0.3em] outline-none focus:border-accent/60"
          />
          <button disabled={busy || pin.length < 4} className="rounded border border-accent/40 px-2.5 py-1 text-xs text-accent disabled:opacity-50">
            Unlock
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-xs text-bad">{error}</p>}
    </div>
  );
}
