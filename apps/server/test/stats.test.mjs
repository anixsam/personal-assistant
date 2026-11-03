import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../dist/app.js";
import { StatsStore } from "../dist/stats.js";
import { HandoffStore } from "../dist/handoffs.js";

const post = (app, path, body) => app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const user = { messages: [{ role: "user", content: "Hello" }] };

test("stats count answers, handoffs, errors and tokens per model", async () => {
  let n = 0;
  const router = {
    route: async () => {
      n++;
      if (n === 3) throw new Error("NIM down");
      if (n === 2) return { kind: "delegate", target: "claude", task: "t", reason: "r", requiresApproval: true, model: "nemo", usage: { total_tokens: 50 } };
      return { kind: "answer", content: "hi", model: "nemo", usage: { total_tokens: 100 } };
    },
  };
  const app = createApp({ router });
  await post(app, "/api/chat", user);
  await post(app, "/api/chat", user);
  await post(app, "/api/chat", user);
  const s = await (await app.request("/api/stats")).json();
  assert.equal(s.totals.requests, 3);
  assert.equal(s.totals.answered, 1);
  assert.equal(s.totals.handedOff, 1);
  assert.equal(s.totals.errors, 1);
  assert.equal(s.totals.tokens, 150);
  assert.deepEqual(s.models.map((m) => [m.model, m.requests, m.tokens]), [["nemo", 2, 150]]);
  assert.equal(s.hourly.length, 24);
  const last = s.hourly.at(-1);
  assert.deepEqual([last.nim, last.delegated], [1, 1]);
  assert.equal(s.handoffs.byStatus.pending, 1);
  assert.equal(s.handoffs.byTarget.claude, 1);
  assert.deepEqual(s.mcp.map((m) => m.status), ["not-configured", "not-configured", "not-configured"]);
});

test("completed handoffs show up as delegated models with cost", () => {
  const handoffs = new HandoffStore();
  const h = handoffs.create({ target: "claude-code", task: "x", reason: "y" });
  handoffs.update(h.id, { status: "completed", by: "claude-code", costUsd: 0.4 });
  const s = new StatsStore().snapshot(handoffs, []);
  assert.deepEqual(s.models, [{ model: "claude-code", source: "delegated", requests: 1, tokens: 0, avgLatencyMs: null, costUsd: 0.4 }]);
  assert.equal(s.handoffs.costUsd, 0.4);
});

test("hourly buckets ignore old records", () => {
  const stats = new StatsStore();
  const now = Date.now();
  stats.record({ at: now - 30 * 3_600_000, model: "m", kind: "answer", latencyMs: 10, tokens: 1, ok: true });
  stats.record({ at: now, model: "m", kind: "answer", latencyMs: 30, tokens: 1, ok: true });
  const s = stats.snapshot(new HandoffStore(), [], now, 24);
  assert.equal(s.totals.requests, 1);
  assert.equal(s.hourly.reduce((a, h) => a + h.nim, 0), 1);
  assert.equal(s.totals.avgLatencyMs, 30);
});
