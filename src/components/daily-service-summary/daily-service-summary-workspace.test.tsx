// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { staffPages } from "@/lib/catalog";
import { buildDemoDailyServiceSummary } from "@/lib/daily-service-summary/demo";
import { DailyServiceSummaryWorkspace } from "./daily-service-summary-workspace";

afterEach(cleanup);
const page = staffPages.find((value) => value.number === 54)!;
const filters = { serviceDate: "2026-09-07", clientId: null,
  completeness: "all" as const };
const snapshot = buildDemoDailyServiceSummary(filters);

function workspace(overrides: Partial<Parameters<typeof DailyServiceSummaryWorkspace>[0]> = {}) {
  return <DailyServiceSummaryWorkspace canExport filters={filters}
    hasRecentAal2 page={page} snapshot={snapshot} {...overrides} />;
}

describe("Page 54 workspace", () => {
  it("renders eight source columns, textual unknown states and offline boundary", () => {
    render(workspace());
    expect(screen.getByRole("heading", { level: 1, name: "每日服務彙整" }))
      .toBeInTheDocument();
    for (const label of ["出勤", "生命徵象", "照顧日誌", "服務使用",
      "活動參與", "餐食", "接送", "異常事件"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText(/未授權・未知/u).length).toBeGreaterThan(0);
    expect(screen.getByText(/離線狀態：未設定/u)).toBeInTheDocument();
    expect(screen.getByText(/不列入完整度分母/u)).toBeInTheDocument();
  });

  it("provides a whitelisted internal drilldown for every desktop and mobile cell", () => {
    render(workspace());
    const links = screen.getAllByRole("link", { name: /查看 .*來源/u });
    expect(links).toHaveLength(snapshot.rows.length * 8 * 2);
    expect(links.every((link) => link.getAttribute("href")?.startsWith("/app/staff/")))
      .toBe(true);
  });

  it("binds CSV to the rendered snapshot and gates it on recent AAL2", () => {
    const { rerender } = render(workspace());
    expect(screen.getByRole("link", { name: "匯出同一快照" }))
      .toHaveAttribute("href", expect.stringContaining(`snapshot=${snapshot.snapshotId}`));
    rerender(workspace({ snapshot: { ...snapshot, demo: false }, hasRecentAal2: false }));
    expect(screen.getByRole("button", { name: "重新驗證後匯出" })).toBeDisabled();
  });

  it("fails closed without demo substitution", () => {
    render(workspace({ snapshot: null, loadError: true }));
    expect(screen.getByRole("alert")).toHaveTextContent("每日服務彙整暫時無法載入");
    expect(screen.queryByText("合成個案・晨光")).not.toBeInTheDocument();
  });
});
