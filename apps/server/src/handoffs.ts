import { randomUUID } from "node:crypto";
import type { DelegateTarget } from "@jarvis/router";

export type HandoffStatus = "pending" | "approved" | "rejected" | "running" | "completed" | "failed";

export interface Handoff {
  id: string;
  target: DelegateTarget;
  task: string;
  reason: string;
  status: HandoffStatus;
  createdAt: string;
  decidedAt?: string;
  finishedAt?: string;
  /** Output from Claude / Claude Code once completed. */
  result?: string;
  /** Model or agent that produced the result. */
  by?: string;
  costUsd?: number;
  error?: string;
  /** Latest steps while running (Claude Code via MCP): files edited, commands run. */
  progress?: string[];
}

export const HANDOFF_STATUSES: readonly HandoffStatus[] = ["pending", "approved", "rejected", "running", "completed", "failed"];

/**
 * Handoffs NIM has proposed. Nothing is sent to Claude or Claude Code until a handoff is approved.
 * In-memory for now; SQLite persistence comes later.
 */
export class HandoffStore {
  private readonly items = new Map<string, Handoff>();

  create(input: Pick<Handoff, "target" | "task" | "reason">): Handoff {
    const h: Handoff = { id: randomUUID(), ...input, status: "pending", createdAt: new Date().toISOString() };
    this.items.set(h.id, h);
    return h;
  }

  get(id: string): Handoff | undefined {
    return this.items.get(id);
  }

  list(status?: HandoffStatus): Handoff[] {
    return [...this.items.values()].filter((h) => !status || h.status === status);
  }

  /** Returns the updated handoff, undefined if missing, or null if it was already decided. */
  decide(id: string, status: "approved" | "rejected"): Handoff | undefined | null {
    const h = this.items.get(id);
    if (!h) return undefined;
    if (h.status !== "pending") return null;
    h.status = status;
    h.decidedAt = new Date().toISOString();
    return h;
  }

  update(id: string, patch: Partial<Omit<Handoff, "id">>): Handoff | undefined {
    const h = this.items.get(id);
    if (h) Object.assign(h, patch);
    return h;
  }
}
