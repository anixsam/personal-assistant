import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";

export type TaskStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface TaskStep {
  at: number;
  /** "text" is something Claude Code said; "tool" is a tool it used (Edit, Bash, ...). */
  kind: "text" | "tool";
  summary: string;
}

export interface CodingTask {
  id: string;
  task: string;
  /** Folder Claude Code works in, relative to the root ("." for the root itself). */
  folder: string;
  status: TaskStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  /** Latest steps, newest last (capped). */
  steps: TaskStep[];
  stepCount: number;
  result?: string;
  error?: string;
  costUsd?: number;
  turns?: number;
}

export interface RunnerOptions {
  /** Folder Claude Code may work in; tasks can target it or a subfolder. */
  root: string;
  /** claude CLI. */
  bin?: string;
  /** Claude Code permission mode for headless runs (default acceptEdits). */
  permissionMode?: string;
  /** Tasks run one at a time by default; the rest wait in a queue. */
  maxConcurrent?: number;
  timeoutMs?: number;
  /** How many finished tasks to keep. */
  keep?: number;
}

type Spawner = typeof spawn;
const MAX_STEPS = 25;

function clip(s: string, n = 200) {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

/** One-line description of a Claude Code tool call, e.g. "Edit src/app.ts" or "Bash: pnpm test". */
export function describeTool(name: string, input: Record<string, unknown> = {}): string {
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  const target = s("file_path") || s("path") || s("pattern") || s("url");
  if (name === "Bash") return clip(`Bash: ${s("command")}`, 160);
  return clip(target ? `${name} ${target}` : name, 160);
}

/**
 * Runs coding tasks with Claude Code in headless mode (`claude -p`, stream-json output) and keeps
 * their progress, so an MCP client can start a task and check on it later.
 */
export class ClaudeCodeRunner {
  private readonly tasks = new Map<string, CodingTask>();
  private readonly children = new Map<string, ChildProcess>();
  private readonly queue: string[] = [];
  private readonly root: string;

  constructor(private readonly opts: RunnerOptions, private readonly spawner: Spawner = spawn) {
    this.root = realpathSync(opts.root);
  }

  /** Resolves a folder inside the root, refusing anything outside it. */
  resolveFolder(folder = "."): string {
    const abs = path.resolve(this.root, folder);
    let real: string;
    try {
      real = realpathSync(abs);
    } catch {
      throw new Error(`Folder not found: ${folder}`);
    }
    const rel = path.relative(this.root, real);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`Folder is outside the allowed root: ${folder}`);
    return real;
  }

  start(task: string, folder = "."): CodingTask {
    if (!task.trim()) throw new Error("task is required");
    const cwd = this.resolveFolder(folder);
    const t: CodingTask = {
      id: randomUUID().slice(0, 8),
      task: task.trim(),
      folder: path.relative(this.root, cwd) || ".",
      status: "queued",
      createdAt: Date.now(),
      steps: [],
      stepCount: 0,
    };
    this.tasks.set(t.id, t);
    this.queue.push(t.id);
    this.pump();
    this.prune();
    return t;
  }

  get(id: string): CodingTask | undefined {
    return this.tasks.get(id);
  }

  list(): CodingTask[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  cancel(id: string): CodingTask {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`No task ${id}`);
    if (t.status === "queued") {
      this.queue.splice(this.queue.indexOf(id), 1);
      this.finish(t, "cancelled");
    } else if (t.status === "running") {
      t.status = "cancelled";
      this.children.get(id)?.kill();
    }
    return t;
  }

  /** Resolves when the task leaves queued/running, or after `ms`. */
  async wait(id: string, ms: number): Promise<CodingTask | undefined> {
    const end = Date.now() + ms;
    for (;;) {
      const t = this.tasks.get(id);
      if (!t || (t.status !== "queued" && t.status !== "running") || Date.now() >= end) return t;
      await new Promise((r) => setTimeout(r, Math.min(250, end - Date.now())));
    }
  }

  private running() {
    return [...this.tasks.values()].filter((t) => t.status === "running").length;
  }

  private pump() {
    while (this.queue.length && this.running() < (this.opts.maxConcurrent ?? 1)) {
      const t = this.tasks.get(this.queue.shift()!);
      if (t) this.run(t);
    }
  }

  private prune() {
    const done = this.list().filter((t) => t.status !== "queued" && t.status !== "running");
    for (const t of done.slice(this.opts.keep ?? 50)) this.tasks.delete(t.id);
  }

  private step(t: CodingTask, kind: TaskStep["kind"], summary: string) {
    if (!summary) return;
    t.stepCount++;
    t.steps.push({ at: Date.now(), kind, summary });
    if (t.steps.length > MAX_STEPS) t.steps.shift();
  }

  private finish(t: CodingTask, status: TaskStatus, extra: Partial<CodingTask> = {}) {
    Object.assign(t, extra);
    if (t.status !== "cancelled") t.status = status;
    t.finishedAt = Date.now();
    this.children.delete(t.id);
    this.pump();
  }

  private run(t: CodingTask) {
    t.status = "running";
    t.startedAt = Date.now();
    const args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", this.opts.permissionMode ?? "acceptEdits"];
    const child = this.spawner(this.opts.bin ?? "claude", args, {
      cwd: this.resolveFolder(t.folder),
      stdio: ["pipe", "pipe", "pipe"],
      // On Windows the claude CLI is a .cmd shim, which needs a shell to start. The task goes
      // through stdin, so it is never parsed by that shell.
      shell: process.platform === "win32",
      windowsHide: true,
    });
    this.children.set(t.id, child);
    // Our own timer (spawn's `timeout` option leaves a live timer behind when the binary is missing).
    const timer = setTimeout(() => {
      if (t.finishedAt) return;
      child.kill();
      this.finish(t, "failed", { error: `Timed out after ${Math.round((this.opts.timeoutMs ?? 30 * 60_000) / 60_000)} min` });
    }, this.opts.timeoutMs ?? 30 * 60_000);
    timer.unref();
    child.on("close", () => clearTimeout(timer));
    child.on("error", () => clearTimeout(timer));
    let buf = "";
    let stderr = "";
    let final: { result?: string; is_error?: boolean; total_cost_usd?: number; num_turns?: number } | null = null;

    const onLine = (line: string) => {
      if (!line.trim()) return;
      let ev: { type?: string; message?: { content?: unknown }; result?: string; is_error?: boolean; total_cost_usd?: number; num_turns?: number };
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
        for (const c of ev.message.content as { type: string; text?: string; name?: string; input?: Record<string, unknown> }[]) {
          if (c.type === "text" && c.text) this.step(t, "text", clip(c.text));
          if (c.type === "tool_use" && c.name) this.step(t, "tool", describeTool(c.name, c.input));
        }
      } else if (ev.type === "result") {
        final = ev;
      }
    };

    child.stdout?.on("data", (d: Buffer) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        onLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    child.stderr?.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
    child.on("error", (e) => this.finish(t, "failed", { error: `Could not start Claude Code (${e.message}). Is the claude CLI installed and signed in?` }));
    child.on("close", (code) => {
      if (buf) onLine(buf);
      if (t.finishedAt) return;
      const f = final as typeof final;
      const extra = { costUsd: f?.total_cost_usd, turns: f?.num_turns };
      if (f && !f.is_error) this.finish(t, "done", { ...extra, result: (f.result ?? "").trim() });
      else if (f?.is_error) this.finish(t, "failed", { ...extra, error: f.result || "Claude Code reported an error" });
      else this.finish(t, "failed", { error: `claude exited with ${code}: ${stderr.trim().slice(-500) || "no output"}` });
    });
    child.stdin?.end(t.task);
  }
}
