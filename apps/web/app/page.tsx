"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Menu } from "lucide-react";
import { Composer } from "@/components/chat/composer";
import { JarvisMark, Message } from "@/components/chat/message";
import { Sidebar } from "@/components/chat/sidebar";
import { Button } from "@/components/ui/button";
import { health, streamChat } from "@/lib/api";
import { appendMessage, toWire, updateMessage } from "@/lib/conversations";
import type { Handoff, UiMessage } from "@/lib/types";
import { useConversations } from "@/lib/use-conversations";
import { uid } from "@/lib/utils";

const SUGGESTIONS = [
  "What's on my plate today?",
  "Summarise the latest in AI in three bullets",
  "Write a Python script that renames photos by date",
  "Fix the failing tests in my repo",
];

export default function ChatPage() {
  const { list, active, activeId, setActiveId, update, create, remove } = useConversations();
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const check = async () => alive && setOnline(await health());
    void check();
    const t = setInterval(check, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const messageCount = active?.messages.length ?? 0;
  const lastContent = active?.messages.at(-1)?.content.length ?? 0;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messageCount, lastContent, activeId]);

  async function send(text: string) {
    const convo = active ?? create();
    const user: UiMessage = { id: uid(), role: "user", content: text, createdAt: new Date().toISOString() };
    const reply: UiMessage = { id: uid(), role: "assistant", content: "", createdAt: new Date().toISOString(), streaming: true };
    const history = toWire([...convo.messages, user]);
    update(convo.id, (c) => appendMessage(appendMessage(c, user), reply));
    // `create()` state may not be flushed yet; make sure the new conversation exists.
    if (!active) setActiveId(convo.id);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    const patch = (p: Partial<UiMessage> | ((m: UiMessage) => Partial<UiMessage>)) => update(convo.id, (c) => updateMessage(c, reply.id, p));
    try {
      await streamChat(
        history,
        {
          onRoute: ({ model }) => patch({ model }),
          onDelta: (t) => patch((m) => ({ content: m.content + t })),
          onHandoff: (handoff) => patch({ handoff }),
          onError: (error) => patch({ error }),
        },
        ctrl.signal,
      );
    } catch (e) {
      if (!ctrl.signal.aborted) patch({ error: e instanceof Error ? e.message : "Could not reach Jarvis" });
    } finally {
      patch((m) => ({ streaming: false, content: m.content || (ctrl.signal.aborted && !m.handoff ? "_Stopped._" : m.content) }));
      setBusy(false);
      abortRef.current = null;
    }
  }

  const onHandoffChange = useCallback(
    (h: Handoff) => {
      if (!activeId) return;
      update(activeId, (c) => ({ ...c, messages: c.messages.map((m) => (m.handoff?.id === h.id ? { ...m, handoff: h } : m)) }));
    },
    [activeId, update],
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar
        conversations={list}
        activeId={activeId}
        online={online}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onNew={() => {
          create();
          setMenuOpen(false);
        }}
        onSelect={(id) => {
          setActiveId(id);
          setMenuOpen(false);
        }}
        onDelete={remove}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b border-line px-3 md:px-6">
          <Button size="icon" className="md:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </Button>
          <h1 className="truncate text-sm font-medium">{active?.title ?? "New conversation"}</h1>
        </header>

        <div className="scroll-thin flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
            {!active || active.messages.length === 0 ? (
              <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
                <JarvisMark size={64} />
                <h2 className="mt-6 text-2xl font-semibold">Good to see you.</h2>
                <p className="mt-2 max-w-md text-sm text-muted">
                  I answer with NVIDIA NIM. For heavier work I&apos;ll suggest handing off to Claude or Claude Code, and I&apos;ll
                  wait for your approval first.
                </p>
                <div className="mt-8 grid w-full max-w-xl gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      disabled={busy}
                      className="rounded-xl border border-line bg-panel px-4 py-3 text-left text-sm text-muted transition-colors hover:border-accent/40 hover:text-fg"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {active.messages.map((m) => (
                  <Message key={m.id} message={m} onHandoffChange={onHandoffChange} />
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="mx-auto w-full max-w-3xl px-4 pb-4 md:px-6">
          <Composer busy={busy} onSend={send} onStop={() => abortRef.current?.abort()} />
          <p className="mt-2 text-center text-[11px] text-muted/70">Enter to send · Shift+Enter for a new line</p>
        </div>
      </main>
    </div>
  );
}
