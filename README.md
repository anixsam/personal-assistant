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
cp .env.example .env   # add NVIDIA_API_KEY (and optionally ANTHROPIC_API_KEY, CLAUDE_CODE_CWD)
pnpm -r build
pnpm voice:setup       # optional: downloads Piper + the British voice into ./voices
pnpm dev               # server on :8787, chat UI on http://localhost:3000
```

Needs Node 22+ and pnpm 10 (`npm i -g pnpm@10.28.0`; on Windows, pnpm 11+ can fail to switch to the pinned version).

## Voice

Replies are spoken locally with [Piper](https://github.com/rhasspy/piper) using the stock
`en_GB-alan-medium` voice. `pnpm voice:setup` downloads the Piper binary for your platform and the voice
model into `./voices` (gitignored). Without it, Jarvis still works and simply stays silent. Use the
Voice toggle in the chat header to mute, or the Speak button on any reply to replay it.

Progress is tracked in [ROADMAP.md](ROADMAP.md).
