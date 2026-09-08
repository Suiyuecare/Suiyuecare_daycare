// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { staffPages } from "@/lib/catalog";
import { buildDemoTransportPlanSnapshot } from "@/lib/transport-plans/demo";
import type { TransportPlanSnapshot } from "@/lib/transport-plans/types";

import { TransportPlansWorkspace } from "./transport-plans-workspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const filters = { serviceDate: "2026-09-07", direction: "all" as const,
  vehicleQuery: "", driverQuery: "", status: "all" as const };
const demo = buildDemoTransportPlanSnapshot(filters);
const formal: TransportPlanSnapshot = { ...demo, demo: false };
const page = staffPages.find(({ number }) => number === 47)!;

function workspace(snapshot: TransportPlanSnapshot | null, options: {
  loadError?: boolean; canManage?: boolean; canApprove?: boolean;
  canOverride?: boolean; recent?: boolean;
} = {}) {
  return render(<TransportPlansWorkspace canApprove={options.canApprove ?? false}
    canManage={options.canManage ?? false} canOverride={options.canOverride ?? false}
    currentUserId="47990000-0000-4000-8000-000000000099" filters={filters}
    hasRecentAal2={options.recent ?? false} loadError={options.loadError ?? false}
    page={page} snapshot={snapshot} />);
}

describe("Page 47 transport-plan workspace", () => {
  afterEach(cleanup);

  it("freezes catalog permissions, governed publication and offline boundary", () => {
    expect(page.requiredPermissions).toEqual(["clients.read", "transport_plans.read"]);
    expect(page.acceptance.join(" ")).toMatch(/衝突.*不可靜默.*非建立人/u);
    expect(page.acceptance.join(" ")).toMatch(/override.*15 分鐘 AAL2/u);
    expect(page.offline.mode).toBe("read-cache-24h");
    expect(page.offline.note).toMatch(/尚未配置/u);
  });

  it("renders reconciled synthetic metrics and honest governance", () => {
    workspace(demo);
    expect(screen.getByRole("heading", { level: 1, name: "交通趟次計畫" }))
      .toBeInTheDocument();
    const metrics = within(screen.getByRole("region", { name: "交通計畫摘要" }));
    for (const [label, value] of [["趟次數", "3"], ["乘客數", "6"],
      ["容量衝突", "1"], ["待發布", "1"]]) {
      const labelNode = metrics.getByText(label);
      expect(labelNode).toBeInTheDocument();
      expect(within(labelNode.closest("article")!).getByText(value)).toBeInTheDocument();
    }
    expect(screen.getByText(/不是官方車籍或駕照驗證/u)).toBeInTheDocument();
    expect(screen.getByText(/外部通知、匯出與 24 小時唯讀快取尚未配置/u))
      .toBeInTheDocument();
    expect(screen.getByText(/均為合成資料/u)).toBeInTheDocument();
  });

  it("exposes the same per-client places and conflicts through keyboard details", () => {
    const { container } = workspace(demo);
    const summary = [...container.querySelectorAll("summary")][0] as HTMLElement;
    const details = summary.closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(screen.getAllByText(/上車：合成住址/u).length).toBeGreaterThan(0);
    const conflict = screen.getAllByText(/乘員 3 人超過車輛容量 2 人/u)[0];
    expect(conflict).toBeInTheDocument();
  });

  it("fails closed without substituting synthetic trips", () => {
    workspace(null, { loadError: true });
    expect(screen.getByRole("alert")).toHaveTextContent("交通趟次計畫暫時無法載入");
    expect(screen.getByRole("alert")).toHaveTextContent("沒有改用展示資料");
    expect(screen.queryByText("合成駕駛甲")).not.toBeInTheDocument();
  });

  it("blocks formal controls until recent AAL2", () => {
    workspace(formal, { canManage: true, canApprove: true, canOverride: true,
      recent: false });
    expect(screen.getAllByRole("heading", { name: "交通計畫操作前需重新驗證" }))
      .toHaveLength(2);
    expect(screen.queryByText("建立趟次／建立不可變更正版")).not.toBeInTheDocument();
  });

  it("shows create and independent override paths only with exact authority", () => {
    workspace(formal, { canManage: true, canApprove: true, canOverride: true,
      recent: true });
    expect(screen.getByText("建立趟次／建立不可變更正版")).toBeInTheDocument();
    expect(screen.getByText("獨立發布、駁回或衝突覆核")).toBeInTheDocument();
    fireEvent.click(screen.getByText("獨立發布、駁回或衝突覆核"));
    expect(screen.getByRole("option", { name: "覆核衝突並發布" })).toBeInTheDocument();
    cleanup();
    workspace(formal, { canManage: false, canApprove: true, canOverride: false,
      recent: true });
    expect(screen.queryByText("建立趟次／建立不可變更正版")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("獨立發布、駁回或衝突覆核"));
    expect(screen.queryByRole("option", { name: "覆核衝突並發布" }))
      .not.toBeInTheDocument();
  });
});
