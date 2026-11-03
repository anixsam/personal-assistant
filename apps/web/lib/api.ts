import { SseParser } from "./sse";
import type { Handoff } from "./types";

export interface StreamHandlers {
  onRoute?: (info: { model: string; kind: "answer" | "handoff" }) => void;
  onDelta?: (text: string) => void;
  onHandoff?: (handoff: Handoff) => void;
  onError?: (message: string) => void;
}

type WireMessage = { role: "user" | "assistant"; content: string };

/** POSTs the conversation to /api/chat/stream and dispatches SSE events until `done`. */
export async function streamChat(messages: WireMessage[], handlers: StreamHandlers, signal?: AbortSignal): Promise<void> {
  const res = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error((body as { error?: string }).error || `Server responded ${res.status}`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const parser = new SseParser();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    for (const ev of parser.push(value)) {
      const data = JSON.parse(ev.data);
      if (ev.event === "route") handlers.onRoute?.(data);
      else if (ev.event === "delta") handlers.onDelta?.(data.text);
      else if (ev.event === "handoff") handlers.onHandoff?.(data);
      else if (ev.event === "error") handlers.onError?.(data.error);
      else if (ev.event === "done") return;
    }
  }
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `Server responded ${res.status}`);
  return body as T;
}

export async function decideHandoff(id: string, action: "approve" | "reject"): Promise<Handoff> {
  const res = await fetch(`/api/handoffs/${id}/${action}`, { method: "POST" });
  return (await json<{ handoff: Handoff }>(res)).handoff;
}

export async function getHandoff(id: string): Promise<Handoff> {
  return (await json<{ handoff: Handoff }>(await fetch(`/api/handoffs/${id}`))).handoff;
}

export async function health(): Promise<boolean> {
  try {
    return (await fetch("/api/health")).ok;
  } catch {
    return false;
  }
}

export async function getStats(hours = 24): Promise<import("./types").Stats> {
  return json(await fetch(`/api/stats?hours=${hours}`));
}
