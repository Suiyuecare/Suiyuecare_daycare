// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreOverview } from "@/lib/store-overview/types";
import { hasViewTransition, tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/app/module-loading", () => ({ ModuleLoading: () => <p role="status">讀取中</p> }));
import { StoreOverviewWorkspace } from "./store-overview-workspace";

const now = Date.parse("2026-09-26T09:00:00Z");
let overview: StoreOverview;
let leases: Array<() => void>;
function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value });
  act(() => { window.dispatchEvent(new Event(value ? "online" : "offline")); });
}
function setVisible(value: boolean) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: value ? "visible" : "hidden" });
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
}
function advance(ms: number) { act(() => { vi.advanceTimersByTime(ms); }); }
function refreshed(): StoreOverview {
  return { ...overview, finance: { status: "ready", data: { income: "10.00", expenses: "5.00", entryCount: 2,
    generatedAt: new Date(Date.now()).toISOString() } } };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  leases = [];
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  window.history.replaceState(null, "", "/app/store-overview?date=2026-09-26&month=2026-09");
  overview = { organizationName: "合成機構", branchName: "合成分支", periods: { date: "2026-09-26", month: "2026-09" },
    invalid: false, demo: false, attendance: { status: "unavailable" },
    finance: { status: "ready", data: { income: "10.00", expenses: "5.00", entryCount: 2,
      generatedAt: new Date(now).toISOString() } } };
});
afterEach(() => { cleanup(); for (const release of leases) release(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("bounded, coordinated Finance reads", () => {
  it("waits 55 seconds before a read and does not mistake router completion for a fresh source", () => {
    render(<StoreOverviewWorkspace overview={overview} />);
    advance(54_999);
    expect(router.refresh).not.toHaveBeenCalled();
    advance(1);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(hasViewTransition()).toBe(false);
    expect(screen.getByText(/尚未取得更新的 Finance 資料/u)).toHaveTextContent("將稍後重試");
    advance(59_999);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    advance(1);
    expect(router.refresh).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/尚未取得更新的 Finance 資料/u)).toHaveTextContent("自動更新已暫停");
    advance(300_000);
    expect(router.refresh).toHaveBeenCalledTimes(2);
  });
  it("accepts a newer server timestamp and continues at the bounded interval without overwriting filter edits", () => {
    const view = render(<StoreOverviewWorkspace overview={overview} />);
    router.refresh.mockImplementation(() => { view.rerender(<StoreOverviewWorkspace overview={refreshed()} />); });
    fireEvent.change(screen.getByLabelText("收支月份"), { target: { value: "2026-08" } });
    advance(55_000);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/尚未取得更新的 Finance 資料/u)).not.toBeInTheDocument();
    expect(screen.getByLabelText("收支月份")).toHaveValue("2026-08");
    advance(54_999);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    advance(1);
    expect(router.refresh).toHaveBeenCalledTimes(2);
    expect(router.push).not.toHaveBeenCalled();
  });
  it.each(["demo", "invalid", "stale", "malformed", "not_connected", "unavailable", "timeout"])("does not start automatic reads for %s", (state) => {
    const data = state === "demo" ? { ...overview, demo: true } : state === "invalid" ? { ...overview, invalid: true } :
      state === "stale" || state === "malformed" ? { ...overview, finance: { status: "ready" as const,
        data: { income: "10.00", expenses: "5.00", entryCount: 2, generatedAt: state === "stale" ? new Date(now - 60_001).toISOString() : "bad" } } } :
      { ...overview, finance: { status: state as "not_connected" | "unavailable" | "timeout" } };
    render(<StoreOverviewWorkspace overview={data} />);
    advance(300_000);
    expect(router.refresh).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });
  it("skips hidden tabs and reads only once on returning when overdue", () => {
    render(<StoreOverviewWorkspace overview={overview} />);
    setVisible(false);
    advance(120_000);
    expect(router.refresh).not.toHaveBeenCalled();
    setVisible(true);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    setVisible(false); setVisible(true);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
  it("stays paused after reconnection until a full no-store native GET and keeps the lease until unmount", () => {
    const view = render(<StoreOverviewWorkspace overview={overview} />);
    setOnline(false);
    advance(120_000);
    setOnline(true);
    advance(120_000);
    expect(router.refresh).not.toHaveBeenCalled();
    expect(fireEvent.submit(screen.getByRole("form"))).toBe(true);
    expect(hasViewTransition()).toBe(true);
    view.rerender(<StoreOverviewWorkspace overview={refreshed()} />);
    expect(hasViewTransition()).toBe(true);
    expect(screen.getByRole("button", { name: "更新資料" })).toBeDisabled();
    view.unmount();
    expect(hasViewTransition()).toBe(false);
  });
  it.each(["operation", "view"])("does not start automatic or forced manual navigation during a shared %s lease", (kind) => {
    const view = render(<StoreOverviewWorkspace overview={overview} />);
    act(() => { leases.push((kind === "operation" ? tryAcquirePendingOperation() : tryAcquireViewTransition())!); });
    advance(120_000);
    expect(fireEvent.submit(screen.getByRole("form"))).toBe(false);
    expect(router.refresh).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    act(() => { leases.pop()!(); });
    advance(5_000);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    view.unmount();
  });
  it("acquires a shared lease before refresh and holds it through the asynchronous React transition", async () => {
    let finish!: () => void;
    const deferred = new Promise<void>((resolve) => { finish = resolve; });
    router.refresh.mockImplementation(() => {
      expect(hasViewTransition()).toBe(true);
      expect(tryAcquirePendingOperation()).toBeNull();
      return deferred;
    });
    const view = render(<StoreOverviewWorkspace overview={overview} />);
    advance(55_000);
    expect(hasViewTransition()).toBe(true);
    advance(120_000);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); await deferred; });
    expect(hasViewTransition()).toBe(false);
    view.unmount();
  });
  it("releases an in-flight lease on actual unmount and no timer survives the old view", async () => {
    let finish!: () => void;
    const deferred = new Promise<void>((resolve) => { finish = resolve; });
    router.refresh.mockReturnValue(deferred);
    const view = render(<StoreOverviewWorkspace overview={overview} />);
    advance(55_000);
    expect(hasViewTransition()).toBe(true);
    view.unmount();
    expect(hasViewTransition()).toBe(false);
    advance(300_000);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); await deferred; });
  });
  it("allows a manual read after retry exhaustion and resumes only on a newer validated source", () => {
    const view = render(<StoreOverviewWorkspace overview={overview} />);
    advance(55_000); advance(60_000);
    expect(router.refresh).toHaveBeenCalledTimes(2);
    router.refresh.mockImplementation(() => { view.rerender(<StoreOverviewWorkspace overview={refreshed()} />); });
    fireEvent.submit(screen.getByRole("form"));
    expect(router.refresh).toHaveBeenCalledTimes(3);
    expect(screen.queryByText(/尚未取得更新的 Finance 資料/u)).not.toBeInTheDocument();
    advance(55_000);
    expect(router.refresh).toHaveBeenCalledTimes(4);
  });
  it("stops immediately on a malformed returned timestamp and can recover through a validated manual read", () => {
    const view = render(<StoreOverviewWorkspace overview={overview} />);
    const bad: StoreOverview = { ...overview, finance: { status: "ready", data: {
      income: "10.00", expenses: "5.00", entryCount: 2, generatedAt: "malformed" } } };
    router.refresh.mockImplementationOnce(() => { view.rerender(<StoreOverviewWorkspace overview={bad} />); });
    advance(55_000);
    expect(screen.getByText(/尚未取得更新的 Finance 資料/u)).toHaveTextContent("自動更新已暫停");
    advance(120_000);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    router.refresh.mockImplementation(() => { view.rerender(<StoreOverviewWorkspace overview={refreshed()} />); });
    fireEvent.submit(screen.getByRole("form"));
    expect(screen.queryByText(/尚未取得更新的 Finance 資料/u)).not.toBeInTheDocument();
    advance(55_000);
    expect(router.refresh).toHaveBeenCalledTimes(3);
  });
  it("changes periods only through guarded navigation and never adds branch or entity query parameters", () => {
    const view = render(<StoreOverviewWorkspace overview={overview} />);
    router.push.mockImplementation(() => { expect(hasViewTransition()).toBe(true); });
    fireEvent.change(screen.getByLabelText("收支月份"), { target: { value: "2026-08" } });
    fireEvent.submit(screen.getByRole("form"));
    expect(router.push).toHaveBeenCalledWith("/app/store-overview?date=2026-09-26&month=2026-08");
    expect(hasViewTransition()).toBe(false);
    view.rerender(<StoreOverviewWorkspace overview={{ ...refreshed(), periods: { ...overview.periods, month: "2026-08" } }} />);
    advance(54_999);
    expect(router.refresh).not.toHaveBeenCalled();
    advance(1);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
  it("stops after a synchronous navigation error and offers manual recovery", () => {
    router.refresh.mockImplementation(() => { throw new Error("synthetic transport error"); });
    render(<StoreOverviewWorkspace overview={overview} />);
    advance(300_000);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(hasViewTransition()).toBe(false);
    expect(screen.getByText(/尚未取得更新的 Finance 資料/u)).toHaveTextContent("自動更新已暫停");
  });
  it("never reads or writes Finance data through persistent browser storage", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    render(<StoreOverviewWorkspace overview={overview} />);
    advance(55_000);
    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
  });
});
