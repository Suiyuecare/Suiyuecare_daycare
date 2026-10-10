// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
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
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe("minimal owner page", () => {
  it("renders the same Taipei time when server and browser Intl literals differ", () => {
    const generatedAt = "2026-10-10T11:30:56.000Z";
    overview = {
      ...overview,
      attendance: { status: "ready", data: { present: 24, leave: 3, absent: 1, generatedAt } },
      finance: { status: "ready", data: { income: "685000.00", expenses: "472350.00", entryCount: 36, generatedAt } },
    };
    const original = Intl.DateTimeFormat.prototype.formatToParts;
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    spy.mockImplementation(function (this: Intl.DateTimeFormat, date?: Date | number) {
      return original.call(this, date).map((part) => part.type === "literal" ? { ...part, value: "\u2009" } : part);
    });
    const serverHtml = renderToString(<StoreOverviewWorkspace overview={overview} />);
    spy.mockImplementation(function (this: Intl.DateTimeFormat, date?: Date | number) {
      return original.call(this, date).map((part) => part.type === "literal" ? { ...part, value: " " } : part);
    });
    const clientHtml = renderToString(<StoreOverviewWorkspace overview={overview} />);
    expect(spy).toHaveBeenCalled();
    expect(serverHtml).toBe(clientHtml);
    expect(serverHtml).toContain("10/10 19:30:56");
    expect(serverHtml).not.toContain("\u2009");
  });
  it("renders only scoped attendance and Finance amounts with accessible periods", () => {
    const { container } = render(<StoreOverviewWorkspace overview={overview} />);
    expect(screen.getByRole("heading", { level: 1, name: "萬華展示店" })).toBeInTheDocument();
    expect(screen.getByText("單店出勤與收支")).toBeInTheDocument();
    const quickSummary = screen.getByRole("navigation", { name: "快速查看出勤與收支" });
    expect(quickSummary).toHaveTextContent("出席 24 · 請假 3 · 缺席 1");
    expect(quickSummary).toHaveTextContent("收入 NT$685,000 · 支出 NT$472,350");
    expect(quickSummary.querySelector('a[href="#store-attendance-heading"]')).toBeInTheDocument();
    expect(quickSummary.querySelector('a[href="#store-finance-heading"]')).toBeInTheDocument();
    expect(screen.getByLabelText("出勤日期")).toHaveValue("2026-09-12");
    expect(screen.getByLabelText("收支月份")).toHaveValue("2026-09");
    expect(screen.getByRole("region", { name: "Finance 收入與支出" })).toHaveTextContent("NT$685,000");
    expect(screen.getByRole("region", { name: "Finance 收入與支出" })).toHaveTextContent("NT$472,350");
    expect(screen.getByRole("region", { name: "個案出缺勤" })).toHaveTextContent("已登記 28 人");
    expect(screen.getByText("未登記不等於缺席；已取消紀錄不計。")).toBeInTheDocument();
    expect(screen.getByText(/未登記與已取消不列入缺席/u)).toBeInTheDocument();
    expect(container.querySelectorAll("dl")).toHaveLength(2);
    expect(screen.getByRole("region", { name: "個案出缺勤" }).querySelectorAll("dt svg")).toHaveLength(3);
    expect(container.querySelectorAll("[aria-hidden='true']").length).toBeGreaterThan(3);
    expect(container.querySelector("a[download],input[type=file],table")).toBeNull();
    expect(container.textContent).not.toMatch(/人事|薪資|投資報酬|來源雜湊/u);
  });
  it("has actionable unconnected/error states without fake zero amounts", () => {
    render(<StoreOverviewWorkspace overview={{ ...overview, attendance: { status: "timeout" }, finance: { status: "not_connected" } }} />);
    expect(screen.getByText("出勤讀取逾時")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "快速查看出勤與收支" })).toHaveTextContent("Finance 尚未連線");
    expect(screen.getByRole("region", { name: "Finance 收入與支出" })).toHaveTextContent("Finance 尚未連線");
    expect(screen.queryByText("685,000")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新資料" })).toBeEnabled();
  });
  it("doesn't show cached numbers on invalid input", () => {
    render(<StoreOverviewWorkspace overview={{ ...overview, invalid: true }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("本次未讀取任何出勤或財務數字");
    expect(screen.queryByRole("navigation", { name: "快速查看出勤與收支" })).not.toBeInTheDocument();
    expect(screen.queryByText("685,000")).not.toBeInTheDocument();
  });
  it("labels synthetic data prominently", () => {
    render(<StoreOverviewWorkspace overview={{ ...overview, demo: true }} />);
    expect(screen.getByLabelText("合成展示資料")).toHaveTextContent("不是這間店的實際營運資料");
    expect(screen.getByLabelText("合成展示資料")).toHaveTextContent("不會連線正式 Finance");
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
    expect(screen.queryByRole("navigation", { name: "快速查看出勤與收支" })).not.toBeInTheDocument();
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
