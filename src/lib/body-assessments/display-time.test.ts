import { describe, expect, it, vi } from "vitest";
import { formatBodyAssessmentTime } from "./display-time";
describe("body assessment stable Taipei display", () => {
  it("ignores varying server ICU literal spacing and uses exact ASCII date/time separators", () => {
    const native = Intl.DateTimeFormat.prototype.formatToParts;
    const changed = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockImplementation(function(this: Intl.DateTimeFormat, date) {
      return native.call(this, date).map((part) => part.type === "literal" ? { ...part, value: "\u2009server" } : part);
    });
    try {
      expect(formatBodyAssessmentTime("2026-09-26T08:23:00Z")).toBe("2026/09/26 16:23");
      expect(formatBodyAssessmentTime("2026-09-26T16:00:00Z")).toBe("2026/09/27 00:00");
      expect(formatBodyAssessmentTime("invalid")).toBe("時間尚未確認");
    } finally { changed.mockRestore(); }
  });
});
