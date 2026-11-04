"use client";

import { CircleAlert, Loader2, Square, Volume2 } from "lucide-react";
import { Reactor } from "@/components/hud/reactor";
import type { Handoff, UiMessage } from "@/lib/types";
import { HandoffCard } from "./handoff-card";
import { Markdown } from "./markdown";

/** Small Friday mark used in lists and headers. */
export function JarvisMark({ size = 28 }: { size?: number }) {
  return <Reactor size={size} />;
}

function Typing() {
  return (
    <div className="relative flex h-6 w-40 items-center overflow-hidden" aria-label="Friday is thinking">
      <span className="font-hud text-xs text-accent/80">Processing</span>
      <span className="hud-sweep absolute inset-x-0 bottom-0 h-px bg-accent/20" />
    </div>
  );
}

export interface SpeakControls {
  available: boolean;
  activeId: string | null;
  state: "idle" | "loading" | "speaking";
  level: number;
  onSpeak: (m: UiMessage) => void;
  onStop: () => void;
}

export function Message({ message, onHandoffChange, voice }: { message: UiMessage; onHandoffChange: (h: Handoff) => void; voice: SpeakControls }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm border border-accent/25 bg-accent/[0.07] px-4 py-2.5 text-[15px] whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }
  const empty = !message.content && !message.handoff && !message.error;
  const mine = voice.activeId === message.id;
  const coreState = mine && voice.state === "speaking" ? "speaking" : message.streaming ? "thinking" : "idle";
  return (
    <div className="flex gap-3">
      <Reactor size={30} state={coreState} level={mine ? voice.level : 0} className="mt-0.5" />
      <div className="hud-panel min-w-0 flex-1 space-y-2 rounded-md px-4 py-3">
        {message.tools?.length ? (
          <div className="flex flex-wrap gap-1.5" aria-label="Tools used">
            {message.tools.map((t, i) => (
              <span
                key={i}
                className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${t.ok ? "border-accent/30 text-accent/80" : "border-bad/40 text-bad"}`}
              >
                {t.name.replace("__", " · ")}
              </span>
            ))}
          </div>
        ) : null}
        <div className="font-hud flex items-center gap-2 text-[11px] text-accent/80">
          <span>Friday</span>
          {message.model && !message.streaming && <span className="truncate text-muted/70 normal-case tracking-normal">· {message.model}</span>}
          {voice.available && message.content && !message.streaming && (
            <button
              className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted hover:bg-accent/10 hover:text-accent"
              onClick={() => (mine ? voice.onStop() : voice.onSpeak(message))}
              aria-label={mine ? "Stop speaking" : "Read aloud"}
            >
              {mine && voice.state === "loading" ? <Loader2 size={13} className="animate-spin" /> : mine ? <Square size={12} /> : <Volume2 size={13} />}
              <span className="font-hud text-[10px]">{mine ? "Stop" : "Speak"}</span>
            </button>
          )}
        </div>
        {empty && message.streaming ? <Typing /> : message.content && <Markdown>{message.content}</Markdown>}
        {message.handoff && <HandoffCard handoff={message.handoff} onChange={onHandoffChange} />}
        {message.error && (
          <p className="flex items-start gap-1.5 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">
            <CircleAlert size={15} className="mt-0.5 shrink-0" /> {message.error}
          </p>
        )}
      </div>
    </div>
  );
}
