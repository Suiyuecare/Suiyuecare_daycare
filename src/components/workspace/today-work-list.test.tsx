// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDemoDailySnapshot } from "@/lib/core-care/demo";
import { buildTodayWorkRows } from "@/lib/core-care/today-work";
import type { CareRosterSnapshot } from "@/lib/care-roster/types";
import { TodayWorkList } from "./today-work-list";
import { DashboardWorkspace } from "./dashboard-workspace";

vi.mock("@/components/app/navigation-link", () => ({
  NavigationLink: ({ loadingLabel, onClick, ...props }: ComponentProps<"a"> & { loadingLabel: string }) => <a {...props} data-loading-label={loadingLabel}
    onClick={(event) => { onClick?.(event); event.preventDefault(); }} />,
}));
vi.mock("./dashboard-auto-refresh", () => ({ DashboardAutoRefresh: () => <button>立即更新</button> }));
afterEach(cleanup);
const date = "2026-09-10";
const snapshot = buildDemoDailySnapshot(date);
const rows = buildTodayWorkRows(snapshot);

describe("TodayWorkList", () => {
  it("keeps search ahead of collapsed mobile filters and preserves the selected scope", () => {
    const { container } = render(<TodayWorkList rows={rows} serviceDate={date} access={snapshot.sourceAccess} />);
    const search = screen.getByRole("searchbox", { name: "搜尋今日個案姓名或代碼" });
    const counters = screen.getByRole("group", { name: "篩選待處理工作" });
    const toggle = screen.getByRole("button", { name: /篩選個案與工作/ });
    expect(search.compareDocumentPosition(counters) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(counters).toHaveClass("today-filters--collapsed");
    expect(container.querySelector("#today-filter-controls")).toHaveClass("today-filters--collapsed");

    fireEvent.change(search, { target: { value: "HX-026" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(search).toHaveValue("HX-026");
    fireEvent.click(screen.getByRole("button", { name: "清除搜尋今日個案姓名或代碼" }));
    expect(search).toHaveValue("");
    expect(search).toHaveFocus();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(counters).not.toHaveClass("today-filters--collapsed");
    fireEvent.click(screen.getByRole("button", { name: /尚無量測 2/ }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(counters).toHaveClass("today-filters--collapsed");
    expect(container.querySelector(".today-client")).toHaveFocus();
    expect(screen.getByText("尚無量測・2 位")).toBeInTheDocument();
  });

  it("waits until Chinese input composition finishes before filtering", () => {
    render(<TodayWorkList rows={rows} serviceDate={date} access={snapshot.sourceAccess} />);
    const search = screen.getByRole("searchbox", { name: "搜尋今日個案姓名或代碼" });
    fireEvent.compositionStart(search);
    fireEvent.change(search, { target: { value: "黃" } });
    expect(search).toHaveValue("黃");
    expect(screen.getByRole("status")).toHaveTextContent("待處理：5 位");
    fireEvent.compositionEnd(search);
    expect(screen.getByRole("status")).toHaveTextContent("待處理：1 位（搜尋結果）");
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
  it("offers each pending diary shift instead of a full-day entry when both shifts need work", () => {
    const roster: CareRosterSnapshot = { status: "ready", manager: false, demo: true, staffOptions: [],
      assignments: (["morning", "afternoon"] as const).map((shift) => ({
        id: `assignment-${shift}`, clientId: snapshot.clients[0]!.clientId, staffUserId: "assigned-staff",
        staffName: "合成照服員", serviceDate: date, shift, version: 1, state: "scheduled", isServiceEligible: true, serviceEligibility: "eligible", sourceNote: "合成資料",
        tasks: [{ kind: "care_diary", status: "pending", evidenceAt: null }],
      })) };
    render(<TodayWorkList rows={buildTodayWorkRows(snapshot, roster)} serviceDate={date} access={snapshot.sourceAccess} roster={roster} />);
    fireEvent.click(screen.getByRole("button", { name: /日誌待完成 1/ }));
    const links = screen.getAllByRole("link", { name: /陳O華.*接續照顧日誌/ });
    expect(links).toHaveLength(2);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      `/app/staff/daily-care/care-diary?date=${date}&client=${snapshot.clients[0]!.clientId}&shift=morning`,
      `/app/staff/daily-care/care-diary?date=${date}&client=${snapshot.clients[0]!.clientId}&shift=afternoon`,
    ]);
    expect(screen.queryByRole("link", { name: "陳O華（HX-021）：接續照顧日誌" })).not.toBeInTheDocument();
  });
  it("uses the sole pending diary shift even when another shift has already been recorded", () => {
    const roster: CareRosterSnapshot = { status: "ready", manager: false, demo: true, staffOptions: [],
      assignments: (["morning", "afternoon"] as const).map((shift) => ({
        id: `assignment-${shift}`, clientId: snapshot.clients[0]!.clientId, staffUserId: "assigned-staff",
        staffName: "合成照服員", serviceDate: date, shift, version: 1, state: "scheduled", isServiceEligible: true, serviceEligibility: "eligible", sourceNote: "合成資料",
        tasks: [{ kind: "care_diary", status: shift === "morning" ? "recorded" as const : "pending" as const, evidenceAt: null }],
      })) };
    render(<TodayWorkList rows={buildTodayWorkRows(snapshot, roster)} serviceDate={date} access={snapshot.sourceAccess} roster={roster} />);
    fireEvent.click(screen.getByRole("button", { name: /日誌待完成 1/ }));
    expect(screen.getByRole("link", { name: /陳O華.*下午・接續照顧日誌/ })).toHaveAttribute("href",
      `/app/staff/daily-care/care-diary?date=${date}&client=${snapshot.clients[0]!.clientId}&shift=afternoon`);
    expect(screen.queryByRole("link", { name: /上午・接續照顧日誌/ })).not.toBeInTheDocument();
  });
  it("puts the next action before expandable shift details without hiding an unassigned shift", () => {
    const roster: CareRosterSnapshot = { status: "ready", manager: true, demo: true, staffOptions: [],
      assignments: (["morning", "afternoon"] as const).map((shift) => ({
        id: `assignment-${shift}`, clientId: snapshot.clients[0]!.clientId,
        staffUserId: shift === "morning" ? null : "assigned-staff",
        staffName: shift === "morning" ? null : "合成照服員",
        serviceDate: date, shift, version: 1, state: "scheduled", isServiceEligible: true, serviceEligibility: "eligible", sourceNote: "合成資料",
        tasks: [{ kind: "care_diary" as const, status: "pending" as const, evidenceAt: null }],
      })) };
    const { container } = render(<TodayWorkList rows={buildTodayWorkRows(snapshot, roster)} serviceDate={date} access={snapshot.sourceAccess} roster={roster} />);
    const card = container.querySelector(".today-client")!;
    const action = card.querySelector(".today-client__action")!;
    const details = card.querySelector(".today-client__schedule")!;
    const summary = details.querySelector("summary")!;
    expect(action.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(details).not.toHaveAttribute("open");
    expect(summary).toHaveTextContent("上午、下午・1 班待指派");
    expect(within(card as HTMLElement).getByText("需留意")).toBeVisible();
    fireEvent.click(summary);
    expect(details).toHaveAttribute("open");
    expect(within(details as HTMLElement).getByText("上午・待指派負責人")).toBeVisible();
    expect(within(details as HTMLElement).getByText("下午・合成照服員")).toBeVisible();
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
    expect(screen.getByRole("button", { name: /尚無量測 1 位（目前搜尋）/ })).toHaveTextContent("位・搜尋內");
    fireEvent.click(screen.getByRole("button", { name: /尚無出勤 0 位（目前搜尋）/ }));
    expect(screen.getByRole("searchbox")).toHaveValue("HX-026");
    expect(screen.getByRole("status")).toHaveTextContent("尚無出勤：0 位（搜尋結果）");
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除搜尋並查看全部在案個案" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("全部在案：6 位");
    fireEvent.click(screen.getByRole("button", { name: /日誌待完成 2/ }));
    expect(screen.getByRole("link", { name: /張O德.*接續照顧日誌/ })).toHaveAttribute("href", "/app/staff/daily-care/care-diary?date=2026-09-10&client=a5555555-5555-4555-8555-555555555555");
  });

  it("provides an actionable empty search", () => {
    render(<TodayWorkList rows={rows} serviceDate={date} access={snapshot.sourceAccess} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nobody" } });
    expect(screen.getByText("找不到符合條件的個案")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "清除搜尋並查看全部在案個案" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
  });

  it("does not label whitespace-only input as a filtered result", () => {
    render(<TodayWorkList rows={rows} serviceDate={date} access={snapshot.sourceAccess} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: " " } });
    expect(screen.getByRole("status")).toHaveTextContent("待處理：5 位");
    expect(screen.getByRole("status")).not.toHaveTextContent("搜尋結果");
  });

  it("clears an empty search without silently changing the selected shift", () => {
    const roster: CareRosterSnapshot = { status: "ready", manager: false, demo: true, staffOptions: [], assignments: [{
      id: "afternoon-assignment", clientId: snapshot.clients[0]!.clientId, staffUserId: "assigned-staff",
      staffName: "合成照服員", serviceDate: date, shift: "afternoon", version: 1, state: "scheduled",
      isServiceEligible: true, serviceEligibility: "eligible", sourceNote: "合成資料", tasks: [],
    }] };
    render(<TodayWorkList rows={buildTodayWorkRows(snapshot, roster)} serviceDate={date} access={snapshot.sourceAccess} roster={roster} />);
    fireEvent.change(screen.getByRole("combobox", { name: "班別" }), { target: { value: "afternoon" } });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nobody" } });
    fireEvent.click(screen.getByRole("button", { name: "清除搜尋並查看目前條件名單" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "班別" })).toHaveValue("afternoon");
    expect(screen.getByRole("status")).toHaveTextContent("全部當班：1 位");
    expect(screen.getByRole("link", { name: /陳O華/ })).toBeVisible();
  });

  it("keeps a searched client and result focus when applying a mobile task filter", () => {
    const { container } = render(<TodayWorkList rows={rows} serviceDate={date} access={snapshot.sourceAccess} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "HX-023" } });
    const toggle = screen.getByRole("button", { name: /篩選個案與工作/ });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: /尚無量測 1 位（目前搜尋）/ }));
    expect(screen.getByRole("searchbox")).toHaveValue("HX-023");
    expect(screen.getByRole("status")).toHaveTextContent("尚無量測：1 位（搜尋結果）");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector(".today-client")).toHaveFocus();
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

  it("focuses and scrolls to the first new row after explicit pagination", () => {
    const previousScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    try {
      const many = Array.from({ length: 45 }, (_, index) => ({ ...rows[0]!, id: `a1111111-1111-4111-8111-${String(index).padStart(12, "0")}`, code: `TEST-${index}` }));
      render(<TodayWorkList rows={many} serviceDate={date} access={snapshot.sourceAccess} />);
      fireEvent.click(screen.getByRole("button", { name: "下一頁" }));
      expect(screen.getByText("TEST-20").closest("li")).toHaveFocus();
      expect(screen.getByRole("status")).toHaveTextContent("第 2 / 3 頁");
      expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "start" });
      fireEvent.click(screen.getByRole("button", { name: "下一頁" }));
      expect(screen.getByText("TEST-40").closest("li")).toHaveFocus();
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
      fireEvent.click(screen.getByRole("button", { name: "上一頁" }));
      expect(screen.getByText("TEST-20").closest("li")).toHaveFocus();
      expect(scrollIntoView).toHaveBeenCalledTimes(3);
    } finally {
      if (previousScrollIntoView) Object.defineProperty(Element.prototype, "scrollIntoView", previousScrollIntoView);
      else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    }
  });

  it("restores a same-actor search and task filter after returning without putting the query in history or Web Storage", async () => {
    window.history.replaceState({ __NA: true, preservedRouterState: "router" }, "", `/app/staff/workspace/dashboard?date=${date}`);
    const props = { rows, serviceDate: date, access: snapshot.sourceAccess, resumeScopeKey: "actor-a:branch-a" };
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const first = render(<TodayWorkList {...props} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "HX-023" } });
    fireEvent.click(screen.getByRole("button", { name: /尚無量測 1 位（目前搜尋）/ }));
    expect(screen.getByRole("searchbox")).toHaveValue("HX-023");
    fireEvent.click(screen.getByRole("link", { name: /黃O生.*前往量測/ }));
    const historyState = window.history.state;
    expect(historyState).toMatchObject({ __NA: true, preservedRouterState: "router", __daycareTodayResume: expect.any(String) });
    expect(JSON.stringify(historyState)).not.toContain("HX-023");
    expect(JSON.stringify(historyState)).not.toContain(rows[2]?.id);
    expect(storageWrite).not.toHaveBeenCalled();
    first.unmount();

    render(<TodayWorkList {...props} />);
    await waitFor(() => expect(screen.getByRole("searchbox")).toHaveValue("HX-023"));
    expect(screen.getByRole("status")).toHaveTextContent("尚無量測：1 位（搜尋結果）");
    expect(screen.getByRole("link", { name: /黃O生.*前往量測/ })).toBeVisible();
    storageWrite.mockRestore();
  });

  it("clamps restored pagination when the reauthorized list shrinks", async () => {
    window.history.replaceState({ __NA: true }, "", `/app/staff/workspace/dashboard?date=${date}`);
    const many = Array.from({ length: 45 }, (_, index) => ({ ...rows[0]!, id: `a1111111-1111-4111-8111-${String(index).padStart(12, "0")}`, code: `TEST-${index}` }));
    const props = { serviceDate: date, access: snapshot.sourceAccess, resumeScopeKey: "actor-b:branch-a" };
    const first = render(<TodayWorkList {...props} rows={many} />);
    fireEvent.click(screen.getByRole("button", { name: "下一頁" }));
    fireEvent.click(screen.getByRole("button", { name: "下一頁" }));
    fireEvent.click(screen.getByRole("link", { name: /TEST-40/ }));
    first.unmount();

    render(<TodayWorkList {...props} rows={many.slice(0, 23)} />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("第 2 / 2 頁"));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByText("TEST-40")).not.toBeInTheDocument();
  });

  it("restores the same service-day shift and unassigned-only choice", async () => {
    window.history.replaceState({ __NA: true }, "", `/app/staff/workspace/dashboard?date=${date}`);
    const roster: CareRosterSnapshot = { status: "ready", manager: true, demo: true, staffOptions: [],
      assignments: [snapshot.clients[0]!, snapshot.clients[1]!].map((client, index) => ({
        id: `assignment-${index}`, clientId: client.clientId, staffUserId: index === 0 ? null : "assigned-staff",
        staffName: index === 0 ? null : "合成照服員", serviceDate: date, shift: "afternoon" as const,
        version: 1, state: "scheduled" as const, isServiceEligible: true, serviceEligibility: "eligible" as const,
        sourceNote: "合成測試", tasks: [{ kind: "care_diary" as const, status: "pending" as const, evidenceAt: null }],
      })) };
    const props = { rows: buildTodayWorkRows(snapshot, roster), roster, serviceDate: date, access: snapshot.sourceAccess,
      resumeScopeKey: "actor-shift:branch-a" };
    const first = render(<TodayWorkList {...props} />);
    fireEvent.change(screen.getByRole("combobox", { name: "班別" }), { target: { value: "afternoon" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "只看待指派" }));
    expect(screen.getByRole("status")).toHaveTextContent("全部當班：1 位");
    fireEvent.click(screen.getByRole("link", { name: /陳O華.*下午/ }));
    first.unmount();

    render(<TodayWorkList {...props} />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "班別" })).toHaveValue("afternoon"));
    expect(screen.getByRole("checkbox", { name: "只看待指派" })).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent("全部當班：1 位");
    expect(screen.getByRole("link", { name: /陳O華.*下午/ })).toHaveAttribute("href", expect.stringContaining("shift=afternoon"));
  });

  it("never carries an in-memory search into another actor or branch, even if the visible clients overlap", () => {
    window.history.replaceState({ __NA: true }, "", `/app/staff/workspace/dashboard?date=${date}`);
    const common = { rows, serviceDate: date, access: snapshot.sourceAccess };
    const first = render(<TodayWorkList {...common} resumeScopeKey="actor-c:branch-a" />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "HX-023" } });
    first.unmount();

    render(<TodayWorkList {...common} resumeScopeKey="actor-d:branch-b" />);
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("待處理：5 位");
    expect(JSON.stringify(window.history.state)).not.toContain("HX-023");
  });

  it("erases a saved search after ten minutes when the tab becomes visible again", async () => {
    window.history.replaceState({ __NA: true }, "", `/app/staff/workspace/dashboard?date=${date}`);
    const props = { rows, serviceDate: date, access: snapshot.sourceAccess, resumeScopeKey: "actor-expiry:branch-a" };
    const first = render(<TodayWorkList {...props} />);
    await waitFor(() => expect(window.history.state.__daycareTodayResume).toEqual(expect.any(String)));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "HX-023" } });
    first.unmount();

    const future = Date.now() + 10 * 60_000 + 1;
    const now = vi.spyOn(Date, "now").mockReturnValue(future);
    try {
      document.dispatchEvent(new Event("visibilitychange"));
      render(<TodayWorkList {...props} />);
      expect(screen.getByRole("searchbox")).toHaveValue("");
      expect(screen.getByRole("status")).toHaveTextContent("待處理：5 位");
    } finally {
      now.mockRestore();
    }
  });

  it("erases the in-memory search immediately when logout begins", () => {
    window.history.replaceState({ __NA: true }, "", `/app/staff/workspace/dashboard?date=${date}`);
    const props = { rows, serviceDate: date, access: snapshot.sourceAccess, resumeScopeKey: "actor-logout:branch-a" };
    const first = render(<TodayWorkList {...props} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "HX-023" } });
    first.unmount();

    document.dispatchEvent(new Event("daycare:session-ending"));
    render(<TodayWorkList {...props} />);
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("待處理：5 位");
    expect(JSON.stringify(window.history.state)).not.toContain("HX-023");
  });

  it("keeps a restored restricted filter safely empty when that source permission is revoked", async () => {
    window.history.replaceState({ __NA: true }, "", `/app/staff/workspace/dashboard?date=${date}`);
    const scope = "actor-e:branch-a";
    const first = render(<TodayWorkList rows={rows} serviceDate={date} access={snapshot.sourceAccess} resumeScopeKey={scope} />);
    fireEvent.click(screen.getByRole("button", { name: /尚無量測 2/ }));
    fireEvent.click(screen.getByRole("link", { name: /黃O生.*前往量測/ }));
    first.unmount();

    const access = { ...snapshot.sourceAccess, measurements: false };
    render(<TodayWorkList rows={buildTodayWorkRows({ ...snapshot, sourceAccess: access })} serviceDate={date} access={access} resumeScopeKey={scope} />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("目前沒有「尚無量測」查閱權限"));
    expect(screen.queryByRole("link", { name: /前往量測/ })).not.toBeInTheDocument();
    expect(screen.queryByText("此清單目前沒有待處理個案")).not.toBeInTheDocument();
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
  it("remounts the work list with blank search when the active branch changes", () => {
    const { rerender } = render(<DashboardWorkspace snapshot={snapshot} serviceDate={date} resumeScopeKey="actor-branch-test:branch-a" />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "HX-023" } });
    expect(screen.getByRole("searchbox")).toHaveValue("HX-023");
    rerender(<DashboardWorkspace snapshot={snapshot} serviceDate={date} resumeScopeKey="actor-branch-test:branch-b" />);
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("待處理：5 位");
  });
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
