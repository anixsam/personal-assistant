"use client";

import { useEffect, useState } from "react";
import { Bot, Check, CircleAlert, Code2, Loader2, ShieldQuestion, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { decideHandoff, getHandoff } from "@/lib/api";
import type { Handoff } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";

const TARGET = {
  claude: { label: "Claude", icon: Bot, blurb: "Anthropic API" },
  "claude-code": { label: "Claude Code", icon: Code2, blurb: "coding agent" },
} as const;

const STATUS: Record<Handoff["status"], { text: string; tone: string }> = {
  pending: { text: "Awaiting your approval", tone: "text-warn border-warn/40 bg-warn/10" },
  approved: { text: "Approved", tone: "text-accent border-accent/40 bg-accent/10" },
  running: { text: "Working", tone: "text-accent border-accent/40 bg-accent/10" },
  completed: { text: "Done", tone: "text-ok border-ok/40 bg-ok/10" },
  rejected: { text: "Declined", tone: "text-muted border-line bg-panel-2" },
  failed: { text: "Failed", tone: "text-bad border-bad/40 bg-bad/10" },
};

export function HandoffCard({ handoff, onChange }: { handoff: Handoff; onChange: (h: Handoff) => void }) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = TARGET[handoff.target];
  const s = STATUS[handoff.status];
  const active = handoff.status === "running" || handoff.status === "approved";

  // Poll while the handoff is running.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(async () => {
      try {
        onChange(await getHandoff(handoff.id));
      } catch {
        /* keep polling */
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [active, handoff.id, onChange]);

  async function decide(action: "approve" | "reject") {
    setBusy(action);
    setError(null);
    try {
      onChange(await decideHandoff(handoff.id, action));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-1 overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <ShieldQuestion size={16} className="text-accent" />
        <span className="text-sm">
          Friday wants to hand this to <span className="font-medium text-fg">{t.label}</span>
          <span className="text-muted"> ({t.blurb})</span>
        </span>
        <span className={cn("ml-auto inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs", s.tone)}>
          {active && <Loader2 size={12} className="animate-spin" />}
          {s.text}
        </span>
      </div>
      <div className="space-y-2 px-4 py-3 text-sm">
        <p className="text-muted">{handoff.reason}</p>
        <div className="rounded-lg border border-line bg-panel-2 p-3 whitespace-pre-wrap">{handoff.task}</div>
        {handoff.status === "pending" && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="primary" size="sm" disabled={!!busy} onClick={() => decide("approve")}>
              {busy === "approve" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Approve
            </Button>
            <Button variant="outline" size="sm" disabled={!!busy} onClick={() => decide("reject")}>
              <X size={14} />
              Decline
            </Button>
          </div>
        )}
        {error && (
          <p className="flex items-center gap-1.5 text-bad">
            <CircleAlert size={14} /> {error}
          </p>
        )}
        {handoff.status === "running" && handoff.progress?.length ? (
          <ul className="space-y-0.5 font-mono text-[11px] text-muted" aria-label="Progress">
            {handoff.progress.map((p, i) => (
              <li key={i} className={i === handoff.progress!.length - 1 ? "text-fg" : undefined}>
                {p}
              </li>
            ))}
          </ul>
        ) : null}
        {handoff.status === "failed" && handoff.error && (
          <p className="flex items-center gap-1.5 text-bad">
            <CircleAlert size={14} /> {handoff.error}
          </p>
        )}
      </div>
      {handoff.status === "completed" && handoff.result && (
        <div className="border-t border-line px-4 py-3">
          <div className="mb-2 text-xs text-muted">
            Result from {handoff.by ?? t.label}
            {handoff.costUsd != null && ` · $${handoff.costUsd.toFixed(2)}`}
          </div>
          <Markdown>{handoff.result}</Markdown>
        </div>
      )}
    </div>
  );
}
