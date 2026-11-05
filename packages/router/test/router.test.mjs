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
  assert.equal(c.model, "nvidia/nemotron-3.5-super-vl-120b-a12b");
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

test("retired model errors explain the fix", async () => {
  const nim = new NimClient(config, async () => new Response("gone", { status: 410 }));
  await assert.rejects(nim.chat([{ role: "user", content: "x" }]), /isn't available on NIM any more; set NIM_MODEL/);
});

test("the assistant persona is Friday", async () => {
  const { FRIDAY_SYSTEM_PROMPT, JARVIS_SYSTEM_PROMPT } = await import("../dist/index.js");
  assert.match(FRIDAY_SYSTEM_PROMPT, /^You are Friday/);
  assert.equal(JARVIS_SYSTEM_PROMPT, FRIDAY_SYSTEM_PROMPT);
});

function seqFetch(payloads, seen = []) {
  let i = 0;
  return async (url, init) => {
    seen.push(JSON.parse(init.body));
    return new Response(JSON.stringify(payloads[Math.min(i++, payloads.length - 1)]), { status: 200 });
  };
}
const toolCall = (name, args, id = "c1") => ({ model: "m", usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" }] });
const answer = (text) => ({ model: "m", usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 }, choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }] });
const readTool = { type: "function", function: { name: "filesystem__read_file", description: "read", parameters: { type: "object", properties: {} } } };

test("router runs toolbox tools in a loop and answers with the results", async () => {
  const seen = [];
  const calls = [];
  const toolbox = { tools: () => [readTool], call: async (name, args) => (calls.push([name, JSON.parse(args)]), "Buy milk") };
  const nim = new NimClient(config, seqFetch([toolCall("filesystem__read_file", { path: "todo.txt" }), answer("Your list says: buy milk, boss.")], seen));
  const r = await new JarvisRouter(nim, { toolbox }).route([{ role: "user", content: "What's on my todo list?" }]);
  assert.equal(r.kind, "answer");
  assert.equal(r.content, "Your list says: buy milk, boss.");
  assert.deepEqual(r.tools, [{ name: "filesystem__read_file", ok: true }]);
  assert.equal(r.usage.total_tokens, 40, "usage summed over rounds");
  assert.deepEqual(calls, [["filesystem__read_file", { path: "todo.txt" }]]);
  assert.deepEqual(seen[0].tools.map((t) => t.function.name), ["delegate", "filesystem__read_file"]);
  const second = seen[1].messages;
  assert.equal(second.at(-2).tool_calls[0].function.name, "filesystem__read_file");
  assert.deepEqual(second.at(-1), { role: "tool", tool_call_id: "c1", content: "Buy milk" });
});

test("router reports tool errors to NIM, stops after max rounds, and still delegates", async () => {
  const seen = [];
  const toolbox = { tools: () => [readTool], call: async () => { throw new Error("denied"); } };
  const nim = new NimClient(config, seqFetch([toolCall("filesystem__read_file", {}), toolCall("filesystem__read_file", {}), answer("Sorry boss, I couldn't read it.")], seen));
  const r = await new JarvisRouter(nim, { toolbox, maxToolRounds: 1 }).route([{ role: "user", content: "read it" }]);
  assert.equal(r.kind, "answer");
  assert.deepEqual(r.tools, [{ name: "filesystem__read_file", ok: false }]);
  assert.equal(seen[1].messages.at(-1).content, "Error: denied");
  assert.deepEqual(seen[1].tools.map((t) => t.function.name), ["delegate"], "last round only offers delegate");

  const nim2 = new NimClient(config, seqFetch([toolCall("delegate", { target: "claude-code", task: "Fix it", reason: "repo work" })]));
  const d = await new JarvisRouter(nim2, { toolbox }).route([{ role: "user", content: "fix my repo" }]);
  assert.equal(d.kind, "delegate");
  assert.equal(d.requiresApproval, true);
});

test("guest requests get no tools or delegate, and the system prompt names the user", async () => {
  const seen = [];
  const nim = { chat: async (messages, opts) => { seen.push({ messages, opts }); return { model: "m", message: { role: "assistant", content: "hi" } }; } };
  const toolbox = { tools: async () => [{ type: "function", function: { name: "fs__read", description: "", parameters: {} } }], call: async () => "" };
  const r = new JarvisRouter(nim, { toolbox });
  await r.route([{ role: "user", content: "yo" }], undefined, { user: { name: "Sam", role: "guest" }, tools: false, delegate: false });
  assert.equal(seen[0].opts.tools, undefined);
  assert.match(seen[0].messages[0].content, /talking with Sam \(guest\)/);
  await r.route([{ role: "user", content: "yo" }], undefined, { user: { name: "Ria", role: "member" } });
  assert.deepEqual(seen[1].opts.tools.map((t) => t.function.name), ["delegate", "fs__read"]);
});
