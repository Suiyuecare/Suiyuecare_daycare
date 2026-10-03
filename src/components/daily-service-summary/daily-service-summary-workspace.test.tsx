// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it("uses source evidence rather than label fragments for cell tones", () => {
    const { container } = render(workspace());
    const pills = Array.from(container.querySelectorAll(".status-pill"));
    expect(pills.filter((pill) => pill.textContent === "1 筆待完成").every((pill) =>
      pill.classList.contains("status-pill--warning"))).toBe(true);
    expect(pills.filter((pill) => pill.textContent === "有 1 項例外").every((pill) =>
      pill.classList.contains("status-pill--danger"))).toBe(true);
    expect(pills.filter((pill) => pill.textContent === "未授權・未知").every((pill) =>
      pill.classList.contains("status-pill--neutral"))).toBe(true);
  });

  it("puts mobile exceptions and unknowns before the eight full source rows", () => {
    const { container } = render(workspace());
    const cards = Array.from(container.querySelectorAll("article.record-card"));
    expect(cards).toHaveLength(snapshot.rows.length);
    expect(cards[0]).toHaveTextContent("當日無紀錄異常事件");
    expect(cards[1]).toHaveTextContent("需留意・4 項來源");
    expect(cards[1]).toHaveTextContent("無法確認餐食、接送（未授權或未配置）");
    for (const card of cards) {
      const disclosure = card.querySelector("details");
      expect(disclosure).toHaveTextContent("查看 8 項來源與快照證據");
      expect(disclosure?.querySelectorAll("section")).toHaveLength(8);
      expect(disclosure?.querySelectorAll('a[aria-label*="來源"]')).toHaveLength(8);
    }
    fireEvent.click(cards[1]!.querySelector("details > summary")!);
    expect(cards[1]!.querySelector("details")?.open).toBe(true);
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

  it("offers a native GET filter and focuses the new results anchor", () => {
    const { container } = render(workspace());
    const form = container.querySelector("form");
    expect(form).toHaveAttribute("action", "/app/staff/service-management/daily-summary#daily-summary-results");
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("novalidate");
    expect(form?.querySelectorAll("select")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "2026-09-07 服務明細" })).toHaveAttribute("id", "daily-summary-results");
    expect(screen.getByRole("link", { name: "匯出同一快照" }))
      .toHaveAttribute("href", expect.stringContaining(`snapshot=${snapshot.snapshotId}`));
  });

  it("fails closed without demo substitution", () => {
    render(workspace({ snapshot: null, loadError: true, filters: {
      serviceDate: "2026-09-07", clientId: "11111111-1111-4111-8111-111111111111",
      completeness: "incomplete",
    } }));
    expect(screen.getByRole("alert")).toHaveTextContent("每日服務彙整暫時無法載入");
    expect(screen.queryByText("合成個案・晨光")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "依原條件重試" }))
      .toHaveAttribute("href", "/app/staff/service-management/daily-summary?date=2026-09-07&client=11111111-1111-4111-8111-111111111111&completeness=incomplete");
  });
});
