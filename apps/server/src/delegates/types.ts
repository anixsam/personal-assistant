import type { Handoff } from "../handoffs.js";

export interface DelegateResult {
  output: string;
  /** Model or agent that produced the output. */
  by: string;
  costUsd?: number;
}

/** Runs one approved handoff. Implementations: Claude (Anthropic API) and Claude Code (headless CLI). */
export interface Delegate {
  /** `onProgress` receives the latest steps (newest last) for delegates that can report them. */
  run(handoff: Handoff, signal?: AbortSignal, onProgress?: (steps: string[]) => void): Promise<DelegateResult>;
}

export type Delegates = Partial<Record<Handoff["target"], Delegate>>;
