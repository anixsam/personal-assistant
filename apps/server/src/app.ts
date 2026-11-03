import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { NimMessage, RouteResult } from "@jarvis/router";
import { HandoffStore, HANDOFF_STATUSES, type Handoff } from "./handoffs.js";
import type { Delegates } from "./delegates/types.js";
import { StatsStore, defaultMcpStatus, type McpStatus } from "./stats.js";
import { speakable } from "@jarvis/voice";

/** Text-to-speech used for spoken replies (Piper in production, a fake in tests). */
export interface Speaker {
  available(): boolean;
  synthesize(text: string): Promise<Buffer>;
  readonly voiceName?: string;
}

/** The part of JarvisRouter the server needs (lets tests pass a fake). */
export interface ChatRouter {
  route(history: NimMessage[], signal?: AbortSignal): Promise<RouteResult>;
}

export interface AppDeps {
  router: ChatRouter;
  handoffs?: HandoffStore;
  /** Executors for approved handoffs. A missing target makes approval fail with 503. */
  delegates?: Delegates;
  stats?: StatsStore;
  voice?: Speaker;
  /** Reports MCP server health for the dashboard. */
  mcpStatus?: () => McpStatus[] | Promise<McpStatus[]>;
  corsOrigin?: string;
}

const MAX_MESSAGES = 100;
const MAX_CHARS = 32_000;

type ChatReply =
  | { kind: "answer"; content: string; model: string }
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
  handoffs = new HandoffStore(),
  delegates = {},
  stats = new StatsStore(),
  voice,
  mcpStatus = defaultMcpStatus,
  corsOrigin = "*",
}: AppDeps) {
  const app = new Hono();
  app.use("/api/*", cors({ origin: corsOrigin }));

  async function reply(messages: NimMessage[], signal?: AbortSignal): Promise<ChatReply> {
    const started = Date.now();
    let result: RouteResult;
    try {
      result = await router.route(messages, signal);
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
    if (result.kind === "answer") return { kind: "answer", content: result.content, model: result.model };
    const handoff = handoffs.create({ target: result.target, task: result.task, reason: result.reason });
    return { kind: "handoff", handoff, model: result.model };
  }

  app.get("/api/health", (c) => c.json({ ok: true }));

  // Spoken replies. Small cache so replaying a message doesn't re-synthesize it.
  const audioCache = new Map<string, Buffer>();
  app.get("/api/voice", (c) =>
    c.json({ enabled: !!voice?.available(), voice: voice?.voiceName ?? null, setup: voice?.available() ? null : "Run pnpm voice:setup, then restart Jarvis" }),
  );
  app.post("/api/speak", async (c) => {
    if (!voice?.available()) return c.json({ error: "Voice isn't set up. Run pnpm voice:setup, then restart Jarvis." }, 503);
    const body = (await c.req.json().catch(() => null)) as { text?: unknown } | null;
    if (typeof body?.text !== "string" || !body.text.trim()) return c.json({ error: "text is required" }, 400);
    const text = speakable(body.text);
    if (!text) return c.json({ error: "Nothing to say" }, 400);
    try {
      let wav = audioCache.get(text);
      if (!wav) {
        wav = await voice.synthesize(text);
        audioCache.set(text, wav);
        if (audioCache.size > 50) audioCache.delete(audioCache.keys().next().value as string);
      }
      return new Response(new Uint8Array(wav), { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 500);
    }
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
      return c.json(await reply(messages, c.req.raw.signal));
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
    return streamSSE(c, async (stream) => {
      try {
        const r = await reply(messages, c.req.raw.signal);
        await stream.writeSSE({ event: "route", data: JSON.stringify({ model: r.model, kind: r.kind }) });
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
    const delegate = delegates[existing.target];
    if (!delegate) return c.json({ error: `${existing.target} is not configured on this server` }, 503);
    const h = handoffs.decide(id, "approved");
    if (!h) return c.json({ error: "handoff was already decided" }, 409);
    handoffs.update(id, { status: "running" });
    void delegate
      .run(h)
      .then((r) => handoffs.update(id, { status: "completed", result: r.output, by: r.by, costUsd: r.costUsd, finishedAt: new Date().toISOString() }))
      .catch((err) => handoffs.update(id, { status: "failed", error: errorMessage(err), finishedAt: new Date().toISOString() }));
    return c.json({ handoff: handoffs.get(id) }, 202);
  });

  app.post("/api/handoffs/:id/reject", (c) => {
    const h = handoffs.decide(c.req.param("id"), "rejected");
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
