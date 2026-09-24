import { describe, expect, it } from "vitest";
import { pageCatalog } from "@/lib/catalog";
import { dailyWorkflowHref, type DailyWorkflowPage, type DailyWorkflowShift } from "./workflow-links";
import { parseDailyWorkSelection } from "./selection-query";

const CLIENT = "a2222222-2222-4222-8222-222222222222";
describe("daily workflow fixed links", () => {
  it.each([46, 3, 6] as const)("keeps date and stable client on catalog page %s", (page) => {
    const href = dailyWorkflowHref(page, "2026-09-10", CLIENT);
    const url = new URL(href, "https://daycare.example.test");
    expect(url.pathname).toBe(`/app/${pageCatalog.find((entry) => entry.number === page)!.slug}`);
    expect([...url.searchParams]).toEqual([["date", "2026-09-10"], ["client", CLIENT]]);
  });
  it("clears only the client when choosing a different person", () => {
    expect(dailyWorkflowHref(3, "2026-09-10")).toBe("/app/staff/daily-care/vital-signs?date=2026-09-10");
  });
  it.each(["", "2026-02-30", "2026-13-01", "javascript:alert(1)", "2026-09-10&role=admin"])("rejects invalid dates instead of changing the service day: %s", (date) => {
    expect(() => dailyWorkflowHref(3, date, CLIENT)).toThrow();
  });
  it.each(["", "javascript:alert(1)", "other-person", `${CLIENT}&date=2025-01-01`])("rejects untrusted client query content: %s", (client) => {
    expect(() => dailyWorkflowHref(3, "2026-09-10", client)).toThrow("INVALID_WORKFLOW_CLIENT");
  });
  it("rejects unsupported pages at runtime", () => {
    expect(() => dailyWorkflowHref(99 as DailyWorkflowPage, "2026-09-10", CLIENT)).toThrow("INVALID_WORKFLOW_PAGE");
  });
  it.each(["morning", "afternoon", "full_day"] as const)("retains %s across steps and changing clients", (shift) => {
    for (const page of [46, 3, 6] as const) {
      const selected = new URL(dailyWorkflowHref(page, "2026-09-10", CLIENT, shift), "https://daycare.example.test");
      expect(selected.searchParams.get("shift")).toBe(shift);
      const changed = new URL(dailyWorkflowHref(page, "2026-09-10", undefined, shift), "https://daycare.example.test");
      expect(changed.searchParams.get("shift")).toBe(shift);
      expect(changed.searchParams.has("client")).toBe(false);
    }
    expect(parseDailyWorkSelection({ date: "2026-09-10", client: CLIENT, shift })).toMatchObject({ selectedShift: shift, invalid: false });
  });
  it.each(["", "night", "morning&role=admin"])("rejects invalid shifts without substituting a full day: %s", (shift) => {
    expect(() => dailyWorkflowHref(6, "2026-09-10", CLIENT, shift as DailyWorkflowShift)).toThrow("INVALID_WORKFLOW_SHIFT");
    expect(parseDailyWorkSelection({ date: "2026-09-10", shift })).toMatchObject({ selectedShift: undefined, invalid: true });
  });
  it("rejects repeated shift query parameters and preserves the legacy absent-shift case", () => {
    expect(parseDailyWorkSelection({ date: "2026-09-10", shift: ["morning", "afternoon"] }).invalid).toBe(true);
    expect(parseDailyWorkSelection({ date: "2026-09-10" })).toMatchObject({ selectedShift: undefined, invalid: false });
  });
});
