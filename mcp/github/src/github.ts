export type FetchLike = typeof fetch;

export class GitHubError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "GitHubError";
  }
}

export interface GitHubOptions {
  token: string;
  /** API base, e.g. https://api.github.com or a GitHub Enterprise URL ending in /api/v3. */
  apiUrl?: string;
  /** When set, only these "owner/repo" names can be touched. */
  allowedRepos?: string[];
  fetchImpl?: FetchLike;
}

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Thin GitHub REST client returning trimmed objects (keeps model context small). */
export class GitHub {
  private readonly api: string;
  private readonly allowed?: Set<string>;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly opts: GitHubOptions) {
    this.api = (opts.apiUrl || "https://api.github.com").replace(/\/+$/, "");
    this.allowed = opts.allowedRepos?.length ? new Set(opts.allowedRepos.map((r) => r.toLowerCase())) : undefined;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Validates "owner/repo" and checks the allowlist. */
  repo(name: string): string {
    if (!REPO_RE.test(name)) throw new GitHubError(`Repository must look like owner/name, got "${name}"`);
    if (this.allowed && !this.allowed.has(name.toLowerCase())) {
      throw new GitHubError(`${name} is not in JARVIS_GITHUB_REPOS, so Jarvis can't access it`);
    }
    return name;
  }

  async request<T>(method: string, path: string, body?: unknown, accept = "application/vnd.github+json"): Promise<T> {
    const res = await this.fetchImpl(`${this.api}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.opts.token}`,
        Accept: accept,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "jarvis-mcp-github",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      const hint = res.status === 401 ? " (check GITHUB_TOKEN)" : res.status === 404 ? " (not found, or the token can't see it)" : "";
      throw new GitHubError(`GitHub ${res.status}: ${data.message ?? res.statusText}${hint}`, res.status);
    }
    if (accept.includes("diff")) return (await res.text()) as T;
    return (await res.json()) as T;
  }

  async me() {
    const u = await this.request<any>("GET", "/user");
    return { login: u.login, name: u.name };
  }

  async listRepos(opts: { owner?: string; limit?: number } = {}) {
    const n = clamp(opts.limit, 30, 100);
    const path = opts.owner ? `/users/${encodeURIComponent(opts.owner)}/repos?sort=updated&per_page=${n}` : `/user/repos?sort=updated&per_page=${n}`;
    const repos = await this.request<any[]>("GET", path);
    return repos
      .filter((r) => !this.allowed || this.allowed.has(String(r.full_name).toLowerCase()))
      .map((r) => ({ name: r.full_name, private: r.private, description: r.description, default_branch: r.default_branch, updated_at: r.updated_at, open_issues: r.open_issues_count, url: r.html_url }));
  }

  async getRepo(repo: string) {
    const r = await this.request<any>("GET", `/repos/${this.repo(repo)}`);
    return { name: r.full_name, private: r.private, description: r.description, default_branch: r.default_branch, language: r.language, stars: r.stargazers_count, open_issues: r.open_issues_count, pushed_at: r.pushed_at, url: r.html_url };
  }

  async listIssues(repo: string, opts: { state?: "open" | "closed" | "all"; labels?: string; limit?: number } = {}) {
    const q = new URLSearchParams({ state: opts.state ?? "open", per_page: String(clamp(opts.limit, 20, 100)) });
    if (opts.labels) q.set("labels", opts.labels);
    const items = await this.request<any[]>("GET", `/repos/${this.repo(repo)}/issues?${q}`);
    // The issues endpoint also returns PRs; keep issues only.
    return items.filter((i) => !i.pull_request).map(issueSummary);
  }

  async getIssue(repo: string, number: number) {
    const r = this.repo(repo);
    const [issue, comments] = await Promise.all([
      this.request<any>("GET", `/repos/${r}/issues/${number}`),
      this.request<any[]>("GET", `/repos/${r}/issues/${number}/comments?per_page=30`),
    ]);
    return { ...issueSummary(issue), body: truncate(issue.body), comments: comments.map((c) => ({ author: c.user?.login, created_at: c.created_at, body: truncate(c.body, 2000) })) };
  }

  async createIssue(repo: string, input: { title: string; body?: string; labels?: string[] }) {
    const i = await this.request<any>("POST", `/repos/${this.repo(repo)}/issues`, input);
    return issueSummary(i);
  }

  async comment(repo: string, number: number, body: string) {
    const c = await this.request<any>("POST", `/repos/${this.repo(repo)}/issues/${number}/comments`, { body });
    return { url: c.html_url, created_at: c.created_at };
  }

  async listPulls(repo: string, opts: { state?: "open" | "closed" | "all"; limit?: number } = {}) {
    const q = new URLSearchParams({ state: opts.state ?? "open", per_page: String(clamp(opts.limit, 20, 100)) });
    const prs = await this.request<any[]>("GET", `/repos/${this.repo(repo)}/pulls?${q}`);
    return prs.map(prSummary);
  }

  async getPull(repo: string, number: number, opts: { diff?: boolean } = {}) {
    const r = this.repo(repo);
    const [pr, files] = await Promise.all([
      this.request<any>("GET", `/repos/${r}/pulls/${number}`),
      this.request<any[]>("GET", `/repos/${r}/pulls/${number}/files?per_page=100`),
    ]);
    const out: Record<string, unknown> = {
      ...prSummary(pr),
      body: truncate(pr.body),
      mergeable: pr.mergeable,
      additions: pr.additions,
      deletions: pr.deletions,
      files: files.map((f) => ({ file: f.filename, status: f.status, additions: f.additions, deletions: f.deletions })),
    };
    if (opts.diff) out.diff = truncate(await this.request<string>("GET", `/repos/${r}/pulls/${number}`, undefined, "application/vnd.github.diff"), 60_000);
    return out;
  }

  async listCommits(repo: string, opts: { branch?: string; limit?: number } = {}) {
    const q = new URLSearchParams({ per_page: String(clamp(opts.limit, 20, 100)) });
    if (opts.branch) q.set("sha", opts.branch);
    const commits = await this.request<any[]>("GET", `/repos/${this.repo(repo)}/commits?${q}`);
    return commits.map((c) => ({ sha: String(c.sha).slice(0, 7), message: String(c.commit?.message ?? "").split("\n")[0], author: c.commit?.author?.name, date: c.commit?.author?.date, url: c.html_url }));
  }

  async getFile(repo: string, path: string, ref?: string) {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const clean = path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
    const f = await this.request<any>("GET", `/repos/${this.repo(repo)}/contents/${clean}${q}`);
    if (Array.isArray(f)) return { type: "directory", entries: f.map((e) => ({ name: e.name, type: e.type, size: e.size })) };
    if (f.type !== "file") return { type: f.type, path: f.path };
    const text = Buffer.from(f.content ?? "", "base64").toString("utf8");
    if (text.slice(0, 8000).includes("\0")) return { type: "file", path: f.path, size: f.size, binary: true };
    return { type: "file", path: f.path, size: f.size, content: truncate(text, 100_000) };
  }

  async searchIssues(query: string, limit?: number) {
    const scoped = this.allowed ? `${query} ${[...this.allowed].map((r) => `repo:${r}`).join(" ")}` : query;
    const r = await this.request<any>("GET", `/search/issues?q=${encodeURIComponent(scoped)}&per_page=${clamp(limit, 20, 50)}`);
    return { total: r.total_count, items: r.items.map((i: any) => ({ ...issueSummary(i), kind: i.pull_request ? "pr" : "issue", repo: String(i.repository_url).split("/repos/")[1] })) };
  }

  async searchCode(query: string, limit?: number) {
    const scoped = this.allowed ? `${query} ${[...this.allowed].map((r) => `repo:${r}`).join(" ")}` : query;
    const r = await this.request<any>("GET", `/search/code?q=${encodeURIComponent(scoped)}&per_page=${clamp(limit, 20, 50)}`);
    return { total: r.total_count, items: r.items.map((i: any) => ({ repo: i.repository?.full_name, path: i.path, url: i.html_url })) };
  }
}

function clamp(v: number | undefined, def: number, max: number) {
  return Math.min(Math.max(Math.trunc(v ?? def), 1), max);
}

function truncate(s: string | null | undefined, max = 8000) {
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max)}\n\n[truncated, ${s.length - max} more characters]` : s;
}

function issueSummary(i: any) {
  return { number: i.number, title: i.title, state: i.state, author: i.user?.login, labels: (i.labels ?? []).map((l: any) => (typeof l === "string" ? l : l.name)), comments: i.comments, created_at: i.created_at, updated_at: i.updated_at, url: i.html_url };
}

function prSummary(p: any) {
  return { number: p.number, title: p.title, state: p.merged_at ? "merged" : p.state, draft: p.draft, author: p.user?.login, head: p.head?.ref, base: p.base?.ref, updated_at: p.updated_at, url: p.html_url };
}
