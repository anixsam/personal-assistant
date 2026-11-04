import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import type { NimTool, Toolbox } from "@jarvis/router";
import type { McpStatus } from "../stats.js";

/** One MCP server Friday can start. `command` is unset when it isn't configured. */
export interface McpServerConfig {
  name: string;
  /** Why it's off and how to turn it on, shown on the dashboard when not configured. */
  hint: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** Tools from this server are offered to NIM directly. False for servers that need approval first (Claude Code). */
  exposeToNim: boolean;
  /** Short note for the dashboard when online, e.g. "read-only". */
  note?: string;
}

/** The subset of the MCP client the hub uses (tests pass a fake). */
export interface McpClientLike {
  listTools(): Promise<{ tools: { name: string; description?: string; inputSchema: Record<string, unknown> }[] }>;
  callTool(req: { name: string; arguments?: Record<string, unknown> }, _?: unknown, opts?: { signal?: AbortSignal }): Promise<unknown>;
  close(): Promise<void>;
}

export type Connector = (cfg: McpServerConfig) => Promise<McpClientLike>;

interface Live {
  cfg: McpServerConfig;
  client?: McpClientLike;
  tools: NimTool[];
  error?: string;
}

const SEP = "__";

/** Starts an MCP server over stdio and connects to it. */
export const stdioConnector: Connector = async (cfg) => {
  const client = new Client({ name: "friday", version: "0.1.0" });
  await client.connect(
    new StdioClientTransport({ command: cfg.command!, args: cfg.args ?? [], env: { ...(process.env as Record<string, string>), ...cfg.env }, stderr: "ignore" }),
  );
  return client as unknown as McpClientLike;
};

function textOf(result: unknown): string {
  const r = result as { content?: { type: string; text?: string }[]; isError?: boolean };
  const text = (r.content ?? []).map((c) => (c.type === "text" ? c.text ?? "" : `[${c.type}]`)).join("\n");
  if (r.isError) throw new Error(text || "tool failed");
  return text;
}

/**
 * Starts the MCP servers that are configured, offers their tools to NIM as `<server>__<tool>`,
 * and reports each server's state for the dashboard. Unconfigured servers are simply skipped.
 */
export class McpHub implements Toolbox {
  private readonly live = new Map<string, Live>();

  constructor(private readonly configs: McpServerConfig[], private readonly connect: Connector = stdioConnector) {}

  /** Connects to every configured server. Failures are kept as "offline" and never throw. */
  async start(): Promise<void> {
    await Promise.all(
      this.configs.map(async (cfg) => {
        if (!cfg.command) return;
        const entry: Live = { cfg, tools: [] };
        this.live.set(cfg.name, entry);
        try {
          entry.client = await this.connect(cfg);
          const { tools } = await entry.client.listTools();
          entry.tools = tools.map((t) => ({
            type: "function",
            function: {
              name: `${cfg.name.replace(/[^a-zA-Z0-9_-]/g, "_")}${SEP}${t.name}`.slice(0, 64),
              description: `[${cfg.name}] ${t.description ?? t.name}`.slice(0, 1000),
              parameters: t.inputSchema ?? { type: "object", properties: {} },
            },
          }));
        } catch (e) {
          entry.error = e instanceof Error ? e.message : String(e);
          entry.client = undefined;
        }
      }),
    );
  }

  tools(): NimTool[] {
    return [...this.live.values()].filter((l) => l.client && l.cfg.exposeToNim).flatMap((l) => l.tools);
  }

  async call(name: string, argsJson: string, signal?: AbortSignal): Promise<string> {
    const entry = [...this.live.values()].find((l) => l.cfg.exposeToNim && l.tools.some((t) => t.function.name === name));
    if (!entry?.client) throw new Error(`Unknown tool ${name}`);
    const tool = name.slice(name.indexOf(SEP) + SEP.length);
    let args: Record<string, unknown>;
    try {
      args = argsJson.trim() ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
    } catch {
      throw new Error("Tool arguments were not valid JSON");
    }
    return textOf(await entry.client.callTool({ name: tool, arguments: args }, undefined, { signal }));
  }

