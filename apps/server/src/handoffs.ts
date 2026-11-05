import { randomUUID } from "node:crypto";
import type { DelegateTarget } from "@jarvis/router";
import type { FridayDb } from "./db.js";

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
  /** Who asked (by name), and who approved or rejected it. */
  requestedBy?: string;
  decidedBy?: string;
}

export const HANDOFF_STATUSES: readonly HandoffStatus[] = ["pending", "approved", "rejected", "running", "completed", "failed"];

/**
 * Handoffs NIM has proposed. Nothing is sent to Claude or Claude Code until a handoff is approved.
 * Saved in the database when one is given; handoffs that were running when Friday stopped are marked failed.
 */
export class HandoffStore {
  private readonly items = new Map<string, Handoff>();

  constructor(private readonly db?: FridayDb) {
    for (const h of db?.loadHandoffs() ?? []) {
      if (h.status === "running" || h.status === "approved") {
        Object.assign(h, { status: "failed", error: "Friday restarted before this finished", finishedAt: new Date().toISOString() });
        db!.saveHandoff(h);
      }
      this.items.set(h.id, h);
    }
  }

  private persist(h: Handoff) {
    this.db?.saveHandoff(h);
  }

  create(input: Pick<Handoff, "target" | "task" | "reason" | "requestedBy">): Handoff {
    const h: Handoff = { id: randomUUID(), ...input, status: "pending", createdAt: new Date().toISOString() };
    this.items.set(h.id, h);
    this.persist(h);
    return h;
  }

  get(id: string): Handoff | undefined {
    return this.items.get(id);
  }

  list(status?: HandoffStatus): Handoff[] {
    return [...this.items.values()].filter((h) => !status || h.status === status);
  }

  /** Returns the updated handoff, undefined if missing, or null if it was already decided. */
  decide(id: string, status: "approved" | "rejected", by?: string): Handoff | undefined | null {
    const h = this.items.get(id);
    if (!h) return undefined;
    if (h.status !== "pending") return null;
    h.status = status;
    h.decidedAt = new Date().toISOString();
    if (by) h.decidedBy = by;
    this.persist(h);
    return h;
  }

  update(id: string, patch: Partial<Omit<Handoff, "id">>): Handoff | undefined {
    const h = this.items.get(id);
    if (h) {
      Object.assign(h, patch);
      this.persist(h);
    }
    return h;
  }
}
