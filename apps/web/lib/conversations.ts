import type { Conversation, UiMessage } from "./types";
import { uid } from "./utils";

/** Pure helpers for conversation state (persisted in localStorage until the SQLite task). */

export const STORAGE_KEY = "jarvis.conversations.v1";

export function newConversation(): Conversation {
  return { id: uid(), title: "New conversation", messages: [], updatedAt: new Date().toISOString() };
}

export function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 48 ? `${clean.slice(0, 45).trimEnd()}...` : clean || "New conversation";
}

export function appendMessage(c: Conversation, m: UiMessage): Conversation {
  const first = c.messages.length === 0 && m.role === "user";
  return { ...c, title: first ? titleFrom(m.content) : c.title, messages: [...c.messages, m], updatedAt: new Date().toISOString() };
}

export function updateMessage(c: Conversation, id: string, patch: Partial<UiMessage> | ((m: UiMessage) => Partial<UiMessage>)): Conversation {
  return {
    ...c,
    messages: c.messages.map((m) => (m.id === id ? { ...m, ...(typeof patch === "function" ? patch(m) : patch) } : m)),
    updatedAt: new Date().toISOString(),
  };
}

/** Messages to send to the server: completed user/assistant turns, skipping failed or handoff-only turns. */
export function toWire(messages: UiMessage[]): { role: "user" | "assistant"; content: string }[] {
  return messages
    .filter((m) => !m.error && !m.streaming && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content }));
}

export function sortByRecent(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function load(storage: Pick<Storage, "getItem"> | undefined): Conversation[] {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Conversation[]) : [];
    // A reload interrupts any in-flight stream.
    return parsed.map((c) => ({ ...c, messages: c.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)) }));
  } catch {
    return [];
  }
}

export function save(storage: Pick<Storage, "setItem"> | undefined, list: Conversation[]): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked: keep working in memory */
  }
}
