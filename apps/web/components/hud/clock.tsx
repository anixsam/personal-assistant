"use client";

import { useEffect, useState } from "react";

export function HudClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!now) return null;
  return (
    <div className="font-hud hidden text-right text-[11px] leading-tight text-muted sm:block">
      <div className="text-accent/90 tabular-nums">{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
      <div>{now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}</div>
    </div>
  );
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 5 ? "Working late, boss?" : h < 12 ? "Good morning, boss." : h < 17 ? "Good afternoon, boss." : "Good evening, boss.";
}
