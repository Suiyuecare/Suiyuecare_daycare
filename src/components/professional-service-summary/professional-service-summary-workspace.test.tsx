// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProfessionalServiceSummaryWorkspace } from "./professional-service-summary-workspace";
import { staffPages } from "@/lib/catalog";
import { buildDemoProfessionalServiceSummary } from "@/lib/professional-service-summary/demo";
import type { ProfessionalServiceSummaryFilters } from "@/lib/professional-service-summary/types";

afterEach(cleanup);

const page = staffPages.find((value) => value.number === 42)!;
const filters: ProfessionalServiceSummaryFilters = {
  month: "2026-09",
  clientId: null,
  professionalKind: "all",
  status: "all",
};
const snapshot = buildDemoProfessionalServiceSummary(filters);

function workspace(overrides: Partial<Parameters<
  typeof ProfessionalServiceSummaryWorkspace
>[0]> = {}) {
  return <ProfessionalServiceSummaryWorkspace
    canExport
    filters={filters}
    hasRecentAal2
    page={page}
    snapshot={snapshot}
    {...overrides}
  />;
}

describe("Page 42 professional service summary workspace", () => {
  it("renders textual completion states, metrics and governance gaps", () => {
    expect(page.requiredPermissions).toEqual([
      "clients.read", "professional_service_summary.read",
    ]);
    render(workspace());
    expect(screen.getByRole("heading", { level: 1, name: "專業服務彙整表" }))
      .toBeInTheDocument();
    for (const label of ["應完成", "已完成", "待完成", "逾期"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText("規則未設定").length).toBeGreaterThan(0);
    expect(screen.getByText(/MNA 電子化授權/u)).toBeInTheDocument();
    expect(screen.getByText(/不推測尚未建立/u)).toBeInTheDocument();
    expect(screen.getAllByText("既有紀錄已完成（頻率未設定）").length)
      .toBeGreaterThan(0);
    expect(document.body).not.toHaveTextContent("manual_due_date_only");
    expect(document.body).toHaveTextContent("採來源內人工複評日期");
  });

  it("provides an internal source drilldown for every visible item", () => {
    render(workspace());
    const links = screen.getAllByRole("link", { name: /查看來源/u });
    expect(links).toHaveLength(snapshot.items.length * 2);
    for (const link of links) {
      expect(link.getAttribute("href"))
        .toMatch(/^\/app\/staff\/professional-care\//u);
    }
  });

  it("binds the export link to the currently rendered snapshot and filters", () => {
    render(workspace());
    const exportLink = screen.getByRole("link", { name: "匯出同一快照" });
    expect(exportLink.getAttribute("href")).toContain(
      `snapshot=${snapshot.snapshotId}`,
    );
    expect(exportLink.getAttribute("href")).toContain("month=2026-09");
  });

  it("does not offer a live export when recent AAL2 is absent", () => {
    render(workspace({
      snapshot: { ...snapshot, demo: false },
      hasRecentAal2: false,
    }));
    expect(screen.queryByRole("link", { name: "匯出同一快照" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新驗證後匯出" }))
      .toBeDisabled();
  });

  it("fails closed without substituting demo data", () => {
    render(workspace({ loadError: true, snapshot: null }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "專業服務彙整暫時無法載入",
    );
    expect(screen.queryByText("合成個案・晨光")).not.toBeInTheDocument();
  });
});
