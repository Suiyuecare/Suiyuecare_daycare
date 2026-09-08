// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SnapshotFreshness } from "./snapshot-freshness";
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); refresh.mockReset(); });

describe("shared read-only snapshot freshness", () => {
  it("expires at the server boundary and only refreshes on explicit request", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-08T01:00:00Z"));
    render(<SnapshotFreshness expiresAt="2026-09-08T01:01:00Z" />);
    expect(screen.getByText(/仍在效期內/u)).toBeDefined();
    act(() => vi.advanceTimersByTime(60_001));
    expect(screen.getByText(/已過期/u)).toBeDefined(); expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "更新快照" }));
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("clears stale status only with a fresh server expiry", () => {
    const { rerender } = render(<SnapshotFreshness expiresAt="2020-01-01T00:00:00Z" />);
    expect(screen.getByText(/已過期/u)).toBeDefined();
    rerender(<SnapshotFreshness expiresAt={new Date(Date.now() + 60_000).toISOString()} />);
    expect(screen.getByText(/仍在效期內/u)).toBeDefined();
  });
  it("distinguishes offline and reenables refresh after reconnection", () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<SnapshotFreshness expiresAt="2020-01-01T00:00:00Z" />);
    expect(screen.getByText(/目前離線/u)).toBeDefined();
    expect((screen.getByRole("button", { name: "更新快照" }) as HTMLButtonElement).disabled).toBe(true);
    online.mockReturnValue(true); fireEvent(window, new Event("online"));
    expect(screen.getByText(/已過期/u)).toBeDefined();
    expect((screen.getByRole("button", { name: "更新快照" }) as HTMLButtonElement).disabled).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });
  it("treats invalid expiry as stale and demo as explicitly non-live", () => {
    const { rerender } = render(<SnapshotFreshness expiresAt="invalid" />);
    expect(screen.getByText(/已過期/u)).toBeDefined();
    rerender(<SnapshotFreshness expiresAt="invalid" demo />);
    expect(screen.getByText(/合成展示快照/u)).toBeDefined();
    expect(screen.queryByRole("button", { name: "更新快照" })).toBeNull();
  });
  it("removes listeners and expiry timers when unmounted", () => {
    vi.useFakeTimers(); const remove = vi.spyOn(window, "removeEventListener");
    const documentRemove = vi.spyOn(document, "removeEventListener");
    const { unmount } = render(<SnapshotFreshness expiresAt={new Date(Date.now() + 60_000).toISOString()} />);
    unmount();
    expect(remove).toHaveBeenCalledWith("online", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("offline", expect.any(Function));
    expect(documentRemove).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});
