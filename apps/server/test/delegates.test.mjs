import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { ClaudeDelegate } from "../dist/delegates/claude.js";
import { ClaudeCodeDelegate } from "../dist/delegates/claude-code.js";

const handoff = { id: "1", target: "claude", task: "Write a haiku", reason: "Creative writing", status: "approved", createdAt: "" };

function fakeClient(message, seen = []) {
  return { beta: { messages: { stream: (params) => { seen.push(params); return { finalMessage: async () => message }; } } } };
}

test("ClaudeDelegate sends the task and returns text", async () => {
  const seen = [];
  const d = new ClaudeDelegate(fakeClient({ model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Autumn moon..." }] }, seen));
  const r = await d.run(handoff);
  assert.equal(r.output, "Autumn moon...");
  assert.equal(r.by, "claude-opus-5-5");
  assert.equal(seen[0].model, "claude-opus-5-5");
  assert.equal(seen[0].fallbacks, "default");
  assert.match(seen[0].messages[0].content, /Write a haiku/);
});

test("ClaudeDelegate surfaces refusals as errors", async () => {
  const d = new ClaudeDelegate(fakeClient({ model: "m", stop_reason: "refusal", content: [] }));
  await assert.rejects(d.run(handoff), /declined/);
});

function fakeSpawn(stdout, code = 0, seen = []) {
  return (bin, args, opts) => {
    seen.push({ bin, args, opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stdout.emit("data", stdout);
      if (code) child.stderr.emit("data", "boom");
      child.emit("close", code);
    });
    return child;
  };
}

test("ClaudeCodeDelegate runs claude -p in the workspace and parses JSON", async () => {
  const seen = [];
  const d = new ClaudeCodeDelegate({ cwd: "/repo" }, fakeSpawn(JSON.stringify({ result: "Done, tests pass.", total_cost_usd: 0.42 }), 0, seen));
  const r = await d.run({ ...handoff, target: "claude-code" });
  assert.equal(r.output, "Done, tests pass.");
  assert.equal(r.costUsd, 0.42);
  assert.equal(seen[0].bin, "claude");
  assert.deepEqual(seen[0].args.slice(0, 4), ["-p", "Write a haiku", "--output-format", "json"]);
  assert.equal(seen[0].opts.cwd, "/repo");
});

test("ClaudeCodeDelegate rejects on non-zero exit and on is_error", async () => {
  await assert.rejects(new ClaudeCodeDelegate({ cwd: "/r" }, fakeSpawn("", 1)).run(handoff), /exited with 1: boom/);
  await assert.rejects(new ClaudeCodeDelegate({ cwd: "/r" }, fakeSpawn(JSON.stringify({ is_error: true, result: "no access" }))).run(handoff), /no access/);
});
