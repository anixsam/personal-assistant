import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { NimMessage, RouteResult } from "@jarvis/router";
import { HandoffStore, type Handoff } from "./handoffs.js";

/** The part of JarvisRouter the server needs (lets tests pass a fake). */
export interface ChatRouter {
  route(history: NimMessage[], signal?: AbortSignal): Promise<RouteResult>;
}

export interface AppDeps {
  router: ChatRouter;
  handoffs?: HandoffStore;
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

export function createApp({ router, handoffs = new HandoffStore(), corsOrigin = "*" }: AppDeps) {
  const app = new Hono();
  app.use("/api/*", cors({ origin: corsOrigin }));

  async function reply(messages: NimMessage[], signal?: AbortSignal): Promise<ChatReply> {
    const result = await router.route(messages, signal);
    if (result.kind === "answer") return { kind: "answer", content: result.content, model: result.model };
    const handoff = handoffs.create({ target: result.target, task: result.task, reason: result.reason });
    return { kind: "handoff", handoff, model: result.model };
  }

  app.get("/api/health", (c) => c.json({ ok: true }));

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
    if (status && !["pending", "approved", "rejected"].includes(status)) return c.json({ error: "bad status" }, 400);
    return c.json({ handoffs: handoffs.list(status as Handoff["status"] | undefined) });
  });

  for (const [action, status] of [["approve", "approved"], ["reject", "rejected"]] as const) {
    app.post(`/api/handoffs/:id/${action}`, (c) => {
      const h = handoffs.decide(c.req.param("id"), status);
      if (h === undefined) return c.json({ error: "handoff not found" }, 404);
      if (h === null) return c.json({ error: "handoff was already decided" }, 409);
      return c.json({ handoff: h });
    });
  }

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
