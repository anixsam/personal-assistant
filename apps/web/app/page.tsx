"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AudioLines, Menu, Sparkles, UserRound, Volume2, VolumeX } from "lucide-react";
import { Composer } from "@/components/chat/composer";
import { MicRecorder } from "@/lib/recorder";
import { AccessDenied } from "@/components/chat/access-denied";
import { Message, type SpeakControls } from "@/components/chat/message";
import { Sidebar } from "@/components/chat/sidebar";
import { HudClock, greeting } from "@/components/hud/clock";
import { Reactor, type CoreState } from "@/components/hud/reactor";
import { Button } from "@/components/ui/button";
import { getMe, health, streamChat, type Me } from "@/lib/api";
import { appendMessage, toWire, updateMessage } from "@/lib/conversations";
import type { Handoff, UiMessage } from "@/lib/types";
import { useConversations } from "@/lib/use-conversations";
import { useVoice } from "@/lib/use-voice";
import { uid } from "@/lib/utils";
import { voicePlayer } from "@/lib/voice";

const SUGGESTIONS = [
  "What's on my plate today?",
  "Summarise the latest in AI in three bullets",
  "Write a Python script that renames photos by date",
  "Fix the failing tests in my repo",
];

const HANDOFF_LINE = {
  claude: "This one needs a bit more brainpower, boss. Want me to bring in Claude?",
  "claude-code": "That's a job for the coding agent. Shall I hand it to Claude Code?",
} as const;

