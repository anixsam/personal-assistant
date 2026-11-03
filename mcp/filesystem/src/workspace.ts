import { promises as fs } from "node:fs";
import path from "node:path";

export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export interface WorkspaceOptions {
  /** Folder every path is resolved against; nothing outside it is reachable. */
  root: string;
  /** When true, write_file, edit_file and create_directory are refused. */
  readOnly?: boolean;
  /** Largest file read_file returns, in bytes. */
  maxReadBytes?: number;
}

export interface Entry {
  path: string;
  type: "file" | "directory" | "symlink" | "other";
  size?: number;
}

const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", ".venv", "__pycache__"]);
/** Secret files are never readable or writable, so keys can't leak into model context. */
const SECRET = /(^|\/)(\.env(\..*)?|.*\.pem|.*\.key|id_rsa.*|id_ed25519.*)$/;

/** Filesystem access locked to one folder, with symlink-escape and secret-file protection. */
export class Workspace {
  readonly root: string;
  readonly readOnly: boolean;
  private readonly maxReadBytes: number;
  private realRoot?: string;

  constructor(opts: WorkspaceOptions) {
    this.root = path.resolve(opts.root);
    this.readOnly = opts.readOnly ?? false;
    this.maxReadBytes = opts.maxReadBytes ?? 1_000_000;
  }

  private async rootReal(): Promise<string> {
    this.realRoot ??= await fs.realpath(this.root);
    return this.realRoot;
  }

  /** Workspace-relative display path. */
  rel(abs: string): string {
    return path.relative(this.root, abs).split(path.sep).join("/") || ".";
  }

  /** Resolves a user path inside the workspace or throws. Follows symlinks to make sure they stay inside too. */
  async resolve(p: string, { write = false } = {}): Promise<string> {
    if (typeof p !== "string" || p.includes("\0")) throw new WorkspaceError("Invalid path");
    const abs = path.resolve(this.root, p.replace(/^[/\\]+/, ""));
    const inside = (child: string, parent: string) => child === parent || child.startsWith(parent + path.sep);
    if (!inside(abs, this.root)) throw new WorkspaceError(`Path is outside the workspace: ${p}`);
    const rel = this.rel(abs);
    if (SECRET.test(rel)) throw new WorkspaceError(`Access to secret files is blocked: ${rel}`);
    if (write && (rel === ".git" || rel.startsWith(".git/"))) throw new WorkspaceError("Writing inside .git is blocked");

    // Check the real location of the deepest existing ancestor (catches symlinks pointing outside).
    let probe = abs;
    for (;;) {
      try {
        const real = await fs.realpath(probe);
        if (!inside(real, await this.rootReal())) throw new WorkspaceError(`Path leaves the workspace through a symlink: ${p}`);
        break;
      } catch (e) {
        if (e instanceof WorkspaceError) throw e;
        const parent = path.dirname(probe);
        if (parent === probe) break;
        probe = parent;
      }
    }
    return abs;
  }

  private assertWritable() {
    if (this.readOnly) throw new WorkspaceError("The workspace is read-only");
  }

  async list(p = ".", { recursive = false, maxEntries = 500 } = {}): Promise<{ entries: Entry[]; truncated: boolean }> {
    const start = await this.resolve(p);
    const entries: Entry[] = [];
    let truncated = false;
    const walk = async (dir: string, depth: number): Promise<void> => {
      const items = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
      for (const it of items) {
        if (entries.length >= maxEntries) {
          truncated = true;
          return;
        }
        const abs = path.join(dir, it.name);
        const rel = this.rel(abs);
        if (SECRET.test(rel)) continue;
        const type: Entry["type"] = it.isDirectory() ? "directory" : it.isFile() ? "file" : it.isSymbolicLink() ? "symlink" : "other";
        const e: Entry = { path: rel, type };
        if (type === "file") e.size = (await fs.stat(abs)).size;
        entries.push(e);
        if (recursive && type === "directory" && !SKIP_DIRS.has(it.name) && depth < 8) await walk(abs, depth + 1);
      }
    };
    const st = await fs.stat(start).catch(() => null);
    if (!st) throw new WorkspaceError(`Not found: ${p}`);
    if (!st.isDirectory()) throw new WorkspaceError(`Not a directory: ${p}`);
    await walk(start, 0);
    return { entries, truncated };
  }

