// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDemoDailySnapshot } from "@/lib/core-care/demo";
import { buildTodayWorkRows } from "@/lib/core-care/today-work";
import type { CareRosterSnapshot } from "@/lib/care-roster/types";
import { TodayWorkList } from "./today-work-list";
import { DashboardWorkspace } from "./dashboard-workspace";

vi.mock("@/components/app/navigation-link", () => ({
  NavigationLink: ({ loadingLabel, ...props }: ComponentProps<"a"> & { loadingLabel: string }) => <a {...props} data-loading-label={loadingLabel} />,
}));
vi.mock("./dashboard-auto-refresh", () => ({ DashboardAutoRefresh: () => <button onClick={() => undefined}>立即更新</button> }));
afterEach(cleanup);
const date = "2026-09-10";
const snapshot = buildDemoDailySnapshot(date);
const rows = buildTodayWorkRows(snapshot);

describe("TodayWorkList", () => {
  it("shows selected-shift short statuses and one next action while preserving full evidence in a disclosure", () => {
    const roster: CareRosterSnapshot = { status: "ready", manager: false, demo: true, staffOptions: [],
      assignments: (["morning", "afternoon"] as const).map((shift) => ({
        id: `assignment-${shift}`, clientId: snapshot.clients[0]!.clientId, staffUserId: "assigned-staff",
        staffName: "合成照服員", serviceDate: date, shift, version: 1, state: "scheduled", isServiceEligible: true, serviceEligibility: "eligible", sourceNote: "合成資料",
        tasks: [{ kind: "temperature", status: shift === "morning" ? "recorded" : "pending", evidenceAt: shift === "morning" ? "2026-09-10T01:00:00Z" : null },
          { kind: "care_diary", status: "pending", evidenceAt: null }],
      })) };
    const { container } = render(<TodayWorkList rows={buildTodayWorkRows(snapshot, roster)} serviceDate={date} access={snapshot.sourceAccess} roster={roster} />);
    fireEvent.change(screen.getByRole("combobox", { name: "班別" }), { target: { value: "afternoon" } });
    fireEvent.click(screen.getByRole("button", { name: /量測待完成 1/ }));
    const person = container.querySelector<HTMLElement>(".today-client")!;
    const statuses = person.querySelector<HTMLElement>(".today-client__status")!;
    expect(within(statuses).getAllByText("待記錄")).toHaveLength(2);
    expect(statuses).not.toHaveTextContent("班已簽署");
    expect(within(person).getAllByRole("link")).toHaveLength(1);
    expect(within(person).getByRole("link")).toHaveAttribute("href",
      `/app/staff/daily-care/vital-signs?date=${date}&client=${snapshot.clients[0]!.clientId}&shift=afternoon`);
    const detail = person.querySelector<HTMLDetailsElement>("details")!;
    expect(detail).not.toHaveAttribute("open");
    fireEvent.click(within(person).getByText("陳O華・分工與紀錄詳情"));
    expect(detail).toHaveAttribute("open");
    expect(within(detail).getByRole("region", { name: "下午照顧安排" })).toHaveTextContent("尚待記錄");
    expect(within(detail).queryByRole("region", { name: "上午照顧安排" })).not.toBeInTheDocument();
    expect(detail).toHaveTextContent("0／1 項已有紀錄");
    expect(detail).toHaveTextContent("已有紀錄不代表全部照顧工作完成");
  });

  it("clears only the local search, preserving the selected shift and work filter without a request", () => {
    const request = vi.spyOn(globalThis, "fetch");
    const roster: CareRosterSnapshot = { status: "ready", manager: false, demo: true, staffOptions: [], assignments: [{
      id: "assignment-afternoon", clientId: snapshot.clients[0]!.clientId, staffUserId: "assigned-staff", staffName: "合成照服員",
      serviceDate: date, shift: "afternoon", version: 1, state: "scheduled", isServiceEligible: true, serviceEligibility: "eligible", sourceNote: "合成資料",
      tasks: [{ kind: "care_diary", status: "pending", evidenceAt: null }],
    }] };
    render(<TodayWorkList rows={buildTodayWorkRows(snapshot, roster)} serviceDate={date} access={snapshot.sourceAccess} roster={roster} />);
    fireEvent.change(screen.getByRole("combobox", { name: "班別" }), { target: { value: "afternoon" } });
    fireEvent.click(screen.getByRole("button", { name: /日誌待完成 1/ }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no-match" } });
    fireEvent.click(screen.getByRole("button", { name: "清除搜尋今日個案姓名或代碼" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("searchbox")).toHaveFocus();
    expect(screen.getByRole("combobox", { name: "班別" })).toHaveValue("afternoon");
    expect(screen.getByRole("status")).toHaveTextContent("日誌待完成：1 位");
    expect(screen.getByRole("link")).toHaveAttribute("href", expect.stringContaining("shift=afternoon"));
    expect(request).not.toHaveBeenCalled();
    request.mockRestore();
  });

  it("keeps unavailable scheduling visibly distinct from the authorized in-case list", () => {
    render(<TodayWorkList rows={rows} serviceDate={date} access={snapshot.sourceAccess}
      roster={{ status: "unavailable", manager: false, demo: false, staffOptions: [], assignments: [] }} />);
    expect(screen.getByText(/今日安排未取得，名單不代表今天應到/)).toBeVisible();
    expect(screen.getByRole("heading", { name: "在案工作清單" })).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "班別" })).not.toBeInTheDocument();
  });

  it.each(["草稿待完成", "待簽署"])("keeps %s visible even when a planned diary already has signed evidence", (state) => {
    const roster: CareRosterSnapshot = { status: "ready", manager: false, demo: true, staffOptions: [], assignments: [{
      id: "assignment-morning", clientId: rows[0]!.id, staffUserId: "assigned-staff", staffName: "合成照服員",
      serviceDate: date, shift: "morning", version: 1, state: "scheduled", isServiceEligible: true, serviceEligibility: "eligible", sourceNote: "合成資料",
      tasks: [{ kind: "care_diary", status: "recorded", evidenceAt: "2026-09-10T01:00:00Z" }],
    }] };
    const person = { ...rows[0]!, tasks: ["diary" as const], diary: `1／1 班已簽署；有${state}日誌`, plannedShifts: roster.assignments };
    const { container } = render(<TodayWorkList rows={[person]} serviceDate={date} access={snapshot.sourceAccess} roster={roster} />);
    expect(container.querySelector(".today-client__status")).toHaveTextContent(state);
    expect(container.querySelector(".today-client__status")).not.toHaveTextContent("已簽署");
    expect(screen.getByRole("link")).toHaveAttribute("href", expect.stringContaining("care-diary"));
    expect(container.querySelector("details")).toHaveTextContent(`1／1 班已簽署；有${state}日誌`);
  });

  it("carries the explicitly chosen afternoon through the person-specific next action", () => {
    const roster: CareRosterSnapshot = { status: "ready", manager: false, demo: true, staffOptions: [],
      assignments: (["morning", "afternoon"] as const).map((shift) => ({
        id: `assignment-${shift}`, clientId: snapshot.clients[0]!.clientId, staffUserId: "assigned-staff",
        staffName: "合成照服員", serviceDate: date, shift, version: 1, state: "scheduled", isServiceEligible: true, serviceEligibility: "eligible", sourceNote: "合成資料",
        tasks: [{ kind: "care_diary", status: "pending", evidenceAt: null }],
      })) };
    render(<TodayWorkList rows={buildTodayWorkRows(snapshot, roster)} serviceDate={date} access={snapshot.sourceAccess} roster={roster} />);
    fireEvent.change(screen.getByRole("combobox", { name: "班別" }), { target: { value: "afternoon" } });
    fireEvent.click(screen.getByRole("button", { name: /日誌待完成 1/ }));
    expect(screen.getByRole("link", { name: /陳O華.*下午・接續照顧日誌/ })).toHaveAttribute("href",
      `/app/staff/daily-care/care-diary?date=${date}&client=${snapshot.clients[0]!.clientId}&shift=afternoon`);
    expect(screen.queryByRole("region", { name: "上午照顧安排" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 位");
  });
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
  it("shows the preparation entrance only when the server explicitly enables it, including errors", () => {
    const { rerender } = render(<DashboardWorkspace snapshot={snapshot} serviceDate={date} />);
    expect(screen.queryByRole("link", { name: "主管：檢查開站缺項" })).not.toBeInTheDocument();
    rerender(<DashboardWorkspace snapshot={snapshot} serviceDate={date} canOpenReadiness />);
    expect(screen.getByRole("link", { name: "主管：檢查開站缺項" })).toHaveAttribute("href",
      `/app/staff/operations/organization?effectiveOn=${date}#opening-readiness`);
    rerender(<DashboardWorkspace snapshot={null} serviceDate={date} canOpenReadiness loadError />);
    expect(screen.getByRole("link", { name: "主管：檢查開站缺項" })).toBeVisible();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });
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
