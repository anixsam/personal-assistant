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
}

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  /** Model that answered (assistant only). */
  model?: string;
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
