// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { getPageBySlug } from "@/lib/catalog";
import { buildDemoMnaAssessmentSnapshot } from "@/lib/mna-assessments/demo";

import { MnaAssessmentsWorkspace } from "./mna-assessments-workspace";

const page = getPageBySlug("staff/professional-care/mna")!;
const snapshot = buildDemoMnaAssessmentSnapshot();
const filters = { clientId: null, risk: "all" as const, followUp: "all" as const };

afterEach(cleanup);

describe("page 36 MNA workspace", () => {
  it("distinguishes missing license from no assessment data", () => {
    render(<MnaAssessmentsWorkspace canManage={false} filters={filters}
      hasRecentAal2={false} page={page} snapshot={snapshot} />);
    expect(screen.getByRole("heading", { level: 1, name: "MNA 營養評估" }))
      .toBeDefined();
    expect(screen.getByText(/授權未配置，不等於沒有資料/u)).toBeDefined();
    expect(screen.getAllByText(/尚無正式評估資料/u).length).toBeGreaterThan(0);
    expect(screen.getByText(/沒有重打或近似重建題目/u)).toBeDefined();
  });

  it("labels every displayed result as synthetic and read-only", () => {
    render(<MnaAssessmentsWorkspace canManage filters={filters}
      hasRecentAal2 page={page} snapshot={snapshot} />);
    expect(screen.getAllByText(/合成唯讀展示/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/合成展示值/u).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", {
      name: /建立草稿|正式簽署|建立更正版/u,
    }).every((button) =>
      (button as HTMLButtonElement).disabled)).toBe(true);
    expect(document.querySelector("form[action]")).toBeNull();
  });

  it("shows short, full, due and follow-up fields without official items", () => {
    render(<MnaAssessmentsWorkspace canManage={false} filters={filters}
      hasRecentAal2={false} page={page} snapshot={snapshot} />);
    expect(screen.getAllByText(/篩檢 10・有風險/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/完整評估 22.5・有風險/u).length)
      .toBeGreaterThan(0);
    expect(screen.getAllByText(/人工複評期限/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/人工輸入的期限/u).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/第 ?[A-R] ?題/u);
  });

  it("exposes immutable corrected history and hashes by keyboard", () => {
    render(<MnaAssessmentsWorkspace canManage={false} filters={filters}
      hasRecentAal2={false} page={page} snapshot={snapshot} />);
    const summary = screen.getAllByText(/查看不可變歷程（2 版）/u)[0]!;
    fireEvent.keyDown(summary, { key: "Enter" });
    fireEvent.click(summary);
    expect(screen.getAllByText(/合成更正版/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/修正外部結果轉錄內容/u).length)
      .toBeGreaterThan(0);
    expect(screen.getAllByText(/治理快照/u).length).toBeGreaterThan(0);
  });

  it("renders an explicit fail-closed load state", () => {
    render(<MnaAssessmentsWorkspace canManage={false} filters={filters}
      hasRecentAal2={false} loadError page={page} snapshot={null} />);
    expect(screen.getByRole("alert").textContent).toMatch(/非法篩選不會被降級/u);
    expect(screen.queryByText("合成個案 A")).toBeNull();
  });

  it("keeps source links external and named", () => {
    render(<MnaAssessmentsWorkspace canManage={false} filters={filters}
      hasRecentAal2={false} page={page} snapshot={snapshot} />);
    const links = screen.getAllByRole("link").filter((link) =>
      link.getAttribute("target") === "_blank");
    expect(links).toHaveLength(3);
    expect(links.every((link) => link.getAttribute("rel") === "noreferrer"))
      .toBe(true);
  });
});
