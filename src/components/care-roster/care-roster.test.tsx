// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { buildDemoDailySnapshot } from "@/lib/core-care/demo";
import { buildTodayWorkRows } from "@/lib/core-care/today-work";
import type { CareRosterSnapshot } from "@/lib/care-roster/types";
import { TodayWorkList } from "@/components/workspace/today-work-list";
import { RosterComposer } from "./roster-composer";
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), acquireOperation: vi.fn(), releaseOperation: vi.fn(), acquireView: vi.fn(), releaseView: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/navigation/pending-operation-lock", () => ({ tryAcquirePendingOperation: mocks.acquireOperation, tryAcquireViewTransition: mocks.acquireView }));
vi.mock("@/components/app/navigation-link", () => ({ NavigationLink: ({ loadingLabel, ...props }: ComponentProps<"a"> & { loadingLabel: string }) => <a {...props} data-loading-label={loadingLabel} /> }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
beforeEach(() => { mocks.acquireOperation.mockReturnValue(mocks.releaseOperation); mocks.acquireView.mockReturnValue(mocks.releaseView); });
const snapshot = buildDemoDailySnapshot("2026-09-12");
const roster: CareRosterSnapshot = { manager: false, status: "ready", demo: false, staffOptions: [], assignments: [{
  id: "f1111111-1111-4111-8111-111111111111", clientId: snapshot.clients[0].clientId, staffUserId: "f1111111-1111-4111-8111-111111111111", staffName: "合成照服員",
  serviceDate: snapshot.serviceDate, shift: "afternoon", version: 1, state: "scheduled", isServiceEligible: true, serviceEligibility: "eligible", sourceNote: "合成核准計畫", tasks: [{ kind: "temperature", status: "pending", evidenceAt: null }],
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
  it.each(["not_admitted", "inactive"] as const)("omits %s allocations from frontline cards and all counters", (serviceEligibility) => {
    const blocked = { ...roster, manager: true, assignments: [{ ...roster.assignments[0], isServiceEligible: false, serviceEligibility }] };
    render(<TodayWorkList rows={buildTodayWorkRows(snapshot, roster)} roster={blocked} serviceDate={snapshot.serviceDate} access={snapshot.sourceAccess} />);
    expect(screen.queryByText(snapshot.clients[0].displayName)).not.toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: /位，查看名單/ })) expect(button).toHaveAccessibleName(/ 0 位/);
    fireEvent.click(screen.getByRole("button", { name: "全部當班" }));
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });
  it("shows an authorized missing-from-today identity for explicit cancellation only", () => {
    const blocked = { ...roster, manager: true, assignments: [{ ...roster.assignments[0], isServiceEligible: false as const, serviceEligibility: "not_admitted" as const,
      clientIdentity: { displayName: "合成待收案甲", clientCode: "PENDING-01" }, tasks: [{ kind: "temperature" as const, status: "restricted" as const, evidenceAt: null }] }] };
    render(<RosterComposer roster={blocked} clients={[]} serviceDate={snapshot.serviceDate} />);
    const button = screen.getByRole("button", { name: "檢查並取消 合成待收案甲 下午分工", hidden: true });
    fireEvent.click(button);
    expect(screen.getByRole("combobox", { name: "個案", hidden: true })).toHaveValue(blocked.assignments[0].clientId);
    const state = screen.getByRole("combobox", { name: "服務安排", hidden: true });
    expect(state).toHaveValue("");
    expect(within(state).queryByRole("option", { name: "安排服務", hidden: true })).not.toBeInTheDocument();
    expect(screen.getByText(/未正式收案：只可取消/)).toBeInTheDocument();
    expect(screen.queryByText("體溫：尚待記錄")).not.toBeInTheDocument();
    expect(blocked.assignments[0].state).toBe("scheduled");
    fireEvent.change(screen.getByRole("combobox", { name: "班別", hidden: true }), { target: { value: "morning" } });
    expect(screen.getByRole("button", { name: "確認並儲存分工", hidden: true })).toBeDisabled();
    expect(screen.getByRole("alert", { hidden: true })).toHaveTextContent("沒有可取消的既有分工");
  });
  it("never substitutes a UUID or another identity when the authorized identity is absent", () => {
    const blocked = { ...roster, manager: true, assignments: [{ ...roster.assignments[0], isServiceEligible: false, serviceEligibility: "inactive" as const, clientIdentity: null }] };
    render(<RosterComposer roster={blocked} clients={[]} serviceDate={snapshot.serviceDate} />);
    expect(screen.getByText("個案識別暫無法確認")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /檢查並取消/, hidden: true })).not.toBeInTheDocument();
    expect(screen.queryByText(blocked.assignments[0].clientId)).not.toBeInTheDocument();
  });
});

const errorReply = (code: string, status: number) => Response.json({ requestId: roster.assignments[0].id, status: "error", data: null,
  errors: [{ code, message: "合成拒絕，請重新核對" }] }, { status });
