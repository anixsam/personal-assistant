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

test("handoff is created pending and must be approved once", async () => {
  const app = createApp({ router: handoffRouter });
  const body = await (await post(app, "/api/chat", user)).json();
  assert.equal(body.kind, "handoff");
  assert.equal(body.handoff.status, "pending");
  const pending = await (await app.request("/api/handoffs?status=pending")).json();
  assert.equal(pending.handoffs.length, 1);
  const ok = await post(app, `/api/handoffs/${body.handoff.id}/approve`, {});
  assert.equal((await ok.json()).handoff.status, "approved");
  assert.equal((await post(app, `/api/handoffs/${body.handoff.id}/reject`, {})).status, 409);
  assert.equal((await post(app, "/api/handoffs/nope/approve", {})).status, 404);
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
