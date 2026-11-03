import { describe, expect, it } from "vitest";
import { fmtAgo, fmtMs, niceScale } from "@/lib/format";

describe("format", () => {
  it("niceScale gives round tops", () => {
    expect(niceScale(0)).toEqual({ top: 4, step: 1 });
    expect(niceScale(7)).toEqual({ top: 8, step: 2 });
    expect(niceScale(37)).toEqual({ top: 40, step: 10 });
    expect(niceScale(130).top).toBeGreaterThanOrEqual(130);
  });
  it("fmtMs and fmtAgo", () => {
    expect(fmtMs(null)).toBe("–");
    expect(fmtMs(420)).toBe("420 ms");
    expect(fmtMs(2500)).toBe("2.5 s");
    const now = Date.parse("2026-11-03T10:00:00Z");
    expect(fmtAgo("2026-11-03T09:59:40Z", now)).toBe("just now");
    expect(fmtAgo("2026-11-03T09:30:00Z", now)).toBe("30 min ago");
    expect(fmtAgo("2026-11-03T07:00:00Z", now)).toBe("3 h ago");
  });
});