  /** Calls a tool on a named server directly (used by the Claude Code handoff, which is approved first). */
  async callOn(server: string, tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const entry = this.live.get(server);
    if (!entry?.client) throw new Error(`${server} MCP server is not running`);
    return textOf(await entry.client.callTool({ name: tool, arguments: args }, undefined, { signal }));
  }

  isOnline(server: string): boolean {
    return !!this.live.get(server)?.client;
  }

  status(): McpStatus[] {
    return this.configs.map((cfg) => {
      const l = this.live.get(cfg.name);
      if (!cfg.command) return { name: cfg.name, status: "not-configured", detail: cfg.hint };
      if (!l?.client) return { name: cfg.name, status: "offline", detail: l?.error ?? "Starting…" };
      const n = l.tools.length;
      return { name: cfg.name, status: "online", detail: [`${n} tool${n === 1 ? "" : "s"}`, cfg.note].filter(Boolean).join(" · ") };
    });
  }

  async close(): Promise<void> {
    await Promise.all([...this.live.values()].map((l) => l.client?.close().catch(() => undefined)));
  }
}

/**
 * Which MCP servers to start, from environment variables. Each one is optional:
 * - filesystem: JARVIS_FS_ROOT (read-only unless JARVIS_FS_READONLY=0)
 * - github: GITHUB_TOKEN (read-only unless JARVIS_GITHUB_READONLY=0; JARVIS_GITHUB_REPOS limits repos)
 * - claude-code: CLAUDE_CODE_CWD (used only for approved handoffs, never offered to NIM directly)
 * Set JARVIS_MCP_DISABLE=github,filesystem to keep a configured server off.
 */
export function mcpConfigsFromEnv(env: NodeJS.ProcessEnv, repoRoot: string, node = process.execPath): McpServerConfig[] {
  const off = new Set((env.JARVIS_MCP_DISABLE ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const entry = (name: string) => path.join(repoRoot, "mcp", name, "dist", "index.js");
  const on = (name: string, cond: unknown) => !!cond && !off.has(name);
  const fsReadOnly = env.JARVIS_FS_READONLY !== "0";
  const ghReadOnly = env.JARVIS_GITHUB_READONLY !== "0";
  return [
    {
      name: "filesystem",
      hint: off.has("filesystem") ? "Turned off with JARVIS_MCP_DISABLE" : "Set JARVIS_FS_ROOT to a folder to turn on",
      exposeToNim: true,
      note: fsReadOnly ? "read-only" : "read and write",
      ...(on("filesystem", env.JARVIS_FS_ROOT) && {
        command: node,
        args: [entry("filesystem"), env.JARVIS_FS_ROOT!],
        env: { JARVIS_FS_READONLY: fsReadOnly ? "1" : "0" },
      }),
    },
    {
      name: "github",
      hint: off.has("github") ? "Turned off with JARVIS_MCP_DISABLE" : "Set GITHUB_TOKEN to turn on",
      exposeToNim: true,
      note: ghReadOnly ? "read-only" : "read and write",
      ...(on("github", env.GITHUB_TOKEN) && {
        command: node,
        args: [entry("github")],
        env: { JARVIS_GITHUB_READONLY: ghReadOnly ? "1" : "0" },
      }),
    },
    {
      name: "claude-code",
      hint: off.has("claude-code") ? "Turned off with JARVIS_MCP_DISABLE" : "Set CLAUDE_CODE_CWD to your project folder to turn on",
      exposeToNim: false,
      note: "runs only after you approve a handoff",
      ...(on("claude-code", env.CLAUDE_CODE_CWD) && { command: node, args: [entry("claude-code"), env.CLAUDE_CODE_CWD!] }),
    },
  ];
}
