// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { hasPendingOperations, hasViewTransition, tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";
import { clearPsychosocialAssessmentPendingOnLogout, getPsychosocialAssessmentPending, observePsychosocialAssessmentAuthority, psychosocialAssessmentAuthoritySignature } from "@/lib/psychosocial-assessments/pending";
import { capabilities, psychosocialFixture, psychosocialReceipt } from "@/lib/psychosocial-assessments/pending.test-fixtures";
import { SnapshotReadError } from "@/lib/psychosocial-assessments/snapshot-client";
import type { PsychosocialAssessmentFilters, PsychosocialAssessmentSnapshot } from "@/lib/psychosocial-assessments/types";
import { PsychosocialAssessmentActions } from "./psychosocial-assessment-actions";
import { PsychosocialAssessmentController, usePsychosocialAssessmentController } from "./psychosocial-assessment-controller";

const refresh = vi.fn();
const readSnapshot = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/psychosocial-assessments/snapshot-client", async (original) => ({ ...await original<typeof import("@/lib/psychosocial-assessments/snapshot-client")>(), readPsychosocialSnapshot: readSnapshot }));
let fixture: ReturnType<typeof psychosocialFixture>; let iteration = 0;
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
beforeEach(() => { clearPsychosocialAssessmentPendingOnLogout(); vi.setSystemTime(new Date(1912000000000 + (++iteration * 10000))); fixture = psychosocialFixture(); });
afterEach(() => { cleanup(); clearPsychosocialAssessmentPendingOnLogout(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function Rows() { const owner = usePsychosocialAssessmentController();
  return owner?.snapshot ? <>{owner.snapshot.items.map((item) => <section key={item.clientId}><p>{item.clientDisplayName} source {item.assessmentSummary}</p>
    <PsychosocialAssessmentActions {...owner.capabilities} item={item} snapshot={owner.snapshot!}/></section>)}</> : <p>授權來源不可用</p>; }
type Props = { context?: TenantContext; snapshot?: PsychosocialAssessmentSnapshot; filters?: PsychosocialAssessmentFilters; canManage?: boolean; canSign?: boolean; hasRecentAal2?: boolean };
function Harness({ context = fixture.context, snapshot = fixture.snapshot, filters, canManage = true, canSign = true, hasRecentAal2 = true }: Props) {
  return <PsychosocialAssessmentController context={context} snapshot={snapshot} filters={filters} canManage={canManage} canSign={canSign} hasRecentAal2={hasRecentAal2}><Rows/></PsychosocialAssessmentController>;
}
async function unknown(props: Props = {}) {
  const fetch = vi.fn().mockRejectedValue(new TypeError("lost ACK")); vi.stubGlobal("fetch", fetch); const view = render(<Harness {...props}/>);
  fireEvent.click(screen.getAllByRole("button", { name: "快速新增評估草稿" })[1]!);
  fireEvent.change(screen.getByLabelText("人工輸入複評期限"), { target: { value: "2200-01-01" } });
  fireEvent.change(screen.getByLabelText("期限來源／依據"), { target: { value: "合成：人工會議安排" } });
  fireEvent.change(screen.getByLabelText("人工評估摘要"), { target: { value: "合成：心理社會紀錄" } });
  fireEvent.click(screen.getByRole("button", { name: "保存評估草稿" }));
  await waitFor(() => expect(getPsychosocialAssessmentPending().operation?.phase).toBe("unknown"));
  fireEvent.click(screen.getByRole("button", { name: "回待確認清單" }));
  return { ...view, fetch };
}
function bundle(caps = capabilities, context = fixture.context, ms = 1000) {
  const generatedAt = new Date(Date.parse(fixture.snapshot.generatedAt) + ms).toISOString(); vi.setSystemTime(new Date(generatedAt));
  return { snapshot: { ...fixture.snapshot, generatedAt, staleAfter: new Date(Date.parse(generatedAt) + 60_000).toISOString() }, capabilities: caps, authoritySignature: psychosocialAssessmentAuthoritySignature(context) };
}
function check() { fireEvent.click(screen.getByRole("button", { name: "重新核對原範圍授權" })); }
describe("psychosocial explicit read recovery", () => {
  it("exposes a manual authorization read without clearing the original unknown lease", async () => {
    await unknown(); expect(screen.getByRole("button", { name: "重新核對原範圍授權" })).toBeEnabled();
    expect(hasPendingOperations()).toBe(true); expect(refresh).not.toHaveBeenCalled(); expect(readSnapshot).not.toHaveBeenCalled();
  });
  it("never offers recovery for a foreign actor or sending operation", async () => {
    await unknown(); cleanup(); render(<Harness context={{ ...fixture.context, userId: "28280000-0000-4000-8000-000000000009" }}/>);
    expect(screen.queryByRole("button", { name: "重新核對原範圍授權" })).not.toBeInTheDocument(); expect(hasPendingOperations()).toBe(true);
  });
  it("does not acquire the read fence while an additional foreign pending lease exists", async () => {
    await unknown(); const foreign = tryAcquirePendingOperation(); expect(foreign).not.toBeNull();
    try { check(); expect(hasViewTransition()).toBe(false); expect(readSnapshot).not.toHaveBeenCalled(); }
    finally { foreign?.(); }
  });
  it("an existing foreign view fence blocks recovery before a GET begins", async () => {
    await unknown(); act(() => clearPsychosocialAssessmentPendingOnLogout()); const foreign = tryAcquireViewTransition(); expect(foreign).not.toBeNull();
    try { expect(readSnapshot).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: "重新核對原範圍授權" })).not.toBeInTheDocument(); }
    finally { foreign?.(); }
  });
  it("fresh manual GET restores the original key/body retry after assignment ABA without automatic POST/refresh", async () => {
    const { rerender, fetch } = await unknown(); const original = getPsychosocialAssessmentPending().operation!;
    const removed = { ...fixture.snapshot, items: fixture.snapshot.items.filter((item) => item.clientId !== fixture.client.clientId),
      itemTotal: fixture.snapshot.itemTotal - 1, matchingTotal: fixture.snapshot.matchingTotal - 1,
      clientOptions: fixture.snapshot.clientOptions.filter((item) => item.clientId !== fixture.client.clientId),
      metrics: { ...fixture.snapshot.metrics, notAssessed: fixture.snapshot.metrics.notAssessed - 1 } };
    rerender(<Harness snapshot={removed}/>); rerender(<Harness/>); expect(screen.getByText("授權來源不可用")).toBeInTheDocument();
    readSnapshot.mockResolvedValueOnce(bundle()); check(); await screen.findByText(/已重新核對原範圍授權/u);
    expect(getPsychosocialAssessmentPending().operation?.input.idempotencyKey).toBe(original.input.idempotencyKey);
    expect(getPsychosocialAssessmentPending().operation?.body).toBe(original.body); expect(hasPendingOperations()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1); expect(refresh).not.toHaveBeenCalled(); expect(screen.queryByText(/已確認保存/u)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重試同一評估操作" })); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[1]![1].body).toBe(original.body); expect(new Headers(fetch.mock.calls[1]![1].headers).get("idempotency-key")).toBe(original.input.idempotencyKey);
  });
  it("binds original complete filters and synchronously excludes writes, navigation and a second GET", async () => {
    const filters: PsychosocialAssessmentFilters = { clientId: fixture.client.clientId, responsibleUserId: null, serviceStatus: "active", dueStatus: "all" };
    const { fetch } = await unknown({ filters }); let finish!: (value: ReturnType<typeof bundle>) => void;
    readSnapshot.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })); check(); check();
    expect(readSnapshot).toHaveBeenCalledTimes(1); expect(readSnapshot.mock.calls[0]![0]).toEqual({ organizationId: fixture.context.organizationId, branchId: fixture.context.branchId, userId: fixture.context.userId });
    expect(readSnapshot.mock.calls[0]![1]).toEqual(filters); expect(hasViewTransition()).toBe(true); expect(hasPendingOperations()).toBe(true);
    expect(tryAcquirePendingOperation()).toBeNull(); expect(screen.getByRole("button", { name: "重試同一評估操作" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重試同一評估操作" })); expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => finish(bundle())); expect(hasViewTransition()).toBe(false); expect(hasPendingOperations()).toBe(true);
  });
  it("uses actual returned capability flags without fabricating context or accepting old true props", async () => {
    await unknown(); readSnapshot.mockResolvedValueOnce(bundle({ canManage: false, canSign: false, hasRecentAal2: false })); check();
    await screen.findByText(/已重新核對原範圍授權/u); expect(screen.getByRole("button", { name: "重試同一評估操作" })).toBeDisabled();
    expect(getPsychosocialAssessmentPending().operation?.phase).toBe("unknown"); expect(screen.getByText(/查回不會完成近期驗證/u)).toBeInTheDocument();
  });
  it("a valid GET can recover current server manage capability without inventing context timestamps", async () => {
    const { rerender } = await unknown(); rerender(<Harness canManage={false}/>); expect(screen.getByRole("button", { name: "重試同一評估操作" })).toBeDisabled();
    readSnapshot.mockResolvedValueOnce(bundle()); check(); await screen.findByText(/已重新核對原範圍授權/u);
    expect(fixture.context.recentAal2At).toBeNull(); expect(screen.getByRole("button", { name: "重試同一評估操作" })).toBeEnabled();
    expect(getPsychosocialAssessmentPending().operation?.phase).toBe("unknown");
  });
  it.each([401, 403])("auth-denied GET %i quarantines old clinical source across remount without releasing original operation", async (status) => {
    const { unmount, fetch } = await unknown(); const original = getPsychosocialAssessmentPending().operation!;
    readSnapshot.mockRejectedValueOnce(new SnapshotReadError(status, "UNAVAILABLE")); check(); await screen.findByText(/未能重新取得授權資料/u);
    expect(screen.getByText("授權來源不可用")).toBeInTheDocument(); expect(screen.getByRole("button", { name: "重試同一評估操作" })).toBeDisabled();
    unmount(); render(<Harness/>); expect(screen.getByText("授權來源不可用")).toBeInTheDocument();
    expect(getPsychosocialAssessmentPending().operation?.body).toBe(original.body); expect(hasPendingOperations()).toBe(true); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("signature mismatch quarantines the source instead of raising flags or inventing a new authority", async () => {
    await unknown(); const changed = { ...fixture.context, scopes: fixture.context.scopes.filter((value) => value !== "social_work_records.manage") };
    readSnapshot.mockResolvedValueOnce(bundle(capabilities, changed)); check(); await screen.findByText(/授權已變更，舊資料已隱藏/u);
    expect(screen.getByText("授權來源不可用")).toBeInTheDocument(); expect(screen.getByRole("button", { name: "重試同一評估操作" })).toBeDisabled(); expect(hasPendingOperations()).toBe(true);
  });
  it("transport failure displays an actionable error outside the closed editor and retains original source/key", async () => {
    await unknown(); const original = getPsychosocialAssessmentPending().operation!;
    readSnapshot.mockRejectedValueOnce(new SnapshotReadError(null, "UNAVAILABLE")); check(); await screen.findByText(/未能重新取得授權資料/u);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(screen.queryByText("授權來源不可用")).not.toBeInTheDocument();
    expect(screen.getByText(/並非最新查回結果/u)).toBeInTheDocument();
    expect(getPsychosocialAssessmentPending().operation).toBe(original); expect(hasViewTransition()).toBe(false); expect(hasPendingOperations()).toBe(true);
  });
  it.each(["malformed200", "untrustedSource", "server503"])("%s quarantines old source/capabilities; only genuinely newer proof resumes original operation", async (kind) => {
    await unknown(); const original = getPsychosocialAssessmentPending().operation!;
    if (kind === "untrustedSource") { const next = bundle(); readSnapshot.mockResolvedValueOnce({ ...next, snapshot: { ...next.snapshot, organizationId: "28280000-0000-4000-8000-000000000088" } }); }
    else readSnapshot.mockRejectedValueOnce(new SnapshotReadError(kind === "malformed200" ? 200 : 503, kind === "malformed200" ? "INVALID_RESPONSE" : "UNAVAILABLE"));
    check(); await screen.findByText(/未能重新取得授權資料/u);
    expect(screen.getByText("授權來源不可用")).toBeInTheDocument(); expect(screen.getByRole("button", { name: "重試同一評估操作" })).toBeDisabled();
    expect(getPsychosocialAssessmentPending().operation?.body).toBe(original.body); expect(hasPendingOperations()).toBe(true);
    readSnapshot.mockResolvedValueOnce(bundle(capabilities, fixture.context, 2000)); check(); await screen.findByText(/已重新核對原範圍授權/u);
    expect(screen.getByRole("button", { name: "重試同一評估操作" })).toBeEnabled(); expect(getPsychosocialAssessmentPending().operation?.input.idempotencyKey).toBe(original.input.idempotencyKey);
  });
  it("a previous read error stops claiming the original operation remains once an exact success receipt arrives", async () => {
    const { fetch } = await unknown(); const original = getPsychosocialAssessmentPending().operation!;
    readSnapshot.mockRejectedValueOnce(new SnapshotReadError(null, "UNAVAILABLE")); check(); await screen.findByText(/未能重新取得授權資料/u);
    fetch.mockResolvedValueOnce(Response.json(psychosocialReceipt(original.input, fixture.context), { status: 201 }));
    fireEvent.click(screen.getByRole("button", { name: "重試同一評估操作" })); await screen.findByText(/已確認保存；清單尚未確認更新/u);
    expect(screen.queryByText(/未能重新取得授權資料/u)).not.toBeInTheDocument(); expect(getPsychosocialAssessmentPending().operation).toBeNull();
  });
  it("genuinely newer authorized SSR clears only the obsolete failure notice, never claims an unknown operation saved", async () => {
    const { rerender } = await unknown(); readSnapshot.mockRejectedValueOnce(new SnapshotReadError(403, "UNAVAILABLE")); check();
    await screen.findByText(/未能重新取得授權資料/u); expect(screen.getByText("授權來源不可用")).toBeInTheDocument();
    rerender(<Harness snapshot={bundle().snapshot}/>); expect(screen.queryByText("授權來源不可用")).not.toBeInTheDocument();
    expect(screen.queryByText(/未能重新取得授權資料/u)).not.toBeInTheDocument(); expect(screen.queryByText(/已確認保存/u)).not.toBeInTheDocument();
    expect(getPsychosocialAssessmentPending().operation?.phase).toBe("unknown"); expect(hasPendingOperations()).toBe(true);
  });
  it("a same or regressed generation cannot clear the quarantined floor or enable retries", async () => {
    await unknown(); readSnapshot.mockRejectedValueOnce(new SnapshotReadError(403, "UNAVAILABLE")); check(); await screen.findByText(/未能重新取得授權資料/u);
    readSnapshot.mockResolvedValueOnce({ snapshot: fixture.snapshot, capabilities, authoritySignature: psychosocialAssessmentAuthoritySignature(fixture.context) }); check();
    await waitFor(() => expect(readSnapshot).toHaveBeenCalledTimes(2)); expect(screen.getByText("授權來源不可用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重試同一評估操作" })).toBeDisabled(); expect(hasPendingOperations()).toBe(true);
  });
  it("late authority ABA GET is aborted and never revives old clinical source or success", async () => {
    const { rerender } = await unknown(); let finish!: (value: ReturnType<typeof bundle>) => void;
    readSnapshot.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })); check(); const signal = readSnapshot.mock.calls[0]![2] as AbortSignal;
    const altered = { ...fixture.context, roles: ["organization_manager"] as TenantContext["roles"] };
    rerender(<Harness context={altered}/>); rerender(<Harness/>); await act(async () => finish(bundle()));
    expect(signal.aborted).toBe(true); expect(screen.queryByText(/已重新核對原範圍授權/u)).not.toBeInTheDocument(); expect(getPsychosocialAssessmentPending().operation?.phase).toBe("unknown");
    expect(hasViewTransition()).toBe(false); expect(hasPendingOperations()).toBe(true);
  });
  it("global actor ABA while mounted fences late GET even when final context props are unchanged", async () => {
    await unknown(); let finish!: (value: ReturnType<typeof bundle>) => void;
    readSnapshot.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })); check(); const signal = readSnapshot.mock.calls[0]![2] as AbortSignal;
    act(() => { observePsychosocialAssessmentAuthority(psychosocialAssessmentAuthoritySignature({ ...fixture.context, userId: "28280000-0000-4000-8000-000000000009" }));
      observePsychosocialAssessmentAuthority(psychosocialAssessmentAuthoritySignature(fixture.context)); });
    await act(async () => finish(bundle())); expect(signal.aborted).toBe(true); expect(screen.getByText("授權來源不可用")).toBeInTheDocument();
    expect(screen.queryByText(/已重新核對原範圍授權/u)).not.toBeInTheDocument(); expect(getPsychosocialAssessmentPending().operation?.phase).toBe("unknown");
  });
  it("filter and capability ABA abort stale GET and never adopt its later flags", async () => {
    const { rerender } = await unknown(); let finish!: (value: ReturnType<typeof bundle>) => void;
    readSnapshot.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })); check(); const signal = readSnapshot.mock.calls[0]![2] as AbortSignal;
    rerender(<Harness filters={{ clientId: null, responsibleUserId: null, serviceStatus: null, dueStatus: "due" }} canManage={false}/>);
    rerender(<Harness/>); await act(async () => finish(bundle())); expect(signal.aborted).toBe(true); expect(screen.queryByText(/已重新核對原範圍授權/u)).not.toBeInTheDocument();
    expect(getPsychosocialAssessmentPending().operation?.phase).toBe("unknown"); expect(hasViewTransition()).toBe(false);
  });
  it("an old aborted GET cannot release a newer check's fence or replace its current response", async () => {
    const { rerender } = await unknown(); let oldFinish!: (value: ReturnType<typeof bundle>) => void; let newFinish!: (value: ReturnType<typeof bundle>) => void;
    readSnapshot.mockImplementationOnce(() => new Promise((resolve) => { oldFinish = resolve; })).mockImplementationOnce(() => new Promise((resolve) => { newFinish = resolve; }));
    check(); rerender(<Harness canManage={false}/>); rerender(<Harness/>); check(); expect(readSnapshot).toHaveBeenCalledTimes(2); expect(hasViewTransition()).toBe(true);
    await act(async () => oldFinish(bundle())); expect(hasViewTransition()).toBe(true); expect(screen.getByRole("button", { name: "重試同一評估操作" })).toBeDisabled();
    await act(async () => newFinish(bundle(capabilities, fixture.context, 2000))); expect(hasViewTransition()).toBe(false);
    expect(screen.getByRole("button", { name: "重試同一評估操作" })).toBeEnabled(); expect(getPsychosocialAssessmentPending().operation?.phase).toBe("unknown");
  });
  it.each(["logout", "unmount"])("late GET after %s cannot repopulate the journal or reacquire a lease", async (boundary) => {
    const { unmount } = await unknown(); let finish!: (value: ReturnType<typeof bundle>) => void;
    readSnapshot.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })); check(); const signal = readSnapshot.mock.calls[0]![2] as AbortSignal;
    if (boundary === "logout") act(() => clearPsychosocialAssessmentPendingOnLogout()); else unmount();
    await act(async () => finish(bundle())); expect(signal.aborted).toBe(true); expect(hasViewTransition()).toBe(false);
    expect(getPsychosocialAssessmentPending().confirmed).toHaveLength(0); expect(getPsychosocialAssessmentPending().operation === null).toBe(boundary === "logout");
  });
  it("newer RSC capabilities replace the GET bundle while raw capability ABA cannot resurrect it", async () => {
    const { rerender } = await unknown(); readSnapshot.mockResolvedValueOnce(bundle({ canManage: false, canSign: false, hasRecentAal2: false })); check(); await screen.findByText(/已重新核對原範圍授權/u);
    expect(screen.getByRole("button", { name: "重試同一評估操作" })).toBeDisabled(); rerender(<Harness canManage={false}/>); rerender(<Harness/>);
    expect(screen.queryByText(/已重新核對原範圍授權/u)).not.toBeInTheDocument();
    const latest = bundle(capabilities, fixture.context, 2000); rerender(<Harness snapshot={latest.snapshot}/>);
    expect(screen.getByRole("button", { name: "重試同一評估操作" })).toBeEnabled();
  });
});
