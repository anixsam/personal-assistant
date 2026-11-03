"use client";

import { useEffect, useRef, useState } from "react";
import { fmtHour, niceScale } from "@/lib/format";
import type { Stats } from "@/lib/types";

// Validated (dark, on #0c121c): CVD ΔE 26.8, all checks pass.
export const SERIES = {
  nim: { label: "Answered by NIM", color: "#3987e5" },
  delegated: { label: "Handed off", color: "#d95926" },
} as const;

const H = 220;
const PAD = { top: 12, right: 8, bottom: 26, left: 32 };

export function HourlyChart({ data }: { data: Stats["hourly"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  // Measure the real width so text stays at its true size on phones and desktops.
  const boxRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [table]);
  const max = Math.max(1, ...data.map((d) => d.nim + d.delegated));
  const { top, step } = niceScale(max);
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const slot = iw / data.length;
  const bw = Math.max(4, Math.min(22, slot - 6));
  const y = (v: number) => PAD.top + ih - (v / top) * ih;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const h = hover != null ? data[hover] : null;

  return (
    <section className="min-w-0 rounded-xl border border-line bg-panel p-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-sm font-medium">Requests per hour, last 24 hours</h2>
        <div className="flex items-center gap-4 text-xs text-muted">
          {Object.values(SERIES).map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
        <button className="ml-auto text-xs text-muted underline-offset-2 hover:text-fg hover:underline" onClick={() => setTable((t) => !t)}>
          {table ? "Show chart" : "Show as table"}
        </button>
      </div>

      {table ? (
        <div className="scroll-thin max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-panel text-left text-xs text-muted">
              <tr>
                <th className="py-1.5 font-normal">Hour</th>
                <th className="py-1.5 text-right font-normal">NIM</th>
                <th className="py-1.5 text-right font-normal">Handed off</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.hour} className="border-t border-line">
                  <td className="py-1.5">{fmtHour(d.hour)}</td>
                  <td className="py-1.5 text-right tabular-nums">{d.nim}</td>
                  <td className="py-1.5 text-right tabular-nums">{d.delegated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative" ref={boxRef}>
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label="Stacked bar chart of requests per hour" onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={t === 0 ? 1 : 0.5} />
                <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="10" fill="var(--color-muted)">
                  {t}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = PAD.left + slot * i + slot / 2;
              const x = cx - bw / 2;
              const nimTop = y(d.nim);
              const total = y(d.nim + d.delegated);
              const every = W < 500 ? 6 : 3;
              const showLabel = (data.length - 1 - i) % every === 0;
              return (
                <g key={d.hour} onMouseEnter={() => setHover(i)}>
                  <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={ih} fill={hover === i ? "rgb(255 255 255 / 0.04)" : "transparent"} />
                  {d.nim > 0 && <rect x={x} y={nimTop} width={bw} height={y(0) - nimTop} rx={d.delegated ? 0 : 3} fill={SERIES.nim.color} />}
                  {d.delegated > 0 && (
                    <rect x={x} y={total} width={bw} height={Math.max(0, nimTop - total - (d.nim ? 2 : 0))} rx={3} fill={SERIES.delegated.color} />
                  )}
                  {showLabel && (
                    <text x={cx} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--color-muted)">
                      {fmtHour(d.hour)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {h && hover != null && (
            <div
              className="pointer-events-none absolute top-2 rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs shadow-lg"
              style={{ left: `clamp(0px, calc(${((PAD.left + slot * hover + slot / 2) / W) * 100}% - 70px), calc(100% - 150px))` }}
            >
              <div className="mb-1 font-medium">{fmtHour(h.hour)}</div>
              <div className="flex items-center gap-1.5 text-muted">
                <span className="h-2 w-2 rounded-sm" style={{ background: SERIES.nim.color }} /> NIM <span className="ml-auto pl-3 text-fg tabular-nums">{h.nim}</span>
              </div>
              <div className="flex items-center gap-1.5 text-muted">
                <span className="h-2 w-2 rounded-sm" style={{ background: SERIES.delegated.color }} /> Handed off{" "}
                <span className="ml-auto pl-3 text-fg tabular-nums">{h.delegated}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
