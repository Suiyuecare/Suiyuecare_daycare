import { describe, expect, it } from "vitest";
import { parseStaffAnnouncementPageQuery, StaffAnnouncementFilterError } from "./query";

describe("announcement page query", () => {
  it("uses bounded explicit defaults", () => {
    expect(parseStaffAnnouncementPageQuery({})).toEqual({ filters: { query: "", status: "all", page: 1, pageSize: 20 }, selectedReleaseId: null });
  });
  it("keeps literal search syntax and surrounding spaces without trimming", () => {
    expect(parseStaffAnnouncementPageQuery({ q: " %_\\ 中秋 ", status: "published", page: "10000", pageSize: "100" }).filters).toEqual({ query: " %_\\ 中秋 ", status: "published", page: 10000, pageSize: 100 });
  });
  it("accepts exactly 120 Unicode characters without cutting surrogate pairs", () => {
    expect(parseStaffAnnouncementPageQuery({ q: "😀".repeat(120) }).filters.query).toBe("😀".repeat(120));
  });
  it.each([
    { q: "a".repeat(121) }, { q: "line\nfeed" }, { q: ["a", "b"] },
    { status: "invalid" }, { status: "" }, { status: ["published"] },
    { page: "0" }, { page: "01" }, { page: "1e2" }, { page: "10001" }, { page: ["1"] },
    { pageSize: "10" }, { pageSize: "20 " }, { pageSize: ["20"] },
    { release: "" }, { release: "invalid" }, { release: ["68111111-1111-4111-8111-111111111112"] },
  ])("rejects malformed or repeated query %#", (query) => {
    expect(() => parseStaffAnnouncementPageQuery(query)).toThrow(StaffAnnouncementFilterError);
  });
});
