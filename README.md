# Jarvis

A personal assistant with a modern chat UI, dashboards, voice replies and Claude Code as its
coding agent, built as a pnpm monorepo. Every request goes to NVIDIA NIM first, which hands off
to Claude or Claude Code only after you approve.

## Layout

| Path | What it is |
| --- | --- |
| `apps/web` | Chat UI and dashboards (Next.js) |
| `apps/server` | API server: chat, tool loop, voice synthesis |
| `packages/router` | NVIDIA NIM router: answers first, delegates on approval |
| `packages/shared` | Shared types |
| `packages/voice` | Piper text-to-speech wrapper |
| `mcp/filesystem` | MCP server: workspace files |
| `mcp/github` | MCP server: GitHub repos, issues, PRs |
| `mcp/claude-code` | MCP server: delegates coding tasks to Claude Code |

## Getting started

```bash
pnpm install
cp .env.example .env   # fill in keys
pnpm dev
```

Progress is tracked in [ROADMAP.md](ROADMAP.md).
