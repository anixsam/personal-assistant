"use client";

import { CircleAlert } from "lucide-react";
import type { Handoff, UiMessage } from "@/lib/types";
import { HandoffCard } from "./handoff-card";
import { Markdown } from "./markdown";

export function JarvisMark({ size = 28 }: { size?: number }) {
  return (
    <div
      className="relative grid shrink-0 place-items-center rounded-full border border-accent/50 bg-panel shadow-[0_0_18px_rgb(63_208_255/0.25)]"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <div className="rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)]" style={{ width: size * 0.32, height: size * 0.32 }} />
    </div>
  );
}

function Typing() {
  return (
    <div className="flex h-6 items-center gap-1" aria-label="Jarvis is thinking">
      {[0, 150, 300].map((d) => (
        <span key={d} className="typing-dot h-1.5 w-1.5 rounded-full bg-accent" style={{ animationDelay: `${d}ms` }} />
      ))}
    </div>
  );
}

export function Message({ message, onHandoffChange }: { message: UiMessage; onHandoffChange: (h: Handoff) => void }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-panel-2 px-4 py-2.5 text-[15px] whitespace-pre-wrap border border-line">
          {message.content}
        </div>
      </div>
    );
  }
  const empty = !message.content && !message.handoff && !message.error;
  return (
    <div className="flex gap-3">
      <JarvisMark />
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        {empty && message.streaming ? <Typing /> : message.content && <Markdown>{message.content}</Markdown>}
        {message.handoff && <HandoffCard handoff={message.handoff} onChange={onHandoffChange} />}
        {message.error && (
          <p className="flex items-start gap-1.5 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">
            <CircleAlert size={15} className="mt-0.5 shrink-0" /> {message.error}
          </p>
        )}
        {message.model && !message.streaming && (
          <div className="text-[11px] tracking-wide text-muted/80 uppercase">{message.model}</div>
        )}
      </div>
    </div>
  );
}
