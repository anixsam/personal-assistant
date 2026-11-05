import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, parseMessages, chunk } from "../dist/app.js";
import { UserStore } from "../dist/users.js";

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
  const status = await (await app.request("/api/voice")).json();
  assert.deepEqual({ ...status, stt: undefined }, { enabled: true, voice: "en_GB-alan-medium", setup: null, stt: undefined });
  assert.equal(status.stt.enabled, false);
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

test("transcribe: 503 without STT, 400 for non-WAV, transcript with engine", async () => {
  const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(60)]);
  const send = (app, body) => app.request("/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body });
  assert.equal((await send(createApp({ router: answerRouter }), wav)).status, 503);
  const got = [];
  const stt = { available: () => true, engineNames: () => ["whisper"], transcribe: async (b) => (got.push(b.length), { text: "Hello Friday", engine: "whisper" }) };
  const app = createApp({ router: answerRouter, stt });
  assert.equal((await send(app, Buffer.from("not audio at all, really"))).status, 400);
  assert.deepEqual(await (await send(app, wav)).json(), { text: "Hello Friday", engine: "whisper" });
  assert.deepEqual(got, [64]);
  assert.deepEqual((await (await app.request("/api/voice")).json()).stt, { enabled: true, engines: ["whisper"], setup: null });
  const failing = createApp({ router: answerRouter, stt: { ...stt, transcribe: async () => { throw new Error("whisper: crashed"); } } });
  assert.equal((await send(failing, wav)).status, 502);
});

