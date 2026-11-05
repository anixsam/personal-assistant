import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Handoff } from "./handoffs.js";
import type { RequestRecord } from "./stats.js";

/** A saved chat. `messages` is the UI's message list, stored as JSON. */
export interface StoredConversation {
  id: string;
  title: string;
  messages: unknown[];
  updatedAt: string;
}

export const MAX_CONVERSATION_BYTES = 2_000_000;
export const MAX_CONVERSATIONS_PER_USER = 500;
const DAY = 86_400_000;

/**
 * Friday's local SQLite database (data/friday.db): conversations per user, the request log behind the
 * dashboard numbers, and handoff history. Uses Node's built-in node:sqlite, so nothing native to install.
 */
export class FridayDb {
  readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 3000;
      CREATE TABLE IF NOT EXISTS conversations (
        owner TEXT NOT NULL,
        id TEXT NOT NULL,
        title TEXT NOT NULL,
        messages TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (owner, id)
      );
      CREATE INDEX IF NOT EXISTS conversations_recent ON conversations (owner, updated_at DESC);
      CREATE TABLE IF NOT EXISTS requests (
        at INTEGER NOT NULL,
        model TEXT NOT NULL,
        kind TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,
        tokens INTEGER NOT NULL,
        ok INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS requests_at ON requests (at);
      CREATE TABLE IF NOT EXISTS handoffs (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
    `);
  }

  close() {
    this.db.close();
  }

  // Request log (dashboard numbers)

  addRequest(r: RequestRecord) {
    this.db.prepare("INSERT INTO requests (at, model, kind, latency_ms, tokens, ok) VALUES (?, ?, ?, ?, ?, ?)").run(r.at, r.model, r.kind, r.latencyMs, r.tokens, r.ok ? 1 : 0);
  }

  requestsSince(at: number): RequestRecord[] {
    const rows = this.db.prepare("SELECT at, model, kind, latency_ms, tokens, ok FROM requests WHERE at >= ? ORDER BY at").all(at) as {
      at: number;
      model: string;
      kind: string;
      latency_ms: number;
      tokens: number;
      ok: number;
    }[];
    return rows.map((r) => ({ at: Number(r.at), model: r.model, kind: r.kind === "handoff" ? "handoff" : "answer", latencyMs: Number(r.latency_ms), tokens: Number(r.tokens), ok: !!r.ok }));
  }

  /** Drops request rows older than `days` (default 90). */
  pruneRequests(days = 90, now = Date.now()) {
    this.db.prepare("DELETE FROM requests WHERE at < ?").run(now - days * DAY);
  }

  // Handoffs

  saveHandoff(h: Handoff) {
    this.db.prepare("INSERT INTO handoffs (id, created_at, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data").run(h.id, h.createdAt, JSON.stringify(h));
  }

  loadHandoffs(limit = 500): Handoff[] {
    const rows = this.db.prepare("SELECT data FROM handoffs ORDER BY created_at DESC LIMIT ?").all(limit) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as Handoff).reverse();
  }

  // Conversations

  listConversations(owner: string): StoredConversation[] {
    const rows = this.db.prepare("SELECT id, title, messages, updated_at FROM conversations WHERE owner = ? ORDER BY updated_at DESC LIMIT ?").all(owner, MAX_CONVERSATIONS_PER_USER) as {
      id: string;
      title: string;
      messages: string;
      updated_at: string;
    }[];
    return rows.map((r) => ({ id: r.id, title: r.title, messages: JSON.parse(r.messages) as unknown[], updatedAt: r.updated_at }));
  }

  putConversation(owner: string, c: StoredConversation) {
    this.db
      .prepare(
        "INSERT INTO conversations (owner, id, title, messages, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner, id) DO UPDATE SET title = excluded.title, messages = excluded.messages, updated_at = excluded.updated_at",
      )
      .run(owner, c.id, c.title, JSON.stringify(c.messages), c.updatedAt);
    // Keep the newest MAX_CONVERSATIONS_PER_USER.
    this.db
      .prepare("DELETE FROM conversations WHERE owner = ? AND id NOT IN (SELECT id FROM conversations WHERE owner = ? ORDER BY updated_at DESC LIMIT ?)")
      .run(owner, owner, MAX_CONVERSATIONS_PER_USER);
  }

  deleteConversation(owner: string, id: string): boolean {
    return Number(this.db.prepare("DELETE FROM conversations WHERE owner = ? AND id = ?").run(owner, id).changes) > 0;
  }

  deleteConversationsOf(owner: string) {
    this.db.prepare("DELETE FROM conversations WHERE owner = ?").run(owner);
  }
}
