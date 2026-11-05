# Friday

[![CI](https://github.com/anixsam/personal-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/anixsam/personal-assistant/actions/workflows/ci.yml)

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
| `packages/voice` | Piper text-to-speech, whisper.cpp / NIM speech-to-text |
| `packages/voiceid` | Voice identification (local speaker embeddings) |
| `mcp/filesystem` | MCP server: workspace files |
| `mcp/github` | MCP server: GitHub repos, issues, PRs |
| `mcp/claude-code` | MCP server: delegates coding tasks to Claude Code |
| `scripts` | Voice downloads (`voice-setup.mjs`) and the setup check (`preflight.mjs`) |
| `docs/SETUP.md` | Full setup guide and troubleshooting |

## Getting started

```bash
pnpm bootstrap         # install, build, download voices, speech and voice ID models, then check
cp .env.example .env   # add NVIDIA_API_KEY (and optionally ANTHROPIC_API_KEY, CLAUDE_CODE_CWD)
pnpm preflight         # what's set up and what's missing (never prints your keys)
pnpm dev               # server on :8787, chat UI on http://localhost:3000
```

Needs Node 22.13+ (Node 24 recommended) and pnpm 10 (`npm i -g pnpm@10.28.0`; on Windows, pnpm 11+ can
fail to switch to the pinned version). The full walkthrough, every setting, and troubleshooting are in
[docs/SETUP.md](docs/SETUP.md).

## Development

`pnpm check` runs what CI runs: typecheck, build and every test. GitHub Actions runs it on every push and
pull request, on Node 22 and 24 ([.github/workflows/ci.yml](.github/workflows/ci.yml)). Tests use fakes for
NIM, Piper, whisper.cpp and Claude Code, so they need no keys or downloads.

## Talking to Friday

Hold the mic button next to the message box (or Ctrl+Space) and speak; let go to send. A quick tap
toggles instead: tap to start, tap again to send. The recording is turned into text on your machine
with [whisper.cpp](https://github.com/ggml-org/whisper.cpp), and sent as a normal message.

```bash
pnpm voice:setup --stt    # Windows: downloads whisper.cpp + the base English model into ./voices
```

On macOS or Linux, install whisper.cpp yourself (`brew install whisper-cpp` on macOS) and set `WHISPER_BIN`.
If you run an NVIDIA Speech NIM (Parakeet), set `NIM_ASR_URL` to its `/v1/audio/transcriptions` endpoint
and Friday tries it first, falling back to whisper.cpp. The mic button only shows when one of them is set up.

## Voice ID

Friday can answer only your voice. Run `pnpm voice:setup --voiceid` to download a small speaker model
(WeSpeaker CAM++, runs locally with onnxruntime, nothing leaves your machine), then open
Dashboard → Voice ID and read the three phrases to enroll. From then on every voice message is checked
first: your voice goes through, anyone else gets **ACCESS DENIED**. You can tune the match threshold,
test your voice, re-enroll, turn it off, and set a 4 to 8 digit PIN. The PIN unlocks voice input for
15 minutes when your voice isn't recognized (a cold, a noisy room) and is needed to change Voice ID
settings. Voiceprints and the access log are kept in `data/voiceprints.json` (gitignored).

## Users and roles

Dashboard → Users and roles lets the owner (and admins) add people, give each a role, and enroll each
person's voice (hand them the mic and they read three phrases). Friday answers each recognised voice by
name, with that role's limits:

| Role | Can |
| --- | --- |
| guest | Chat only (no tools, no handoffs) |
| member | Chat and tasks: tools, and asking for Claude / Claude Code handoffs |
| admin | Also approves or declines handoffs and manages members and guests |
| owner | Everything, including making admins; can't be removed |

A recognised voice starts a 15 minute session, so the typed messages and approvals that follow count as
that person, and the chat header shows who Friday thinks it's talking to. Unknown voices still get
**ACCESS DENIED**. Typed messages with no recognised voice count as the owner by default; the owner can
change that to guest on the same panel. With voice ID off, everyone is the owner. Users are saved in
`data/users.json` (gitignored).

## Saved history

Conversations, the dashboard numbers and handoff history are saved in a local SQLite database,
`data/friday.db` (gitignored; set `FRIDAY_DB` to move it). It uses Node's built-in `node:sqlite`, so
there's nothing extra to install (Node 22.13+; Node may print an "experimental" warning on start, which is
harmless). Chats are kept per person: whoever Friday recognises by voice sees their own list. Chats that
were only in your browser are uploaded the first time the server is reachable. Handoffs that were
running when Friday stopped show as failed after a restart.

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