export default function ChatPage() {
  const { list, active, activeId, setActiveId, update, create, remove } = useConversations();
  const voice = useVoice();
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [denied, setDenied] = useState<{ pinAvailable: boolean } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [hello, setHello] = useState("Good evening, boss.");

  useEffect(() => setHello(greeting()), []);

  // Who Friday thinks it's talking to (voice session, PIN unlock, or the keyboard role).
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    const refresh = async () => setMe(await getMe());
    void refresh();
    const t = setInterval(refresh, 15000);
    window.addEventListener("friday:identity", refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener("friday:identity", refresh);
    };
  }, []);

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

  const speak = useCallback((text: string, id: string | null) => {
    setVoiceError(null);
    voicePlayer.speak(text, id).catch((e) => setVoiceError(e instanceof Error ? e.message : "Voice failed"));
  }, []);

  async function send(text: string) {
    voicePlayer.stop();
    const convo = active ?? create();
    const user: UiMessage = { id: uid(), role: "user", content: text, createdAt: new Date().toISOString() };
    const reply: UiMessage = { id: uid(), role: "assistant", content: "", createdAt: new Date().toISOString(), streaming: true };
    const history = toWire([...convo.messages, user]);
    update(convo.id, (c) => appendMessage(appendMessage(c, user), reply));
    if (!active) setActiveId(convo.id);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    const patch = (p: Partial<UiMessage> | ((m: UiMessage) => Partial<UiMessage>)) => update(convo.id, (c) => updateMessage(c, reply.id, p));
    let answer = "";
    let handoff: Handoff | null = null;
    try {
      await streamChat(
        history,
        {
          onRoute: ({ model, tools }) => patch({ model, ...(tools && { tools }) }),
          onDelta: (t) => {
            answer += t;
            patch((m) => ({ content: m.content + t }));
          },
          onHandoff: (h) => {
            handoff = h;
            patch({ handoff: h });
          },
          onError: (error) => patch({ error }),
        },
        ctrl.signal,
      );
    } catch (e) {
      if (!ctrl.signal.aborted) patch({ error: e instanceof Error ? e.message : "Could not reach Friday" });
    } finally {
      patch((m) => ({ streaming: false, content: m.content || (ctrl.signal.aborted && !m.handoff ? "_Stopped._" : m.content) }));
      setBusy(false);
      abortRef.current = null;
    }
    if (voice.available && !voice.muted && !ctrl.signal.aborted) {
      const h = handoff as Handoff | null;
      if (answer.trim()) speak(answer, reply.id);
      else if (h) speak(HANDOFF_LINE[h.target], reply.id);
    }
  }

  const onHandoffChange = useCallback(
    (h: Handoff) => {
      if (!activeId) return;
      update(activeId, (c) => ({ ...c, messages: c.messages.map((m) => (m.handoff?.id === h.id ? { ...m, handoff: h } : m)) }));
    },
    [activeId, update],
  );

  const controls: SpeakControls = {
    available: voice.available,
    activeId: voice.messageId,
    state: voice.state,
    level: voice.level,
    onSpeak: (m) => speak(m.content, m.id),
    onStop: () => voicePlayer.stop(),
  };
  const coreState: CoreState = voice.state === "speaking" ? "speaking" : busy || voice.state === "loading" ? "thinking" : "idle";

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
        <header className="flex h-14 items-center gap-3 border-b border-accent/15 bg-bg/60 px-3 backdrop-blur md:px-6">
          <Button size="icon" className="md:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </Button>
          <Reactor size={30} state={coreState} level={voice.level} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-medium">{active?.title ?? "New conversation"}</h1>
            <div className="font-hud text-[10px] text-muted">
              {coreState === "speaking" ? "Speaking" : coreState === "thinking" ? "Processing" : online === false ? "Server offline" : "Standing by"}
            </div>
          </div>
          <HudClock />
          {me && me.via !== "open" && (
            <Link
              href="/dashboard#users"
              title={`Friday is talking to ${me.name} (${me.role}${me.via === "keyboard" ? ", typed" : me.via === "pin" ? ", PIN" : ", by voice"})`}
              className="hidden h-8 items-center gap-1.5 rounded-md border border-accent/30 px-2.5 text-muted hover:text-fg sm:inline-flex"
            >
              <UserRound size={15} className={me.via === "voice" ? "text-accent" : undefined} />
              <span className="font-hud text-[11px]">
                {me.name} · {me.role}
              </span>
            </Link>
          )}
          <Link
            href="/dashboard#voice"
            title="Pick Friday's voice"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-accent/30 px-2.5 text-muted hover:text-fg"
          >
            <AudioLines size={15} />
            <span className="font-hud hidden text-[11px] sm:inline">Voices</span>
          </Link>
          <Button
            variant="outline"
            size="sm"
            disabled={!voice.available || voice.muted}
            onClick={() => voice.setFx(!voice.fx)}
            aria-pressed={voice.fx}
            title="Studio effect: light reverb and shimmer on the voice"
            className={voice.fx ? "border-accent/60 bg-accent/10" : "border-accent/30"}
          >
            <Sparkles size={15} className={voice.fx ? "text-accent" : undefined} />
            <span className="font-hud hidden text-[11px] sm:inline">{voice.fx ? "FX on" : "FX off"}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!voice.available}
            onClick={() => voice.setMuted(!voice.muted)}
            title={voice.available ? undefined : "Run pnpm voice:setup to enable voice"}
            aria-label={voice.muted ? "Unmute voice" : "Mute voice"}
            className="border-accent/30"
          >
            {voice.available && !voice.muted ? <Volume2 size={15} className="text-accent" /> : <VolumeX size={15} />}
            <span className="font-hud hidden text-[11px] sm:inline">{!voice.available ? "Voice off" : voice.muted ? "Muted" : "Voice on"}</span>
          </Button>
        </header>

        <div className="scroll-thin flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
            {!active || active.messages.length === 0 ? (
              <div className="flex min-h-[62vh] flex-col items-center justify-center text-center">
                <Reactor size={180} state={coreState} level={voice.level} />
                <h2 className="mt-8 text-3xl font-semibold tracking-tight">{hello}</h2>
                <p className="font-hud mt-2 text-xs text-accent/70">All systems online</p>
                <p className="mt-3 max-w-md text-sm text-muted">
                  I answer with NVIDIA NIM. For heavier work I&apos;ll suggest handing off to Claude or Claude Code, and I&apos;ll wait for your approval first.
                </p>
                <div className="mt-8 grid w-full max-w-xl gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      disabled={busy}
                      className="hud-panel rounded-md px-4 py-3 text-left text-sm text-muted transition-colors hover:border-accent/50 hover:text-fg"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {active.messages.map((m) => (
                  <Message key={m.id} message={m} onHandoffChange={onHandoffChange} voice={controls} />
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="mx-auto w-full max-w-3xl px-4 pb-4 md:px-6">
          {denied && <AccessDenied pinAvailable={denied.pinAvailable} onClose={() => setDenied(null)} />}
          {voiceError && <p className="mb-2 text-center text-xs text-warn">{voiceError}</p>}
          <Composer
            busy={busy}
            onSend={send}
            onStop={() => abortRef.current?.abort()}
            mic={
              voice.canListen && MicRecorder.supported()
                ? {
                    onError: setVoiceError,
                    onDenied: (pinAvailable) => {
                      setDenied({ pinAvailable });
                      if (voice.available && !voice.muted) voicePlayer.speak("Access denied.").catch(() => undefined);
                    },
                  }
                : undefined
            }
          />
          <p className="font-hud mt-2 text-center text-[10px] text-muted/60">Enter to send · Shift+Enter for a new line</p>
        </div>
      </main>
    </div>
  );
}
