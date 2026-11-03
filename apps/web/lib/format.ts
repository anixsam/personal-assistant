export const fmtInt = (n: number) => new Intl.NumberFormat("en-IN").format(n);
export const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
export const fmtMs = (n: number | null) => (n == null ? "–" : n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`);
export const fmtHour = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric" });
export function fmtAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** A "nice" axis maximum and tick step for small counts. */
export function niceScale(max: number): { top: number; step: number } {
  if (max <= 4) return { top: 4, step: 1 };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  return { top: Math.ceil(max / step) * step, step };
}