test("voice ID: denies unknown voices, PIN unlocks, settings need the PIN", async () => {
  const { VoiceprintStore, decodeWav, normalize } = await import("@jarvis/voiceid");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  // Fake embedder: the "voice" is the first sample's sign/size, enough to tell two speakers apart.
  const embedder = { available: () => true, embed: async (w) => { const s = decodeWav(w).samples; return normalize(Float32Array.from([s[100] > 0 ? 1 : -1, 0.1])); } };
  const store = new VoiceprintStore(path.join(mkdtempSync(path.join(tmpdir(), "vid-")), "v.json"), embedder);
  const tone = (sign) => { const n = 16000 * 2; const b = Buffer.alloc(44 + n * 2); b.write("RIFF", 0); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b.writeInt16LE(sign * 9000, 44 + i * 2); return b; };
  const stt = { available: () => true, engineNames: () => ["whisper"], transcribe: async () => ({ text: "Hello Friday", engine: "whisper" }) };
  const app = createApp({ router: answerRouter, stt, voiceId: store, users: new UserStore(undefined, "Anix") });
  const send = (url, body, headers = {}) => app.request(url, { method: "POST", headers: { "Content-Type": "audio/wav", ...headers }, body });
  for (let i = 0; i < 3; i++) assert.equal((await send("/api/voiceid/enroll?user=owner&name=Anix", tone(1))).status, 200);
  assert.equal((await (await app.request("/api/voiceid")).json()).enabled, true);
  const mine = await (await send("/api/transcribe", tone(1))).json();
  assert.equal(mine.speaker.name, "Anix");
  const other = await send("/api/transcribe", tone(-1));
  assert.equal(other.status, 403);
  assert.equal((await other.json()).error, "Access denied");
  const put = (body, headers = {}) => app.request("/api/voiceid/settings", { method: "PUT", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  assert.equal((await put({ pin: "2468" })).status, 200);
  assert.equal((await put({ threshold: 0.9 })).status, 401, "PIN now required");
  assert.equal((await put({ threshold: 0.9 }, { "x-friday-pin": "2468" })).status, 200);
  const pin = (p) => app.request("/api/voiceid/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: p }) });
  assert.equal((await pin("0000")).status, 401);
  const { unlock } = await (await pin("2468")).json();
  assert.equal((await send("/api/transcribe", tone(-1), { "x-friday-unlock": unlock })).status, 200);
  const log = (await (await app.request("/api/voiceid")).json()).recent.map((e) => e.outcome);
  assert.deepEqual(log.slice(0, 4), ["pin", "denied", "denied", "accepted"]);
});

test("users and roles: per-user voices, guests chat only, only admins approve or manage users", async () => {
  const { VoiceprintStore, decodeWav, normalize } = await import("@jarvis/voiceid");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  // Fake embedder: each loudness level is a different "voice".
  const embedder = { available: () => true, embed: async (w) => { const v = new Float32Array(10); v[Math.round(Math.abs(decodeWav(w).samples[100]) * 10)] = 1; return normalize(v); } };
  const store = new VoiceprintStore(path.join(mkdtempSync(path.join(tmpdir(), "vid-")), "v.json"), embedder);
  const tone = (amp) => { const n = 32000; const b = Buffer.alloc(44 + n * 2); b.write("RIFF", 0); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(amp * 32767), 44 + i * 2); return b; };
  const seen = [];
  let mode = "answer";
  const router = { route: async (_h, _s, opts) => (seen.push(opts), mode === "answer" ? { kind: "answer", content: "hi", model: "nemo" } : { kind: "delegate", target: "claude-code", task: "Fix it", reason: "code", requiresApproval: true, model: "nemo" }) };
  const ran = [];
  const delegates = { "claude-code": { run: async (h) => (ran.push(h.id), { output: "done", by: "claude-code" }) } };
  const stt = { available: () => true, engineNames: () => ["whisper"], transcribe: async () => ({ text: "hello", engine: "whisper" }) };
  const users = new UserStore(undefined, "Anix");
  const app = createApp({ router, delegates, stt, voiceId: store, users });
  const req = (method, url, body, session) =>
    app.request(url, { method, headers: { "Content-Type": "application/json", ...(session && { "x-friday-unlock": session }) }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  const wavPost = (url, wav) => app.request(url, { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });

  const ria = (await (await req("POST", "/api/users", { name: "Ria", role: "member" })).json()).user;
  const sam = (await (await req("POST", "/api/users", { name: "Sam", role: "guest" })).json()).user;
  assert.equal((await req("POST", "/api/users", { name: "ria", role: "guest" })).status, 400, "names are unique");
  for (const [id, amp] of [["owner", 0.1], [ria.id, 0.3], [sam.id, 0.5]]) for (let i = 0; i < 3; i++) assert.equal((await wavPost(`/api/voiceid/enroll?user=${id}`, tone(amp))).status, 200);
  assert.equal((await wavPost("/api/voiceid/enroll?user=nobody", tone(0.7))).status, 404);
  const list = (await (await req("GET", "/api/users")).json()).users;
  assert.deepEqual(list.map((u) => [u.name, u.role, u.voice]), [["Anix", "owner", true], ["Ria", "member", true], ["Sam", "guest", true]]);

  // Each recognised voice gets a session; chat is answered for that person with that role's limits.
  const samT = await (await wavPost("/api/transcribe", tone(0.5))).json();
  assert.equal(samT.speaker.name, "Sam");
  assert.equal(samT.speaker.role, "guest");
  await req("POST", "/api/chat", user, samT.session);
  assert.deepEqual(seen.at(-1), { user: { name: "Sam", role: "guest" }, tools: false, delegate: false });
  assert.equal((await (await req("GET", "/api/me", undefined, samT.session)).json()).name, "Sam");
  assert.equal((await req("POST", "/api/users", { name: "Eve", role: "admin" }, samT.session)).status, 403);
  assert.equal((await wavPost("/api/transcribe", tone(0.7))).status, 403, "unknown voices are still denied");

  const riaT = await (await wavPost("/api/transcribe", tone(0.3))).json();
  mode = "handoff";
  const { handoff } = await (await req("POST", "/api/chat", user, riaT.session)).json();
  assert.deepEqual(seen.at(-1), { user: { name: "Ria", role: "member" }, tools: true, delegate: true });
  assert.equal(handoff.requestedBy, "Ria");
  assert.equal((await req("POST", `/api/handoffs/${handoff.id}/approve`, undefined, riaT.session)).status, 403, "members can't approve");
  const ownerT = await (await wavPost("/api/transcribe", tone(0.1))).json();
  const ok = await req("POST", `/api/handoffs/${handoff.id}/approve`, undefined, ownerT.session);
  assert.equal(ok.status, 202);
  assert.equal((await ok.json()).handoff.decidedBy, "Anix");

  // Typed requests with no voice session use the keyboard role (owner by default).
  assert.equal((await (await req("GET", "/api/me")).json()).role, "owner");
  assert.equal((await req("PUT", "/api/users-keyboard", { role: "guest" }, riaT.session)).status, 403);
  assert.equal((await req("PUT", "/api/users-keyboard", { role: "guest" })).status, 200);
  assert.equal((await (await req("GET", "/api/me")).json()).role, "guest");
  assert.equal((await req("GET", "/api/users")).status, 403);

  // Removing a user ends their session and deletes their voiceprint. The owner can't be removed.
  assert.equal((await req("DELETE", `/api/users/${sam.id}`, undefined, ownerT.session)).status, 200);
  assert.equal((await (await req("GET", "/api/me", undefined, samT.session)).json()).role, "guest");
  assert.equal(store.prints().some((p) => p.userId === sam.id), false);
  assert.equal((await req("DELETE", "/api/users/owner", undefined, ownerT.session)).status, 400);
  assert.equal((await req("PATCH", `/api/users/${ria.id}`, { role: "admin" }, ownerT.session)).status, 200);
});

test("saved history: conversations, dashboard numbers and handoffs survive a restart", async () => {
  const { FridayDb } = await import("../dist/db.js");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const file = path.join(mkdtempSync(path.join(tmpdir(), "fdb-")), "friday.db");
  let db = new FridayDb(file);
  let app = createApp({ router: answerRouter, db });
  const put = (a, id, body) => a.request(`/api/conversations/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await put(app, "c1", { title: "Todo", messages: [{ id: "m1", role: "user", content: "hi" }], updatedAt: "2026-11-05T06:00:00.000Z" })).status, 200);
  assert.equal((await put(app, "c2", { title: "Other", messages: [], updatedAt: "2026-11-05T07:00:00.000Z" })).status, 200);
  assert.equal((await put(app, "bad id!", { messages: [] })).status, 400);
  assert.equal((await put(app, "c3", { messages: "nope" })).status, 400);
  await post(app, "/api/chat", user);
  const hApp = createApp({ router: handoffRouter, db });
  const { handoff } = await (await post(hApp, "/api/chat", user)).json();
  // A handoff left running when Friday stops is marked failed on the next start.
  const { HandoffStore } = await import("../dist/handoffs.js");
  new HandoffStore(db).update(handoff.id, { status: "running" });
  assert.equal((await app.request("/api/conversations/c2", { method: "DELETE" })).status, 200);
  db.close();

  db = new FridayDb(file);
  app = createApp({ router: answerRouter, db });
  const { saved, conversations } = await (await app.request("/api/conversations")).json();
  assert.equal(saved, true);
  assert.deepEqual(conversations.map((c) => [c.id, c.title, c.messages.length]), [["c1", "Todo", 1]]);
  const stats = await (await app.request("/api/stats")).json();
  assert.equal(stats.saved, true);
  assert.equal(stats.totals.requests, 2);
  const h = stats.handoffs.recent.find((x) => x.id === handoff.id);
  assert.equal(h.status, "failed");
  assert.match(h.error, /restarted/);
  db.close();

  // Without a database, history isn't saved and the UI keeps using the browser.
  const mem = createApp({ router: answerRouter });
  assert.deepEqual(await (await mem.request("/api/conversations")).json(), { saved: false, conversations: [] });
  assert.equal((await put(mem, "c1", { messages: [] })).status, 501);
});
