import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Workspace } from "../dist/workspace.js";

let root, outside, ws;
before(() => {
  const base = mkdtempSync(path.join(tmpdir(), "jarvis-fs-"));
  root = path.join(base, "ws");
  outside = path.join(base, "outside");
  mkdirSync(path.join(root, "src"), { recursive: true });
  mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(path.join(root, "src", "app.ts"), "const greeting = 'Hello';\nexport default greeting;\n");
  writeFileSync(path.join(root, "README.md"), "# Demo\nHello world\n");
  writeFileSync(path.join(root, ".env"), "SECRET=1\n");
  writeFileSync(path.join(root, "node_modules", "pkg", "index.js"), "hello");
  writeFileSync(path.join(outside, "secret.txt"), "nope");
  symlinkSync(outside, path.join(root, "escape"));
  ws = new Workspace({ root });
});

test("lists and hides secrets", async () => {
  const { entries } = await ws.list(".");
  const names = entries.map((e) => e.path);
  assert.ok(names.includes("README.md") && names.includes("src"));
  assert.ok(!names.includes(".env"));
  const rec = (await ws.list(".", { recursive: true })).entries.map((e) => e.path);
  assert.ok(rec.includes("src/app.ts"));
  assert.ok(!rec.some((p) => p.startsWith("node_modules/")), "skips node_modules contents");
});

test("reads with line ranges", async () => {
  const r = await ws.read("src/app.ts", { offset: 2, limit: 1 });
  assert.equal(r.content, "export default greeting;");
  assert.equal(r.truncated, true);
});

test("blocks traversal, absolute escapes, symlink escapes and secrets", async () => {
  await assert.rejects(ws.read("../outside/secret.txt"), /outside the workspace/);
  await assert.rejects(ws.read("escape/secret.txt"), /symlink/);
  await assert.rejects(ws.write("escape/new.txt", "x"), /symlink/);
  await assert.rejects(ws.read(".env"), /secret/);
  await assert.rejects(ws.read("src/../../outside/secret.txt"), /outside/);
  // A leading slash is treated as workspace-relative, never as the real filesystem root.
  assert.equal((await ws.read("/README.md")).path, "README.md");
  assert.equal(existsSync(path.join(outside, "new.txt")), false);
});

test("searches names and content", async () => {
  assert.deepEqual((await ws.search("app", { mode: "name" })).results.map((r) => r.path), ["src/app.ts"]);
  const c = (await ws.search("hello", { mode: "content" })).results;
  assert.deepEqual(c.map((r) => `${r.path}:${r.line}`).sort(), ["README.md:2", "src/app.ts:1"]);
});

test("writes, edits and creates folders", async () => {
  const w = await ws.write("notes/todo.md", "- buy milk\n");
  assert.equal(w.created, true);
  await assert.rejects(ws.write("notes/todo.md", "x", { overwrite: false }), /already exists/);
  const e = await ws.edit("notes/todo.md", "milk", "tea");
  assert.equal(e.line, 1);
  assert.equal(readFileSync(path.join(root, "notes/todo.md"), "utf8"), "- buy tea\n");
  await assert.rejects(ws.edit("notes/todo.md", "coffee", "x"), /not found/);
  writeFileSync(path.join(root, "dup.txt"), "a a");
  await assert.rejects(ws.edit("dup.txt", "a", "b"), /more than once/);
  await ws.mkdir("deep/er/folder");
  assert.equal((await ws.info("deep/er/folder")).type, "directory");
  await assert.rejects(ws.write(".git/config", "x"), /\.git/);
});

test("read-only workspaces refuse writes", async () => {
  const ro = new Workspace({ root, readOnly: true });
  await assert.rejects(ro.write("x.txt", "x"), /read-only/);
  await assert.rejects(ro.edit("README.md", "Demo", "X"), /read-only/);
  assert.equal((await ro.read("README.md")).content.startsWith("# Demo"), true);
});
