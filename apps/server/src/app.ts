import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { NimMessage, RouteOptions, RouteResult } from "@jarvis/router";
import { HandoffStore, HANDOFF_STATUSES, type Handoff } from "./handoffs.js";
import type { Delegates } from "./delegates/types.js";
import { StatsStore, defaultMcpStatus, type McpStatus } from "./stats.js";
import { speakable } from "@jarvis/voice";
import { checkPin, type VoiceprintStore } from "@jarvis/voiceid";
import { checkSpeaker, registerVoiceIdRoutes } from "./voiceid.js";
import { MAX_CONVERSATION_BYTES, type FridayDb } from "./db.js";
import { ROLES, SESSION_HEADER, Sessions, UserError, UserStore, atLeast, type Identity, type Role } from "./users.js";

/** Text-to-speech used for spoken replies (Piper in production, a fake in tests). */
export interface Speaker {
  available(): boolean;
  /** `voiceId` picks another installed voice (previews); omitted means the selected one. */
  synthesize(text: string, voiceId?: string): Promise<Buffer>;
  readonly voiceName?: string;
  /** Voice picker support (VoiceLibrary). Optional so a plain single voice still works. */
  options?(): { id: string; label: string; description: string; gender: string }[];
  current?(): string;
  select?(id: string): void;
}

/** Speech-to-text for voice input (NIM ASR, then local whisper.cpp). */
export interface Listener {
  available(): boolean;
  engineNames(): string[];
  transcribe(wav: Buffer, signal?: AbortSignal): Promise<{ text: string; engine: string }>;
}

/** The part of JarvisRouter the server needs (lets tests pass a fake). */
export interface ChatRouter {
  route(history: NimMessage[], signal?: AbortSignal, opts?: RouteOptions): Promise<RouteResult>;
}

export interface AppDeps {
  router: ChatRouter;
  /** SQLite database: saves conversations, dashboard numbers and handoffs. Without it they live in memory. */
  db?: FridayDb;
  handoffs?: HandoffStore;
  /** Executors for approved handoffs. A missing target makes approval fail with 503. */
  delegates?: Delegates;
  stats?: StatsStore;
  voice?: Speaker;
  stt?: Listener;
  /** Voice ID: when enabled, spoken requests from unrecognised voices get "Access denied". */
  voiceId?: VoiceprintStore;
  /** Users and roles (in memory when omitted). */
  users?: UserStore;
  /** Reports MCP server health for the dashboard. */
  mcpStatus?: () => McpStatus[] | Promise<McpStatus[]>;
  corsOrigin?: string;
}

const MAX_MESSAGES = 100;
const MAX_CHARS = 32_000;
/** About two minutes of 16 kHz mono 16-bit audio. */
const MAX_AUDIO_BYTES = 4_000_000;

type ChatReply =
  | { kind: "answer"; content: string; model: string; tools?: { name: string; ok: boolean }[] }
  | { kind: "handoff"; handoff: Handoff; model: string };

export function parseMessages(body: unknown): NimMessage[] | string {
  const raw = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(raw) || raw.length === 0) return "messages must be a non-empty array";
  if (raw.length > MAX_MESSAGES) return `at most ${MAX_MESSAGES} messages`;
  const out: NimMessage[] = [];
  for (const m of raw) {
    const role = (m as { role?: unknown })?.role;
    const content = (m as { content?: unknown })?.content;
    if (role !== "user" && role !== "assistant") return "each message needs role 'user' or 'assistant'";
    if (typeof content !== "string" || !content.trim()) return "each message needs non-empty string content";
    if (content.length > MAX_CHARS) return `message content is limited to ${MAX_CHARS} characters`;
    out.push({ role, content });
  }
  if (out[out.length - 1].role !== "user") return "the last message must be from the user";
  return out;
}

