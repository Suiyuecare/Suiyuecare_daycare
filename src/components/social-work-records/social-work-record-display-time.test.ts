import { afterEach, describe, expect, it, vi } from "vitest";
import { formatTimestamp } from "./social-work-records-workspace";

afterEach(() => vi.restoreAllMocks());
describe("social-work timestamp hydration", () => {
  it("uses fixed separators despite Node/Chrome ICU literal whitespace differences", () => {
    const values = ["\u2009", " ", "\u202f"];
    for (const whitespace of values) {
      const parts: Intl.DateTimeFormatPart[] = [{ type: "year", value: "2026" }, { type: "literal", value: "/" }, { type: "month", value: "09" }, { type: "literal", value: "/" }, { type: "day", value: "26" }, { type: "literal", value: whitespace }, { type: "hour", value: "22" }, { type: "literal", value: ":" }, { type: "minute", value: "49" }];
      vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockReturnValueOnce(parts);
      expect(formatTimestamp("2026-09-26T14:49:00.000Z")).toBe("2026/09/26 22:49");
      vi.restoreAllMocks();
    }
  });
  it("keeps Taipei day rollover and h23 midnight with ASCII whitespace", () => {
    expect(formatTimestamp("2026-09-26T16:03:00.000Z")).toBe("2026/09/27 00:03");
    expect(formatTimestamp("2026-09-26T14:49:00+00:00")).toBe("2026/09/26 22:49");
  });
});
