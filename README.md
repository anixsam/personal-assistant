# Friday

> Formerly Jarvis. Internal package names (`@jarvis/*`) and `JARVIS_*` environment variables keep the old name so existing setups keep working.

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

## Tools (MCP servers)

Friday can use three optional MCP servers. Each one starts only when you configure it in `.env`, so
Friday runs fine without any of them, and the dashboard shows which are on.

| Server | Turn on with | What Friday can do |
| --- | --- | --- |
| `filesystem` | `JARVIS_FS_ROOT=<folder>` | Read files in that one folder (writes only with `JARVIS_FS_READONLY=0`) |
| `github` | `GITHUB_TOKEN=<token>` | Read repos, issues and PRs (writes only with `JARVIS_GITHUB_READONLY=0`) |
| `claude-code` | `CLAUDE_CODE_CWD=<project>` | Run approved coding handoffs, with live progress in the chat |

NIM calls the filesystem and GitHub tools itself while answering, and the reply shows which tools it used.
Claude Code is never called directly: it only runs after you approve a handoff. The same servers are listed in
`.mcp.json`, so Claude Code can use the filesystem and GitHub servers when you open it in this repo.

## Voice

Replies are spoken locally with [Piper](https://github.com/rhasspy/piper) using the stock
`en_GB-northern_english_male-medium` voice. `pnpm voice:setup` downloads the Piper binary for your platform and the voice
model into `./voices` (gitignored). Without it, Friday still works and simply stays silent. Use the
Voice toggle in the chat header to mute, or the Speak button on any reply to replay it.

Progress is tracked in [ROADMAP.md](ROADMAP.md).
