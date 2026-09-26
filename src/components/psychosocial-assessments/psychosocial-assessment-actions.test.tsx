// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { hasPendingOperations, hasViewTransition } from "@/lib/navigation/pending-operation-lock";
import { clearPsychosocialAssessmentPendingOnLogout, getPsychosocialAssessmentPending, observePsychosocialAssessmentAuthority, psychosocialAssessmentAuthoritySignature } from "@/lib/psychosocial-assessments/pending";
import { capabilities, psychosocialCommittedSnapshot, psychosocialDenial, psychosocialFixture, psychosocialReceipt } from "@/lib/psychosocial-assessments/pending.test-fixtures";
import type { PsychosocialAssessmentListItem, PsychosocialAssessmentSnapshot } from "@/lib/psychosocial-assessments/types";
import { PsychosocialAssessmentActions, PsychosocialAssessmentFreshness } from "./psychosocial-assessment-actions";
import { PsychosocialAssessmentController, usePsychosocialAssessmentController } from "./psychosocial-assessment-controller";
import { PsychosocialAssessmentsWorkspace } from "./psychosocial-assessments-workspace";
import { staffPages } from "@/lib/catalog";
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
let fixture: ReturnType<typeof psychosocialFixture>; let iteration = 0;
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
beforeEach(() => { clearPsychosocialAssessmentPendingOnLogout(); vi.setSystemTime(new Date(1910000000000 + (++iteration * 10000))); fixture = psychosocialFixture(); });
afterEach(() => { cleanup(); clearPsychosocialAssessmentPendingOnLogout(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
type Props = { context?: TenantContext; snapshot?: PsychosocialAssessmentSnapshot | null; canManage?: boolean; canSign?: boolean; hasRecentAal2?: boolean; double?: boolean };
function Rows({ double = false }: { double?: boolean }) { const controller = usePsychosocialAssessmentController(); const snapshot = controller?.snapshot;
  return snapshot ? <>{snapshot.items.map((item) => <section key={item.clientId}><p>{item.clientDisplayName} source {item.assessmentSummary}</p>
    <PsychosocialAssessmentActions {...capabilities} item={item} snapshot={snapshot}/>
    {double && <PsychosocialAssessmentActions {...capabilities} item={item} snapshot={snapshot}/>}</section>)}</> : <p>授權來源不可用</p>; }
function Harness({ context = fixture.context, snapshot = fixture.snapshot, canManage = true, canSign = true, hasRecentAal2 = true, double = false }: Props) {
  return <PsychosocialAssessmentController context={context} snapshot={snapshot} canManage={canManage} canSign={canSign} hasRecentAal2={hasRecentAal2}><Rows double={double}/></PsychosocialAssessmentController>;
}
function openCreate() { fireEvent.click(screen.getAllByRole("button", { name: "快速新增評估草稿" })[1]!); }
function fillCreate() { openCreate(); fireEvent.change(screen.getByLabelText("人工輸入複評期限"), { target: { value: "2200-01-01" } });
  fireEvent.change(screen.getByLabelText("期限來源／依據"), { target: { value: "合成：人工會議安排" } });
  fireEvent.change(screen.getByLabelText("人工評估摘要"), { target: { value: "合成：心理社會紀錄" } }); }
function submitCreate() { fireEvent.click(screen.getByRole("button", { name: "保存評估草稿" })); }
function sign() { fireEvent.click(screen.getByRole("button", { name: "簽署評估" })); fireEvent.click(screen.getByRole("button", { name: "確認簽署評估" })); }
function retry() { fireEvent.click(screen.getAllByRole("button", { name: "重試同一評估操作" })[0]!); }
function pending() { return waitFor(() => expect(getPsychosocialAssessmentPending().operation?.phase).toBe("unknown")); }
function response(init: RequestInit, target?: PsychosocialAssessmentListItem, overrides: Record<string, unknown> = {}) {
  const input = { ...JSON.parse(String(init.body)), idempotencyKey: new Headers(init.headers).get("idempotency-key") };
  return Response.json(psychosocialReceipt(input, fixture.context, target, overrides), { status: overrides.replayed ? 200 : 201 });
}
function newer(snapshot: PsychosocialAssessmentSnapshot, ms = 1000) { return { ...snapshot, generatedAt: new Date(Date.parse(snapshot.generatedAt) + ms).toISOString(), staleAfter: new Date(Date.parse(snapshot.staleAfter) + ms).toISOString() }; }
describe("psychosocial workspace-owned writes", () => {
  it("GET filters use the scoped server projection without native validation bubbles", () => {
    render(<PsychosocialAssessmentsWorkspace context={fixture.context} snapshot={fixture.snapshot}
      {...capabilities} filters={{ clientId: null, responsibleUserId: null, serviceStatus: null, dueStatus: "all" }}
      page={staffPages.find((page) => page.number === 28)!}/>);
    const form = screen.getByRole("button", { name: "套用篩選" }).closest("form")!;
    expect(form).toHaveAttribute("method", "get"); expect(form).toHaveAttribute("novalidate");
    expect(form.querySelectorAll("select")).toHaveLength(4);
    expect(form.querySelector("input,textarea,[required],[pattern]")).toBeNull();
  });
  it("sign-only authority is not described as read-only or denied signing", () => {
    render(<PsychosocialAssessmentsWorkspace context={{ ...fixture.context,
      scopes: fixture.context.scopes.filter((scope) => scope !== "social_work_records.manage") }}
      snapshot={fixture.draftSnapshot} canManage={false} canSign hasRecentAal2
      filters={{ clientId: null, responsibleUserId: null, serviceStatus: null, dueStatus: "all" }}
      page={staffPages.find((page) => page.number === 28)!}/>);
    expect(screen.queryByText(/目前角色只有查看權限/u)).not.toBeInTheDocument();
    expect(screen.getByText(/目前沒有新增與修訂草稿權限/u)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "簽署評估" })).toHaveLength(2);
    screen.getAllByRole("button", { name: "簽署評估" }).forEach((button) => expect(button).toBeEnabled());
    screen.getAllByRole("button", { name: "建立草稿新版" }).forEach((button) => expect(button).toBeDisabled());
  });
  it("rows without provider are safely disabled", () => { render(<PsychosocialAssessmentActions {...capabilities} item={fixture.client} snapshot={fixture.snapshot}/>);
    expect(screen.getByRole("button", { name: "快速新增評估草稿" })).toBeDisabled(); });
  it("synthetic mode is read-only and never sends", () => { const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); render(<Harness context={{ ...fixture.context, demo: true }} snapshot={{ ...fixture.snapshot, demo: true }}/>);
    screen.getAllByRole("button", { name: /展示唯讀/u }).forEach((button) => expect(button).toBeDisabled()); expect(fetch).not.toHaveBeenCalled(); });
  it("desktop/mobile triggers share one modal/form and no auto POST", () => { const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); render(<Harness double/>);
    fireEvent.click(screen.getAllByRole("button", { name: "快速新增評估草稿" })[2]!);
    expect(screen.getAllByRole("dialog")).toHaveLength(1); expect(document.querySelectorAll("[data-psychosocial-assessment-form]")).toHaveLength(1); expect(fetch).not.toHaveBeenCalled(); });
  it("requires an app confirmation before signing, initial cancel focus and zero calls", () => { const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); render(<Harness snapshot={fixture.draftSnapshot}/>);
    fireEvent.click(screen.getByRole("button", { name: "簽署評估" })); expect(screen.getByRole("dialog", { name: "簽署評估" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus(); expect(fetch).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("button", { name: "簽署評估" })).toHaveFocus(); });
  it("sign keeps the exact predecessor id/version and uses PATCH", async () => { const fetch = vi.fn().mockRejectedValue(new TypeError("lost ACK")); vi.stubGlobal("fetch", fetch);
    render(<Harness snapshot={fixture.draftSnapshot}/>); sign(); await pending(); expect(fetch.mock.calls[0]![1]).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ action: "sign", clientId: fixture.draft.clientId, assessmentKey: fixture.draft.assessmentKey, previousVersionId: fixture.draft.versionId, expectedVersion: 1 }); });
  it("blocks missing required fields inline, focus first invalid and no native bubbles", () => { const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); render(<Harness/>); openCreate(); submitCreate();
    const date = screen.getByLabelText("人工輸入複評期限"); expect(date).toHaveFocus(); expect(date).toHaveAttribute("aria-invalid", "true"); expect(date).toHaveAccessibleDescription(/有效西元日期/u);
    expect(date.closest("form")).toHaveAttribute("novalidate"); expect(fetch).not.toHaveBeenCalled(); });
  it("provided dimensions require content, whereas missing/N/A remain distinct", () => { const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); render(<Harness/>); fillCreate();
    fireEvent.change(screen.getByLabelText("社會支持狀態"), { target: { value: "provided" } }); submitCreate();
    expect(screen.getByLabelText("社會支持狀態")).toHaveFocus(); expect(screen.getByLabelText("社會支持內容")).toHaveAttribute("aria-invalid", "true"); expect(fetch).not.toHaveBeenCalled(); });
  it("date ordering and blank correction reason are actionable inline errors", () => { const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); render(<Harness/>);
    fireEvent.click(screen.getAllByRole("button", { name: "建立更正版" })[0]!); fireEvent.change(screen.getByLabelText("人工輸入複評期限"), { target: { value: "2000-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "確認建立更正版" })); expect(screen.getByLabelText("人工輸入複評期限")).toHaveFocus(); expect(screen.getByText("複評期限不能早於評估日期。")).toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled(); });
  it("keeps original content and key immutable after uncertain content changes", async () => { const fetch = vi.fn().mockRejectedValue(new TypeError("lost ACK")); vi.stubGlobal("fetch", fetch); render(<Harness/>); fillCreate(); submitCreate(); await pending();
    const summary = screen.getByLabelText("人工評估摘要"); expect(summary.closest("fieldset")).toBeDisabled(); fireEvent.change(summary, { target: { value: "attempted edit" } }); retry(); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[1]![1].body).toBe(fetch.mock.calls[0]![1].body); expect(new Headers(fetch.mock.calls[1]![1].headers).get("idempotency-key")).toBe(new Headers(fetch.mock.calls[0]![1].headers).get("idempotency-key")); expect(refresh).not.toHaveBeenCalled(); });
  it.each([403, 409])("unknown then %i retains original lease/key/body", async (status) => { const fetch = vi.fn().mockRejectedValueOnce(new TypeError("lost ACK")).mockResolvedValue(Response.json(psychosocialDenial(status), { status })); vi.stubGlobal("fetch", fetch);
    render(<Harness/>); fillCreate(); submitCreate(); await pending(); retry(); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2)); await pending();
    expect(hasPendingOperations()).toBe(true); expect(fetch.mock.calls[1]![1].body).toBe(fetch.mock.calls[0]![1].body); expect(screen.getByRole("button", { name: "重新載入評估清單" })).toBeDisabled(); });
  it("strict first denial keeps editable form and actionable refusal", async () => { const fetch = vi.fn().mockResolvedValue(Response.json(psychosocialDenial(), { status: 403 })); vi.stubGlobal("fetch", fetch);
    render(<Harness/>); fillCreate(); submitCreate(); await screen.findByText(/本次操作未保存/u); expect(getPsychosocialAssessmentPending().operation).toBeNull(); expect(screen.getByLabelText("人工評估摘要").closest("fieldset")).not.toBeDisabled(); });
  it("remount loses neither original operation nor key and does not auto-send", async () => { const fetch = vi.fn().mockRejectedValue(new TypeError("lost ACK")); vi.stubGlobal("fetch", fetch);
    const first = render(<Harness/>); fillCreate(); submitCreate(); await pending(); const body = fetch.mock.calls[0]![1].body; first.unmount(); render(<Harness/>);
    expect(fetch).toHaveBeenCalledTimes(1); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); retry(); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2)); expect(fetch.mock.calls[1]![1].body).toBe(body); });
  it("safe close hides only the unknown view, not key/lease; logout stays reachable", async () => { vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("lost ACK"))); render(<Harness/>); fillCreate(); submitCreate(); await pending();
    fireEvent.click(screen.getByRole("button", { name: "回待確認清單" })); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(hasPendingOperations()).toBe(true); expect(getPsychosocialAssessmentPending().operation).not.toBeNull(); });
  it.each(["clientId", "assessmentKey", "versionId", "assessedOn", "responsibleUserId"])("wrong %s success stays unknown", async (field) => { const fetch = vi.fn((_url, init: RequestInit) => Promise.resolve(response(init, fixture.draft,
    { [field]: field === "assessedOn" ? "2000-01-01" : field === "versionId" ? fixture.draft.versionId : "28900000-0000-4000-8000-000000000088" }))); vi.stubGlobal("fetch", fetch);
    render(<Harness snapshot={fixture.draftSnapshot}/>); sign(); await pending(); expect(getPsychosocialAssessmentPending().confirmed).toHaveLength(0); });
  it("success proves saved only; no automatic list refresh and same-client new write remains blocked", async () => { const fetch = vi.fn((_url, init: RequestInit) => Promise.resolve(response(init))); vi.stubGlobal("fetch", fetch); render(<Harness/>); fillCreate(); submitCreate();
    await screen.findByText(/已確認保存；清單尚未確認更新/u); expect(refresh).not.toHaveBeenCalled(); expect(screen.getAllByRole("button", { name: "快速新增評估草稿" })[1]).toBeDisabled(); expect(screen.getByRole("region", { name: "心理社會評估操作狀態" })).toHaveFocus(); });
  it("fresh positive snapshot alone changes saved notice to confirmed list updated", async () => {
    const fetch = vi.fn((_url, init: RequestInit) => Promise.resolve(response(init))); vi.stubGlobal("fetch", fetch); const { rerender } = render(<Harness/>); fillCreate(); submitCreate();
    await screen.findByText(/已確認保存；清單尚未確認更新/u);
    const init = fetch.mock.calls[0]![1]; const input = { ...JSON.parse(String(init.body)), idempotencyKey: new Headers(init.headers).get("idempotency-key") };
    const receipt = psychosocialReceipt(input, fixture.context).data;
    const updated = psychosocialCommittedSnapshot(fixture.snapshot, input, receipt as Parameters<typeof psychosocialCommittedSnapshot>[2]); vi.setSystemTime(new Date(updated.generatedAt));
    rerender(<Harness snapshot={updated}/>); await screen.findByText("已確認保存，清單已確認更新。"); expect(screen.queryByText(/清單尚未確認更新/u)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "快速新增評估草稿" })[1]).not.toBeDisabled(); expect(refresh).not.toHaveBeenCalled();
  });
  it("manual refresh owns a shared lease and never implies positive list reconciliation", async () => { let finish!: () => void; refresh.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })); render(<Harness/>);
    fireEvent.click(screen.getByRole("button", { name: "重新載入評估清單" })); expect(hasViewTransition()).toBe(true); expect(screen.getAllByRole("button", { name: "快速新增評估草稿" })[0]).toBeDisabled();
    await act(async () => finish()); expect(hasViewTransition()).toBe(false); });
  it("actor/read-scope ABA cannot resurrect old clinical rows; valid new generation resumes", () => { const { rerender } = render(<Harness/>);
    rerender(<Harness context={{ ...fixture.context, userId: "28280000-0000-4000-8000-000000000002" }}/>); expect(screen.getByText("授權來源不可用")).toBeInTheDocument();
    rerender(<Harness/>); expect(screen.getByText("授權來源不可用")).toBeInTheDocument();
    rerender(<Harness snapshot={newer(fixture.snapshot)}/>); expect(screen.queryByText("授權來源不可用")).not.toBeInTheDocument(); });
  it("read revocation/restoration never reuses same old generation, including unmount", () => { const first = render(<Harness/>); first.unmount();
    act(() => { observePsychosocialAssessmentAuthority(psychosocialAssessmentAuthoritySignature({ ...fixture.context, scopes: fixture.context.scopes.filter((scope) => scope !== "social_work_records.read") }));
      observePsychosocialAssessmentAuthority(psychosocialAssessmentAuthoritySignature(fixture.context)); });
    render(<Harness/>); expect(screen.getByText("授權來源不可用")).toBeInTheDocument(); });
  it("accepted fresh generation survives remount and rejects regressed RSC", () => { const first = render(<Harness snapshot={newer(fixture.snapshot)}/>); first.unmount(); render(<Harness/>); expect(screen.getByText("授權來源不可用")).toBeInTheDocument(); });
  it("manage-only revocation preserves authorized read content but disables writes", () => { render(<Harness canManage={false} context={{ ...fixture.context, scopes: fixture.context.scopes.filter((scope) => scope !== "social_work_records.manage") }}/>);
    expect(screen.queryByText("授權來源不可用")).not.toBeInTheDocument(); expect(screen.getAllByRole("button", { name: "快速新增評估草稿" })[0]).toBeDisabled(); });
  it("manager read does not invent social-worker-only restrictions", () => { render(<Harness canManage={false} canSign={false} context={{ ...fixture.context, roles: ["organization_manager"], scopes: ["clients.read", "social_work_records.read"] }}/>);
    expect(screen.queryByText("授權來源不可用")).not.toBeInTheDocument(); });
  it("capability ABA suppresses late response without refreshing or showing success", async () => { let finish!: (response: Response) => void; let captured!: RequestInit;
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => { captured = init; return new Promise<Response>((resolve) => { finish = resolve; }); }));
    const { rerender } = render(<Harness/>); fillCreate(); submitCreate(); rerender(<Harness canManage={false}/>); rerender(<Harness/>);
    await act(async () => finish(response(captured))); expect(getPsychosocialAssessmentPending().operation?.phase).toBe("unknown"); expect(getPsychosocialAssessmentPending().confirmed).toHaveLength(0); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); });
  it("assignment ABA cannot revive stale source or editor, including remount and late success", async () => {
    let finish!: (response: Response) => void; let captured!: RequestInit; vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => { captured = init; return new Promise<Response>((resolve) => { finish = resolve; }); }));
    const { rerender, unmount } = render(<Harness/>); fillCreate(); submitCreate();
    const removed = { ...fixture.snapshot, items: fixture.snapshot.items.filter((item) => item.clientId !== fixture.client.clientId),
      itemTotal: fixture.snapshot.itemTotal - 1, matchingTotal: fixture.snapshot.matchingTotal - 1, clientOptions: fixture.snapshot.clientOptions.filter((item) => item.clientId !== fixture.client.clientId),
      metrics: { ...fixture.snapshot.metrics, notAssessed: fixture.snapshot.metrics.notAssessed - 1 } };
    rerender(<Harness snapshot={removed}/>); rerender(<Harness/>); expect(screen.getByText("授權來源不可用")).toBeInTheDocument(); unmount(); render(<Harness/>);
    await act(async () => finish(response(captured))); expect(getPsychosocialAssessmentPending().operation?.phase).toBe("unknown"); expect(getPsychosocialAssessmentPending().confirmed).toHaveLength(0);
    expect(screen.getByText("授權來源不可用")).toBeInTheDocument(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText(/此頁尚無獨立授權回查入口/u)).toBeInTheDocument(); expect(refresh).not.toHaveBeenCalled();
  });
  it("logout/unmount rejects late ACK and cannot repopulate clinical journal", async () => { let finish!: (response: Response) => void; let captured!: RequestInit;
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => { captured = init; return new Promise<Response>((resolve) => { finish = resolve; }); }));
    const view = render(<Harness/>); fillCreate(); submitCreate(); act(() => clearPsychosocialAssessmentPendingOnLogout()); expect(screen.getByText("授權來源不可用")).toBeInTheDocument(); view.unmount();
    await act(async () => finish(response(captured))); expect(getPsychosocialAssessmentPending().operation).toBeNull(); expect(getPsychosocialAssessmentPending().confirmed).toHaveLength(0); });
  it("unmounted sending operation becomes unknown and its late reply is ignored", async () => { let finish!: (response: Response) => void; let captured!: RequestInit;
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => { captured = init; return new Promise<Response>((resolve) => { finish = resolve; }); }));
    const view = render(<Harness/>); fillCreate(); submitCreate(); view.unmount(); await act(async () => finish(response(captured)));
    expect(getPsychosocialAssessmentPending().operation?.phase).toBe("unknown"); expect(getPsychosocialAssessmentPending().confirmed).toHaveLength(0); });
  it("expired signer recency flag prevents signing without fabricated context timestamp", () => { render(<Harness snapshot={fixture.draftSnapshot} hasRecentAal2={false}/>);
    expect(screen.getByRole("button", { name: "簽署評估" })).toBeDisabled(); });
  it("dirty cancel uses shared discard confirmation, Escape/continue retains fields and IME blocks submit", () => { const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); render(<Harness/>); fillCreate();
    fireEvent.compositionStart(screen.getByLabelText("人工評估摘要")); submitCreate(); expect(fetch).not.toHaveBeenCalled(); fireEvent.compositionEnd(screen.getByLabelText("人工評估摘要"));
    fireEvent.click(screen.getByRole("button", { name: "取消" })); expect(screen.getByRole("dialog", { name: "放棄未保存的心理社會評估？" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "繼續填寫" })); expect(screen.getByLabelText("人工評估摘要")).toHaveValue("合成：心理社會紀錄");
    fireEvent.click(screen.getByRole("button", { name: "取消" })); fireEvent.click(screen.getByRole("button", { name: "放棄填寫並繼續" })); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); });
  it("freshness resets honestly for a new deadline", async () => { const { rerender } = render(<PsychosocialAssessmentFreshness demo={false} staleAfter={new Date(Date.now() - 1).toISOString()}/>);
    expect(screen.getByRole("status")).toHaveTextContent("資料已過期"); rerender(<PsychosocialAssessmentFreshness demo={false} staleAfter={new Date(Date.now() + 60000).toISOString()}/>);
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument()); });
});
