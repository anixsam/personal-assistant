# @jarvis/mcp-claude-code

An MCP server (stdio) that hands coding tasks to [Claude Code](https://claude.com/claude-code) in headless
mode and reports progress while it works. Friday uses it for approved coding handoffs; any MCP client can use it.

```bash
pnpm --filter @jarvis/mcp-claude-code build
node mcp/claude-code/dist/index.js D:\projects\my-app      # or set CLAUDE_CODE_CWD
```

Needs the `claude` CLI installed and signed in on the same machine.

| Tool | What it does |
| --- | --- |
| `start_coding_task` | Starts a task (optionally in a subfolder) and returns its id straight away |
| `get_coding_task` | Status, elapsed time, the latest steps (files edited, commands run) and the result; `wait_seconds` waits up to 2 minutes for it to finish |
| `list_coding_tasks` | Recent tasks, newest first |
| `cancel_coding_task` | Stops a queued or running task |

Settings (environment variables):

| Variable | Default | |
| --- | --- | --- |
| `CLAUDE_CODE_CWD` | (required) | Project folder. Tasks can only work in it or its subfolders |
| `CLAUDE_CODE_BIN` | `claude` | Path to the CLI |
| `CLAUDE_CODE_PERMISSION_MODE` | `acceptEdits` | Claude Code permission mode for headless runs |
| `CLAUDE_CODE_MAX_TASKS` | `1` | Tasks run one at a time; the rest wait in a queue |

Safety:
- This server does not ask for approval itself. Friday asks you to approve every handoff before it calls
  `start_coding_task`; if you connect it to another client, that client has to do the same.
- Folders outside the project root (`../`, absolute paths, symlinks that point out) are refused.
- The task text goes to Claude Code on stdin, never through a shell.
- Each task stops after 30 minutes.
