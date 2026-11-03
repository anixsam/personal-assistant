"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Composer({ busy, onSend, onStop }: { busy: boolean; onSend: (text: string) => void; onStop: () => void }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  function submit() {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText("");
  }

  return (
    <form
      className="hud-panel flex items-end gap-2 rounded-md p-2 transition-shadow focus-within:shadow-[0_0_24px_rgb(63_208_255/0.18)]"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <span className="font-hud hidden self-center pl-2 text-xs text-accent/70 sm:block">&gt;</span>
      <textarea
        ref={ref}
        rows={1}
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="What can I do for you, boss?"
        aria-label="Message Friday"
        className="scroll-thin max-h-[220px] min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] outline-none placeholder:text-muted/60"
      />
      {busy ? (
        <Button type="button" variant="outline" size="icon" onClick={onStop} aria-label="Stop">
          <Square size={14} />
        </Button>
      ) : (
        <Button type="submit" variant="primary" size="icon" disabled={!text.trim()} aria-label="Send" className="shadow-[0_0_14px_rgb(63_208_255/0.45)]">
          <ArrowUp size={18} />
        </Button>
      )}
    </form>
  );
}
