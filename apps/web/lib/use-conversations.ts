"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { load, newConversation, save, sortByRecent } from "./conversations";
import { authHeaders } from "./recorder";
import type { Conversation } from "./types";

const SYNC_DELAY_MS = 800;

async function putRemote(c: Conversation) {
  await fetch(`/api/conversations/${encodeURIComponent(c.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ title: c.title, messages: c.messages, updatedAt: c.updatedAt }),
  });
}

/**
 * Conversations saved on the Friday server (SQLite, per recognised user), with localStorage as a fast
 * cache and as the fallback when the server doesn't save history. Chats that only exist in this browser
 * are uploaded the first time the server is reachable.
 * `owner` is who Friday is talking to; the list reloads when it changes.
 */
export function useConversations(owner?: string | null) {
  const [list, setList] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const loaded = useRef(false);
  const remote = useRef(false);
  /** updatedAt the server has for each conversation. */
  const synced = useRef(new Map<string, string>());
  /** Browser-only chats are merged in once; after a change of speaker, the list is that person's alone. */
  const merged = useRef(false);

  useEffect(() => {
    const stored = sortByRecent(load(typeof window === "undefined" ? undefined : window.localStorage));
    setList(stored);
    // /?c=<id> opens a specific conversation (used by the dashboard).
    const wanted = new URLSearchParams(window.location.search).get("c");
    setActiveId(stored.find((c) => c.id === wanted)?.id ?? stored[0]?.id ?? null);
    loaded.current = true;
  }, []);

  // Load the server's copy (after we know who's talking).
  useEffect(() => {
    if (owner === undefined || owner === null) return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/conversations", { headers: authHeaders() });
        if (!res.ok) return;
        const body = (await res.json()) as { saved: boolean; conversations: Conversation[] };
        if (!alive || !body.saved) return;
        remote.current = true;
        const server = body.conversations.map((c) => ({ ...c, messages: c.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)) }));
        synced.current = new Map(server.map((c) => [c.id, c.updatedAt]));
        const first = !merged.current;
        merged.current = true;
        setList((local) => {
          // First load: keep browser-only chats (the sync below uploads them), newest copy wins otherwise.
          const byId = new Map(server.map((c) => [c.id, c]));
          if (first) for (const c of local) {
            const s = byId.get(c.id);
            if (!s || c.updatedAt > s.updatedAt) byId.set(c.id, c);
          }
          const merged = sortByRecent([...byId.values()]);
          const wanted = new URLSearchParams(window.location.search).get("c");
          setActiveId((cur) => (merged.some((c) => c.id === cur) ? cur : (merged.find((c) => c.id === wanted)?.id ?? merged[0]?.id ?? null)));
          return merged;
        });
      } catch {
        /* server offline: keep the browser copy */
      }
    })();
    return () => {
      alive = false;
    };
  }, [owner]);

  // Save: browser cache right away, server shortly after (only what changed, skipping chats mid-stream).
  useEffect(() => {
    if (!loaded.current) return;
    save(window.localStorage, list);
    if (!remote.current) return;
    const t = setTimeout(() => {
      for (const c of list) {
        if (synced.current.get(c.id) === c.updatedAt || c.messages.some((m) => m.streaming)) continue;
        if (!c.messages.length) continue;
        synced.current.set(c.id, c.updatedAt);
        void putRemote(c).catch(() => synced.current.delete(c.id));
      }
    }, SYNC_DELAY_MS);
    return () => clearTimeout(t);
  }, [list]);

  const update = useCallback((id: string, fn: (c: Conversation) => Conversation) => {
    setList((prev) => prev.map((c) => (c.id === id ? fn(c) : c)));
  }, []);

  const create = useCallback((): Conversation => {
    const c = newConversation();
    setList((prev) => [c, ...prev]);
    setActiveId(c.id);
    return c;
  }, []);

  const remove = useCallback((id: string) => {
    setList((prev) => {
      const next = prev.filter((c) => c.id !== id);
      setActiveId((cur) => (cur === id ? (next[0]?.id ?? null) : cur));
      return next;
    });
    if (remote.current) {
      synced.current.delete(id);
      void fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE", headers: authHeaders() }).catch(() => undefined);
    }
  }, []);

  const active = list.find((c) => c.id === activeId) ?? null;
  return { list: sortByRecent(list), active, activeId, setActiveId, update, create, remove };
}
