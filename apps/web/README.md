# @jarvis/web

Jarvis chat UI (Next.js + Tailwind). Talks to `apps/server` through a `/api/*` proxy.

```bash
pnpm --filter @jarvis/server dev   # API on :8787 (needs NVIDIA_API_KEY in ../../.env)
pnpm --filter @jarvis/web dev      # UI on http://localhost:3000
```

Set `JARVIS_API_URL` if the server runs somewhere other than `http://127.0.0.1:8787`.

- Streaming replies (Server-Sent Events) with markdown, tables and copyable code blocks
- Model label on every reply
- Handoff cards: approve or decline a NIM handoff to Claude or Claude Code, then watch it run and read the result
- Conversation list (stored in the browser for now; SQLite comes with the persistence task)
- Responsive: sidebar becomes a drawer on phones
