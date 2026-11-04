# Friday (formerly Jarvis) build roadmap

One task is completed per scheduled build run (every 6 hours). Tick the box in the
same commit that completes the task.

- [x] 1. Monorepo scaffold: pnpm workspaces, shared TS config, package layout, roadmap
- [x] 2. `packages/router`: NVIDIA NIM client (OpenAI-compatible API, `NVIDIA_API_KEY`). Every request goes to NIM first; NIM answers or decides to delegate
- [x] 3. `apps/server`: Node/TypeScript API with a streaming chat endpoint that routes through the NIM router
- [x] 4. Delegation layer: NIM hands off to Claude (Anthropic API) or the Claude Code agent only after the user approves the handoff in the UI
- [x] 5. `apps/web`: Next.js + Tailwind + shadcn/ui chat UI (conversation list, streaming messages, markdown/code rendering, handoff approval prompts)
- [x] 6. Dashboards page: usage per model (NIM vs delegated), recent conversations, coding-agent task history, MCP server health
- [x] 7. `mcp/filesystem`: MCP server for scoped read/write of a workspace folder
- [x] 8. `mcp/github`: MCP server for repos, issues and PRs (uses `GITHUB_TOKEN`)
- [x] 9. Rename the assistant from Jarvis to Friday everywhere you see or hear it: UI name and logo text, page title, greetings and spoken lines, the NIM system prompt persona (warm, friendly, light Irish-English phrasing is fine but no imitation of any real person), the Claude delegate prompt, README and docs. Internal package names (`@jarvis/*`) and env var names stay as they are so nothing breaks; existing browser data (conversations, voice settings) is kept
- [x] 10. `mcp/claude-code`: MCP server that hands coding tasks to Claude Code (headless `claude -p`) and reports progress
- [x] 11. Wire the MCP servers into the tool loop, plus a `.mcp.json` for using them from Claude Code directly. Each server is optional and only starts when configured (GitHub only with `GITHUB_TOKEN`), so the assistant runs fine without them and you can connect them later; the dashboard shows which are on
- [x] 12. `packages/voice`: Piper TTS wrapper using a British male voice (`en_GB-alan-medium`), with a voice-download script
- [x] 13. Voice replies in the UI: speak assistant responses, mute toggle, playback controls, studio FX toggle, and a voice picker on the dashboard (preview and switch between installed stock voices)
- [x] 14. Voice input (speech recognition): push-to-talk mic button in the UI, speech-to-text via NVIDIA NIM ASR (Parakeet) with local whisper.cpp as offline fallback, transcript sent as a chat message
- [x] 15. Voice identification: enroll the owner's voice (a few short phrases), compute a speaker embedding locally (WeSpeaker CAM++ via ONNX), and check every spoken request against it; unrecognized voices get "Access denied" and are logged on the dashboard. Adjustable match threshold, re-enroll option, and a PIN fallback
- [ ] 16. User management on the dashboard (owner only): add, edit and remove users; each user enrolls their own voiceprint and gets a role (e.g. guest: chat only; member: chat + tasks; admin: can approve Claude/Claude Code handoffs and manage users). Requests are answered per recognized user, unknown voices still get "Access denied"
- [ ] 17. Persistence: SQLite store for conversations and dashboard metrics
- [ ] 18. Dev experience: root `pnpm dev`, CI (typecheck + build), setup docs

## Routing

NVIDIA NIM is the default model and router. It handles each request first and only delegates to
Claude or Claude Code, and only after the user approves that handoff.

## Voice note

Replies are spoken with stock Piper voices (open, licensed TTS voices), picked by the user in the
dashboard's voice picker. They never clone or imitate any real actor's voice.
