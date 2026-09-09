// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DASHBOARD_REFRESH_INTERVAL_MS,
  DashboardAutoRefresh,
} from "./dashboard-auto-refresh";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

describe("DashboardAutoRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    navigation.refresh.mockReset();
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
});
