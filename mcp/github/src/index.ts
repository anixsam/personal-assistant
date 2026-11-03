#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GitHub } from "./github.js";
import { createGitHubServer } from "./server.js";

// Env: GITHUB_TOKEN (required), GITHUB_API_URL (optional, for GitHub Enterprise),
// JARVIS_GITHUB_REPOS="owner/a,owner/b" (optional allowlist), JARVIS_GITHUB_READONLY=1 (no write tools).
const token = process.env.GITHUB_TOKEN?.trim();
if (!token) {
  console.error("jarvis-mcp-github: set GITHUB_TOKEN (a fine-grained personal access token)");
  process.exit(1);
}
const allowedRepos = (process.env.JARVIS_GITHUB_REPOS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const readOnly = /^(1|true|yes)$/i.test(process.env.JARVIS_GITHUB_READONLY ?? "");
const gh = new GitHub({ token, apiUrl: process.env.GITHUB_API_URL, allowedRepos });
await createGitHubServer(gh, { readOnly }).connect(new StdioServerTransport());
console.error(`jarvis-mcp-github ready${readOnly ? " (read-only)" : ""}${allowedRepos.length ? ` for ${allowedRepos.join(", ")}` : ""}`);
