// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CustomPublicationFields, CustomPublicationReview } from "./custom-publication-review";
import type { FormGovernanceVersion } from "@/lib/form-governance/types";
import type { PublicationReviewHistory } from "@/lib/form-governance/publication-review";
import type { CustomDraftPayload } from "@/lib/form-governance/custom-draft";
import { reviewEnvelope, reviewHistory, reviewIds as ids, reviewPayload, reviewReceipt, reviewRequest } from "@/lib/form-governance/publication-review.test-fixtures";
import { hasPendingOperations, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";
import { buildDemoFormGovernanceSnapshot } from "@/lib/form-governance/demo";
import { buildDemoPublicationReview } from "@/lib/form-governance/publication-review-demo";
const refresh = vi.fn(); vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const version: FormGovernanceVersion = { id: ids.version, definitionId: ids.other, formKey: "tenant.custom.review", name: "合成送審表單", category: "行政表單", official: false, version: 1, status: "draft", effectiveFrom: "2026-09-23", effectiveTo: null, schemaFieldCount: 1, scoringRuleCount: 0, publishedAt: null, contentHash: null, publication: null };
function response(data: unknown, status = 200) { return new Response(JSON.stringify(reviewEnvelope(data)), { status }); }
function read(history = reviewHistory()) { return response({ history, demo: false }); }
function saved(action: "request" | "approve" | "withdraw" | "return" = "request", replayed = false, override = {}) { return response({ receipt: { ...reviewReceipt(action, replayed), ...override }, persisted: true, demo: false }, replayed ? 200 : 201); }
function denied(status = 403, code = "PUBLICATION_REVIEW_DENIED") { return new Response(JSON.stringify({ requestId: ids.other, status: "error", data: null, errors: [{ code, message: "操作不允許" }] }), { status }); }
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
afterEach(() => { cleanup(); refresh.mockReset(); vi.unstubAllGlobals(); });
async function open(options: { canAct?: boolean } = {}) {
  const view = render(<CustomPublicationReview version={version} instance="desktop" enabled canAct={options.canAct ?? true} />);
  fireEvent.click(screen.getByRole("button", { name: "審閱欄位／送審歷程" }));
  await waitFor(() => expect(screen.queryByText("正在確認完整內容…")).toBeNull()); return view;
}
function confirm() { fireEvent.click(screen.getByRole("checkbox", { name: "我已核對本輪實際欄位、生效日與申請狀態" })); }
function reason() { fireEvent.change(screen.getByLabelText("撤回／退回原因（至少五字）"), { target: { value: "合成修改原因說明" } }); }
function closedHistory(revised: boolean): PublicationReviewHistory {
  const request = reviewRequest(); request.status = "withdrawn";
  request.events.push({ ...request.events[0]!, id: ids.other, action: "withdraw", reason: "合成修改原因說明", createdAt: "2026-09-22T08:01:00Z" });
  const history = reviewHistory([request]); history.currentDraftRevision = revised ? 2 : 1;
  if (revised) history.currentDraft!.schema.fields[0]!.label = "新版已修改欄位";
  return history;
}
describe("custom publication review", () => {
  it("keeps disabled demo entry read-only", () => { const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); render(<CustomPublicationReview version={version} instance="mobile" enabled={false} canAct={false} />); fireEvent.click(screen.getByRole("button", { name: "審閱欄位／送審歷程" })); expect(fetch).not.toHaveBeenCalled(); });
  it("loads actual fields before requesting exact saved revision", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(read()).mockResolvedValueOnce(saved()); vi.stubGlobal("fetch", fetch); await open();
    expect(screen.getByText("當時送審欄位")).toBeTruthy(); expect(screen.getByText("最多 400 字")).toBeTruthy();
    expect((screen.getByRole("button", { name: "送出覆核" }) as HTMLButtonElement).disabled).toBe(true);
    confirm(); fireEvent.click(screen.getByRole("button", { name: "送出覆核" })); fireEvent.click(screen.getByRole("button", { name: "送出覆核" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1)); expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({ action: "request", formVersionId: ids.version, requestId: null, baseRevision: 1, reason: null });
  });
  it("requester can withdraw but cannot approve or return", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(read(reviewHistory([reviewRequest()]))).mockResolvedValueOnce(saved("withdraw")); vi.stubGlobal("fetch", fetch); await open();
    expect(screen.queryByRole("button", { name: "核准並發布" })).toBeNull(); expect(screen.queryByRole("button", { name: "退回修改" })).toBeNull();
    confirm(); reason(); fireEvent.click(screen.getByRole("button", { name: "撤回並修改" })); await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetch.mock.calls[1]![1].body).reason).toBe("合成修改原因說明");
  });
  it("independent reviewer can return with reason, never withdraw", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(read(reviewHistory([reviewRequest(false)]))).mockResolvedValueOnce(saved("return")); vi.stubGlobal("fetch", fetch); await open();
    expect(screen.queryByRole("button", { name: "撤回並修改" })).toBeNull(); confirm();
    fireEvent.click(screen.getByRole("button", { name: "退回修改" })); expect(fetch).toHaveBeenCalledTimes(1); expect(screen.getByRole("alert").textContent).toContain("至少五字");
    reason(); fireEvent.click(screen.getByRole("button", { name: "退回修改" })); await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
  it("supports independent approval of frozen field content", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(read(reviewHistory([reviewRequest(false)]))).mockResolvedValueOnce(saved("approve")); vi.stubGlobal("fetch", fetch); await open(); confirm();
    fireEvent.click(screen.getByRole("button", { name: "核准並發布" })); await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetch.mock.calls[1]![1].body).requestId).toBe(ids.request);
  });
  it("requires a saved changed revision before resubmitting", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(read(closedHistory(false)))); await open(); confirm();
    expect((screen.getByRole("button", { name: "重新送出覆核" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/請先關閉、編輯並儲存草稿/u)).toBeTruthy();
  });
  it("identical saved content is not a meaningful revision", async () => {
    const history = closedHistory(false); history.currentDraftRevision = 2;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(read(history))); await open(); confirm();
    expect((screen.getByRole("button", { name: "重新送出覆核" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/僅儲存相同內容不算修改/u)).toBeTruthy();
  });
  it("known synthetic demo history can be inspected without fetch or any write", async () => {
    const demo = buildDemoFormGovernanceSnapshot().versions.find(item => item.formKey === "tenant.custom.care_diary" && item.version === 2)!;
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<CustomPublicationReview version={demo} instance="mobile" enabled canAct demoHistory={buildDemoPublicationReview(demo)} />);
    fireEvent.click(screen.getByRole("button", { name: "審閱欄位／送審歷程" })); await screen.findByText(/合成展示・僅供審閱/u);
    expect(screen.getByText("合成參與程度")).toBeTruthy(); expect((screen.getByRole("button", { name: "核准並發布" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "核准並發布" })); expect(fetch).not.toHaveBeenCalled();
  });
  it("separates old frozen fields from edited draft, and submits as a new request", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(read(closedHistory(true))).mockResolvedValueOnce(saved("request", false, { event: { ...reviewReceipt().event, requestId: ids.other } })); vi.stubGlobal("fetch", fetch); await open();
    expect(screen.getByText("新版已修改欄位")).toBeTruthy(); fireEvent.change(screen.getByLabelText("審閱內容"), { target: { value: ids.request } });
    expect(screen.getByText("當時送審欄位")).toBeTruthy(); expect(screen.queryByText("新版已修改欄位")).toBeNull();
    expect((screen.getByRole("button", { name: "重新送出覆核" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("審閱內容"), { target: { value: "draft" } }); confirm(); fireEvent.click(screen.getByRole("button", { name: "重新送出覆核" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1)); expect(JSON.parse(fetch.mock.calls[1]![1].body)).toMatchObject({ baseRevision: 2, requestId: null });
  });
  it("retains key/body and navigation guard after unknown then 403; old replay is not a new pending request", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(read()).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(denied()).mockResolvedValueOnce(saved("request", true, { requestStatus: "withdrawn" })); vi.stubGlobal("fetch", fetch); await open(); confirm(); fireEvent.click(screen.getByRole("button", { name: "送出覆核" }));
    await screen.findByRole("button", { name: "以原操作重試" }); expect(hasPendingOperations()).toBe(true); expect((screen.getByRole("button", { name: "關閉" }) as HTMLButtonElement).disabled).toBe(true);
    const cancel = new Event("cancel", { cancelable: true }); screen.getByRole("dialog").dispatchEvent(cancel); expect(cancel.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "以原操作重試" })); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    await waitFor(() => expect((screen.getByRole("button", { name: "以原操作重試" }) as HTMLButtonElement).disabled).toBe(false));
    expect(hasPendingOperations()).toBe(true); fireEvent.click(screen.getByRole("button", { name: "以原操作重試" })); await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetch.mock.calls[1]![1].body).toBe(fetch.mock.calls[3]![1].body); expect(fetch.mock.calls[1]![1].headers["Idempotency-Key"]).toBe(fetch.mock.calls[3]![1].headers["Idempotency-Key"]);
    expect(screen.getByText(/已確認原送審結果：申請人已撤回/u)).toBeTruthy(); expect(hasPendingOperations()).toBe(false);
  });
  it("preserves pending lease after unmount until exact late success", async () => {
    let resolve!: (value: Response) => void; const pending = new Promise<Response>(done => { resolve = done; });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(read()).mockReturnValueOnce(pending)); const view = await open(); confirm(); fireEvent.click(screen.getByRole("button", { name: "送出覆核" })); view.unmount();
    expect(hasPendingOperations()).toBe(true); expect(tryAcquireViewTransition()).toBeNull(); resolve(saved()); await waitFor(() => expect(hasPendingOperations()).toBe(false)); expect(refresh).not.toHaveBeenCalled();
  });
  it("offers new-tab same-account reauthentication after uncertainty without dropping retry identity", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(read()).mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(denied(403, "AAL2_REQUIRED")).mockResolvedValueOnce(saved("request", true));
    vi.stubGlobal("fetch", fetch); await open(); confirm(); fireEvent.click(screen.getByRole("button", { name: "送出覆核" })); await screen.findByRole("button", { name: "以原操作重試" });
    fireEvent.click(screen.getByRole("button", { name: "以原操作重試" })); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    await waitFor(() => expect((screen.getByRole("button", { name: "以原操作重試" }) as HTMLButtonElement).disabled).toBe(false));
    const link = screen.getByRole("link", { name: "另開視窗重新驗證" }); expect(link.getAttribute("target")).toBe("_blank"); expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("href")).toBe("/mfa?audience=staff&purpose=sensitive-action"); fireEvent.click(link); expect(hasPendingOperations()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "以原操作重試" })); await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetch.mock.calls[1]![1].body).toBe(fetch.mock.calls[3]![1].body); expect(fetch.mock.calls[1]![1].headers["Idempotency-Key"]).toBe(fetch.mock.calls[3]![1].headers["Idempotency-Key"]);
  });
  it("retains uncertain mismatched frozen-hash receipt until exact replay", async () => {
    const wrong = reviewReceipt("approve"); wrong.event.formContentHash = "b".repeat(64);
    const fetch = vi.fn().mockResolvedValueOnce(read(reviewHistory([reviewRequest(false)]))).mockResolvedValueOnce(response({ receipt: wrong, persisted: true, demo: false }, 201)).mockResolvedValueOnce(saved("approve", true));
    vi.stubGlobal("fetch", fetch); await open(); confirm(); fireEvent.click(screen.getByRole("button", { name: "核准並發布" })); await screen.findByRole("button", { name: "以原操作重試" });
    expect(refresh).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "以原操作重試" })); await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
  it("rejects resubmit receipt that reuses an older closed request ID", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(read(closedHistory(true))).mockResolvedValueOnce(saved()).mockResolvedValueOnce(saved("request", true, { event: { ...reviewReceipt().event, requestId: ids.other } }));
    vi.stubGlobal("fetch", fetch); await open(); confirm(); fireEvent.click(screen.getByRole("button", { name: "重新送出覆核" })); await screen.findByRole("button", { name: "以原操作重試" });
    expect(refresh).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "以原操作重試" })); await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
  it("read-only reviewers can inspect without new MFA but cannot submit", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(read()); vi.stubGlobal("fetch", fetch); await open({ canAct: false });
    expect(screen.getByText("當時送審欄位")).toBeTruthy(); expect((screen.getByRole("button", { name: "送出覆核" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("link", { name: "前往重新驗證" })).toBeTruthy(); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("never writes on failed initial read or uses old loaded content on reopen", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(read()).mockRejectedValueOnce(new Error("offline")); vi.stubGlobal("fetch", fetch); await open(); fireEvent.click(screen.getByRole("button", { name: "關閉" }));
    fireEvent.click(screen.getByRole("button", { name: "審閱欄位／送審歷程" })); await screen.findByRole("button", { name: "重試載入審閱" });
    expect(screen.queryByRole("button", { name: "送出覆核" })).toBeNull(); expect(screen.queryByText("當時送審欄位")).toBeNull();
  });
  it("does not start writes during a view transition", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(read()); vi.stubGlobal("fetch", fetch); await open(); confirm(); const release = tryAcquireViewTransition();
    try { fireEvent.click(screen.getByRole("button", { name: "送出覆核" })); expect(fetch).toHaveBeenCalledTimes(1); expect(hasPendingOperations()).toBe(false); } finally { release?.(); }
  });
  it("portals the active dialog outside desktop/mobile ancestors without losing pending operations", async () => {
    let resolve!: (value: Response) => void; const pending = new Promise<Response>(done => { resolve = done; });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(read()).mockReturnValueOnce(pending));
    const view = render(<div data-testid="desktop"><CustomPublicationReview version={version} instance="desktop" enabled canAct /></div>);
    fireEvent.click(screen.getByRole("button", { name: "審閱欄位／送審歷程" })); await screen.findByText("當時送審欄位"); confirm();
    fireEvent.click(screen.getByRole("button", { name: "送出覆核" })); screen.getByTestId("desktop").hidden = true;
    expect(screen.getByRole("dialog").parentElement).toBe(document.body); expect(view.container.querySelector("dialog")).toBeNull();
    expect(hasPendingOperations()).toBe(true); resolve(saved()); await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1)); expect(hasPendingOperations()).toBe(false);
  });
  it("shows all five supported field types, requiredness, boundaries and options", () => {
    const payload: CustomDraftPayload = reviewPayload(); payload.schema.fields = [
      ...payload.schema.fields,
      { key: "weight", label: "合成重量", type: "number", required: false, minimum: 0, maximum: 200 },
      { key: "date", label: "合成日期", type: "date", required: true },
      { key: "yes", label: "合成是非", type: "boolean", required: false },
      { key: "kind", label: "合成選項", type: "select", required: true, options: ["甲", "乙"] },
    ];
    render(<CustomPublicationFields payload={payload} />); expect(screen.getByText("範圍：0 ～ 200")).toBeTruthy(); expect(screen.getByText("可選：甲、乙")).toBeTruthy(); expect(screen.getByText("使用有效西元日期")).toBeTruthy(); expect(screen.getByText(/未填不等於「否」/u)).toBeTruthy();
  });
});
