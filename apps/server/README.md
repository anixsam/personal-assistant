# @jarvis/server

Node/TypeScript API (Hono). Every chat request goes through the NVIDIA NIM router first.

```bash
pnpm --filter @jarvis/server dev   # reads ../../.env, listens on http://127.0.0.1:8787
```

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/api/health` | Liveness check |
| POST | `/api/chat` | `{ messages }` → `{ kind: "answer", content, model }` or `{ kind: "handoff", handoff, model }` |
| POST | `/api/chat/stream` | Same, as Server-Sent Events: `route`, `delta`, `handoff`, `error`, `done` |
| GET | `/api/handoffs?status=pending` | Handoffs NIM proposed (statuses: pending, rejected, running, completed, failed) |
| GET | `/api/handoffs/:id` | One handoff, including `result` once completed |
| POST | `/api/handoffs/:id/approve` | Approve and start the handoff in the background (202); 503 if that target isn't configured |
| POST | `/api/handoffs/:id/reject` | Reject a pending handoff |

`messages` is an array of `{ role: "user" | "assistant", content }` ending with a user message.
Settings: `PORT` (8787), `HOST` (127.0.0.1), `CORS_ORIGIN` (http://localhost:3000), plus the NIM variables.
## Handoffs

Nothing is sent to Claude or Claude Code until you approve the handoff.

- `claude`: Anthropic API (`ANTHROPIC_API_KEY`, model `CLAUDE_MODEL`, default `claude-opus-5-5`, adaptive thinking, server-side refusal fallback on).
- `claude-code`: runs `claude -p "<task>" --output-format json` in `CLAUDE_CODE_CWD` with `CLAUDE_CODE_PERMISSION_MODE` (default `acceptEdits`, so it can edit files there but asks before other actions). Needs the Claude Code CLI installed and signed in.

Handoffs are kept in memory until the persistence task adds SQLite.