function prepareWrite(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  const manager = { ...roster, manager: true, assignments: [{ ...roster.assignments[0], shift: "morning" as const }] };
  const view = render(<RosterComposer roster={manager} clients={snapshot.clients} serviceDate={snapshot.serviceDate} />);
  fireEvent.change(screen.getByRole("combobox", { name: "個案", hidden: true }), { target: { value: manager.assignments[0].clientId } });
  fireEvent.change(screen.getByRole("textbox", { name: "安排依據／異動理由", hidden: true }), { target: { value: "合成主管確認的原始內容" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /我已確認照顧計畫/, hidden: true }));
  const form = screen.getByRole("button", { name: "確認並儲存分工", hidden: true }).closest("form")!;
  return { ...view, form, manager };
}
describe("roster write outcome safety", () => {
  it("does not create a key or POST while a view update already owns the shared lock", async () => {
    mocks.acquireOperation.mockReturnValue(null);
    const uuid = vi.spyOn(crypto, "randomUUID");
    const fetchMock = vi.fn().mockResolvedValue(errorReply("ROSTER_REJECTED", 400));
    const { form } = prepareWrite(fetchMock); fireEvent.submit(form);
    expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("清單正在更新或分支正在切換");
    expect(uuid).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.releaseOperation).not.toHaveBeenCalled();
    mocks.acquireOperation.mockReturnValue(mocks.releaseOperation);
    fireEvent.submit(form);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(uuid).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.releaseOperation).toHaveBeenCalledTimes(1));
  });
  it("retains the opaque operation lease through unknown, denied retry and unmount", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue(errorReply("ROSTER_FORBIDDEN", 403));
    const { form, unmount } = prepareWrite(fetchMock); fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole("button", { name: "以原內容重試確認", hidden: true })).toBeEnabled());
    expect(mocks.acquireOperation).toHaveBeenCalledTimes(1); expect(mocks.releaseOperation).not.toHaveBeenCalled();
    fireEvent.submit(form);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "以原內容重試確認", hidden: true })).toBeEnabled());
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
    expect(mocks.acquireOperation).toHaveBeenCalledTimes(1);
    unmount(); expect(mocks.releaseOperation).not.toHaveBeenCalled();
  });
  it.each(["success", "first rejection"] as const)("releases a late %s after unmount without creating a refresh lease", async (outcome) => {
    let resolveReply!: (reply: Response) => void;
    const reply = new Promise<Response>((resolve) => { resolveReply = resolve; });
    const fetchMock = vi.fn().mockReturnValueOnce(reply);
    const { form, unmount } = prepareWrite(fetchMock); fireEvent.submit(form);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const input = JSON.parse(fetchMock.mock.calls[0][1].body);
    unmount(); expect(mocks.releaseOperation).not.toHaveBeenCalled();
    await act(async () => {
      resolveReply(outcome === "success" ? Response.json({ requestId: roster.assignments[0].id, status: "ok", errors: [], data: { persisted: true, demo: false,
        receipt: { id: roster.assignments[0].id, clientId: input.clientId, serviceDate: input.serviceDate, shift: input.shift, version: input.expectedVersion + 1, replayed: false } } }, { status: 201 })
        : errorReply("ROSTER_FORBIDDEN", 403));
      await reply;
    });
    await waitFor(() => expect(mocks.releaseOperation).toHaveBeenCalledTimes(1));
    expect(mocks.acquireView).not.toHaveBeenCalled(); expect(mocks.releaseView).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("retains an unresolved operation when a deferred response fails after unmount", async () => {
    let rejectReply!: (reason: Error) => void;
    const reply = new Promise<Response>((_resolve, reject) => { rejectReply = reject; });
    const fetchMock = vi.fn().mockReturnValueOnce(reply);
    const { form, unmount } = prepareWrite(fetchMock); fireEvent.submit(form);
    expect(fetchMock).toHaveBeenCalledTimes(1); unmount();
    await act(async () => { rejectReply(new Error("synthetic network failure")); await reply.catch(() => undefined); });
    expect(mocks.releaseOperation).not.toHaveBeenCalled();
    expect(mocks.acquireView).not.toHaveBeenCalled(); expect(mocks.releaseView).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("pins exact body, key and version after unknown then definite 409, including refresh", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(errorReply("ROSTER_CONFLICT", 409));
    const { form, rerender, manager } = prepareWrite(fetchMock);
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole("button", { name: "以原內容重試確認", hidden: true })).toBeEnabled());
    const first = fetchMock.mock.calls[0][1].body;
    expect(JSON.parse(first).expectedVersion).toBe(1);
    expect(screen.getByRole("textbox", { name: "安排依據／異動理由", hidden: true })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "個案", hidden: true })).toBeDisabled();
    rerender(<RosterComposer roster={{ ...manager, assignments: [{ ...manager.assignments[0], version: 7 }] }} clients={snapshot.clients} serviceDate={snapshot.serviceDate} />);
    fireEvent.submit(form);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("後續拒絕也不代表前一次未完成"));
    expect(fetchMock.mock.calls[1][1].body).toBe(first);
    expect(screen.queryByRole("button", { name: "重新載入並人工核對", hidden: true })).not.toBeInTheDocument();
    fireEvent.submit(form);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2][1].body).toBe(first);
  });
  it("requires manual reload after a first definite conflict and never automatically retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorReply("ROSTER_CONFLICT", 409));
    const { form } = prepareWrite(fetchMock); fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole("button", { name: "重新載入並人工核對", hidden: true })).toBeInTheDocument());
    fireEvent.submit(form); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.releaseOperation).toHaveBeenCalledTimes(1);
  });
  it("releases editable fields for a first definite validation rejection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorReply("ROSTER_REJECTED", 400));
    const { form } = prepareWrite(fetchMock); fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("合成拒絕"));
    expect(screen.getByRole("textbox", { name: "安排依據／異動理由", hidden: true })).toBeEnabled();
    expect(screen.getByRole("button", { name: "確認並儲存分工", hidden: true })).toBeEnabled();
  });
  it("does not resubmit after a valid success receipt even if refresh cannot read back", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const input = JSON.parse(init.body as string);
      return Response.json({ requestId: roster.assignments[0].id, status: "ok", errors: [], data: { persisted: true, demo: false,
        receipt: { id: roster.assignments[0].id, clientId: input.clientId, serviceDate: input.serviceDate, shift: input.shift, version: input.expectedVersion + 1, replayed: false } } }, { status: 201 });
    });
    const { form } = prepareWrite(fetchMock); fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole("button", { name: "讀取最新分工清單", hidden: true })).toBeInTheDocument());
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.releaseOperation).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.releaseView).toHaveBeenCalledTimes(1));
    fireEvent.submit(form); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("keeps success final without refreshing or reloading over another pending writer", async () => {
    mocks.acquireView.mockReturnValue(null);
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const input = JSON.parse(init.body as string);
      return Response.json({ requestId: roster.assignments[0].id, status: "ok", errors: [], data: { persisted: true, demo: false,
        receipt: { id: roster.assignments[0].id, clientId: input.clientId, serviceDate: input.serviceDate, shift: input.shift, version: input.expectedVersion + 1, replayed: false } } }, { status: 201 });
    });
    const { form } = prepareWrite(fetchMock); fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("每日分工已確認儲存；另有操作尚待確認"));
    expect(mocks.releaseOperation).toHaveBeenCalledTimes(1);
    expect(mocks.acquireView).toHaveBeenCalledTimes(1); expect(mocks.refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "讀取最新分工清單", hidden: true }));
    expect(mocks.acquireView).toHaveBeenCalledTimes(2); expect(mocks.releaseView).not.toHaveBeenCalled();
    fireEvent.submit(form); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "以原內容重試確認", hidden: true })).not.toBeInTheDocument();
  });
  it("retains the refresh lease until the React transition completes", async () => {
    let completeRefresh!: () => void;
    const refresh = new Promise<void>((resolve) => { completeRefresh = resolve; });
    mocks.refresh.mockReturnValueOnce(refresh);
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const input = JSON.parse(init.body as string);
      return Response.json({ requestId: roster.assignments[0].id, status: "ok", errors: [], data: { persisted: true, demo: false,
        receipt: { id: roster.assignments[0].id, clientId: input.clientId, serviceDate: input.serviceDate, shift: input.shift, version: input.expectedVersion + 1, replayed: false } } }, { status: 201 });
    });
    const { form } = prepareWrite(fetchMock); fireEvent.submit(form);
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.releaseOperation).toHaveBeenCalledTimes(1); expect(mocks.releaseView).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "讀取最新分工清單", hidden: true })).toBeDisabled();
    await act(async () => { completeRefresh(); await refresh; });
    await waitFor(() => expect(mocks.releaseView).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "讀取最新分工清單", hidden: true })).toBeEnabled();
    fireEvent.submit(form); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("pins a malformed successful response as unknown instead of reporting completion", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ status: "ok", data: { persisted: true } }, { status: 201 }));
    const { form } = prepareWrite(fetchMock); fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole("button", { name: "以原內容重試確認", hidden: true })).toBeInTheDocument());
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("keeps a validated success final when router refresh throws", async () => {
    mocks.refresh.mockImplementationOnce(() => { throw new Error("synthetic refresh failed"); });
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const input = JSON.parse(init.body as string);
      return Response.json({ requestId: roster.assignments[0].id, status: "ok", errors: [], data: { persisted: true, demo: false,
        receipt: { id: roster.assignments[0].id, clientId: input.clientId, serviceDate: input.serviceDate, shift: input.shift, version: input.expectedVersion + 1, replayed: false } } }, { status: 201 });
    });
    const { form } = prepareWrite(fetchMock); fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("已確認儲存，但最新清單尚未讀回"));
    expect(screen.getByRole("button", { name: "讀取最新分工清單", hidden: true })).toBeEnabled();
    expect(screen.getByRole("button", { name: "確認並儲存分工", hidden: true })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "以原內容重試確認", hidden: true })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "安排依據／異動理由", hidden: true })).toBeDisabled();
    fireEvent.submit(form); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
