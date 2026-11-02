import { test } from "node:test";
import assert from "node:assert/strict";
import { NimClient, JarvisRouter, loadNimConfig, NimError, parseDelegateArgs } from "../dist/index.js";

const config = { apiKey: "k", baseUrl: "https://nim.test/v1", model: "m", timeoutMs: 5000 };

function jsonFetch(payload, status = 200, seen = []) {
  return async (url, init) => {
    seen.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return new Response(JSON.stringify(payload), { status });
  };
}

test("loadNimConfig requires a key and applies defaults", () => {
  assert.throws(() => loadNimConfig({}), /NVIDIA_API_KEY/);
  const c = loadNimConfig({ NVIDIA_API_KEY: " abc ", NIM_BASE_URL: "https://x/v1/" });
  assert.equal(c.apiKey, "abc");
  assert.equal(c.baseUrl, "https://x/v1");
  assert.equal(c.model, "nvidia/nemotron-3-super-120b-a12b");
});

test("router returns NIM's direct answer and sends system prompt + tool", async () => {
  const seen = [];
  const nim = new NimClient(config, jsonFetch({ model: "m", choices: [{ message: { role: "assistant", content: " Good evening, sir. " }, finish_reason: "stop" }] }, 200, seen));
  const r = await new JarvisRouter(nim).route([{ role: "user", content: "hi" }]);
  assert.deepEqual(r.kind, "answer");
  assert.equal(r.content, "Good evening, sir.");
  assert.equal(seen[0].url, "https://nim.test/v1/chat/completions");
  assert.equal(seen[0].headers.Authorization, "Bearer k");
  assert.equal(seen[0].body.messages[0].role, "system");
  assert.equal(seen[0].body.tools[0].function.name, "delegate");
});

test("router turns a delegate tool call into a handoff needing approval", async () => {
  const args = JSON.stringify({ target: "claude-code", task: "Add a login page", reason: "Needs repo edits" });
  const nim = new NimClient(config, jsonFetch({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "delegate", arguments: args } }] }, finish_reason: "tool_calls" }] }));
  const r = await new JarvisRouter(nim).route([{ role: "user", content: "build login" }]);
  assert.equal(r.kind, "delegate");
  assert.equal(r.target, "claude-code");
  assert.equal(r.requiresApproval, true);
});

test("invalid delegate args fall back to an answer", async () => {
  assert.equal(parseDelegateArgs("{bad"), null);
  assert.equal(parseDelegateArgs(JSON.stringify({ target: "gpt", task: "x" })), null);
});

test("HTTP errors raise NimError with status", async () => {
  const nim = new NimClient(config, async () => new Response("nope", { status: 401 }));
  await assert.rejects(nim.chat([{ role: "user", content: "x" }]), (e) => e instanceof NimError && e.status === 401);
});

test("chatStream yields SSE content deltas", async () => {
  const sse = ['data: {"choices":[{"delta":{"content":"Hel"}}]}', 'data: {"choices":[{"delta":{"content":"lo"}}]}', "data: [DONE]", ""].join("\n\n");
  const nim = new NimClient(config, async () => new Response(new Blob([sse]).stream(), { status: 200 }));
  let out = "";
  for await (const d of nim.chatStream([{ role: "user", content: "x" }])) out += d;
  assert.equal(out, "Hello");
});
