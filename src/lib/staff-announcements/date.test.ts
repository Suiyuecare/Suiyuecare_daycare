import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultTaipeiLocal, isoToTaipeiLocal, taipeiLocalToIso } from "./date";

afterEach(() => { vi.useRealTimers(); });

describe("announcement Taipei minute date conversion", () => {
  it.each([
    ["2026-09-26T00:00", "2026-09-25T16:00:00.000Z"],
    ["2026-09-26T23:59", "2026-09-26T15:59:00.000Z"],
    ["2024-02-29T08:00", "2024-02-29T00:00:00.000Z"],
    ["2000-02-29T08:00", "2000-02-29T00:00:00.000Z"],
    ["2027-01-01T00:00", "2026-12-31T16:00:00.000Z"],
  ])("round-trips the exact Taipei minute %s", (local, iso) => {
    expect(taipeiLocalToIso(local)).toBe(iso);
    expect(isoToTaipeiLocal(iso)).toBe(local);
  });

  it.each([
    "2026-02-29T08:00", "1900-02-29T08:00", "2024-02-31T08:00",
    "2026-04-31T08:00", "2026-13-01T08:00", "2026-00-01T08:00",
    "2026-09-00T08:00", "2026-09-26T24:00", "2026-09-26T23:60",
    "2026-09-26T08:00:00", "2026-09-26T08:00:61", "2026-09-26T08:00Z",
    "2026-09-26T08:00+08:00", "2026-9-26T8:00", "2026-09-26 08:00",
    " 2026-09-26T08:00", "2026-09-26T08:00 ", "", "not-a-date",
  ])("rejects invalid or non-minute local input %s", (value) => {
    expect(() => taipeiLocalToIso(value)).toThrow("INVALID_LOCAL_DATETIME");
  });

  it("converts explicit offsets without a browser-local timezone or ICU separator", () => {
    expect(isoToTaipeiLocal("2026-09-25T20:30:47+00:00")).toBe("2026-09-26T04:30");
    expect(isoToTaipeiLocal("2026-09-26T04:30:47+08:00")).toBe("2026-09-26T04:30");
    expect(isoToTaipeiLocal("2026-09-26T04:30+08:00")).toBe("2026-09-26T04:30");
    expect(isoToTaipeiLocal("2026-09-25T16:30:47-04:00")).toBe("2026-09-26T04:30");
  });

  it.each([
    "2026-02-31T08:00:00Z", "2026-09-26T24:00:00Z", "2026-09-26T08:00:61Z",
    "2026-09-26T08:00:00", "2026-09-26", "2026/09/26 08:00", "", "not-a-date",
  ])("rejects invalid or timezone-ambiguous source timestamp %s", (value) => {
    expect(() => isoToTaipeiLocal(value)).toThrow("INVALID_TIMESTAMP");
  });

  it("uses the injected clock for a deterministic default and keeps only its minute", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    expect(defaultTaipeiLocal(new Date("2026-09-25T16:00:59.999Z"))).toBe("2026-09-26T00:00");
    expect(defaultTaipeiLocal()).toBe("2030-01-01T08:00");
  });
});
