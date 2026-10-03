// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaipeiDraftSnapshot } from "@/lib/taipei-abcd/types";
import { emptyWorkflow } from "@/lib/taipei-abcd/workflow";
import { TaipeiAbcdReview } from "./taipei-abcd-review";
const org = "bb010000-0000-4000-8000-000000000001", branch = "bb010000-0000-4000-8000-000000000002", client = "bb010000-0000-4000-8000-000000000003", id = "bb010000-0000-4000-8000-000000000004";
const snapshot: TaipeiDraftSnapshot = { organizationId: org, branchId: branch, clientId: client, form: "A", usageYear: 115, month: 0, history: [], currentSources: null, canEdit: false, canReview: true, canExport: false, workflow: { ...emptyWorkflow, state: "submitted", sequence: 1 }, latest: { id, organizationId: org, branchId: branch, clientId: client, form: "A", usageYear: 115, month: 0, version: 1, previousVersionId: null, contentHash: "a".repeat(64), answers: { "A1.name": { state: "recorded", value: "合成", reason: null } }, sourceSnapshot: null, createdAt: "2026-09-14T01:00:00Z", state: "draft", publicationStatus: "pending_approval" } };
const fetchMock = vi.fn();
describe("administrative review UI", () => {
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  function show(extra: Partial<Parameters<typeof TaipeiAbcdReview>[0]> = {}) { const callbacks = { onBusy: vi.fn(), onDirty: vi.fn(), onUnknown: vi.fn(), onChanged: vi.fn().mockResolvedValue(undefined) }; render(<TaipeiAbcdReview snapshot={snapshot} unsavedAnswers={false} disabled={false} {...callbacks} {...extra} />); return callbacks; }
  it("states administrative approval is not signed and gates high-risk export", () => { show(); expect(screen.getByRole("button", { name: "行政核准（非簽署）" })).toBeEnabled(); expect(screen.getByRole("button", { name: "產生同版預覽／列印 PDF" })).toBeDisabled(); expect(screen.getByText(/不是護理、社工或主管電子簽署/)).toBeInTheDocument(); });
  it("blocks review on unsaved answers and reports pending review reason to parent", () => { const callbacks = show(); fireEvent.change(screen.getByLabelText("送審／退回／核准／更正理由（至少三字）"), { target: { value: "合成覆核" } }); expect(callbacks.onDirty).toHaveBeenLastCalledWith(true); cleanup(); show({ unsavedAnswers: true }); expect(screen.getByRole("button", { name: "行政核准（非簽署）" })).toBeDisabled(); });
  it("retains exact retry after network loss and blocks double clicks while pending", async () => {
    const callbacks = show({ snapshot: { ...snapshot, canExport: true } }); fireEvent.change(screen.getByLabelText("送審／退回／核准／更正理由（至少三字）"), { target: { value: "合成覆核" } });
    fetchMock.mockRejectedValue(new Error("連線中斷"));
    const button = screen.getByRole("button", { name: "行政核准（非簽署）" }); fireEvent.click(button); fireEvent.click(button); await screen.findByText("連線中斷");
    expect(fetchMock).toHaveBeenCalledTimes(1); const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(callbacks.onUnknown).toHaveBeenLastCalledWith(true);
    expect(screen.getByLabelText("送審／退回／核准／更正理由（至少三字）")).toBeDisabled();
    expect(screen.getByRole("button", { name: "退回補件" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "產生同版預覽／列印 PDF" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("送審／退回／核准／更正理由（至少三字）"), { target: { value: "試圖變更理由" } });
    fireEvent.click(screen.getByRole("button", { name: "退回補件" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => { const p = JSON.parse(String(init.body)); return Response.json({ data: { eventId: org, draftId: id, state: "approved", sequence: 2, idempotencyKey: p.idempotency_key, replayed: true, isElectronicSignature: false } }); });
    fireEvent.click(button); await screen.findByText(/已重新讀回核對/); expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(payload); expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body); expect(callbacks.onChanged).toHaveBeenCalledTimes(1);
    expect(callbacks.onUnknown).toHaveBeenLastCalledWith(false);
    // Dirty notification runs in an effect after the success render.
    await waitFor(() => expect(callbacks.onDirty).toHaveBeenLastCalledWith(false));
    expect(callbacks.onBusy).toHaveBeenLastCalledWith(false);
  });
  it("does not claim success until the parent confirms persisted snapshot", async () => {
    const onChanged = vi.fn().mockRejectedValueOnce(new Error("讀回尚未一致")).mockResolvedValue(undefined); const callbacks = show({ onChanged });
    fireEvent.change(screen.getByLabelText("送審／退回／核准／更正理由（至少三字）"), { target: { value: "合成覆核" } });
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => { const p = JSON.parse(String(init.body)); return Response.json({ data: { eventId: org, draftId: id, state: "approved", sequence: 2, idempotencyKey: p.idempotency_key, replayed: false, isElectronicSignature: false } }); });
    fireEvent.click(screen.getByRole("button", { name: "行政核准（非簽署）" })); await screen.findByText("讀回尚未一致"); expect(screen.queryByText(/已重新讀回核對/)).not.toBeInTheDocument();
    expect(callbacks.onUnknown).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "行政核准（非簽署）" })); await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2)); expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(JSON.parse(fetchMock.mock.calls[0][1].body));
  });
  it("requires a real reason without calling API", async () => { show(); fireEvent.click(screen.getByRole("button", { name: "行政核准（非簽署）" })); await screen.findByText(/請確認所有區段/); expect(fetchMock).not.toHaveBeenCalled(); });
  it("keeps a prior uncertain approval locked even if a later retry receives 403", async () => {
    const callbacks = show();
    fireEvent.change(screen.getByLabelText("送審／退回／核准／更正理由（至少三字）"), { target: { value: "合成覆核" } });
    fetchMock.mockRejectedValueOnce(new Error("合成 timeout")).mockResolvedValueOnce(Response.json({ status: "error", data: null,
      requestId: "synthetic-retry", errors: [{ code: "REVIEW_DENIED", message: "暫無權限" }] }, { status: 403 }));
    fireEvent.click(screen.getByRole("button", { name: "行政核准（非簽署）" }));
    await screen.findByText("合成 timeout");
    const button = screen.getByRole("button", { name: "行政核准（非簽署）" });
    fireEvent.click(button);
    await screen.findByText("暫無權限");
    expect(callbacks.onUnknown).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("button", { name: "退回補件" })).toBeDisabled();
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[1][1].headers["idempotency-key"]).toBe(fetchMock.mock.calls[0][1].headers["idempotency-key"]);
  });
  it.each([
    { action: "submit", button: "送行政審核", state: "submitted", options: { canSubmit: true, canReview: false, canCorrect: false, workflow: { ...emptyWorkflow } } },
    { action: "return", button: "退回補件", state: "returned", options: { canSubmit: false, canReview: true, canCorrect: false, workflow: { ...emptyWorkflow, state: "submitted" as const, sequence: 1 } } },
    { action: "correct", button: "建立更正版", state: "draft", options: { canSubmit: false, canReview: false, canCorrect: true, workflow: { ...emptyWorkflow, state: "approved" as const, sequence: 1 } } },
  ])("freezes the $action transition body/key after timeout and retries only that action", async ({ action, button, state, options }) => {
    const callbacks = show({ snapshot: { ...snapshot, ...options } });
    if (action === "submit") {
      for (const checkbox of screen.getAllByRole("checkbox")) fireEvent.click(checkbox);
      for (const reason of screen.getAllByLabelText(/待補原因與後續處理/u)) fireEvent.change(reason, { target: { value: "合成待補說明" } });
    }
    fireEvent.change(screen.getByLabelText("送審／退回／核准／更正理由（至少三字）"), { target: { value: "合成行政理由" } });
    fetchMock.mockRejectedValueOnce(new Error("合成 timeout"));
    const target = screen.getByRole("button", { name: button });
    fireEvent.click(target);
    await screen.findByText("合成 timeout");
    expect(callbacks.onUnknown).toHaveBeenLastCalledWith(true);
    expect(screen.getByLabelText("送審／退回／核准／更正理由（至少三字）")).toBeDisabled();
    expect(target).toBeEnabled();
    if (action === "return") expect(screen.getByRole("button", { name: "行政核准（非簽署）" })).toBeDisabled();
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => { const payload = JSON.parse(String(init.body));
      return Response.json({ status: "ok", data: { eventId: org, draftId: action === "correct" ? branch : id, state,
        sequence: action === "submit" ? 1 : 2, idempotencyKey: payload.idempotency_key, replayed: true, isElectronicSignature: false } }); });
    fireEvent.click(target);
    await screen.findByText(/已重新讀回核對/u);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[1][1].headers["idempotency-key"]).toBe(fetchMock.mock.calls[0][1].headers["idempotency-key"]);
    expect(callbacks.onUnknown).toHaveBeenLastCalledWith(false);
  });
});