export function createApp({
  router,
  db,
  handoffs = new HandoffStore(db),
  delegates = {},
  stats = new StatsStore(db),
  voice,
  stt,
  voiceId,
  users = new UserStore(),
  mcpStatus = defaultMcpStatus,
  corsOrigin = "*",
}: AppDeps) {
  const app = new Hono();
  app.use("/api/*", cors({ origin: corsOrigin }));

  const sessions = new Sessions();

  /**
   * Who is asking. With voice ID off, everyone is the owner (a private, local Friday). With it on, a
   * voice or PIN session names the person; typed requests without one get the keyboard role.
   */
  const whoIs = (c: { req: { header(n: string): string | undefined } }): Identity => {
    const owner = users.owner();
    if (!voiceId?.available() || !voiceId.settings().enabled) return { userId: owner.id, name: owner.name, role: owner.role, via: "open" };
    const held = sessions.get(c.req.header(SESSION_HEADER));
    const u = held ? users.get(held.userId) : undefined;
    if (u) return { userId: u.id, name: u.name, role: u.role, via: held!.via };
    const role = users.keyboardRole();
    return role === "owner" ? { userId: owner.id, name: owner.name, role, via: "keyboard" } : { userId: "keyboard", name: role === "guest" ? "Guest" : "Keyboard user", role, via: "keyboard" };
  };

  const routeOptions = (who: Identity): RouteOptions => ({
    user: { name: who.name, role: who.role },
    tools: atLeast(who.role, "member"),
    delegate: atLeast(who.role, "member"),
  });

  async function reply(messages: NimMessage[], signal: AbortSignal | undefined, who: Identity): Promise<ChatReply> {
    const started = Date.now();
    let result: RouteResult;
    try {
      result = await router.route(messages, signal, routeOptions(who));
    } catch (err) {
      stats.record({ at: started, model: "unknown", kind: "answer", latencyMs: Date.now() - started, tokens: 0, ok: false });
      throw err;
    }
    stats.record({
      at: started,
      model: result.model,
      kind: result.kind === "answer" ? "answer" : "handoff",
      latencyMs: Date.now() - started,
      tokens: result.usage?.total_tokens ?? 0,
      ok: true,
    });
    if (result.kind === "answer") return { kind: "answer", content: result.content, model: result.model, ...(result.tools && { tools: result.tools }) };
    const handoff = handoffs.create({ target: result.target, task: result.task, reason: result.reason, requestedBy: who.name });
    return { kind: "handoff", handoff, model: result.model };
  }

  app.get("/api/health", (c) => c.json({ ok: true }));

  // Spoken replies. Small cache so replaying a message doesn't re-synthesize it.
  const audioCache = new Map<string, Buffer>();
  app.get("/api/voice", (c) =>
    c.json({
      enabled: !!voice?.available(),
      voice: voice?.voiceName ?? null,
      setup: voice?.available() ? null : "Run pnpm voice:setup, then restart Friday",
      stt: { enabled: !!stt?.available(), engines: stt?.engineNames() ?? [], setup: stt?.available() ? null : "Run pnpm voice:setup --stt, then restart Friday" },
    }),
  );
  app.post("/api/speak", async (c) => {
    if (!voice?.available()) return c.json({ error: "Voice isn't set up. Run pnpm voice:setup, then restart Friday." }, 503);
    const body = (await c.req.json().catch(() => null)) as { text?: unknown; voice?: unknown } | null;
    if (typeof body?.text !== "string" || !body.text.trim()) return c.json({ error: "text is required" }, 400);
    const voiceId = typeof body.voice === "string" && body.voice ? body.voice : undefined;
    if (voiceId && !voice.options?.().some((o) => o.id === voiceId)) return c.json({ error: `Voice "${voiceId}" isn't installed` }, 404);
    const text = speakable(body.text);
    if (!text) return c.json({ error: "Nothing to say" }, 400);
    const key = `${voiceId ?? voice.current?.() ?? ""}\u0000${text}`;
    try {
      let wav = audioCache.get(key);
      if (!wav) {
        wav = voiceId ? await voice.synthesize(text, voiceId) : await voice.synthesize(text);
        audioCache.set(key, wav);
        if (audioCache.size > 50) audioCache.delete(audioCache.keys().next().value as string);
      }
      return new Response(new Uint8Array(wav), { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 500);
    }
  });

  /** Voice input: a WAV recording in, the transcript out. */
  app.post("/api/transcribe", async (c) => {
    if (!stt?.available()) return c.json({ error: "Voice input isn't set up. Run pnpm voice:setup --stt, then restart Friday." }, 503);
    const wav = Buffer.from(await c.req.arrayBuffer());
    if (wav.length < 44 || wav.subarray(0, 4).toString("ascii") !== "RIFF") return c.json({ error: "Send a WAV recording" }, 400);
    if (wav.length > MAX_AUDIO_BYTES) return c.json({ error: "Recording is too long (max about 2 minutes)" }, 413);
    const who = await checkSpeaker(voiceId, sessions, wav, c.req.header(SESSION_HEADER), users);
    if (!who.ok) return c.json(who.body, who.status);
    // A recognised voice starts (or refreshes) a session, so the message it sends counts as that person.
    const session = who.via === "voice" && who.userId ? sessions.issue(who.userId) : undefined;
    const role = who.userId ? users.get(who.userId)?.role : undefined;
    try {
      const r = await stt.transcribe(wav, c.req.raw.signal);
      return c.json({
        ...r,
        ...(who.via !== "off" && { speaker: { name: who.name ?? null, score: who.score ?? null, via: who.via, role: role ?? null } }),
        ...(session && { session }),
      });
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 502);
    }
  });

  registerVoiceIdRoutes(app, voiceId, sessions, { users, whoIs });

  // Users and roles. Admins manage members and guests; only the owner manages admins.
  const pinOk = (c: { req: { header(n: string): string | undefined } }) => {
    const hash = voiceId?.settings().pinHash;
    return !hash || sessions.valid(c.req.header(SESSION_HEADER)) || checkPin(c.req.header("x-friday-pin") ?? "", hash);
  };
  const userView = () => {
    const enrolled = new Set(voiceId?.prints().map((p) => p.userId) ?? []);
    return users.list().map((u) => ({ ...u, voice: enrolled.has(u.id) }));
  };
  app.get("/api/me", (c) => {
    const who = whoIs(c);
    return c.json({ ...who, can: { tools: atLeast(who.role, "member"), approve: atLeast(who.role, "admin"), manageUsers: atLeast(who.role, "admin") } });
  });
  app.get("/api/users", (c) => {
    if (!atLeast(whoIs(c).role, "admin")) return c.json({ error: "Only an admin can see users" }, 403);
    return c.json({ users: userView(), keyboardRole: users.keyboardRole(), roles: ROLES.filter((r) => r !== "owner") });
  });
  const userChange = async (c: Context, fn: (role: Role, body: Record<string, unknown>) => unknown) => {
    const who = whoIs(c);
    if (!atLeast(who.role, "admin")) return c.json({ error: "Only an admin can manage users" }, 403);
    if (!pinOk(c)) return c.json({ error: "Enter your PIN to manage users" }, 401);
    try {
      const out = fn(who.role, ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>);
      return c.json({ ...(out && typeof out === "object" ? { user: out } : {}), users: userView(), keyboardRole: users.keyboardRole() });
    } catch (e) {
      if (e instanceof UserError) return c.json({ error: e.message }, e.status);
      throw e;
    }
  };
  const asRole = (r: unknown) => (typeof r === "string" ? (r as Role) : undefined);
  app.post("/api/users", (c) => userChange(c, (by, b) => users.add(by, { name: String(b.name ?? ""), role: asRole(b.role) ?? "guest" })));
  app.patch("/api/users/:id", (c) =>
    userChange(c, (by, b) => {
      const id = c.req.param("id");
      const u = users.update(by, id, { ...(typeof b.name === "string" && { name: b.name }), ...(asRole(b.role) && { role: asRole(b.role) }) });
      sessions.revoke(id);
      return u;
    }),
  );
  app.delete("/api/users/:id", (c) =>
    userChange(c, (by) => {
      const id = c.req.param("id");
      users.remove(by, id);
      sessions.revoke(id);
      db?.deleteConversationsOf(id);
      if (voiceId?.prints().some((p) => p.userId === id)) voiceId.remove(id);
      return null;
    }),
  );
  app.put("/api/users-keyboard", (c) => userChange(c, (by, b) => users.setKeyboardRole(by, asRole(b.role) ?? ("" as Role))));

  /** Voice picker: installed voices and the one in use. */
  app.get("/api/voices", (c) =>
    c.json({ current: voice?.current?.() ?? voice?.voiceName ?? null, voices: voice?.options?.() ?? [], canSelect: !!voice?.select }),
  );
  app.put("/api/voices", async (c) => {
    if (!voice?.select) return c.json({ error: "Voice picking isn't available" }, 501);
    const body = (await c.req.json().catch(() => null)) as { voice?: unknown } | null;
    if (typeof body?.voice !== "string" || !body.voice) return c.json({ error: "voice is required" }, 400);
    try {
      voice.select(body.voice);
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 404);
    }
    return c.json({ current: voice.current?.() ?? body.voice });
  });

  // Saved conversations, kept per person (whoever Friday recognises, or the keyboard role).
  app.get("/api/conversations", (c) => c.json({ saved: !!db, conversations: db?.listConversations(whoIs(c).userId) ?? [] }));
  app.put("/api/conversations/:id", async (c) => {
    if (!db) return c.json({ error: "History isn't saved on this server" }, 501);
    const raw = await c.req.text();
    if (raw.length > MAX_CONVERSATION_BYTES) return c.json({ error: "Conversation is too large to save" }, 413);
    let b: { title?: unknown; messages?: unknown; updatedAt?: unknown };
    try {
      b = JSON.parse(raw) as typeof b;
    } catch {
      return c.json({ error: "Send JSON" }, 400);
    }
    const id = c.req.param("id");
    if (!/^[\w-]{1,64}$/.test(id)) return c.json({ error: "bad id" }, 400);
    if (!Array.isArray(b.messages)) return c.json({ error: "messages must be an array" }, 400);
    const updatedAt = typeof b.updatedAt === "string" && !Number.isNaN(Date.parse(b.updatedAt)) ? b.updatedAt : new Date().toISOString();
    const title = typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 120) : "New conversation";
    db.putConversation(whoIs(c).userId, { id, title, messages: b.messages, updatedAt });
    return c.json({ ok: true });
  });
  app.delete("/api/conversations/:id", (c) => {
    if (!db) return c.json({ error: "History isn't saved on this server" }, 501);
    return c.json({ ok: db.deleteConversation(whoIs(c).userId, c.req.param("id")) });
  });

  /** Dashboard numbers: usage per model, hourly traffic, handoff history, MCP health. */
  app.get("/api/stats", async (c) => {
    const hours = Math.min(Math.max(Number(c.req.query("hours")) || 24, 1), 168);
    return c.json(stats.snapshot(handoffs, await mcpStatus(), Date.now(), hours));
  });

  /** Non-streaming chat: returns NIM's answer or a pending handoff. */
  app.post("/api/chat", async (c) => {
    const messages = parseMessages(await c.req.json().catch(() => null));
    if (typeof messages === "string") return c.json({ error: messages }, 400);
    try {
      return c.json(await reply(messages, c.req.raw.signal, whoIs(c)));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 502);
    }
  });

  /**
   * Streaming chat over Server-Sent Events.
   * Events: `route` (which model is answering), `delta` (text), `handoff` (pending approval), `error`, `done`.
   */
  app.post("/api/chat/stream", async (c) => {
    const messages = parseMessages(await c.req.json().catch(() => null));
    if (typeof messages === "string") return c.json({ error: messages }, 400);
    const who = whoIs(c);
    return streamSSE(c, async (stream) => {
      try {
        const r = await reply(messages, c.req.raw.signal, who);
        await stream.writeSSE({ event: "route", data: JSON.stringify({ model: r.model, kind: r.kind, ...(r.kind === "answer" && r.tools && { tools: r.tools }) }) });
        if (r.kind === "answer") {
          for (const piece of chunk(r.content)) await stream.writeSSE({ event: "delta", data: JSON.stringify({ text: piece }) });
        } else {
          await stream.writeSSE({ event: "handoff", data: JSON.stringify(r.handoff) });
        }
      } catch (err) {
        await stream.writeSSE({ event: "error", data: JSON.stringify({ error: errorMessage(err) }) });
      }
      await stream.writeSSE({ event: "done", data: "{}" });
    });
  });

  app.get("/api/handoffs", (c) => {
    const status = c.req.query("status");
    if (status && !HANDOFF_STATUSES.includes(status as Handoff["status"])) return c.json({ error: "bad status" }, 400);
    return c.json({ handoffs: handoffs.list(status as Handoff["status"] | undefined) });
  });

  app.get("/api/handoffs/:id", (c) => {
    const h = handoffs.get(c.req.param("id"));
    return h ? c.json({ handoff: h }) : c.json({ error: "handoff not found" }, 404);
  });

  /** Approving starts the handoff in the background; poll GET /api/handoffs/:id for the result. */
  app.post("/api/handoffs/:id/approve", (c) => {
    const id = c.req.param("id");
    const existing = handoffs.get(id);
    if (!existing) return c.json({ error: "handoff not found" }, 404);
    const who = whoIs(c);
    if (!atLeast(who.role, "admin")) return c.json({ error: "Only an admin can approve handoffs" }, 403);
    const delegate = delegates[existing.target];
    if (!delegate) return c.json({ error: `${existing.target} is not configured on this server` }, 503);
    const h = handoffs.decide(id, "approved", who.name);
    if (!h) return c.json({ error: "handoff was already decided" }, 409);
    handoffs.update(id, { status: "running" });
    void delegate
      .run(h, undefined, (steps) => handoffs.update(id, { progress: steps.slice(-6) }))
      .then((r) => handoffs.update(id, { status: "completed", result: r.output, by: r.by, costUsd: r.costUsd, finishedAt: new Date().toISOString() }))
      .catch((err) => handoffs.update(id, { status: "failed", error: errorMessage(err), finishedAt: new Date().toISOString() }));
    return c.json({ handoff: handoffs.get(id) }, 202);
  });

  app.post("/api/handoffs/:id/reject", (c) => {
    const who = whoIs(c);
    if (!atLeast(who.role, "admin")) return c.json({ error: "Only an admin can reject handoffs" }, 403);
    const h = handoffs.decide(c.req.param("id"), "rejected", who.name);
    if (h === undefined) return c.json({ error: "handoff not found" }, 404);
    if (h === null) return c.json({ error: "handoff was already decided" }, 409);
    return c.json({ handoff: h });
  });

  return app;
}

/** Splits an answer into word-sized pieces so the UI can render it progressively. */
export function chunk(text: string, size = 24): string[] {
  const parts = text.match(/\S+\s*/g) ?? [];
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    if (cur.length + p.length > size && cur) {
      out.push(cur);
      cur = "";
    }
    cur += p;
  }
  if (cur) out.push(cur);
  return out;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "unknown error";
}
