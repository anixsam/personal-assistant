import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, parseMessages, chunk } from "../dist/app.js";

const answerRouter = { route: async () => ({ kind: "answer", content: "At your service, sir.", model: "nemo" }) };
const handoffRouter = {
  route: async () => ({ kind: "delegate", target: "claude-code", task: "Fix the login bug", reason: "Needs repo edits", requiresApproval: true, model: "nemo" }),
};
const post = (app, path, body) => app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const user = { messages: [{ role: "user", content: "Hello" }] };

test("health", async () => {
  const res = await createApp({ router: answerRouter }).request("/api/health");
  assert.deepEqual(await res.json(), { ok: true });
});

test("validates messages", () => {
  assert.match(parseMessages({}), /non-empty array/);
  assert.match(parseMessages({ messages: [{ role: "system", content: "x" }] }), /role/);
  assert.match(parseMessages({ messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] }), /last message/);
  assert.equal(parseMessages(user).length, 1);
});

test("POST /api/chat returns NIM's answer", async () => {
  const res = await post(createApp({ router: answerRouter }), "/api/chat", user);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { kind: "answer", content: "At your service, sir.", model: "nemo" });
});

test("POST /api/chat rejects bad input with 400", async () => {
  const res = await post(createApp({ router: answerRouter }), "/api/chat", { messages: [] });
  assert.equal(res.status, 400);
});

test("router failure becomes 502", async () => {
  const res = await post(createApp({ router: { route: async () => { throw new Error("NIM down"); } } }), "/api/chat", user);
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, "NIM down");
});

const tick = () => new Promise((r) => setTimeout(r, 10));

test("handoff is created pending, approval runs the delegate once", async () => {
  const calls = [];
  const delegates = { "claude-code": { run: async (h) => { calls.push(h.task); return { output: "Fixed it.", by: "claude-code", costUsd: 0.12 }; } } };
  const app = createApp({ router: handoffRouter, delegates });
  const body = await (await post(app, "/api/chat", user)).json();
  assert.equal(body.kind, "handoff");
  assert.equal(body.handoff.status, "pending");
  assert.equal(calls.length, 0, "nothing runs before approval");
  const pending = await (await app.request("/api/handoffs?status=pending")).json();
  assert.equal(pending.handoffs.length, 1);
  const ok = await post(app, `/api/handoffs/${body.handoff.id}/approve`, {});
  assert.equal(ok.status, 202);
  assert.equal((await ok.json()).handoff.status, "running");
  await tick();
  const done = (await (await app.request(`/api/handoffs/${body.handoff.id}`)).json()).handoff;
  assert.equal(done.status, "completed");
  assert.equal(done.result, "Fixed it.");
  assert.deepEqual(calls, ["Fix the login bug"]);
  assert.equal((await post(app, `/api/handoffs/${body.handoff.id}/approve`, {})).status, 409);
  assert.equal((await post(app, `/api/handoffs/${body.handoff.id}/reject`, {})).status, 409);
  assert.equal((await post(app, "/api/handoffs/nope/approve", {})).status, 404);
});

test("delegate failure marks the handoff failed", async () => {
  const delegates = { "claude-code": { run: async () => { throw new Error("tests failed"); } } };
  const app = createApp({ router: handoffRouter, delegates });
  const { handoff } = await (await post(app, "/api/chat", user)).json();
  await post(app, `/api/handoffs/${handoff.id}/approve`, {});
  await tick();
  const h = (await (await app.request(`/api/handoffs/${handoff.id}`)).json()).handoff;
  assert.equal(h.status, "failed");
  assert.equal(h.error, "tests failed");
});

test("approving without a configured delegate is 503 and stays pending", async () => {
  const app = createApp({ router: handoffRouter });
  const { handoff } = await (await post(app, "/api/chat", user)).json();
  assert.equal((await post(app, `/api/handoffs/${handoff.id}/approve`, {})).status, 503);
  assert.equal((await (await app.request(`/api/handoffs/${handoff.id}`)).json()).handoff.status, "pending");
});

