import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GitHub } from "./github.js";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

async function run(fn: () => Promise<unknown>): Promise<Result> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await fn(), null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
  }
}

const repo = z.string().describe('Repository as "owner/name"');
const state = z.enum(["open", "closed", "all"]).default("open");
const limit = z.number().int().min(1).max(100).optional();
const read = { readOnlyHint: true, openWorldHint: true } as const;

export interface GitHubServerOptions {
  /** When true, create_issue and comment_on_issue are not offered. */
  readOnly?: boolean;
}

/** MCP server for GitHub. Read tools plus issue create/comment; no merge, push, close or delete. */
export function createGitHubServer(gh: GitHub, opts: GitHubServerOptions = {}): McpServer {
  const server = new McpServer({ name: "jarvis-github", version: "0.1.0" });

  server.registerTool("whoami", { title: "Who am I", description: "The GitHub account the token belongs to.", inputSchema: {}, annotations: read }, () => run(() => gh.me()));

  server.registerTool(
    "list_repos",
    { title: "List repositories", description: "Repositories the user can access (or an owner's public repos), most recently updated first.", inputSchema: { owner: z.string().optional(), limit }, annotations: read },
    ({ owner, limit }) => run(() => gh.listRepos({ owner, limit })),
  );
  server.registerTool("get_repo", { title: "Get repository", description: "Details of one repository.", inputSchema: { repo }, annotations: read }, ({ repo }) => run(() => gh.getRepo(repo)));

  server.registerTool(
    "list_issues",
    { title: "List issues", description: "Issues in a repository (pull requests excluded).", inputSchema: { repo, state, labels: z.string().optional().describe("Comma-separated labels"), limit }, annotations: read },
    ({ repo, state, labels, limit }) => run(() => gh.listIssues(repo, { state, labels, limit })),
  );
  server.registerTool(
    "get_issue",
    { title: "Get issue", description: "An issue with its body and recent comments.", inputSchema: { repo, number: z.number().int().min(1) }, annotations: read },
    ({ repo, number }) => run(() => gh.getIssue(repo, number)),
  );
  server.registerTool(
    "list_pull_requests",
    { title: "List pull requests", description: "Pull requests in a repository.", inputSchema: { repo, state, limit }, annotations: read },
    ({ repo, state, limit }) => run(() => gh.listPulls(repo, { state, limit })),
  );
  server.registerTool(
    "get_pull_request",
    {
      title: "Get pull request",
      description: "A pull request with its description and changed files; set diff=true to include the diff.",
      inputSchema: { repo, number: z.number().int().min(1), diff: z.boolean().default(false) },
      annotations: read,
    },
    ({ repo, number, diff }) => run(() => gh.getPull(repo, number, { diff })),
  );
  server.registerTool(
    "list_commits",
    { title: "List commits", description: "Recent commits on a branch (default branch if omitted).", inputSchema: { repo, branch: z.string().optional(), limit }, annotations: read },
    ({ repo, branch, limit }) => run(() => gh.listCommits(repo, { branch, limit })),
  );
  server.registerTool(
    "get_file",
    { title: "Get file", description: "Read a file (or list a folder) from a repository.", inputSchema: { repo, path: z.string().default(""), ref: z.string().optional().describe("Branch, tag or commit") }, annotations: read },
    ({ repo, path, ref }) => run(() => gh.getFile(repo, path, ref)),
  );
  server.registerTool(
    "search_issues",
    { title: "Search issues and PRs", description: "GitHub issue/PR search syntax, e.g. 'is:open label:bug author:me'.", inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(50).optional() }, annotations: read },
    ({ query, limit }) => run(() => gh.searchIssues(query, limit)),
  );
  server.registerTool(
    "search_code",
    { title: "Search code", description: "GitHub code search, e.g. 'useEffect repo:owner/name'.", inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(50).optional() }, annotations: read },
    ({ query, limit }) => run(() => gh.searchCode(query, limit)),
  );

  if (!opts.readOnly) {
    server.registerTool(
      "create_issue",
      {
        title: "Create issue",
        description: "Open a new issue. Visible to everyone who can see the repository.",
        inputSchema: { repo, title: z.string().min(1).max(256), body: z.string().optional(), labels: z.array(z.string()).optional() },
        annotations: { destructiveHint: false, openWorldHint: true },
      },
      ({ repo, title, body, labels }) => run(() => gh.createIssue(repo, { title, body, labels })),
    );
    server.registerTool(
      "comment_on_issue",
      {
        title: "Comment on issue or PR",
        description: "Add a comment to an issue or pull request. Notifies its participants.",
        inputSchema: { repo, number: z.number().int().min(1), body: z.string().min(1) },
        annotations: { destructiveHint: false, openWorldHint: true },
      },
      ({ repo, number, body }) => run(() => gh.comment(repo, number, body)),
    );
  }
  return server;
}
