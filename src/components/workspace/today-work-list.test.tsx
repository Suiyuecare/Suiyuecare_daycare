// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDemoDailySnapshot } from "@/lib/core-care/demo";
import { buildTodayWorkRows } from "@/lib/core-care/today-work";
import { TodayWorkList } from "./today-work-list";
import { DashboardWorkspace } from "./dashboard-workspace";

vi.mock("@/components/app/navigation-link", () => ({
  NavigationLink: ({ loadingLabel, ...props }: ComponentProps<"a"> & { loadingLabel: string }) => <a {...props} data-loading-label={loadingLabel} />,
}));
vi.mock("./dashboard-auto-refresh", () => ({ DashboardAutoRefresh: () => <button>立即更新</button> }));
afterEach(cleanup);
const date = "2026-09-10";
const snapshot = buildDemoDailySnapshot(date);
const rows = buildTodayWorkRows(snapshot);

describe("TodayWorkList", () => {
  it("takes the user from a matching count to the same people and correct selected-client URL", () => {
    render(<TodayWorkList rows={rows} serviceDate={date} access={snapshot.sourceAccess} />);
    expect(screen.getByRole("status")).toHaveTextContent("待處理：5 位");
    fireEvent.click(screen.getByRole("button", { name: /尚無量測 2/ }));
    expect(screen.getByRole("status")).toHaveTextContent("尚無量測：2 位");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    const link = screen.getByRole("link", { name: /黃O生.*前往量測/ });
    expect(link).toHaveAttribute("href", "/app/staff/daily-care/vital-signs?date=2026-09-10&client=a3333333-3333-4333-8333-333333333333");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "HX-026" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /尚無出勤 1/ }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("尚無出勤：1 位");
    fireEvent.click(screen.getByRole("button", { name: /日誌待完成 2/ }));
    expect(screen.getByRole("link", { name: /張O德.*接續照顧日誌/ })).toHaveAttribute("href", "/app/staff/daily-care/care-diary?date=2026-09-10&client=a5555555-5555-4555-8555-555555555555");
  });

  it("provides an actionable empty search", () => {
    render(<TodayWorkList rows={rows} serviceDate={date} access={snapshot.sourceAccess} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nobody" } });
    expect(screen.getByText("找不到符合條件的個案")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "查看全部在案個案" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
  });

  it("retains the chosen filter on refresh and clamps a disappearing last page", () => {
    const many = Array.from({ length: 45 }, (_, index) => ({ ...rows[0]!, id: `a1111111-1111-4111-8111-${String(index).padStart(12, "0")}`, code: `TEST-${index}` }));
    const { rerender } = render(<TodayWorkList rows={many} serviceDate={date} access={snapshot.sourceAccess} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(20);
    fireEvent.click(screen.getByRole("button", { name: "下一頁" }));
    fireEvent.click(screen.getByRole("button", { name: "下一頁" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    rerender(<TodayWorkList rows={rows} serviceDate={date} access={snapshot.sourceAccess} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.queryByRole("navigation", { name: "今日個案分頁" })).not.toBeInTheDocument();
  });

  it("uses a restricted state instead of zero when a source is unavailable", () => {
    const access = { ...snapshot.sourceAccess, measurements: false };
    render(<TodayWorkList rows={buildTodayWorkRows({ ...snapshot, sourceAccess: access })} serviceDate={date} access={access} />);
    const counter = screen.getByRole("button", { name: /尚無量測.*無查閱權限/ });
    expect(counter).toBeDisabled();
    expect(within(counter).getByText("—")).toBeVisible();
  });

  it("does not render any client when client access is missing", () => {
    render(<TodayWorkList rows={rows} serviceDate={date} access={{ ...snapshot.sourceAccess, clients: false }} />);
    expect(screen.getByText("目前無個案查閱權限")).toBeVisible();
    expect(screen.queryByText("陳O華")).not.toBeInTheDocument();
  });

  it("does not turn a selected filter into zero when its permission is revoked on refresh", () => {
    const { rerender } = render(<TodayWorkList rows={rows} serviceDate={date} access={snapshot.sourceAccess} />);
    fireEvent.click(screen.getByRole("button", { name: /尚無量測 2/ }));
    const access = { ...snapshot.sourceAccess, measurements: false };
    rerender(<TodayWorkList rows={buildTodayWorkRows({ ...snapshot, sourceAccess: access })} serviceDate={date} access={access} />);
    expect(screen.getByRole("status")).toHaveTextContent("目前沒有「尚無量測」查閱權限");
    expect(screen.getByRole("status")).not.toHaveTextContent("0 位");
    expect(screen.queryByText("此清單目前沒有待處理個案")).not.toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });
});

describe("dashboard frontline / management boundary", () => {
  it("defaults to frontline actions without technical detail", () => {
    const { rerender } = render(<DashboardWorkspace snapshot={snapshot} serviceDate={date} />);
    expect(screen.queryByText("管理檢查明細")).not.toBeInTheDocument();
    rerender(<DashboardWorkspace snapshot={snapshot} serviceDate={date} canViewManagementDetails />);
    expect(screen.getByText("管理檢查明細").closest("details")).not.toHaveAttribute("open");
  });
  it("never replaces an error with demo or all-complete numbers", () => {
    render(<DashboardWorkspace snapshot={snapshot} serviceDate={date} loadError />);
    expect(screen.getByRole("alert")).toHaveTextContent("目前無法確認哪些工作已完成");
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });
});
