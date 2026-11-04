#!/usr/bin/env node
// Stands in for `claude -p --output-format stream-json`: reads the task from stdin and streams events.
let task = "";
process.stdin.on("data", (d) => (task += d));
process.stdin.on("end", async () => {
  const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  out({ type: "system", subtype: "init", cwd: process.cwd() });
  if (/crash/.test(task)) { process.stderr.write("boom"); process.exit(3); }
  if (/slow/.test(task)) await sleep(5000);
  out({ type: "assistant", message: { content: [{ type: "text", text: `Working on: ${task}` }, { type: "tool_use", name: "Edit", input: { file_path: "src/app.ts" } }] } });
  out({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "pnpm test" } }] } });
  if (/fail/.test(task)) return out({ type: "result", is_error: true, result: "Tests still failing", total_cost_usd: 0.01, num_turns: 2 });
  out({ type: "result", is_error: false, result: `Done in ${process.cwd().split("/").pop()}`, total_cost_usd: 0.05, num_turns: 3 });
});
