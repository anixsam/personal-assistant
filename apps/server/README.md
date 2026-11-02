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
| GET | `/api/handoffs?status=pending` | Handoffs NIM proposed |
| POST | `/api/handoffs/:id/approve` | Approve a pending handoff (running it comes in roadmap task 4) |
| POST | `/api/handoffs/:id/reject` | Reject a pending handoff |

`messages` is an array of `{ role: "user" | "assistant", content }` ending with a user message.
Settings: `PORT` (8787), `HOST` (127.0.0.1), `CORS_ORIGIN` (http://localhost:3000), plus the NIM variables.
Handoffs are kept in memory until the persistence task adds SQLite.
