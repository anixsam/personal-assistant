export type HandoffTarget = "claude" | "claude-code";
export type HandoffStatus = "pending" | "approved" | "rejected" | "running" | "completed" | "failed";

/** Mirrors the server's Handoff record. */
export interface Handoff {
  id: string;
  target: HandoffTarget;
  task: string;
  reason: string;
  status: HandoffStatus;
  createdAt: string;
  decidedAt?: string;
  finishedAt?: string;
  result?: string;
  by?: string;
  costUsd?: number;
  error?: string;
  /** Latest steps while Claude Code works. */
  progress?: string[];
  requestedBy?: string;
  decidedBy?: string;
}

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  /** Model that answered (assistant only). */
  model?: string;
  /** Tools Friday used to answer, e.g. "filesystem__read_file". */
  tools?: { name: string; ok: boolean }[];
  /** Present when NIM proposed handing this request off. */
  handoff?: Handoff;
  error?: string;
  streaming?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  messages: UiMessage[];
  updatedAt: string;
}

/** Mirrors GET /api/stats on the server. */
export interface Stats {
  startedAt: string;
  generatedAt: string;
  totals: { requests: number; answered: number; handedOff: number; errors: number; avgLatencyMs: number; tokens: number };
  hourly: { hour: string; nim: number; delegated: number }[];
  models: { model: string; source: "nim" | "delegated"; requests: number; tokens: number; avgLatencyMs: number | null; costUsd: number }[];
  handoffs: {
    byStatus: Record<HandoffStatus, number>;
    byTarget: Record<HandoffTarget, number>;
    costUsd: number;
    recent: Handoff[];
  };
  mcp: { name: string; status: "online" | "offline" | "not-configured"; detail?: string }[];
}
