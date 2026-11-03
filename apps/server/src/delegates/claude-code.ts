import { spawn } from "node:child_process";
import type { Handoff } from "../handoffs.js";
import type { Delegate, DelegateResult } from "./types.js";

export interface ClaudeCodeOptions {
  /** Folder Claude Code works in (e.g. a repo checkout). Required. */
  cwd: string;
  /** Path to the claude CLI. */
  bin?: string;
  /** Claude Code permission mode for headless runs. */
  permissionMode?: string;
  timeoutMs?: number;
}

type Spawner = typeof spawn;

/** Runs an approved handoff with Claude Code in headless mode (`claude -p ... --output-format json`). */
export class ClaudeCodeDelegate implements Delegate {
  constructor(private readonly opts: ClaudeCodeOptions, private readonly spawner: Spawner = spawn) {}

  run(handoff: Handoff, signal?: AbortSignal): Promise<DelegateResult> {
    const args = ["-p", handoff.task, "--output-format", "json", "--permission-mode", this.opts.permissionMode ?? "acceptEdits"];
    return new Promise((resolve, reject) => {
      const child = this.spawner(this.opts.bin ?? "claude", args, {
        cwd: this.opts.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        signal,
        timeout: this.opts.timeoutMs ?? 30 * 60_000,
        // On Windows the claude CLI is a .cmd shim, which needs a shell to start.
        shell: process.platform === "win32",
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d) => (stdout += d));
      child.stderr?.on("data", (d) => (stderr += d));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) return reject(new Error(`claude exited with ${code}: ${stderr.trim().slice(-500)}`));
        try {
          const json = JSON.parse(stdout) as { result?: string; is_error?: boolean; total_cost_usd?: number };
          if (json.is_error) return reject(new Error(json.result || "Claude Code reported an error"));
          resolve({ output: (json.result ?? "").trim(), by: "claude-code", costUsd: json.total_cost_usd });
        } catch {
          resolve({ output: stdout.trim(), by: "claude-code" });
        }
      });
    });
  }
}
