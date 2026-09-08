// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { buildReportEntries } from "@/lib/reports/entry";
import { ReportsWorkspace } from "./reports-workspace";

afterEach(cleanup);
const periods = { date: "2026-09-08", month: "2026-08" };
const entries = buildReportEntries({ demo: true, scopes: [] }, periods);

describe("report entry workspace", () => {
  it("offers labeled GET period controls and source links without fake report totals", () => {
    const { container } = render(<ReportsWorkspace entries={entries} periods={periods} invalid={false} demo />);
    expect(screen.getByRole("heading", { level: 1, name: "統計報表" })).toBeInTheDocument();
    expect(screen.getByLabelText("每日報表日期（臺北時間）")).toHaveValue(periods.date);
    expect(screen.getByLabelText("每月報表月份（臺北時間）")).toHaveValue(periods.month);
    expect(screen.getByRole("form", { name: "選擇報表期間" })).toHaveAttribute("method", "get");
    expect(screen.getByRole("link", { name: "開啟每日服務彙整" })).toHaveAttribute("href", entries[0].href);
    expect(screen.getByRole("link", { name: "開啟專業服務彙整表" })).toHaveAttribute("href", entries[1].href);
    expect(container.querySelectorAll("details")).toHaveLength(2);
    expect(container.querySelector("table, input[type=file], a[download]")).toBeNull();
    expect(screen.getByText(/不以頁面開啟時間假充資料更新時間/u)).toBeInTheDocument();
    expect(screen.getAllByText(/重新開啟可能取得新快照/u)).toHaveLength(2);
  });
  it("shows an actionable error and no source links for invalid input", () => {
    render(<ReportsWorkspace entries={entries} periods={periods} invalid demo={false} />);
    expect(screen.getByRole("alert")).toHaveTextContent("期間或查詢條件無效");
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "套用期間" })).toBeEnabled();
  });
  it("keeps source authorization failures distinct from empty records", () => {
    const denied = buildReportEntries({ demo: false, scopes: ["reports.read"] }, periods);
    render(<ReportsWorkspace entries={denied} periods={periods} invalid={false} demo={false} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getAllByRole("status")).toHaveLength(2);
    expect(screen.getByText("報表入口 · 部分功能已接線")).toBeInTheDocument();
    expect(screen.queryByText(/合成展示/u)).not.toBeInTheDocument();
  });
});
