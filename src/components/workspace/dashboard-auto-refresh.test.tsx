// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";

import {
  DASHBOARD_REFRESH_INTERVAL_MS,
  DashboardAutoRefresh,
} from "./dashboard-auto-refresh";

const navigation = vi.hoisted(() => ({ refresh: vi.fn(), synchronousTransition: false }));
const releases: (() => void)[] = [];
function remember(release: (() => void) | null) { if (release) releases.push(release); return release; }
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useTransition: () => {
    const realTransition = react.useTransition();
    return navigation.synchronousTransition ? [false, (action: () => void) => action()] : realTransition;
  } };
});

describe("DashboardAutoRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    navigation.refresh.mockReset();
    navigation.synchronousTransition = false;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    cleanup();
    for (const release of releases.splice(0)) release();
    vi.useRealTimers();
  });

  it("refreshes before sixty seconds and supports an explicit refresh", () => {
    render(<DashboardAutoRefresh generatedAt="2026-09-02T08:00:00.000Z" />);

    act(() => vi.advanceTimersByTime(DASHBOARD_REFRESH_INTERVAL_MS - 1));
    expect(navigation.refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(navigation.refresh).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "立即更新" }));
    expect(navigation.refresh).toHaveBeenCalledTimes(2);
  });

  it("announces completion only when a newer snapshot arrives", () => {
    const { rerender } = render(<DashboardAutoRefresh generatedAt="2026-09-10T01:00:00Z" />);
    fireEvent.click(screen.getByRole("button", { name: "立即更新" }));
    expect(screen.queryByText("工作清單已更新。")).not.toBeInTheDocument();
    rerender(<DashboardAutoRefresh generatedAt="2026-09-10T01:01:00Z" />);
    expect(screen.getByRole("status")).toHaveTextContent("工作清單已更新。");
    expect(screen.queryByText("正在更新工作清單。")).not.toBeInTheDocument();
  });

  it("pauses while hidden and catches up after returning to the foreground", () => {
    render(<DashboardAutoRefresh generatedAt="2026-09-02T08:00:00.000Z" />);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    act(() => vi.advanceTimersByTime(DASHBOARD_REFRESH_INTERVAL_MS));
    expect(navigation.refresh).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(navigation.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh while offline and catches up on reconnection", () => {
    render(<DashboardAutoRefresh generatedAt="2026-09-02T08:00:00.000Z" />);
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    act(() => window.dispatchEvent(new Event("offline")));
    expect(screen.getByText("目前離線，清單可能不是最新。請恢復連線後更新。")).toBeVisible();
    expect(screen.getByRole("button", { name: "立即更新" })).toBeDisabled();

    act(() => vi.advanceTimersByTime(DASHBOARD_REFRESH_INTERVAL_MS));
    expect(navigation.refresh).not.toHaveBeenCalled();

    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });
    act(() => window.dispatchEvent(new Event("online")));
    expect(navigation.refresh).toHaveBeenCalledTimes(1);
  });

  it("blocks timer, manual, online and visibility refresh while an outcome is unresolved", () => {
    render(<DashboardAutoRefresh generatedAt="2026-09-15T01:00:00Z" />);
    const button = screen.getByRole("button", { name: "立即更新" });
    let release: (() => void) | null = null;
    act(() => {
      release = remember(tryAcquirePendingOperation());
      fireEvent.click(button); // Handler also checks the store before UI rerenders.
      vi.advanceTimersByTime(DASHBOARD_REFRESH_INTERVAL_MS * 2);
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(button).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("自動與手動更新已暫停");
    expect(navigation.refresh).not.toHaveBeenCalled();
    act(() => release?.());
    fireEvent.click(button);
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it("does not start a second view transition while a branch change owns the view", () => {
    const release = remember(tryAcquireViewTransition());
    render(<DashboardAutoRefresh generatedAt="2026-09-15T01:00:00Z" />);
    act(() => vi.advanceTimersByTime(DASHBOARD_REFRESH_INTERVAL_MS));
    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("暫停重複更新");
    expect(navigation.refresh).not.toHaveBeenCalled();
    act(() => release?.());
  });

  it("blocks a write from starting inside refresh and releases after the transition settles", async () => {
    let finish!: () => void;
    navigation.refresh.mockImplementation(() => {
      expect(tryAcquirePendingOperation()).toBeNull();
      return new Promise<void>((resolve) => { finish = resolve; });
    });
    render(<DashboardAutoRefresh generatedAt="2026-09-15T01:00:00Z" />);
    fireEvent.click(screen.getByRole("button", { name: "立即更新" }));
    expect(tryAcquirePendingOperation()).toBeNull();
    act(() => vi.advanceTimersByTime(DASHBOARD_REFRESH_INTERVAL_MS));
    expect(navigation.refresh).toHaveBeenCalledOnce();
    await act(async () => finish());
    expect(remember(tryAcquirePendingOperation())).not.toBeNull();
  });

  it("releases a refresh lease if the view unmounts before a new snapshot", () => {
    navigation.refresh.mockImplementation(() => new Promise<void>(() => undefined));
    const { unmount } = render(<DashboardAutoRefresh generatedAt="2026-09-15T01:00:00Z" />);
    fireEvent.click(screen.getByRole("button", { name: "立即更新" }));
    expect(tryAcquirePendingOperation()).toBeNull();
    unmount();
    expect(remember(tryAcquirePendingOperation())).not.toBeNull();
  });

  it("releases repeated same-snapshot refreshes even if pending never renders true", () => {
    navigation.synchronousTransition = true;
    render(<DashboardAutoRefresh generatedAt="2026-09-15T01:00:00Z" />);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      fireEvent.click(screen.getByRole("button", { name: "立即更新" }));
      expect(navigation.refresh).toHaveBeenCalledTimes(attempt);
      act(() => { const release = remember(tryAcquirePendingOperation()); expect(release).not.toBeNull(); release?.(); });
    }
  });
});
