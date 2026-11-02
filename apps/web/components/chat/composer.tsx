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
      className="flex items-end gap-2 rounded-2xl border border-line bg-panel p-2 focus-within:border-accent/50 transition-colors"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
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
        placeholder="Ask Jarvis anything..."
        aria-label="Message Jarvis"
        className="scroll-thin max-h-[220px] min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] outline-none placeholder:text-muted/70"
      />
      {busy ? (
        <Button type="button" variant="outline" size="icon" onClick={onStop} aria-label="Stop">
          <Square size={14} />
        </Button>
      ) : (
        <Button type="submit" variant="primary" size="icon" disabled={!text.trim()} aria-label="Send">
          <ArrowUp size={18} />
        </Button>
      )}
    </form>
  );
}
