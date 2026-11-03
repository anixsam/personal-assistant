import type { Handoff, HandoffStore } from "./handoffs.js";

export interface RequestRecord {
  at: number;
  model: string;
  kind: "answer" | "handoff";
  latencyMs: number;
  tokens: number;
  ok: boolean;
}

export interface McpStatus {
  name: string;
  status: "online" | "offline" | "not-configured";
  detail?: string;
}

export interface Stats {
  startedAt: string;
  generatedAt: string;
  totals: { requests: number; answered: number; handedOff: number; errors: number; avgLatencyMs: number; tokens: number };
  hourly: { hour: string; nim: number; delegated: number }[];
  models: { model: string; source: "nim" | "delegated"; requests: number; tokens: number; avgLatencyMs: number | null; costUsd: number }[];
  handoffs: {
    byStatus: Record<Handoff["status"], number>;
    byTarget: Record<Handoff["target"], number>;
    costUsd: number;
    recent: Handoff[];
  };
  mcp: McpStatus[];
}

const HOUR = 3_600_000;
const MAX_RECORDS = 10_000;

/** In-memory usage log (SQLite persistence comes later). */
export class StatsStore {
  private readonly records: RequestRecord[] = [];
  readonly startedAt = Date.now();

  record(r: RequestRecord): void {
    this.records.push(r);
    if (this.records.length > MAX_RECORDS) this.records.splice(0, this.records.length - MAX_RECORDS);
  }

  snapshot(handoffs: HandoffStore, mcp: McpStatus[], now = Date.now(), hours = 24): Stats {
    const all = handoffs.list();
    const since = now - hours * HOUR;
    const recent = this.records.filter((r) => r.at >= since);
    const ok = recent.filter((r) => r.ok);

    // Hourly buckets, oldest first. "delegated" counts handoffs NIM proposed in that hour.
    const start = Math.floor(now / HOUR) * HOUR - (hours - 1) * HOUR;
    const hourly = Array.from({ length: hours }, (_, i) => ({ hour: new Date(start + i * HOUR).toISOString(), nim: 0, delegated: 0 }));
    for (const r of ok) {
      const i = Math.floor((r.at - start) / HOUR);
      if (i >= 0 && i < hours) hourly[i][r.kind === "answer" ? "nim" : "delegated"]++;
    }

    const byModel = new Map<string, { requests: number; tokens: number; latency: number }>();
    for (const r of ok) {
      const m = byModel.get(r.model) ?? { requests: 0, tokens: 0, latency: 0 };
      m.requests++;
      m.tokens += r.tokens;
      m.latency += r.latencyMs;
      byModel.set(r.model, m);
    }
    const models: Stats["models"] = [...byModel].map(([model, m]) => ({
      model,
      source: "nim",
      requests: m.requests,
      tokens: m.tokens,
      avgLatencyMs: Math.round(m.latency / m.requests),
      costUsd: 0,
    }));
    const delegatedBy = new Map<string, { requests: number; cost: number }>();
    for (const h of all) {
      if (h.status !== "completed" || !h.by) continue;
      const d = delegatedBy.get(h.by) ?? { requests: 0, cost: 0 };
      d.requests++;
      d.cost += h.costUsd ?? 0;
      delegatedBy.set(h.by, d);
    }
    for (const [model, d] of delegatedBy) {
      models.push({ model, source: "delegated", requests: d.requests, tokens: 0, avgLatencyMs: null, costUsd: d.cost });
    }
    models.sort((a, b) => b.requests - a.requests);

    const byStatus = { pending: 0, approved: 0, rejected: 0, running: 0, completed: 0, failed: 0 } as Stats["handoffs"]["byStatus"];
    const byTarget = { claude: 0, "claude-code": 0 } as Stats["handoffs"]["byTarget"];
    let cost = 0;
    for (const h of all) {
      byStatus[h.status]++;
      byTarget[h.target]++;
      cost += h.costUsd ?? 0;
    }

    return {
      startedAt: new Date(this.startedAt).toISOString(),
      generatedAt: new Date(now).toISOString(),
      totals: {
        requests: recent.length,
        answered: ok.filter((r) => r.kind === "answer").length,
        handedOff: ok.filter((r) => r.kind === "handoff").length,
        errors: recent.length - ok.length,
        avgLatencyMs: ok.length ? Math.round(ok.reduce((s, r) => s + r.latencyMs, 0) / ok.length) : 0,
        tokens: ok.reduce((s, r) => s + r.tokens, 0),
      },
      hourly,
      models,
      handoffs: {
        byStatus,
        byTarget,
        costUsd: Math.round(cost * 100) / 100,
        recent: [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20),
      },
      mcp,
    };
  }
}

/** MCP servers Friday will use. They're wired in later roadmap tasks, so for now they report not-configured. */
export const PLANNED_MCP_SERVERS = ["filesystem", "github", "claude-code"] as const;

export function defaultMcpStatus(): McpStatus[] {
  return PLANNED_MCP_SERVERS.map((name) => ({ name, status: "not-configured", detail: "Added in a later build step" }));
}
