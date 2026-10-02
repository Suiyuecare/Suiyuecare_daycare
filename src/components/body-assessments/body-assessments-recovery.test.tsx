// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { staffPages } from "@/lib/catalog";
import { buildDemoBodyAssessmentSnapshot } from "@/lib/body-assessments/demo";
import { clearBodyAssessmentPendingOnLogout, getBodyAssessmentPending } from "@/lib/body-assessments/pending";
import { hasPendingOperations, hasViewTransition, tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";
import { BodyAssessmentsWorkspace } from "./body-assessments-workspace";
import type { BodyAssessmentSnapshot } from "@/lib/body-assessments/types";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const page = staffPages.find((value) => value.number === 19)!;
const uuid = "00000000-0000-4000-8000-000000000001";
let snapshot: BodyAssessmentSnapshot;
let actor: string;
let leases: Array<() => void>;
beforeEach(() => {
  clearBodyAssessmentPendingOnLogout(); refresh.mockReset(); leases = [];
  const demo = buildDemoBodyAssessmentSnapshot({ clientId: null, state: "all" });
  const record = demo.records[0].history[0]; actor = record.actor_user_id;
  snapshot = { ...demo, demo: false, records: [{ ...record, history: [], historyTotal: 0, historyTruncated: false }] };
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
});
afterEach(() => { cleanup(); clearBodyAssessmentPendingOnLogout(); for (const release of leases) release(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function props(user = actor, canManage = true, canSign = true, data = snapshot) {
  return { page, snapshot: data, canManage, canSign, actorUserId: user };
}
function sign() {
  fireEvent.click(screen.getByRole("button", { name: "核對並簽署" }));
  fireEvent.click(screen.getByRole("button", { name: "本人確認已核對所選部位的人工觀察與處置" }));
}
const unknown = () => waitFor(() => expect(screen.getByRole("button", { name: "重試相同操作" })).toBeInTheDocument());
function denied(status: number, code: string) {
  return { ok: false, status, json: async () => ({ requestId: uuid, status: "error", data: null,
    errors: [{ code, message: "合成拒絕" }] }) };
}
function success(init: RequestInit, extra: Record<string, unknown> = {}) {
  const payload = JSON.parse(String(init.body));
  const headers = init.headers as Record<string, string>;
  return { ok: true, status: 201, json: async () => ({ requestId: uuid, status: "ok", errors: [], data: {
    operation_id: uuid, organization_id: snapshot.organizationId, branch_id: snapshot.branchId, actor_user_id: actor,
    client_id: payload.client_id, idempotency_key: headers["idempotency-key"], request_payload: payload,
    assessment_key: payload.assessment_key ?? "00000000-0000-4000-8000-000000000030",
    version_id: "00000000-0000-4000-8000-000000000020", version: payload.expected_version + 1,
    record_state: payload.action === "sign" ? "signed" : payload.action === "correct" ? "corrected" : "draft",
    content_hash: "b".repeat(64), committed_at: new Date().toISOString(), replayed: false, ...extra } }) };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function fillEditor() {
  fireEvent.click(screen.getByRole("button", { name: "新增評估草稿" }));
  const form = screen.getByRole("form", { name: "身體評估編輯" });
  const client = form.querySelector("select")!;
  fireEvent.change(client, { target: { value: snapshot.clients[0].clientId } });
  fireEvent.change(screen.getByLabelText("觀察時間（臺灣時間）"), { target: { value: "2026-09-26T16:00" } });
  fireEvent.click(screen.getByRole("button", { name: "加入觀察部位" }));
  fireEvent.change(screen.getByLabelText("部位"), { target: { value: "head" } });
  fireEvent.change(screen.getByLabelText("觀察狀態"), { target: { value: "normal" } });
  fireEvent.change(screen.getByLabelText("建立／修訂理由"), { target: { value: "合成測試建立" } });
  return form;
}
describe("actual body workspace uncertain-operation lifecycle", () => {
  it("recovers the exact immutable operation after component unmount/remount", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("network")); vi.stubGlobal("fetch", fetch);
    const first = render(<BodyAssessmentsWorkspace {...props()} />); sign(); await unknown();
    const request = getBodyAssessmentPending().operation!; first.unmount();
    expect(hasPendingOperations()).toBe(true);
    render(<BodyAssessmentsWorkspace {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "重試相同操作" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[1][1].body).toBe(request.body);
    expect(fetch.mock.calls[1][1].headers["idempotency-key"]).toBe(request.input.idempotencyKey);
    expect(screen.getByRole("button", { name: "新增評估草稿" })).toBeDisabled();
  });
  it.each([[400, "INVALID_BODY_ASSESSMENT_OPERATION"], [401, "AUTH_REQUIRED"], [403, "AAL2_REQUIRED"],
    [409, "BODY_ASSESSMENT_VERSION_CONFLICT"]])("keeps unknown content/key after later %s denial", async (status, code) => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue(denied(Number(status), String(code)));
    vi.stubGlobal("fetch", fetch); render(<BodyAssessmentsWorkspace {...props()} />); sign(); await unknown();
    fireEvent.click(screen.getByRole("button", { name: "重試相同操作" }));
    await waitFor(() => expect(getBodyAssessmentPending().operation?.phase).toBe("unknown"));
    expect(fetch).toHaveBeenCalledTimes(2); expect(hasPendingOperations()).toBe(true);
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);
    expect(fetch.mock.calls[1][1].headers["idempotency-key"]).toBe(fetch.mock.calls[0][1].headers["idempotency-key"]);
    expect(screen.getByRole("button", { name: "重新載入" })).toBeDisabled();
  });
  it("does not fabricate a denial from a malformed 403 envelope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ status: "error", data: null, errors: [] }) }));
    render(<BodyAssessmentsWorkspace {...props()} />); sign(); await unknown(); expect(hasPendingOperations()).toBe(true);
  });
  it("redacts the original operation for another actor and never sends under that actor", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("network")); vi.stubGlobal("fetch", fetch);
    const view = render(<BodyAssessmentsWorkspace {...props()} />); sign(); await unknown();
    const foreign = "00000000-0000-4000-8000-000000000099"; view.rerender(<BodyAssessmentsWorkspace {...props(foreign)} />);
    expect(screen.getByText(/此處不顯示其內容/u)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重試相同操作" })).not.toBeInTheDocument();
    expect(screen.queryByText(/原操作：/u)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新增評估草稿" })); expect(fetch).toHaveBeenCalledOnce();
    view.rerender(<BodyAssessmentsWorkspace {...props()} />); expect(screen.getByRole("button", { name: "重試相同操作" })).toBeEnabled();
  });
  it("ignores a late valid response after actor ABA and permits same-key recovery only", async () => {
    const delayed = deferred<ReturnType<typeof success>>(); const fetch = vi.fn().mockReturnValue(delayed.promise); vi.stubGlobal("fetch", fetch);
    const view = render(<BodyAssessmentsWorkspace {...props()} />); sign();
    view.rerender(<BodyAssessmentsWorkspace {...props("00000000-0000-4000-8000-000000000099")} />);
    view.rerender(<BodyAssessmentsWorkspace {...props()} />);
    await act(async () => { delayed.resolve(success(fetch.mock.calls[0][1])); await delayed.promise; });
    expect(getBodyAssessmentPending().operation?.phase).toBe("unknown");
    expect(screen.queryByText(/已保存第/u)).not.toBeInTheDocument(); expect(refresh).not.toHaveBeenCalled();
  });
  it("redacts client-specific pending UI on legitimate live assignment revocation without losing the original operation", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("network")); vi.stubGlobal("fetch", fetch);
    const view = render(<BodyAssessmentsWorkspace {...props()} />); sign(); await unknown();
    const original = getBodyAssessmentPending().operation!;
    const revoked = { ...snapshot, clients: [], clientTotal: 0, records: [], matchingTotal: 0 };
    view.rerender(<BodyAssessmentsWorkspace {...props(actor, true, true, revoked)} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(snapshot.clients[0].displayName, { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText(/原操作：/u)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重試相同操作" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重試相同操作" })); expect(fetch).toHaveBeenCalledOnce();
    expect(getBodyAssessmentPending().operation?.token).toBe(original.token); expect(hasPendingOperations()).toBe(true);
    view.rerender(<BodyAssessmentsWorkspace {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "重試相同操作" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[1][1].body).toBe(original.body);
    expect(fetch.mock.calls[1][1].headers["idempotency-key"]).toBe(original.input.idempotencyKey);
  });
  it("treats a late receipt as unknown after assignment revoke/restore ABA under the same actor and role", async () => {
    const delayed = deferred<ReturnType<typeof success>>(); const fetch = vi.fn().mockReturnValue(delayed.promise); vi.stubGlobal("fetch", fetch);
    const view = render(<BodyAssessmentsWorkspace {...props()} />); sign();
    view.rerender(<BodyAssessmentsWorkspace {...props(actor, true, true, { ...snapshot, clients: [], clientTotal: 0, records: [], matchingTotal: 0 })} />);
    view.rerender(<BodyAssessmentsWorkspace {...props()} />);
    await act(async () => { delayed.resolve(success(fetch.mock.calls[0][1])); await delayed.promise; });
    expect(getBodyAssessmentPending().operation?.phase).toBe("unknown");
    expect(screen.queryByText(/已保存第/u)).not.toBeInTheDocument(); expect(refresh).not.toHaveBeenCalled();
  });
  it("uses deterministic assigned IDs rather than client order or labels as the permission fingerprint", async () => {
    const other = { clientId: "00000000-0000-4000-8000-000000000099", displayName: "合成另一個案" };
    const data = { ...snapshot, clients: [...snapshot.clients, other], clientTotal: 2 };
    const delayed = deferred<ReturnType<typeof success>>(); const fetch = vi.fn().mockReturnValue(delayed.promise); vi.stubGlobal("fetch", fetch);
    const view = render(<BodyAssessmentsWorkspace {...props(actor, true, true, data)} />); sign();
    view.rerender(<BodyAssessmentsWorkspace {...props(actor, true, true, { ...data,
      clients: [...data.clients].reverse().map((client) => ({ ...client, displayName: `${client.displayName}新稱呼` })),
      records: data.records.map((record) => ({ ...record, client_display_name: `${record.client_display_name}新稱呼`,
        history: record.history.map((version) => ({ ...version, client_display_name: `${version.client_display_name}新稱呼` })) })) })} />);
    await act(async () => { delayed.resolve(success(fetch.mock.calls[0][1])); await delayed.promise; });
    expect(screen.getByText(/已保存第/u)).toBeInTheDocument(); expect(refresh).toHaveBeenCalledOnce();
  });
  it("clears unsent client-specific editor content and its orphan IME state when assignments change", () => {
    const view = render(<BodyAssessmentsWorkspace {...props()} />); const editor = fillEditor();
    fireEvent.change(screen.getByLabelText("觀察描述（其他部位須註明位置）"), { target: { value: "合成私密暫存觀察" } });
    fireEvent.compositionStart(editor);
    view.rerender(<BodyAssessmentsWorkspace {...props(actor, true, true, { ...snapshot, clients: [], clientTotal: 0, records: [], matchingTotal: 0 })} />);
    expect(screen.queryByRole("form", { name: "身體評估編輯" })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("合成私密暫存觀察")).not.toBeInTheDocument();
    expect(screen.queryByText(snapshot.clients[0].displayName, { exact: false })).not.toBeInTheDocument();
  });
  it("does not settle a late old reply after explicit logout or clear a new operation", async () => {
    const delayed = deferred<ReturnType<typeof success>>(); const fetch = vi.fn().mockReturnValueOnce(delayed.promise).mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", fetch); render(<BodyAssessmentsWorkspace {...props()} />); sign();
    act(() => { clearBodyAssessmentPendingOnLogout(); });
    sign(); await unknown(); const current = getBodyAssessmentPending().operation!;
    await act(async () => { delayed.resolve(success(fetch.mock.calls[0][1])); await delayed.promise; });
    expect(getBodyAssessmentPending().operation?.token).toBe(current.token); expect(hasPendingOperations()).toBe(true);
    expect(screen.queryByText(/已保存第/u)).not.toBeInTheDocument(); expect(refresh).not.toHaveBeenCalled();
  });
  it("treats a response after original unmount as unknown for the new mounted view", async () => {
    const delayed = deferred<ReturnType<typeof success>>(); const fetch = vi.fn().mockReturnValue(delayed.promise); vi.stubGlobal("fetch", fetch);
    const first = render(<BodyAssessmentsWorkspace {...props()} />); sign(); first.unmount();
    render(<BodyAssessmentsWorkspace {...props()} />);
    await act(async () => { delayed.resolve(success(fetch.mock.calls[0][1])); await delayed.promise; });
    expect(getBodyAssessmentPending().operation?.phase).toBe("unknown"); expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "重試相同操作" })).toBeEnabled();
  });
  it("does not let a success receipt or router.refresh clear the unchanged old list", async () => {
    const fetch = vi.fn().mockImplementation((_url, init) => Promise.resolve(success(init))); vi.stubGlobal("fetch", fetch);
    const view = render(<BodyAssessmentsWorkspace {...props()} />); sign();
    await waitFor(() => expect(screen.getByText("已保存第 2 版（已簽署）")).toBeInTheDocument());
    expect(screen.queryByText(/操作回執/u)).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalledOnce(); expect(screen.getByRole("button", { name: "新增評估草稿" })).toBeDisabled();
    view.rerender(<BodyAssessmentsWorkspace {...props(actor, true, true, { ...snapshot })} />);
    expect(screen.getByRole("button", { name: "新增評估草稿" })).toBeDisabled();
    const marker = getBodyAssessmentPending().confirmed[0];
    view.rerender(<BodyAssessmentsWorkspace {...props(actor, true, true, { ...snapshot, generatedAt: marker.committedAt,
      records: [{ ...snapshot.records[0], version_id: marker.versionId, version: marker.version, record_state: "signed" }] })} />);
    expect(screen.getByRole("button", { name: "新增評估草稿" })).toBeEnabled();
    expect(getBodyAssessmentPending().confirmed).toHaveLength(0);
  });
  it("offers a GET-only all-state lookup for a signed version excluded by the old draft filter", async () => {
    const fetch = vi.fn().mockImplementation((_url, init) => Promise.resolve(success(init))); vi.stubGlobal("fetch", fetch);
    render(<BodyAssessmentsWorkspace {...props(actor, true, true, { ...snapshot, filters: { clientId: null, state: "draft" } })} />); sign();
    await waitFor(() => expect(screen.getByRole("button", { name: "查看已保存紀錄" })).toBeEnabled());
    const form = screen.getByRole("form", { name: "查看已保存身體評估" });
    expect(form).toHaveAttribute("method", "get");
    expect(new FormData(form as HTMLFormElement).get("state")).toBe("all");
    expect(new FormData(form as HTMLFormElement).get("client")).toBe(snapshot.clients[0].clientId);
    expect(fireEvent.submit(form)).toBe(true); expect(hasViewTransition()).toBe(true);
    expect(fetch).toHaveBeenCalledOnce(); expect(getBodyAssessmentPending().confirmed).toHaveLength(1);
  });
  it("does not expose a confirmed client's hidden query identifier after assignment is revoked", async () => {
    const fetch = vi.fn().mockImplementation((_url, init) => Promise.resolve(success(init))); vi.stubGlobal("fetch", fetch);
    const view = render(<BodyAssessmentsWorkspace {...props()} />); sign();
    await waitFor(() => expect(screen.getByRole("button", { name: "查看已保存紀錄" })).toBeEnabled());
    view.rerender(<BodyAssessmentsWorkspace {...props(actor, true, true, { ...snapshot, clients: [], clientTotal: 0, records: [], matchingTotal: 0 })} />);
    expect(screen.queryByRole("form", { name: "查看已保存身體評估" })).not.toBeInTheDocument();
    expect(screen.queryByText(/已保存第/u)).not.toBeInTheDocument();
    expect(view.container.innerHTML).not.toContain(snapshot.clients[0].clientId);
    expect(getBodyAssessmentPending().confirmed).toHaveLength(1);
  });
  it.each(["actor_user_id", "branch_id", "client_id", "idempotency_key"])("rejects a successful-looking wrong %s receipt", async (field) => {
    const fetch = vi.fn().mockImplementation((_url, init) => Promise.resolve(success(init, { [field]: "00000000-0000-4000-8000-000000000099" })));
    vi.stubGlobal("fetch", fetch); render(<BodyAssessmentsWorkspace {...props()} />); sign(); await unknown();
    expect(screen.queryByText(/已保存第/u)).not.toBeInTheDocument(); expect(refresh).not.toHaveBeenCalled();
  });
  it("guards native GET filters and manual refresh while an uncertain write owns the shared lease", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    render(<BodyAssessmentsWorkspace {...props()} />); sign(); await unknown();
    expect(fireEvent.submit(screen.getByRole("form", { name: "查詢身體評估" }))).toBe(false);
    expect(screen.getByRole("button", { name: "查詢" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重新載入" })); expect(refresh).not.toHaveBeenCalled();
  });
  it("keeps the native GET view lease until actual unmount rather than any rerender", () => {
    const view = render(<BodyAssessmentsWorkspace {...props()} />);
    expect(fireEvent.submit(screen.getByRole("form", { name: "查詢身體評估" }))).toBe(true);
    expect(hasViewTransition()).toBe(true);
    view.rerender(<BodyAssessmentsWorkspace {...props(actor, true, true, { ...snapshot })} />);
    expect(hasViewTransition()).toBe(true); view.unmount(); expect(hasViewTransition()).toBe(false);
  });
  it.each(["operation", "view"])("does not create or send while another %s lease exists", (kind) => {
    render(<BodyAssessmentsWorkspace {...props()} />);
    act(() => { leases.push((kind === "operation" ? tryAcquirePendingOperation() : tryAcquireViewTransition())!); });
    expect(screen.getByRole("button", { name: "新增評估草稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "核對並簽署" })).toBeDisabled();
  });
  it("blocks IME submission but resets the transient IME flag on a permission ABA/editor replacement", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("network")); vi.stubGlobal("fetch", fetch);
    const view = render(<BodyAssessmentsWorkspace {...props()} />); const first = fillEditor();
    fireEvent.compositionStart(first); fireEvent.submit(first); expect(fetch).not.toHaveBeenCalled();
    view.rerender(<BodyAssessmentsWorkspace {...props(actor, false, true)} />);
    view.rerender(<BodyAssessmentsWorkspace {...props()} />); const replacement = fillEditor();
    fireEvent.submit(replacement); await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  });
  it("never persists clinical payload or operation keys in browser storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem"); const getItem = vi.spyOn(Storage.prototype, "getItem");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    render(<BodyAssessmentsWorkspace {...props()} />); sign(); await unknown();
    expect(setItem).not.toHaveBeenCalled(); expect(getItem).not.toHaveBeenCalled();
  });
});
