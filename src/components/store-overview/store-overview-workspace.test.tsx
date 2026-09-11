// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreOverview } from "@/lib/store-overview/types";
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/app/module-loading", () => ({ ModuleLoading: () => <p role="status">讀取中</p> }));
import { StoreOverviewWorkspace } from "./store-overview-workspace";
let overview: StoreOverview;
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  overview = { organizationName: "合成機構", branchName: "萬華展示店", periods: { date: "2026-09-12", month: "2026-09" },
    invalid: false, demo: false,
    attendance: { status: "ready", data: { present: 24, leave: 3, absent: 1, generatedAt: new Date().toISOString() } },
    finance: { status: "ready", data: { income: "685000.00", expenses: "472350.00", entryCount: 36, generatedAt: new Date().toISOString() } },
  };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("minimal owner page", () => {
  it("renders only scoped attendance and Finance amounts with accessible periods", () => {
    const { container } = render(<StoreOverviewWorkspace overview={overview} />);
    expect(screen.getByRole("heading", { level: 1, name: "單店出勤與收支" })).toBeInTheDocument();
    expect(screen.getByText("萬華展示店")).toBeInTheDocument();
    expect(screen.getByLabelText("出勤日期")).toHaveValue("2026-09-12");
    expect(screen.getByLabelText("收支月份")).toHaveValue("2026-09");
    expect(screen.getByText("685,000")).toBeInTheDocument();
    expect(screen.getByText("472,350")).toBeInTheDocument();
    expect(screen.getByText(/未登記與已取消不列入缺席/u)).toBeInTheDocument();
    expect(container.querySelectorAll("dl")).toHaveLength(2);
    expect(container.querySelector("a[download],input[type=file],table")).toBeNull();
    expect(container.textContent).not.toMatch(/人事|薪資|投資報酬|來源雜湊/u);
  });
  it("has actionable unconnected/error states without fake zero amounts", () => {
    render(<StoreOverviewWorkspace overview={{ ...overview, attendance: { status: "timeout" }, finance: { status: "not_connected" } }} />);
    expect(screen.getByText("出勤讀取逾時")).toBeInTheDocument();
    expect(screen.getByText("Finance 尚未連線")).toBeInTheDocument();
    expect(screen.queryByText("685,000")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新資料" })).toBeEnabled();
  });
  it("doesn't show cached numbers on invalid input", () => {
    render(<StoreOverviewWorkspace overview={{ ...overview, invalid: true }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("本次未讀取任何出勤或財務數字");
    expect(screen.queryByText("685,000")).not.toBeInTheDocument();
  });
  it("labels synthetic data prominently", () => {
    render(<StoreOverviewWorkspace overview={{ ...overview, demo: true }} />);
    expect(screen.getByLabelText("合成展示資料")).toHaveTextContent("不是這間店的實際營運資料");
  });
  it("submits independent date/month selections without branch or entity parameters", () => {
    render(<StoreOverviewWorkspace overview={overview} />);
    fireEvent.change(screen.getByLabelText("收支月份"), { target: { value: "2026-08" } });
    fireEvent.submit(screen.getByRole("form"));
    expect(router.push).toHaveBeenCalledWith("/app/store-overview?date=2026-09-12&month=2026-08");
    expect(router.refresh).not.toHaveBeenCalled();
  });
  it("hides financial values when offline and requires a new snapshot on reconnect", () => {
    const { rerender } = render(<StoreOverviewWorkspace overview={overview} />);
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(screen.queryByText("685,000")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新資料" })).toBeDisabled();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(screen.queryByText("685,000")).not.toBeInTheDocument();
    expect(screen.getByText("已恢復連線，請更新資料")).toBeInTheDocument();
    // Reconnect submits a real GET navigation, not a cached client transition.
    expect(fireEvent.submit(screen.getByRole("form"))).toBe(true);
    expect(router.push).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    rerender(<StoreOverviewWorkspace overview={{ ...overview }} />);
    expect(screen.queryByText("685,000")).not.toBeInTheDocument();
  });
  it("also requires a full reload when the initial mount is offline", () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    render(<StoreOverviewWorkspace overview={overview} />);
    expect(screen.queryByText("685,000")).not.toBeInTheDocument();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(screen.queryByText("685,000")).not.toBeInTheDocument();
    expect(screen.getByText("已恢復連線，請更新資料")).toBeInTheDocument();
  });
  it("distinguishes stale summaries from fresh data", () => {
    vi.useFakeTimers();
    render(<StoreOverviewWorkspace overview={overview} />);
    act(() => { vi.advanceTimersByTime(70_000); });
    expect(screen.getByRole("status")).toHaveTextContent("資料已超過 1 分鐘");
  });
  it("gives a truthful empty-data explanation", () => {
    render(<StoreOverviewWorkspace overview={{ ...overview,
      attendance: { status: "ready", data: { present: 0, leave: 0, absent: 0, generatedAt: new Date().toISOString() } },
      finance: { status: "ready", data: { income: "0.00", expenses: "0.00", entryCount: 0, generatedAt: new Date().toISOString() } },
    }} />);
    expect(screen.getByText(/不代表所有個案都缺席/u)).toBeInTheDocument();
    expect(screen.getByText("Finance 這個月尚無分類帳紀錄。")).toBeInTheDocument();
  });
});
