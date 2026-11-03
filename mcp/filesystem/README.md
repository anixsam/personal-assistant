# @jarvis/mcp-filesystem

An MCP server (stdio) that gives Friday, or Claude Code, access to **one folder** and nothing else.

```bash
pnpm --filter @jarvis/mcp-filesystem build
node mcp/filesystem/dist/index.js ~/projects/my-app       # or set JARVIS_FS_ROOT
JARVIS_FS_READONLY=1 node mcp/filesystem/dist/index.js ~/notes   # read-only
```

Use it from Claude Code or any MCP client:

```json
{ "mcpServers": { "jarvis-fs": { "command": "node", "args": ["mcp/filesystem/dist/index.js", "/path/to/folder"] } } }
```

| Tool | What it does |
| --- | --- |
| `list_directory` | List a folder (optionally recursive; skips `.git`, `node_modules`, build output) |
| `read_file` | Read a text file, with optional line range |
| `search_files` | Find files by name, or lines containing some text |
| `file_info` | Type, size and modified time |
| `write_file` | Create or replace a file (not in read-only mode) |
| `edit_file` | Replace one exact snippet in a file (not in read-only mode) |
| `create_directory` | Make a folder (not in read-only mode) |

Safety:
- Every path is resolved inside the workspace; `../` and absolute paths can't leave it, and symlinks pointing outside are refused.
- Secret files (`.env*`, `*.pem`, `*.key`, SSH keys) are hidden and can't be read or written, so keys never reach a model.
- Writing inside `.git` is blocked. There is no delete tool.
- Files over 1 MB and binary files aren't returned.
