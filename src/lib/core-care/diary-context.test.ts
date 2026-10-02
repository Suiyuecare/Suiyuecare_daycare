import { describe, expect, it } from "vitest";
import { diaryMatchesServiceContext } from "./diary-context";
import type { DiaryRecord } from "@/lib/care-diary/schema";

const record = {
  occurred_at: "2026-09-11T16:15:00.000Z", // 2026-09-12 00:15 in Taipei
  fields: { shift: "morning" },
} as Pick<DiaryRecord, "occurred_at" | "fields">;

describe("diary service context", () => {
  it("uses the Taipei service date at the UTC midnight boundary", () => {
    expect(diaryMatchesServiceContext(record, "2026-09-12", "morning")).toBe(true);
    expect(diaryMatchesServiceContext(record, "2026-09-11", "morning")).toBe(false);
  });

  it("keeps each selected shift separate and does not assume full-day covers it", () => {
    expect(diaryMatchesServiceContext(record, "2026-09-12", "afternoon")).toBe(false);
    expect(diaryMatchesServiceContext({ ...record, fields: { ...record.fields, shift: "full_day" } }, "2026-09-12", "morning")).toBe(false);
    expect(diaryMatchesServiceContext(record, "2026-09-12")).toBe(true);
  });

  it("never treats an invalid occurrence as the selected day", () => {
    expect(diaryMatchesServiceContext({ ...record, occurred_at: "invalid" }, "2026-09-12")).toBe(false);
  });
});
