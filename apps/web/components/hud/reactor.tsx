"use client";

import { cn } from "@/lib/utils";

export type CoreState = "idle" | "thinking" | "speaking";

/**
 * The Friday core: concentric HUD rings around a glowing centre.
 * Rings spin faster while thinking; the centre pulses with the voice level while speaking.
 */
export function Reactor({ size = 64, state = "idle", level = 0, className }: { size?: number; state?: CoreState; level?: number; className?: string }) {
  const pulse = state === "speaking" ? 1 + level * 0.35 : 1;
  const glow = state === "speaking" ? 10 + level * 30 : state === "thinking" ? 14 : 8;
  const speed = state === "thinking" ? "0.35" : "1";
  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size, ["--spin" as string]: speed }}
      role="img"
      aria-label={state === "speaking" ? "Friday is speaking" : state === "thinking" ? "Friday is thinking" : "Friday"}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <radialGradient id="core-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#e9fbff" />
            <stop offset="35%" stopColor="#7fe3ff" />
            <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* outer tick ring */}
        <g className="hud-spin-slow" style={{ transformOrigin: "50px 50px" }}>
          {Array.from({ length: 48 }, (_, i) => (
            <line key={i} x1="50" y1="2" x2="50" y2={i % 4 === 0 ? 8 : 5} stroke="var(--color-accent)" strokeOpacity={i % 4 === 0 ? 0.8 : 0.35} strokeWidth="0.8" transform={`rotate(${i * 7.5} 50 50)`} />
          ))}
        </g>
        {/* segmented arc ring */}
        <g className="hud-spin-rev" style={{ transformOrigin: "50px 50px" }}>
          <circle cx="50" cy="50" r="38" fill="none" stroke="var(--color-accent)" strokeOpacity="0.55" strokeWidth="2" strokeDasharray="18 8 4 8" />
        </g>
        {/* inner ring */}
        <g className="hud-spin" style={{ transformOrigin: "50px 50px" }}>
          <circle cx="50" cy="50" r="29" fill="none" stroke="var(--color-accent)" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="2 3" />
          <path d="M50 21 A29 29 0 0 1 79 50" fill="none" stroke="var(--color-accent)" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M50 79 A29 29 0 0 1 21 50" fill="none" stroke="var(--color-accent)" strokeWidth="2.2" strokeLinecap="round" />
        </g>
        {/* core */}
        <circle cx="50" cy="50" r="20" fill="url(#core-grad)" opacity="0.55" style={{ transform: `scale(${pulse})`, transformOrigin: "50px 50px", transition: "transform 60ms linear" }} />
        <circle
          cx="50"
          cy="50"
          r="10"
          fill="#dff8ff"
          style={{ filter: `drop-shadow(0 0 ${glow / 3}px #3fd0ff) drop-shadow(0 0 ${glow}px #0ea5e9)`, transform: `scale(${pulse})`, transformOrigin: "50px 50px", transition: "transform 60ms linear" }}
        />
      </svg>
    </div>
  );
}
