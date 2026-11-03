"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { HourlyChart } from "@/components/dashboard/hourly-chart";
import { HandoffHistory, McpHealth, ModelTable, Panel, RecentConversations, StatTile } from "@/components/dashboard/panels";
import { JarvisMark } from "@/components/chat/message";
import { getStats } from "@/lib/api";
import { load, sortByRecent } from "@/lib/conversations";
import { fmtAgo, fmtInt, fmtMs, fmtUsd } from "@/lib/format";
import type { Conversation, Stats } from "@/lib/types";

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);

  async function refresh() {
    try {
      setStats(await getStats(24));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the Jarvis server");
    }
  }

  useEffect(() => {
    setConversations(sortByRecent(load(window.localStorage)));
    void refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, []);

  const t = stats?.totals;
  const nimShare = t && t.answered + t.handedOff ? Math.round((t.answered / (t.answered + t.handedOff)) * 100) : null;
  const pending = stats?.handoffs.byStatus.pending ?? 0;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-line bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
            <ArrowLeft size={16} /> Chat
          </Link>
          <div className="mx-auto flex items-center gap-2">
            <JarvisMark size={22} />
            <span className="text-sm font-semibold tracking-[0.2em]">DASHBOARD</span>
          </div>
          <button onClick={refresh} className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-fg" aria-label="Refresh">
            <RefreshCw size={14} />
            <span className="hidden sm:inline">{stats ? `Updated ${fmtAgo(stats.generatedAt)}` : "Refresh"}</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        {error && <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Requests (24 h)" value={t ? fmtInt(t.requests) : "–"} hint={t?.errors ? `${t.errors} failed` : "No errors"} />
          <StatTile label="Answered by NIM" value={nimShare == null ? "–" : `${nimShare}%`} hint={t ? `${fmtInt(t.handedOff)} handed off` : undefined} />
          <StatTile label="Avg response time" value={t ? fmtMs(t.avgLatencyMs || null) : "–"} hint={t ? `${fmtInt(t.tokens)} NIM tokens` : undefined} />
          <StatTile
            label="Handoff spend"
            value={stats ? fmtUsd(stats.handoffs.costUsd) : "–"}
            hint={pending ? `${pending} awaiting approval` : "Nothing awaiting approval"}
          />
        </div>

        {stats && <HourlyChart data={stats.hourly} />}

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Usage by model" className="lg:col-span-2">
            <ModelTable models={stats?.models ?? []} />
          </Panel>
          <Panel title="MCP servers">
            <McpHealth servers={stats?.mcp ?? []} />
          </Panel>
          <Panel title="Coding agent and Claude tasks" className="lg:col-span-2">
            <HandoffHistory handoffs={stats?.handoffs.recent ?? []} />
          </Panel>
          <Panel title="Recent conversations">
            <RecentConversations conversations={conversations} />
          </Panel>
        </div>

        {stats && <p className="text-center text-xs text-muted">Server up since {new Date(stats.startedAt).toLocaleString()} · numbers reset on restart until saved history is added</p>}
      </main>
    </div>
  );
}
