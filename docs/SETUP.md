# Setting up Friday

This guide gets Friday running on your own computer, from a fresh clone to talking to it. The steps
are written for Windows (PowerShell), with macOS and Linux notes where they differ.

## 1. Install the tools

- **Node 22.13 or newer.** Node 24 LTS is recommended. Saved history uses Node's built-in SQLite.
- **pnpm 10:** `npm i -g pnpm@10.28.0`. On Windows, pnpm 11+ can fail to switch to the pinned version.
- **Git.**
- Optional: the **Claude Code CLI** (`claude`) for coding handoffs.

## 2. Get the code and install

```powershell
git clone https://github.com/anixsam/personal-assistant.git
cd personal-assistant
pnpm bootstrap
```

`pnpm bootstrap` installs the dependencies and builds every package. It then downloads the voice files
into `./voices`: Piper with a stock voice, whisper.cpp with an English speech model, and the voice ID
model. Last, it runs `pnpm preflight`. You can run the steps on their own instead: `pnpm install`,
`pnpm build`, then `pnpm voice:setup --stt --voiceid`.

On macOS and Linux there is no prebuilt whisper.cpp. Install it yourself (`brew install whisper-cpp`)
and set `WHISPER_BIN` in `.env`.

## 3. Add your settings

Copy `.env.example` to `.env`, then fill in what you use. Keep `.env` private: it's gitignored, and it
should never be pasted into chats or committed.

| Setting | Needed for |
| --- | --- |
| `NVIDIA_API_KEY` | **Required.** NVIDIA NIM answers every request first (key from build.nvidia.com) |
| `NIM_MODEL` | NIM model (default `nvidia/nemotron-3.5-super-vl-120b-a12b`) |
| `ANTHROPIC_API_KEY` | Handoffs to Claude, after you approve them |
| `CLAUDE_CODE_CWD` | Handoffs to Claude Code: the project folder it may work in |
| `JARVIS_FS_ROOT` | Filesystem tools: one folder Friday may read (`JARVIS_FS_READONLY=0` allows writes) |
| `GITHUB_TOKEN` | GitHub tools: read repos, issues and PRs (`JARVIS_GITHUB_READONLY=0` allows writes) |
| `PIPER_VOICE` | Starting voice (you can change it later in the dashboard) |
| `NIM_ASR_URL` | Optional: an NVIDIA Speech NIM, tried before local whisper.cpp |
| `FRIDAY_DB` | Where saved history goes (default `data/friday.db`) |
| `PORT`, `CORS_ORIGIN`, `JARVIS_API_URL` | Server port and the URL the chat UI uses to reach it |

Every setting is described in `.env.example`.

## 4. Check and start

```powershell
pnpm preflight   # shows what's set up and what's missing, never prints your keys
pnpm dev      # builds the packages, starts the server on :8787 and the chat UI on :3000
```

Open http://localhost:3000.

## 5. First-run setup in the app

1. **Pick a voice:** go to Dashboard → Friday's voice, preview the voices, and pick one.
2. **Enroll your voice:** go to Dashboard → Voice ID and read the three phrases. Voice ID turns on, and
   other voices get "Access denied".
3. **Set a PIN** on the same panel. It unlocks voice input when you aren't recognised, and it's needed
   to change settings.
4. **Add people** on Dashboard → Users and roles. Pick a role for each person and enroll their voice.
5. **Talk:** hold the mic button (or press Ctrl+Space) and speak, or just type.

## Everyday commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run Friday (server + UI) |
| `pnpm preflight` | Check the setup |
| `pnpm check` | Typecheck, build and run every test (the same as CI) |
| `pnpm voice:setup <voice>` | Add another stock Piper voice, such as `en_GB-cori-high` |
| `git pull && pnpm install && pnpm dev` | Update to the latest version |

## Troubleshooting

- **Port 3000 or 8787 in use:** Friday is probably already running in another terminal. Close it, or
  find the process with `netstat -ano | findstr :3000` and end it.
- **"NVIDIA_API_KEY is not set":** add it to `.env` in the repo root, then restart `pnpm dev`.
- **No sound, or static on Windows:** run `pnpm voice:setup` again and make sure you're on the latest
  main. The fix for Windows static is in.
- **No mic button:** run `pnpm voice:setup --stt` (or set `NIM_ASR_URL`), restart, and allow mic access
  in the browser.
- **Friday keeps saying Access denied to you:** lower "Match needed" on Dashboard → Voice ID, or
  re-enroll in the room you usually use. The PIN unlocks voice input for 15 minutes.
- **"SQLite is an experimental feature" warning:** this is harmless. It comes from Node's built-in
  SQLite.
- **pnpm complains about its version:** install pnpm 10 (`npm i -g pnpm@10.28.0`).

## Data Friday keeps

All of it stays on your machine, in gitignored folders:

- `data/friday.db` holds chats, dashboard numbers and handoffs.
- `data/voiceprints.json` holds voiceprints (numbers, not recordings) and voice ID settings.
- `data/users.json` holds users and roles.
- `voices/` holds Piper, the voices, whisper.cpp and the speech and voice ID models.

To start fresh, stop Friday and delete `data/`.
