import { describe, expect, it } from "vitest";
import { qualitySourceHref } from "./navigation";
describe("quality numerator/denominator navigation", () => {
  const row = { id: "d1000000-0000-4000-8000-000000000001", clientId: "d2000000-0000-4000-8000-000000000001", date: "2026-10-11" };
  it.each(["fall", "infection", "abnormal"] as const)("preserves the exact date range for %s", (source) => {
    const url = new URL(qualitySourceHref({ ...row, source }), "https://example.invalid");
    expect(Object.fromEntries(url.searchParams)).toEqual({ client: row.clientId, from: row.date, to: row.date });
  });
  it("uses month for weight and date for attendance", () => {
    expect(qualitySourceHref({ ...row, source: "weight" })).toContain("month=2026-10");
    expect(qualitySourceHref({ ...row, source: "attendance" })).toContain("date=2026-10-11");
    expect(qualitySourceHref({ ...row, clientId: null, source: "attendance" })).not.toContain("client=");
  });
});
