"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { load, newConversation, save, sortByRecent } from "./conversations";
import type { Conversation } from "./types";

/** Conversations kept in localStorage (SQLite persistence comes in a later roadmap task). */
export function useConversations() {
  const [list, setList] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    const stored = sortByRecent(load(typeof window === "undefined" ? undefined : window.localStorage));
    setList(stored);
    setActiveId(stored[0]?.id ?? null);
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (loaded.current) save(window.localStorage, list);
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
  }, []);

  const active = list.find((c) => c.id === activeId) ?? null;
  return { list: sortByRecent(list), active, activeId, setActiveId, update, create, remove };
}
