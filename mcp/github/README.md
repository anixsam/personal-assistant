# @jarvis/mcp-github

An MCP server (stdio) that lets Friday, or Claude Code, read your GitHub and open or comment on issues.

```bash
pnpm --filter @jarvis/mcp-github build
GITHUB_TOKEN=... node mcp/github/dist/index.js
```

| Variable | Meaning |
| --- | --- |
| `GITHUB_TOKEN` | Required. A [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new). For read-only use, give it Contents, Issues, Pull requests and Metadata **read**. Add Issues **write** to create and comment on issues. |
| `JARVIS_GITHUB_REPOS` | Optional allowlist, e.g. `anixsam/personal-assistant,anixsam/other`. Any other repo is refused, and searches are limited to these. |
| `JARVIS_GITHUB_READONLY` | `1` removes the write tools. |
| `GITHUB_API_URL` | For GitHub Enterprise, e.g. `https://github.example.com/api/v3`. |

| Tool | What it does |
| --- | --- |
| `whoami` | The account the token belongs to |
| `list_repos`, `get_repo` | Your repositories, newest first |
| `list_issues`, `get_issue` | Issues, with body and comments |
| `list_pull_requests`, `get_pull_request` | PRs with changed files, and the diff if asked |
| `list_commits` | Recent commits on a branch |
| `get_file` | Read a file or list a folder at any branch or commit |
| `search_issues`, `search_code` | GitHub search |
| `create_issue`, `comment_on_issue` | Write tools (not in read-only mode) |

There are no tools to merge, push, close or delete anything. Long bodies and diffs are truncated so they don't flood the model's context.
