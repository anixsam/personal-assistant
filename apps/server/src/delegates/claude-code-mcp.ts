import type { Handoff } from "../handoffs.js";
import type { Delegate, DelegateResult } from "./types.js";

/** Calls a tool on the claude-code MCP server (McpHub.callOn bound to that server). */
export type ClaudeCodeTools = (tool: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<string>;

interface TaskView {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  recentSteps?: string[];
  result?: string;
  error?: string;
  costUsd?: number;
}

/**
 * Runs an approved handoff through the claude-code MCP server, so Friday can show live progress
 * (files edited, commands run) while Claude Code works.
 */
export class McpClaudeCodeDelegate implements Delegate {
  constructor(private readonly call: ClaudeCodeTools, private readonly pollSeconds = 15) {}

  async run(handoff: Handoff, signal?: AbortSignal, onProgress?: (steps: string[]) => void): Promise<DelegateResult> {
    let t = JSON.parse(await this.call("start_coding_task", { task: handoff.task }, signal)) as TaskView;
    let last = "";
    for (;;) {
      const steps = t.recentSteps ?? [];
      if (onProgress && steps.join("\n") !== last) {
        last = steps.join("\n");
        onProgress(steps);
      }
      if (t.status === "done") return { output: (t.result ?? "").trim(), by: "claude-code", costUsd: t.costUsd };
      if (t.status === "failed" || t.status === "cancelled") throw new Error(t.error || `Claude Code task ${t.status}`);
      if (signal?.aborted) {
        await this.call("cancel_coding_task", { id: t.id }).catch(() => undefined);
        throw new Error("Cancelled");
      }
      t = JSON.parse(await this.call("get_coding_task", { id: t.id, wait_seconds: this.pollSeconds }, signal)) as TaskView;
    }
  }
}
