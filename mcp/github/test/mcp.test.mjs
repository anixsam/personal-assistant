import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
let mock, apiUrl;

before(async () => {
  mock = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.headers.authorization !== "Bearer test-token") return res.writeHead(401).end(JSON.stringify({ message: "Bad credentials" }));
    if (req.url === "/user") return res.end(JSON.stringify({ login: "anixsam", name: "Anix" }));
    if (req.url.startsWith("/repos/anixsam/personal-assistant/pulls?")) return res.end(JSON.stringify([{ number: 1, title: "Add dashboard", state: "open", user: { login: "anixsam" }, head: { ref: "dash" }, base: { ref: "main" } }]));
    res.writeHead(404).end(JSON.stringify({ message: "Not Found" }));
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  apiUrl = `http://127.0.0.1:${mock.address().port}`;
});
after(() => mock.close());

async function connect(env) {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry], env: { ...process.env, GITHUB_TOKEN: "test-token", GITHUB_API_URL: apiUrl, ...env }, stderr: "ignore" }));
  return client;
}

test("speaks MCP over stdio against a mock GitHub", async () => {
  const client = await connect({});
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(names.includes("create_issue") && names.includes("get_pull_request"));
    assert.ok(!names.some((n) => /merge|delete|close|push/.test(n)), "no destructive tools");
    const me = await client.callTool({ name: "whoami", arguments: {} });
    assert.equal(JSON.parse(me.content[0].text).login, "anixsam");
    const prs = await client.callTool({ name: "list_pull_requests", arguments: { repo: "anixsam/personal-assistant" } });
    assert.equal(JSON.parse(prs.content[0].text)[0].title, "Add dashboard");
    const blocked = await client.callTool({ name: "get_repo", arguments: { repo: "../../etc" } });
    assert.equal(blocked.isError, true);
  } finally {
    await client.close();
  }
});

test("read-only mode and allowlist", async () => {
  const client = await connect({ JARVIS_GITHUB_READONLY: "1", JARVIS_GITHUB_REPOS: "anixsam/personal-assistant" });
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(!names.includes("create_issue") && !names.includes("comment_on_issue"));
    const r = await client.callTool({ name: "list_issues", arguments: { repo: "someone/else" } });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /JARVIS_GITHUB_REPOS/);
  } finally {
    await client.close();
  }
});
