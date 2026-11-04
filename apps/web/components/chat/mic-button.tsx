"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic } from "lucide-react";
import { MicRecorder, transcribe } from "@/lib/recorder";
import { cn } from "@/lib/utils";

type MicState = "idle" | "listening" | "transcribing";

/**
 * Push-to-talk: hold the button (or Ctrl+Space) and speak, release to send.
 * A quick tap toggles instead: tap to start, tap again to send.
 */
export function MicButton({
  disabled,
  onTranscript,
  onError,
  onListening,
}: {
  disabled?: boolean;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
  onListening?: (on: boolean) => void;
}) {
  const [state, setState] = useState<MicState>("idle");
  const [level, setLevel] = useState(0);
  const rec = useRef<MicRecorder | null>(null);
  const pressedAt = useRef(0);
  const toggled = useRef(false);

  async function start() {
    if (state !== "idle" || disabled) return;
    try {
      rec.current = new MicRecorder();
      setState("listening");
      onListening?.(true);
      await rec.current.start(setLevel);
    } catch {
      setState("idle");
      onListening?.(false);
      onError("Microphone is blocked. Allow mic access for this page in your browser.");
    }
  }

  async function finish() {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    setLevel(0);
    onListening?.(false);
    setState("transcribing");
    try {
      const wav = await r.stop();
      if (!wav) return;
      const { text } = await transcribe(wav);
      if (text) onTranscript(text);
      else onError("I didn't catch that, boss. Try again?");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Voice input failed");
    } finally {
      setState("idle");
    }
  }

  const down = () => {
    if (state === "listening" && toggled.current) {
      toggled.current = false;
      void finish();
      return;
    }
    pressedAt.current = Date.now();
    void start();
  };
  const up = () => {
    if (state !== "listening" && !rec.current) return;
    if (Date.now() - pressedAt.current < 350) toggled.current = true; // quick tap: keep listening
    else void finish();
  };

  // Ctrl+Space (or ⌘+Space is taken by the OS, so Ctrl on every platform) as a keyboard push-to-talk.
  const keyHeld = useRef(false);
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.code === "Space" && e.ctrlKey && !keyHeld.current) {
        e.preventDefault();
        keyHeld.current = true;
        pressedAt.current = Date.now();
        void start();
      }
    };
    const ku = (e: KeyboardEvent) => {
      if (keyHeld.current && (e.code === "Space" || e.key === "Control")) {
        keyHeld.current = false;
        void finish();
      }
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    };
  });

  useEffect(() => () => rec.current?.cancel(), []);

  const listening = state === "listening";
  return (
    <button
      type="button"
      disabled={disabled || state === "transcribing"}
      onPointerDown={(e) => {
        e.preventDefault();
        down();
      }}
      onPointerUp={up}
      onPointerLeave={() => listening && !toggled.current && void finish()}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={listening ? "Listening, release to send" : "Hold to talk"}
      aria-pressed={listening}
      title="Hold to talk (or Ctrl+Space)"
      className={cn(
        "relative grid size-10 shrink-0 touch-none select-none place-items-center rounded-md border transition-colors disabled:opacity-50",
        listening ? "border-accent bg-accent/20 text-accent" : "border-accent/30 text-muted hover:text-accent",
      )}
    >
      {listening && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-md shadow-[0_0_18px_rgb(63_208_255/0.6)]"
          style={{ transform: `scale(${1 + level * 0.35})`, opacity: 0.4 + level * 0.6 }}
        />
      )}
      {state === "transcribing" ? <Loader2 size={17} className="animate-spin" /> : <Mic size={17} />}
    </button>
  );
}
