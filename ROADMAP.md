# Jarvis build roadmap

One task is completed per scheduled build run (every 6 hours). Tick the box in the
same commit that completes the task.

- [x] 1. Monorepo scaffold: pnpm workspaces, shared TS config, package layout, roadmap
- [x] 2. `packages/router`: NVIDIA NIM client (OpenAI-compatible API, `NVIDIA_API_KEY`). Every request goes to NIM first; NIM answers or decides to delegate
- [x] 3. `apps/server`: Node/TypeScript API with a streaming chat endpoint that routes through the NIM router
- [x] 4. Delegation layer: NIM hands off to Claude (Anthropic API) or the Claude Code agent only after the user approves the handoff in the UI
- [x] 5. `apps/web`: Next.js + Tailwind + shadcn/ui chat UI (conversation list, streaming messages, markdown/code rendering, handoff approval prompts)
- [x] 6. Dashboards page: usage per model (NIM vs delegated), recent conversations, coding-agent task history, MCP server health
- [ ] 7. `mcp/filesystem`: MCP server for scoped read/write of a workspace folder
- [ ] 8. `mcp/github`: MCP server for repos, issues and PRs (uses `GITHUB_TOKEN`)
- [ ] 9. `mcp/claude-code`: MCP server that hands coding tasks to Claude Code (headless `claude -p`) and reports progress
- [ ] 10. Wire the MCP servers into the tool loop, plus a `.mcp.json` for using them from Claude Code directly
- [ ] 11. `packages/voice`: Piper TTS wrapper using a British male voice (`en_GB-alan-medium`), with a voice-download script
- [ ] 12. Voice replies in the UI: speak assistant responses, mute toggle, playback controls
- [ ] 13. Voice input (speech recognition): push-to-talk mic button in the UI, speech-to-text via NVIDIA NIM ASR (Parakeet) with local whisper.cpp as offline fallback, transcript sent as a chat message
- [ ] 14. Voice identification: enroll the owner's voice (a few short phrases), compute a speaker embedding locally (ECAPA-TDNN via ONNX), and check every spoken request against it; unrecognized voices get "Access denied" and are logged on the dashboard. Adjustable match threshold, re-enroll option, and a PIN fallback
- [ ] 15. User management on the dashboard (owner only): add, edit and remove users; each user enrolls their own voiceprint and gets a role (e.g. guest: chat only; member: chat + tasks; admin: can approve Claude/Claude Code handoffs and manage users). Requests are answered per recognized user, unknown voices still get "Access denied"
- [ ] 16. Persistence: SQLite store for conversations and dashboard metrics
- [ ] 17. Dev experience: root `pnpm dev`, CI (typecheck + build), setup docs

## Routing

NVIDIA NIM is the default model and router. It handles each request first and only delegates to
Claude or Claude Code, and only after the user approves that handoff.

## Voice note

Jarvis speaks with Piper's stock `en_GB-alan` voice (an open, licensed TTS voice). It does not
clone or imitate any real actor's voice.
