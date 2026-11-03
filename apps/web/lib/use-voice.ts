"use client";

import { useEffect, useState } from "react";
import { voicePlayer, type VoiceState } from "./voice";

const MUTE_KEY = "jarvis.voice.muted";
const FX_KEY = "jarvis.voice.fx";

/** Voice availability (from the server), mute preference and live playback state. */
export function useVoice() {
  const [available, setAvailable] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [fx, setFxState] = useState(false);
  const [play, setPlay] = useState<{ state: VoiceState; messageId: string | null; level: number }>({ state: "idle", messageId: null, level: 0 });

  useEffect(() => {
    try {
      setMutedState(localStorage.getItem(MUTE_KEY) === "1");
      const f = localStorage.getItem(FX_KEY) === "1";
      voicePlayer.fx = f;
      setFxState(f);
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

  const setFx = (f: boolean) => {
    setFxState(f);
    voicePlayer.fx = f;
    try {
      localStorage.setItem(FX_KEY, f ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  return { available, muted, setMuted, fx, setFx, ...play };
}