  async read(p: string, { offset = 1, limit }: { offset?: number; limit?: number } = {}): Promise<{ path: string; content: string; totalLines: number; truncated: boolean }> {
    const abs = await this.resolve(p);
    const st = await fs.stat(abs).catch(() => null);
    if (!st) throw new WorkspaceError(`Not found: ${p}`);
    if (!st.isFile()) throw new WorkspaceError(`Not a file: ${p}`);
    if (st.size > this.maxReadBytes) throw new WorkspaceError(`File is too large to read (${st.size} bytes, limit ${this.maxReadBytes})`);
    const buf = await fs.readFile(abs);
    if (buf.subarray(0, 8000).includes(0)) throw new WorkspaceError(`Binary file, not shown: ${p}`);
    const lines = buf.toString("utf8").split("\n");
    const from = Math.max(1, offset);
    const to = limit ? Math.min(lines.length, from - 1 + limit) : lines.length;
    return { path: this.rel(abs), content: lines.slice(from - 1, to).join("\n"), totalLines: lines.length, truncated: to < lines.length || from > 1 };
  }

  async info(p: string): Promise<{ path: string; type: Entry["type"]; size: number; modified: string }> {
    const abs = await this.resolve(p);
    const st = await fs.lstat(abs).catch(() => null);
    if (!st) throw new WorkspaceError(`Not found: ${p}`);
    const type: Entry["type"] = st.isDirectory() ? "directory" : st.isFile() ? "file" : st.isSymbolicLink() ? "symlink" : "other";
    return { path: this.rel(abs), type, size: st.size, modified: st.mtime.toISOString() };
  }

  /** Finds files whose name contains `query` (mode "name") or whose text contains it (mode "content"). Case-insensitive. */
  async search(query: string, { path: p = ".", mode = "name", maxResults = 100 }: { path?: string; mode?: "name" | "content"; maxResults?: number } = {}) {
    if (!query.trim()) throw new WorkspaceError("Query must not be empty");
    const q = query.toLowerCase();
    const start = await this.resolve(p);
    const results: { path: string; line?: number; text?: string }[] = [];
    const walk = async (dir: string, depth: number): Promise<void> => {
      for (const it of await fs.readdir(dir, { withFileTypes: true })) {
        if (results.length >= maxResults) return;
        const abs = path.join(dir, it.name);
        const rel = this.rel(abs);
        if (SECRET.test(rel)) continue;
        if (it.isDirectory()) {
          if (mode === "name" && it.name.toLowerCase().includes(q)) results.push({ path: rel + "/" });
          if (!SKIP_DIRS.has(it.name) && depth < 12) await walk(abs, depth + 1);
        } else if (it.isFile()) {
          if (mode === "name") {
            if (it.name.toLowerCase().includes(q)) results.push({ path: rel });
            continue;
          }
          const st = await fs.stat(abs);
          if (st.size > this.maxReadBytes) continue;
          const buf = await fs.readFile(abs);
          if (buf.subarray(0, 8000).includes(0)) continue;
          const lines = buf.toString("utf8").split("\n");
          for (let i = 0; i < lines.length && results.length < maxResults; i++) {
            if (lines[i].toLowerCase().includes(q)) results.push({ path: rel, line: i + 1, text: lines[i].trim().slice(0, 200) });
          }
        }
      }
    };
    await walk(start, 0);
    return { results, truncated: results.length >= maxResults };
  }

  async write(p: string, content: string, { overwrite = true } = {}): Promise<{ path: string; bytes: number; created: boolean }> {
    this.assertWritable();
    const abs = await this.resolve(p, { write: true });
    const exists = await fs.stat(abs).then((s) => {
      if (s.isDirectory()) throw new WorkspaceError(`Is a directory: ${p}`);
      return true;
    }, () => false);
    if (exists && !overwrite) throw new WorkspaceError(`File already exists: ${p}`);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
    return { path: this.rel(abs), bytes: Buffer.byteLength(content), created: !exists };
  }

  /** Replaces exactly one occurrence of `oldText` with `newText`. */
  async edit(p: string, oldText: string, newText: string): Promise<{ path: string; line: number }> {
    this.assertWritable();
    if (!oldText) throw new WorkspaceError("old_text must not be empty");
    const abs = await this.resolve(p, { write: true });
    const text = await fs.readFile(abs, "utf8").catch(() => {
      throw new WorkspaceError(`Not found: ${p}`);
    });
    const first = text.indexOf(oldText);
    if (first < 0) throw new WorkspaceError("old_text was not found in the file");
    if (text.indexOf(oldText, first + 1) >= 0) throw new WorkspaceError("old_text appears more than once; include more surrounding text");
    await fs.writeFile(abs, text.slice(0, first) + newText + text.slice(first + oldText.length), "utf8");
    return { path: this.rel(abs), line: text.slice(0, first).split("\n").length };
  }

  async mkdir(p: string): Promise<{ path: string }> {
    this.assertWritable();
    const abs = await this.resolve(p, { write: true });
    await fs.mkdir(abs, { recursive: true });
    return { path: this.rel(abs) };
  }
}
