#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ClaudeCodeRunner } from "./runner.js";
import { createClaudeCodeServer } from "./server.js";

// Usage: jarvis-mcp-claude-code [project folder]   (or set CLAUDE_CODE_CWD)
// Optional: CLAUDE_CODE_BIN, CLAUDE_CODE_PERMISSION_MODE (default acceptEdits), CLAUDE_CODE_MAX_TASKS (default 1)
const root = process.argv[2] || process.env.CLAUDE_CODE_CWD;
if (!root || !existsSync(root) || !statSync(root).isDirectory()) {
  console.error("jarvis-mcp-claude-code: pass the project folder as the first argument or set CLAUDE_CODE_CWD");
  process.exit(1);
}
const runner = new ClaudeCodeRunner({
  root,
  bin: process.env.CLAUDE_CODE_BIN || undefined,
  permissionMode: process.env.CLAUDE_CODE_PERMISSION_MODE || undefined,
  maxConcurrent: Number(process.env.CLAUDE_CODE_MAX_TASKS) || 1,
});
await createClaudeCodeServer(runner).connect(new StdioServerTransport());
console.error(`jarvis-mcp-claude-code ready for ${root}`);
