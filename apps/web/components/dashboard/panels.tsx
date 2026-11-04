"use client";

import Link from "next/link";
import { CircleCheck, CircleDashed, CircleX, Clock, Loader2 } from "lucide-react";
import { fmtAgo, fmtInt, fmtMs, fmtUsd } from "@/lib/format";
import type { Conversation, HandoffStatus, Stats } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-xl border border-line bg-panel p-4", className)}>
      <h2 className="mb-3 text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}

export function ModelTable({ models }: { models: Stats["models"] }) {
  if (!models.length) return <Empty>No requests yet</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="text-left text-xs text-muted">
          <tr>
            <th className="pb-2 font-normal">Model</th>
            <th className="pb-2 pl-4 font-normal">Role</th>
            <th className="pb-2 pl-4 text-right font-normal whitespace-nowrap">Requests</th>
            <th className="pb-2 pl-4 text-right font-normal whitespace-nowrap">Tokens</th>
            <th className="pb-2 pl-4 text-right font-normal whitespace-nowrap">Avg latency</th>
            <th className="pb-2 pl-4 text-right font-normal whitespace-nowrap">Cost</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={`${m.source}-${m.model}`} className="border-t border-line">
              <td className="py-2 font-mono text-xs break-all">{m.model}</td>
              <td className="py-2 pl-4 text-muted">{m.source === "nim" ? "Router" : "Handoff"}</td>
              <td className="py-2 pl-4 text-right tabular-nums whitespace-nowrap">{fmtInt(m.requests)}</td>
              <td className="py-2 pl-4 text-right tabular-nums whitespace-nowrap">{m.tokens ? fmtInt(m.tokens) : "–"}</td>
              <td className="py-2 pl-4 text-right tabular-nums whitespace-nowrap">{fmtMs(m.avgLatencyMs)}</td>
              <td className="py-2 pl-4 text-right tabular-nums whitespace-nowrap">{m.costUsd ? fmtUsd(m.costUsd) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUS: Record<HandoffStatus, { label: string; icon: React.ElementType; tone: string }> = {
  pending: { label: "Awaiting approval", icon: Clock, tone: "text-warn" },
  approved: { label: "Approved", icon: Loader2, tone: "text-accent" },
  running: { label: "Running", icon: Loader2, tone: "text-accent" },
  completed: { label: "Done", icon: CircleCheck, tone: "text-ok" },
  rejected: { label: "Declined", icon: CircleDashed, tone: "text-muted" },
  failed: { label: "Failed", icon: CircleX, tone: "text-bad" },
};

export function HandoffHistory({ handoffs }: { handoffs: Stats["handoffs"]["recent"] }) {
  if (!handoffs.length) return <Empty>No handoffs yet. Friday will list Claude and Claude Code tasks here.</Empty>;
  return (
    <ul className="divide-y divide-line">
      {handoffs.map((h) => {
        const s = STATUS[h.status];
        const Icon = s.icon;
        return (
          <li key={h.id} className="flex items-start gap-3 py-2.5 text-sm">
            <Icon size={16} className={cn("mt-0.5 shrink-0", s.tone, (h.status === "running" || h.status === "approved") && "animate-spin")} />
            <div className="min-w-0 flex-1">
              <div className="truncate">{h.task}</div>
              <div className="text-xs text-muted">
                {h.target === "claude-code" ? "Claude Code" : "Claude"} · {s.label} · {fmtAgo(h.createdAt)}
                {h.costUsd != null && ` · ${fmtUsd(h.costUsd)}`}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const MCP_TONE = {
  online: { label: "Online", icon: CircleCheck, tone: "text-ok" },
  offline: { label: "Offline", icon: CircleX, tone: "text-bad" },
  "not-configured": { label: "Not set up yet", icon: CircleDashed, tone: "text-muted" },
} as const;

export function McpHealth({ servers }: { servers: Stats["mcp"] }) {
  return (
    <ul className="space-y-2">
      {servers.map((m) => {
        const t = MCP_TONE[m.status];
        const Icon = t.icon;
        return (
          <li key={m.name} className="flex items-center gap-3 rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm">
            <Icon size={16} className={t.tone} />
            <div className="min-w-0">
              <div className="font-mono text-xs">{m.name}</div>
              {m.detail && <div className="truncate text-[11px] text-muted">{m.detail}</div>}
            </div>
            <span className={cn("ml-auto shrink-0 text-xs", t.tone)}>{t.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function RecentConversations({ conversations }: { conversations: Conversation[] }) {
  if (!conversations.length) return <Empty>No conversations yet</Empty>;
  return (
    <ul className="divide-y divide-line">
      {conversations.slice(0, 8).map((c) => (
        <li key={c.id}>
          <Link href={`/?c=${c.id}`} className="flex items-center gap-3 py-2.5 text-sm hover:text-accent">
            <span className="min-w-0 flex-1 truncate">{c.title}</span>
            <span className="shrink-0 text-xs text-muted">
              {c.messages.length} msgs · {fmtAgo(c.updatedAt)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
