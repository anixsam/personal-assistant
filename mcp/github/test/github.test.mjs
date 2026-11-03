import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHub } from "../dist/github.js";

function fake(routes, seen = []) {
  return async (url, init) => {
    const u = new URL(url);
    seen.push({ method: init.method, path: u.pathname + u.search, body: init.body && JSON.parse(init.body), headers: init.headers });
    const key = `${init.method} ${u.pathname}`;
    const hit = routes[key];
    if (!hit) return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    return typeof hit === "string" ? new Response(hit) : new Response(JSON.stringify(hit), { status: 200 });
  };
}

test("sends auth headers and trims issue lists (no PRs)", async () => {
  const seen = [];
  const gh = new GitHub({ token: "t0k", fetchImpl: fake({ "GET /repos/me/app/issues": [
    { number: 1, title: "Bug", state: "open", user: { login: "anix" }, labels: [{ name: "bug" }], html_url: "u1" },
    { number: 2, title: "A PR", pull_request: {}, state: "open" },
  ] }, seen) });
  const issues = await gh.listIssues("me/app");
  assert.deepEqual(issues.map((i) => [i.number, i.labels]), [[1, ["bug"]]]);
  assert.equal(seen[0].headers.Authorization, "Bearer t0k");
  assert.match(seen[0].path, /state=open/);
});

test("allowlist blocks other repos and scopes search", async () => {
  const seen = [];
  const gh = new GitHub({ token: "t", allowedRepos: ["me/app"], fetchImpl: fake({ "GET /search/issues": { total_count: 0, items: [] }, "GET /user/repos": [{ full_name: "me/app" }, { full_name: "me/secret" }] }, seen) });
  await assert.rejects(gh.getRepo("me/secret"), /not in JARVIS_GITHUB_REPOS/);
  await assert.rejects(gh.getRepo("not a repo"), /owner\/name/);
  await gh.searchIssues("is:open");
  assert.match(decodeURIComponent(seen[0].path), /is:open repo:me\/app/);
  assert.deepEqual((await gh.listRepos()).map((r) => r.name), ["me/app"]);
});

test("errors explain 401 and 404", async () => {
  const gh401 = new GitHub({ token: "bad", fetchImpl: async () => new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 }) });
  await assert.rejects(gh401.me(), /401: Bad credentials \(check GITHUB_TOKEN\)/);
  const gh = new GitHub({ token: "t", fetchImpl: fake({}) });
  await assert.rejects(gh.getRepo("me/nope"), /404.*can't see it/);
});

test("getFile decodes base64 and lists folders", async () => {
  const gh = new GitHub({ token: "t", fetchImpl: fake({
    "GET /repos/me/app/contents/README.md": { type: "file", path: "README.md", size: 7, content: Buffer.from("# Hello").toString("base64") },
    "GET /repos/me/app/contents/src": [{ name: "a.ts", type: "file", size: 3 }],
  }) });
  assert.equal((await gh.getFile("me/app", "README.md")).content, "# Hello");
  assert.deepEqual((await gh.getFile("me/app", "src")).entries, [{ name: "a.ts", type: "file", size: 3 }]);
});

test("getPull includes files and optional diff; merged state", async () => {
  const gh = new GitHub({ token: "t", fetchImpl: async (url, init) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/files")) return new Response(JSON.stringify([{ filename: "a.ts", status: "modified", additions: 2, deletions: 1 }]));
    if (init.headers.Accept.includes("diff")) return new Response("diff --git a/a.ts b/a.ts");
    return new Response(JSON.stringify({ number: 5, title: "Feat", state: "closed", merged_at: "2026-01-01", head: { ref: "f" }, base: { ref: "main" } }));
  } });
  const pr = await gh.getPull("me/app", 5, { diff: true });
  assert.equal(pr.state, "merged");
  assert.equal(pr.files[0].file, "a.ts");
  assert.match(pr.diff, /^diff --git/);
});

test("create issue and comment post the right bodies", async () => {
  const seen = [];
  const gh = new GitHub({ token: "t", fetchImpl: fake({ "POST /repos/me/app/issues": { number: 9, title: "New", html_url: "u" }, "POST /repos/me/app/issues/9/comments": { html_url: "c" } }, seen) });
  assert.equal((await gh.createIssue("me/app", { title: "New", body: "b" })).number, 9);
  assert.equal((await gh.comment("me/app", 9, "Thanks")).url, "c");
  assert.deepEqual(seen.map((s) => s.body), [{ title: "New", body: "b" }, { body: "Thanks" }]);
});