test("rejecting never runs the delegate", async () => {
  let ran = false;
  const app = createApp({ router: handoffRouter, delegates: { "claude-code": { run: async () => { ran = true; return { output: "", by: "x" }; } } } });
  const { handoff } = await (await post(app, "/api/chat", user)).json();
  assert.equal((await (await post(app, `/api/handoffs/${handoff.id}/reject`, {})).json()).handoff.status, "rejected");
  await tick();
  assert.equal(ran, false);
});

test("SSE stream sends route, deltas and done", async () => {
  const res = await post(createApp({ router: answerRouter }), "/api/chat/stream", user);
  assert.match(res.headers.get("content-type"), /text\/event-stream/);
  const text = await res.text();
  assert.match(text, /event: route/);
  const deltas = [...text.matchAll(/event: delta\ndata: (.*)/g)].map((m) => JSON.parse(m[1]).text).join("");
  assert.equal(deltas, "At your service, sir.");
  assert.match(text, /event: done/);
});

test("SSE stream sends handoff event", async () => {
  const text = await (await post(createApp({ router: handoffRouter }), "/api/chat/stream", user)).text();
  assert.match(text, /event: handoff/);
  assert.doesNotMatch(text, /event: delta/);
});

test("chunk keeps all text", () => {
  const s = "The quick brown fox jumps over the lazy dog, sir. ".repeat(3);
  assert.equal(chunk(s).join(""), s);
});

test("voice: status, 503 when not set up, WAV when set up, cached", async () => {
  assert.equal((await (await createApp({ router: answerRouter }).request("/api/voice")).json()).enabled, false);
  assert.equal((await post(createApp({ router: answerRouter }), "/api/speak", { text: "hi" })).status, 503);
  let calls = 0;
  const said = [];
  const voice = { voiceName: "en_GB-alan-medium", available: () => true, synthesize: async (t) => { calls++; said.push(t); return Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(40)]); } };
  const app = createApp({ router: answerRouter, voice });
  assert.deepEqual(await (await app.request("/api/voice")).json(), { enabled: true, voice: "en_GB-alan-medium", setup: null });
  const res = await post(app, "/api/speak", { text: "**Good evening**, sir." });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "audio/wav");
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString(), "RIFF");
  assert.deepEqual(said, ["Good evening, sir."]);
  await post(app, "/api/speak", { text: "**Good evening**, sir." });
  assert.equal(calls, 1, "second request served from cache");
  assert.equal((await post(app, "/api/speak", {})).status, 400);
});

test("voices: list, preview with another voice, select", async () => {
  let current = "a";
  const used = [];
  const voice = {
    available: () => true,
    options: () => [{ id: "a", label: "A", description: "", gender: "male" }, { id: "b", label: "B", description: "", gender: "female" }],
    current: () => current,
    select: (id) => { if (id !== "a" && id !== "b") throw new Error(`Voice "${id}" isn't installed`); current = id; },
    synthesize: async (t, id) => { used.push(id ?? current); return Buffer.from("RIFF0000"); },
  };
  const app = createApp({ router: answerRouter, voice });
  const list = await (await app.request("/api/voices")).json();
  assert.equal(list.current, "a");
  assert.deepEqual(list.voices.map((v) => v.id), ["a", "b"]);
  assert.equal((await post(app, "/api/speak", { text: "hi", voice: "b" })).status, 200);
  assert.equal((await post(app, "/api/speak", { text: "hi", voice: "zzz" })).status, 404);
  const put = (body) => app.request("/api/voices", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await put({ voice: "zzz" })).status, 404);
  assert.deepEqual(await (await put({ voice: "b" })).json(), { current: "b" });
  await post(app, "/api/speak", { text: "hello" });
  assert.deepEqual(used, ["b", "b"]);
});

test("chat passes through the tools Friday used", async () => {
  const router = { route: async () => ({ kind: "answer", content: "Buy milk, boss.", model: "nemo", tools: [{ name: "filesystem__read_file", ok: true }] }) };
  const app = createApp({ router });
  assert.deepEqual((await (await post(app, "/api/chat", user)).json()).tools, [{ name: "filesystem__read_file", ok: true }]);
  const text = await (await post(app, "/api/chat/stream", user)).text();
  assert.match(text, /event: route\ndata: .*"tools":\[\{"name":"filesystem__read_file","ok":true\}\]/);
});
