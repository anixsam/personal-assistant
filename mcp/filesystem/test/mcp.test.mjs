import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

async function connect(root, env = {}) {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry, root], env: { ...process.env, ...env }, stderr: "ignore" }));
  return client;
}

test("speaks MCP over stdio: lists tools and runs them", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "jarvis-mcp-"));
  writeFileSync(path.join(root, "hello.txt"), "Hello, sir.\n");
  const client = await connect(root);
  try {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["create_directory", "edit_file", "file_info", "list_directory", "read_file", "search_files", "write_file"]);
    const read = await client.callTool({ name: "read_file", arguments: { path: "hello.txt" } });
    assert.equal(read.content[0].text, "Hello, sir.\n");
    const bad = await client.callTool({ name: "read_file", arguments: { path: "../../etc/passwd" } });
    assert.equal(bad.isError, true);
    const w = await client.callTool({ name: "write_file", arguments: { path: "a/b.txt", content: "hi" } });
    assert.equal(JSON.parse(w.content[0].text).created, true);
  } finally {
    await client.close();
  }
});

test("read-only mode hides write tools", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "jarvis-mcp-"));
  const client = await connect(root, { JARVIS_FS_READONLY: "1" });
  try {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["file_info", "list_directory", "read_file", "search_files"]);
  } finally {
    await client.close();
  }
});
