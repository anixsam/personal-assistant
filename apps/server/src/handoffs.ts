import { randomUUID } from "node:crypto";
import type { DelegateTarget } from "@jarvis/router";

export type HandoffStatus = "pending" | "approved" | "rejected";

export interface Handoff {
  id: string;
  target: DelegateTarget;
  task: string;
  reason: string;
  status: HandoffStatus;
  createdAt: string;
  decidedAt?: string;
}

/**
 * Handoffs NIM has proposed. Nothing is sent to Claude or Claude Code until a handoff is
 * approved; running approved handoffs is added in the delegation step of the roadmap.
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
}
