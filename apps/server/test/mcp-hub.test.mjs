import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpHub, mcpConfigsFromEnv } from "../dist/mcp/hub.js";
import { McpClaudeCodeDelegate } from "../dist/delegates/claude-code-mcp.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("mcpConfigsFromEnv turns servers on only when configured, read-only by default", () => {
  const none = mcpConfigsFromEnv({}, "/r", "node");
  assert.deepEqual(none.map((c) => [c.name, !!c.command]), [["filesystem", false], ["github", false], ["claude-code", false]]);
  assert.match(none[1].hint, /GITHUB_TOKEN/);
  const all = mcpConfigsFromEnv({ JARVIS_FS_ROOT: "/notes", GITHUB_TOKEN: "t", CLAUDE_CODE_CWD: "/code", JARVIS_MCP_DISABLE: "github" }, "/r", "node");
  const fs = all.find((c) => c.name === "filesystem");
  assert.equal(fs.env.JARVIS_FS_READONLY, "1");
  assert.equal(fs.args.at(-1), "/notes");
  assert.equal(all.find((c) => c.name === "github").command, undefined, "disabled");
  assert.equal(all.find((c) => c.name === "claude-code").exposeToNim, false);
  assert.equal(mcpConfigsFromEnv({ JARVIS_FS_ROOT: "/n", JARVIS_FS_READONLY: "0" }, "/r")[0].env.JARVIS_FS_READONLY, "0");
});

test("hub prefixes tools, hides approval-only servers from NIM, reports status, survives failures", async () => {
  const fake = (tools, results = {}) => ({
    listTools: async () => ({ tools: tools.map((name) => ({ name, description: name, inputSchema: { type: "object" } })) }),
    callTool: async ({ name, arguments: a }) => results[name]?.(a) ?? { content: [{ type: "text", text: `${name} ok` }] },
    close: async () => {},
  });
  const hub = new McpHub(
    [
      { name: "filesystem", hint: "", command: "x", exposeToNim: true, note: "read-only" },
      { name: "github", hint: "", command: "x", exposeToNim: true },
      { name: "claude-code", hint: "", command: "x", exposeToNim: false },
      { name: "off", hint: "Set OFF", exposeToNim: true },
    ],
    async (cfg) => {
      if (cfg.name === "github") throw new Error("bad token");
      if (cfg.name === "claude-code") return fake(["start_coding_task"]);
      return fake(["read_file"], { read_file: (a) => (a.path === "secret" ? { isError: true, content: [{ type: "text", text: "denied" }] } : undefined) });
    },
  );
  await hub.start();
  assert.deepEqual(hub.tools().map((t) => t.function.name), ["filesystem__read_file"]);
  assert.equal(await hub.call("filesystem__read_file", '{"path":"a"}'), "read_file ok");
  await assert.rejects(hub.call("filesystem__read_file", '{"path":"secret"}'), /denied/);
  await assert.rejects(hub.call("claude-code__start_coding_task", "{}"), /Unknown tool/);
  assert.equal(await hub.callOn("claude-code", "start_coding_task", {}), "start_coding_task ok");
  assert.deepEqual(hub.status(), [
    { name: "filesystem", status: "online", detail: "1 tool · read-only" },
    { name: "github", status: "offline", detail: "bad token" },
    { name: "claude-code", status: "online", detail: "1 tool" },
    { name: "off", status: "not-configured", detail: "Set OFF" },
  ]);
});

test("hub runs the real filesystem MCP server (read-only)", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "friday-fs-"));
  writeFileSync(path.join(root, "todo.txt"), "Buy milk\n");
  const hub = new McpHub(mcpConfigsFromEnv({ JARVIS_FS_ROOT: root }, repoRoot));
  await hub.start();
  try {
    const names = hub.tools().map((t) => t.function.name);
    assert.ok(names.includes("filesystem__read_file"));
    assert.ok(!names.includes("filesystem__write_file"), "read-only by default");
    assert.equal(await hub.call("filesystem__read_file", JSON.stringify({ path: "todo.txt" })), "Buy milk\n");
    assert.equal(hub.status()[0].status, "online");
  } finally {
    await hub.close();
  }
});

test("McpClaudeCodeDelegate starts a task, reports progress and returns the result", async () => {
  const views = [
    { id: "t1", status: "running", recentSteps: ["• Edit a.ts"] },
    { id: "t1", status: "running", recentSteps: ["• Edit a.ts", "• Bash: pnpm test"] },
    { id: "t1", status: "done", recentSteps: ["• Edit a.ts", "• Bash: pnpm test"], result: "All green", costUsd: 0.3 },
  ];
  const calls = [];
  const d = new McpClaudeCodeDelegate(async (tool, args) => (calls.push([tool, args]), JSON.stringify(views.shift())), 1);
  const progress = [];
  const r = await d.run({ task: "fix tests" }, undefined, (s) => progress.push(s.length));
  assert.deepEqual(r, { output: "All green", by: "claude-code", costUsd: 0.3 });
  assert.deepEqual(progress, [1, 2]);
  assert.deepEqual(calls[0], ["start_coding_task", { task: "fix tests" }]);
  assert.deepEqual(calls[1], ["get_coding_task", { id: "t1", wait_seconds: 1 }]);
  const failing = new McpClaudeCodeDelegate(async () => JSON.stringify({ id: "x", status: "failed", error: "tests still red" }));
  await assert.rejects(failing.run({ task: "x" }), /tests still red/);
});
