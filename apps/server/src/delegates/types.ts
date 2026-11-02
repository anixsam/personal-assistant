import type { Handoff } from "../handoffs.js";

export interface DelegateResult {
  output: string;
  /** Model or agent that produced the output. */
  by: string;
  costUsd?: number;
}

/** Runs one approved handoff. Implementations: Claude (Anthropic API) and Claude Code (headless CLI). */
export interface Delegate {
  run(handoff: Handoff, signal?: AbortSignal): Promise<DelegateResult>;
}

export type Delegates = Partial<Record<Handoff["target"], Delegate>>;
