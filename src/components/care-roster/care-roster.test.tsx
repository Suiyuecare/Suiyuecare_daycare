// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { buildDemoDailySnapshot } from "@/lib/core-care/demo";
import { buildTodayWorkRows } from "@/lib/core-care/today-work";
import type { CareRosterSnapshot } from "@/lib/care-roster/types";
import { TodayWorkList } from "@/components/workspace/today-work-list";
import { RosterComposer } from "./roster-composer";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/app/navigation-link", () => ({ NavigationLink: ({ loadingLabel, ...props }: ComponentProps<"a"> & { loadingLabel: string }) => <a {...props} data-loading-label={loadingLabel} /> }));
afterEach(cleanup);
const snapshot = buildDemoDailySnapshot("2026-09-12");
const roster: CareRosterSnapshot = { manager: false, status: "ready", demo: false, staffOptions: [], assignments: [{
  id: "f1111111-1111-4111-8111-111111111111", clientId: snapshot.clients[0].clientId, staffUserId: "f1111111-1111-4111-8111-111111111111", staffName: "合成照服員",
  serviceDate: snapshot.serviceDate, shift: "afternoon", version: 1, state: "scheduled", sourceNote: "合成核准計畫", tasks: [{ kind: "temperature", status: "pending", evidenceAt: null }],
}] };
describe("careworker roster interface", () => {
  it("shows my assignments and separate shift tasks without manager controls", () => {
    render(<TodayWorkList rows={buildTodayWorkRows(snapshot, roster)} roster={roster} serviceDate={snapshot.serviceDate} access={snapshot.sourceAccess} />);
    expect(screen.getByRole("heading", { name: "我的當班個案" })).toBeVisible();
    expect(screen.getByText("體溫：尚待記錄")).toBeVisible();
    expect(screen.queryByText("只看待指派")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "班別" }), { target: { value: "morning" } });
    expect(screen.queryByText(snapshot.clients[0].displayName)).not.toBeInTheDocument();
  });
  it("never presents failed roster retrieval as no work or an expected denominator", () => {
    const unavailable = { ...roster, status: "unavailable" as const, assignments: [] };
    render(<TodayWorkList rows={buildTodayWorkRows(snapshot, unavailable)} roster={unavailable} serviceDate={snapshot.serviceDate} access={snapshot.sourceAccess} />);
    expect(screen.getByText(/每日分工暫時無法取得/)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "我的當班個案" })).not.toBeInTheDocument();
  });
  it("does not expose supervisor composer to worker", () => {
    const { container } = render(<RosterComposer roster={roster} clients={snapshot.clients} serviceDate={snapshot.serviceDate} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("marks synthetic allocation as nonpersisting", () => {
    render(<RosterComposer roster={{ ...roster, manager: true, demo: true }} clients={snapshot.clients} serviceDate={snapshot.serviceDate} />);
    fireEvent.click(screen.getByText("主管：安排／調整每日照顧分工"));
    expect(screen.getByRole("button", { name: "合成展示，不寫入資料", hidden: true })).toBeDisabled();
  });
  it("does not replace an open edit or silently advance its base version on refresh", () => {
    const first = { ...roster, manager: true, demo: true, assignments: [{ ...roster.assignments[0], shift: "morning" as const }] };
    const { rerender } = render(<RosterComposer roster={first} clients={snapshot.clients} serviceDate={snapshot.serviceDate} />);
    fireEvent.click(screen.getByText("主管：安排／調整每日照顧分工"));
    fireEvent.change(screen.getByRole("combobox", { name: "個案", hidden: true }), { target: { value: first.assignments[0].clientId } });
    fireEvent.change(screen.getByRole("textbox", { name: "安排依據／異動理由", hidden: true }), { target: { value: "主管填寫中尚未送出" } });
    rerender(<RosterComposer roster={{ ...first, assignments: [{ ...first.assignments[0], version: 2, sourceNote: "另一主管的異動" }] }} clients={snapshot.clients} serviceDate={snapshot.serviceDate} />);
    expect(screen.getByRole("textbox", { name: "安排依據／異動理由", hidden: true })).toHaveValue("主管填寫中尚未送出");
    expect(screen.getByText("調整第 1 版，儲存後保留歷史")).toBeInTheDocument();
  });
});
