#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createFilesystemServer } from "./server.js";
import { Workspace } from "./workspace.js";


// Usage: jarvis-mcp-filesystem [folder]   (or set JARVIS_FS_ROOT). JARVIS_FS_READONLY=1 disables writes.
const root = process.argv[2] || process.env.JARVIS_FS_ROOT;
if (!root || !existsSync(root) || !statSync(root).isDirectory()) {
  console.error("jarvis-mcp-filesystem: pass a workspace folder as the first argument or set JARVIS_FS_ROOT");
  process.exit(1);
}
const readOnly = /^(1|true|yes)$/i.test(process.env.JARVIS_FS_READONLY ?? "");
const server = createFilesystemServer(new Workspace({ root, readOnly }));
await server.connect(new StdioServerTransport());
console.error(`jarvis-mcp-filesystem serving ${root}${readOnly ? " (read-only)" : ""}`);
