import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeCodeRunner, describeTool } from "../dist/runner.js";

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-claude.mjs");
chmodSync(fake, 0o755);
const project = () => {
  const root = mkdtempSync(path.join(tmpdir(), "cc-root-"));
  mkdirSync(path.join(root, "web"));
  return root;
};

test("runs a task, records steps, cost and result", async () => {
  const r = new ClaudeCodeRunner({ root: project(), bin: fake });
  const t = r.start("fix the tests", "web");
  assert.equal(t.folder, "web");
  const done = await r.wait(t.id, 5000);
  assert.equal(done.status, "done");
  assert.equal(done.result, "Done in web");
  assert.equal(done.costUsd, 0.05);
  assert.deepEqual(done.steps.map((s) => s.summary), ["Working on: fix the tests", "Edit src/app.ts", "Bash: pnpm test"]);
});

test("reports Claude Code errors and crashes", async () => {
  const r = new ClaudeCodeRunner({ root: project(), bin: fake, maxConcurrent: 2 });
  const a = r.start("this will fail");
  const b = r.start("crash now");
  assert.equal((await r.wait(a.id, 5000)).error, "Tests still failing");
  const crashed = await r.wait(b.id, 5000);
  assert.equal(crashed.status, "failed");
  assert.match(crashed.error, /exited with 3: boom/);
  const missing = new ClaudeCodeRunner({ root: project(), bin: "/nope/claude" }).start("x");
  await new Promise((res) => setTimeout(res, 200));
  assert.match(missing.error, /Could not start Claude Code/);
});

test("queues one at a time, cancels, and keeps tasks inside the root", async () => {
  const r = new ClaudeCodeRunner({ root: project(), bin: fake });
  const slow = r.start("slow job");
  const next = r.start("quick job");
  assert.equal(r.get(slow.id).status, "running");
  assert.equal(r.get(next.id).status, "queued");
  r.cancel(next.id);
  assert.equal(r.get(next.id).status, "cancelled");
  r.cancel(slow.id);
  await r.wait(slow.id, 3000);
  assert.equal(r.get(slow.id).status, "cancelled");
  assert.throws(() => r.start("x", "../.."), /outside the allowed root/);
  assert.throws(() => r.start("x", "missing"), /Folder not found/);
  assert.throws(() => r.start("   "), /task is required/);
});

test("describeTool", () => {
  assert.equal(describeTool("Read", { file_path: "a.ts" }), "Read a.ts");
  assert.equal(describeTool("TodoWrite"), "TodoWrite");
});
