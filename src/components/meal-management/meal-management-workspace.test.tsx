// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { staffPages } from "@/lib/catalog";
import { buildDemoMealManagementSnapshot } from "@/lib/meal-management/demo";
import type { MealManagementSnapshot } from "@/lib/meal-management/types";

import { MealManagementWorkspace } from "./meal-management-workspace";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const filters = { serviceDate: "2026-09-02", mealKind: "all" as const,
  textureQuery: "", conflict: "all" as const };
const demo = buildDemoMealManagementSnapshot(filters);
const formal: MealManagementSnapshot = { ...demo, demo: false };
const page = staffPages.find((entry) => entry.number === 57)!;

function workspace(snapshot: MealManagementSnapshot | null,
  options: { loadError?: boolean; canManage?: boolean;
    canConfirm?: boolean; recent?: boolean } = {}) {
  return render(<MealManagementWorkspace
    canConfirm={options.canConfirm ?? false}
    canManage={options.canManage ?? false}
    filters={filters}
    hasRecentAal2={options.recent ?? false}
    loadError={options.loadError ?? false}
    page={page}
    snapshot={snapshot}
  />);
}

describe("Page 57 meal-management workspace", () => {
  beforeEach(() => {
    refresh.mockReset();
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() =>
      "57900000-0000-4000-8000-000000000001") });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("freezes the catalog access and acceptance boundary", () => {
    expect(page.requiredPermissions).toEqual([
      "clients.read", "attendance.read", "health.read", "meals.read",
    ]);
    expect(page.acceptance.join(" ")).toMatch(/衝突.*即時警示.*出勤.*對帳/u);
    expect(page.offline.mode).toBe("read-cache-24h");
  });

  it("renders reconciled synthetic metrics and honest unconfigured rules", () => {
    workspace(demo, { recent: true, canManage: true, canConfirm: true });
    expect(screen.getByRole("heading", { level: 1, name: "餐食管理" }))
      .toBeInTheDocument();
    const metrics = within(screen.getByRole("region", { name: "餐食摘要" }));
    for (const label of ["預計份數", "實際份數", "特殊質地", "餐食衝突"]) {
      expect(metrics.getByText(label)).toBeInTheDocument();
    }
    expect(metrics.getByText("正式質地規則未發布")).toBeInTheDocument();
    expect(screen.getByText(/精確代碼比對/u)).toBeInTheDocument();
    expect(screen.getByText(/離線快取與餐食匯出目前停用/u)).toBeInTheDocument();
    expect(screen.getByText(/個案、菜單、過敏、禁忌、衝突與份數皆為合成資料/u))
      .toBeInTheDocument();
  });

  it("keyboard-compatible details expose the same per-client reconciliation", () => {
    const { container } = workspace(demo);
    const summary = [...container.querySelectorAll("summary")].find((node) =>
      node.textContent?.includes("逐人出勤與餐食需求")) as HTMLElement;
    const details = summary.closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(screen.getAllByText("待人工處置").length).toBeGreaterThan(0);
    expect(screen.getAllByText("已人工處置").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/精確代碼：peanut/u).length).toBeGreaterThan(0);
  });

  it("fails closed without substituting synthetic records", () => {
    workspace(null, { loadError: true });
    expect(screen.getByRole("alert")).toHaveTextContent("餐食管理暫時無法載入");
    expect(screen.getByRole("alert")).toHaveTextContent("沒有改用展示資料");
    expect(screen.queryByText("合成個案甲")).not.toBeInTheDocument();
  });

  it("keeps all formal controls disabled until recent AAL2", () => {
    workspace(formal, { canManage: true, canConfirm: true, recent: false });
    expect(screen.getByText(/最近 15 分鐘 AAL2 驗證已失效/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "建立需求新版本" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "凍結出勤與菜單版本" })).toBeDisabled();
  });

  it("reuses the same unknown-result key for an unchanged requirement retry", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("網路未確認"));
    vi.stubGlobal("fetch", fetchMock);
    workspace(formal, { canManage: true, canConfirm: true, recent: true });
    fireEvent.change(screen.getByLabelText("質地文字（狀態為已記錄時必填）"),
      { target: { value: "軟質" } });
    const button = screen.getByRole("button", { name: "建立需求新版本" });
    fireEvent.click(button);
    await screen.findByText("網路未確認");
    fireEvent.click(button);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = fetchMock.mock.calls[0]![1] as RequestInit;
    const second = fetchMock.mock.calls[1]![1] as RequestInit;
    expect((first.headers as Record<string, string>)["idempotency-key"])
      .toBe((second.headers as Record<string, string>)["idempotency-key"]);
    expect(first.body).toBe(second.body);
    expect((first.headers as Record<string, string>)["x-meal-operation"])
      .toBe("set_requirement");
  });
});
