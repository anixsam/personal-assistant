import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ClaudeCodeRunner, type CodingTask } from "./runner.js";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(value: unknown): Result {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}
function fail(e: unknown): Result {
  return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
}

/** What a client sees about a task: status, timing, recent steps, and the result once done. */
export function view(t: CodingTask, now = Date.now()) {
  const end = t.finishedAt ?? now;
  return {
    id: t.id,
    status: t.status,
    task: t.task,
    folder: t.folder,
    elapsedSeconds: t.startedAt ? Math.round((end - t.startedAt) / 1000) : 0,
    steps: t.stepCount,
    recentSteps: t.steps.slice(-8).map((s) => (s.kind === "tool" ? `• ${s.summary}` : s.summary)),
    ...(t.result !== undefined && { result: t.result }),
    ...(t.error && { error: t.error }),
    ...(t.costUsd !== undefined && { costUsd: t.costUsd }),
  };
}

/**
 * MCP server that hands coding tasks to Claude Code and reports progress.
 * The client (Friday) is responsible for getting the user's approval before calling start_coding_task.
 */
export function createClaudeCodeServer(runner: ClaudeCodeRunner): McpServer {
  const server = new McpServer({ name: "jarvis-claude-code", version: "0.1.0" });

  server.registerTool(
    "start_coding_task",
    {
      title: "Start coding task",
      description:
        "Hand a coding task to Claude Code, which edits files and runs commands in the project folder. Returns a task id at once; " +
        "use get_coding_task to follow progress. Only call this after the user has approved the task.",
      inputSchema: {
        task: z.string().min(1).describe("Self-contained description of the coding work"),
        folder: z.string().default(".").describe("Subfolder of the project root to work in"),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    ({ task, folder }) => {
      try {
        return ok(view(runner.start(task, folder)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_coding_task",
    {
      title: "Get coding task",
      description: "Status, recent steps and (when finished) the result of a coding task. Set wait_seconds to wait for it to finish.",
      inputSchema: {
        id: z.string().describe("Task id from start_coding_task"),
        wait_seconds: z.number().int().min(0).max(120).default(0).describe("Wait up to this long for the task to finish"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id, wait_seconds }) => {
      const t = wait_seconds ? await runner.wait(id, wait_seconds * 1000) : runner.get(id);
      return t ? ok(view(t)) : fail(`No task ${id}`);
    },
  );

  server.registerTool(
    "list_coding_tasks",
    {
      title: "List coding tasks",
      description: "Recent coding tasks, newest first, with their status.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => ok(runner.list().map((t) => ({ id: t.id, status: t.status, task: t.task.slice(0, 120), folder: t.folder }))),
  );

  server.registerTool(
    "cancel_coding_task",
    {
      title: "Cancel coding task",
      description: "Stop a queued or running coding task.",
      inputSchema: { id: z.string() },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    ({ id }) => {
      try {
        return ok(view(runner.cancel(id)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}

export { ClaudeCodeRunner } from "./runner.js";
export type { CodingTask, TaskStatus, TaskStep, RunnerOptions } from "./runner.js";
