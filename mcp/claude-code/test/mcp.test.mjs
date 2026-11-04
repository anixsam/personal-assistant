import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "..", "dist", "index.js");

test("speaks MCP over stdio: start a task and wait for its result", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "cc-mcp-"));
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry, root], env: { ...process.env, CLAUDE_CODE_BIN: path.join(here, "fake-claude.mjs") }, stderr: "ignore" }));
  try {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["cancel_coding_task", "get_coding_task", "list_coding_tasks", "start_coding_task"]);
    const started = JSON.parse((await client.callTool({ name: "start_coding_task", arguments: { task: "add a README" } })).content[0].text);
    const got = JSON.parse((await client.callTool({ name: "get_coding_task", arguments: { id: started.id, wait_seconds: 5 } })).content[0].text);
    assert.equal(got.status, "done");
    assert.ok(got.recentSteps.includes("• Edit src/app.ts"));
    const list = JSON.parse((await client.callTool({ name: "list_coding_tasks", arguments: {} })).content[0].text);
    assert.equal(list[0].id, started.id);
    assert.equal((await client.callTool({ name: "get_coding_task", arguments: { id: "nope" } })).isError, true);
  } finally {
    await client.close();
  }
});

test("exits with a hint when no project folder is given", async () => {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(process.execPath, [entry], { env: { ...process.env, CLAUDE_CODE_CWD: "" }, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /CLAUDE_CODE_CWD/);
});
