import { describe, expect, it } from "vitest";
import { SseParser } from "@/lib/sse";
import { appendMessage, load, newConversation, save, titleFrom, toWire, updateMessage } from "@/lib/conversations";
import type { UiMessage } from "@/lib/types";

const msg = (p: Partial<UiMessage>): UiMessage => ({ id: Math.random().toString(), role: "user", content: "hi", createdAt: "", ...p });

describe("SseParser", () => {
  it("parses events split across chunks", () => {
    const p = new SseParser();
    expect(p.push('event: delta\ndata: {"te')).toEqual([]);
    expect(p.push('xt":"Hi"}\n\nevent: done\ndata: {}\n\n')).toEqual([
      { event: "delta", data: '{"text":"Hi"}' },
      { event: "done", data: "{}" },
    ]);
  });
  it("handles CRLF and comments", () => {
    expect(new SseParser().push(": ping\r\nevent: route\r\ndata: 1\r\n\r\n")).toEqual([{ event: "route", data: "1" }]);
  });
});

describe("conversations", () => {
  it("titles from the first user message", () => {
    const c = appendMessage(newConversation(), msg({ content: "  Plan my   week please " }));
    expect(c.title).toBe("Plan my week please");
    expect(titleFrom("x".repeat(80)).length).toBeLessThanOrEqual(48);
  });
  it("updates a message by id", () => {
    const m = msg({ role: "assistant", content: "" });
    const c = updateMessage(appendMessage(newConversation(), m), m.id, (old) => ({ content: old.content + "Hello" }));
    expect(c.messages[0].content).toBe("Hello");
  });
  it("toWire skips errors, streaming and empty turns", () => {
    const wire = toWire([msg({ content: "a" }), msg({ role: "assistant", content: "", streaming: true }), msg({ role: "assistant", content: "x", error: "boom" }), msg({ content: "b" })]);
    expect(wire).toEqual([{ role: "user", content: "a" }, { role: "user", content: "b" }]);
  });
  it("load/save round-trip and clears streaming flags", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const c = appendMessage(newConversation(), msg({ role: "assistant", content: "half", streaming: true }));
    save(storage, [c]);
    expect(load(storage)[0].messages[0].streaming).toBe(false);
    expect(load({ getItem: () => "{bad" })).toEqual([]);
  });
});
