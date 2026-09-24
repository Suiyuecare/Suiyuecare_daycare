import { describe, expect, it } from "vitest";
import { formatCareTaipeiTime } from "./date";

describe("stable care timestamps", () => {
  it("uses explicit Taipei date, 24-hour time and ordinary separators", () => {
    expect(formatCareTaipeiTime("2026-09-12T15:41:04Z")).toBe("2026/09/12 23:41:04");
    expect(formatCareTaipeiTime("2026-09-12T16:00:00Z")).toBe("2026/09/13 00:00:00");
  });
  it("does not guess an invalid timestamp", () => {
    expect(formatCareTaipeiTime("bad")).toBe("時間待確認");
  });
});
