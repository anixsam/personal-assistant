"use client";

import { useEffect, useState } from "react";
import { voicePlayer, type VoiceState } from "./voice";

const MUTE_KEY = "jarvis.voice.muted";

/** Voice availability (from the server), mute preference and live playback state. */
export function useVoice() {
  const [available, setAvailable] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [play, setPlay] = useState<{ state: VoiceState; messageId: string | null; level: number }>({ state: "idle", messageId: null, level: 0 });

  useEffect(() => {
    try {
      setMutedState(localStorage.getItem(MUTE_KEY) === "1");
    } catch {
      /* ignore */
    }
    fetch("/api/voice")
      .then((r) => r.json())
      .then((v: { enabled?: boolean }) => setAvailable(!!v.enabled))
      .catch(() => setAvailable(false));
    return voicePlayer.subscribe(setPlay);
  }, []);

  const setMuted = (m: boolean) => {
    setMutedState(m);
    if (m) voicePlayer.stop();
    try {
      localStorage.setItem(MUTE_KEY, m ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  return { available, muted, setMuted, ...play };
}
