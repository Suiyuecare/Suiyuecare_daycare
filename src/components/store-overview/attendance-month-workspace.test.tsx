// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { AttendanceMonthWorkspace } from "./attendance-month-workspace";
import { calendarMonthDays } from "@/lib/store-overview/attendance-month";
import type { AttendanceMonthSnapshot } from "@/lib/store-overview/attendance-month-snapshot";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => { cleanup(); vi.useRealTimers(); });
const snapshot: AttendanceMonthSnapshot = { month: "2026-09", branchName: "合成分支", demo: false, invalid: false,
  source: { status: "ready", data: { month: "2026-09", generatedAt: "2026-09-14T08:00:00Z",
    days: calendarMonthDays("2026-09").map((date) => ({ date, present: 0, leave: 0, absent: 0 })),
    totals: { present: 0, leave: 0, absent: 0 }, distinctPresentClients: 0 } } };
describe("owner monthly attendance", () => {
  it("renders same-snapshot days and explicit counting rules with correct drilldown dates", () => {
    render(<AttendanceMonthWorkspace snapshot={snapshot} />);
    expect(screen.getAllByRole("row")).toHaveLength(31);
    expect(screen.getByRole("link", { name: "查看 2026-09-30 出勤" })).toHaveAttribute("href", "/app/store-overview?date=2026-09-30&month=2026-09");
    expect(screen.getByText(/未登記不等於缺席/)).toBeInTheDocument();
    expect(screen.getByRole("form")).toHaveAttribute("method", "get");
  });
  it.each(["unavailable", "timeout"] as const)("does not show zeros for %s", (status) => {
    render(<AttendanceMonthWorkspace snapshot={{ ...snapshot, source: { status } }} />);
    expect(screen.queryByRole("table")).toBeNull(); expect(screen.getByRole("alert")).toHaveTextContent("不代表 0 人");
  });
  it("hides data on disconnect and requires a full request after reconnect", () => {
    render(<AttendanceMonthWorkspace snapshot={snapshot} />);
    act(() => window.dispatchEvent(new Event("offline")));
    expect(screen.queryByRole("table")).toBeNull(); expect(screen.getByRole("button", { name: "查詢月報" })).toBeDisabled();
    act(() => window.dispatchEvent(new Event("online")));
    expect(screen.queryByRole("table")).toBeNull(); expect(screen.getByRole("status")).toHaveTextContent("重新確認權限");
    expect(screen.getByRole("button", { name: "查詢月報" })).toBeEnabled();
  });
  it("invalid filters never render the source payload", () => {
    render(<AttendanceMonthWorkspace snapshot={{ ...snapshot, invalid: true }} />);
    expect(screen.queryByRole("table")).toBeNull(); expect(screen.getByRole("alert")).toHaveTextContent("未讀取報表");
  });
  it("marks an online snapshot stale after one minute", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-14T08:00:00Z"));
    render(<AttendanceMonthWorkspace snapshot={snapshot} />);
    expect(screen.getByText(/快照仍在效期內/)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60_001));
    expect(screen.getByText(/這份快照已過期/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新快照" })).toBeEnabled();
  });
});
