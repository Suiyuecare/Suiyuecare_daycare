import { describe, expect, it } from "vitest";
import { pageCatalog } from "@/lib/catalog";
import { dailyWorkflowHref, type DailyWorkflowPage } from "./workflow-links";

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
});
