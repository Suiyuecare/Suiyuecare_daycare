import { describe, expect, it } from "vitest";
import { isDiaryShiftTimeAligned } from "./shift-time";

describe("care diary shift and actual Taipei event time", () => {
  it("uses noon as the boundary even when the input has a UTC offset", () => {
    expect(isDiaryShiftTimeAligned("morning", "2026-10-01T11:59:59+08:00")).toBe(true);
    expect(isDiaryShiftTimeAligned("morning", "2026-10-01T04:00:00Z")).toBe(false);
    expect(isDiaryShiftTimeAligned("afternoon", "2026-10-01T12:00:00+08:00")).toBe(true);
    expect(isDiaryShiftTimeAligned("afternoon", "2026-10-01T03:59:59Z")).toBe(false);
  });

  it("allows an explicit full-day label only for a valid event time", () => {
    expect(isDiaryShiftTimeAligned("full_day", "2026-10-01T03:00:00Z")).toBe(true);
    expect(isDiaryShiftTimeAligned("full_day", "invalid")).toBe(false);
  });
});
