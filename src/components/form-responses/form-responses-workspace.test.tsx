// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import * as leases from "@/lib/navigation/pending-operation-lock";
import type { ResponseInput, ResponseRecord, ResponseSnapshot } from "@/lib/custom-form-responses/contract";
import { FormResponsesWorkspace } from "./form-responses-workspace";

const clientId = "e1100000-0000-4000-8000-000000000001";
const formId = "e1200000-0000-4000-8000-000000000001";
const actorId = "e1300000-0000-4000-8000-000000000001";
const schema: ResponseRecord["schema"] = { builder: "tenant-custom.v1", fields: [
  { key: "note", label: "紀錄", type: "text", required: true, maxLength: 100 },
  { key: "flag", label: "已確認", type: "boolean", required: true },
  { key: "count", label: "數量", type: "number", required: false, minimum: 0, maximum: 10 },
] };
const record: ResponseRecord = { id: "e1400000-0000-4000-8000-000000000001", recordKey: "e1500000-0000-4000-8000-000000000001", clientId, formVersionId: formId,
  revision: 1, previousId: null, correctionSourceId: null, serviceDate: "2026-09-22", status: "draft", schema,
  answers: { note: { state: "answered", value: "保存原文" }, flag: { state: "answered", value: false }, count: { state: "answered", value: 0 } },
  reason: null, signatureEvidence: null, contentHash: "a".repeat(64), actorId, createdAt: "2026-09-22T06:00:00Z" };
const snapshot: ResponseSnapshot = { clientId, forms: [{ id: formId, name: "合成表單", version: 1, schema, effectiveFrom: "2026-09-01", effectiveTo: null }],
  records: [record], hasMore: false, total: 1, generatedAt: record.createdAt };
const signedRecord: ResponseRecord = { ...record, id: "e1400000-0000-4000-8000-000000000002", revision: 2, previousId: record.id, status: "signed",
  signatureEvidence: { signerId: actorId, signedAt: record.createdAt, challengeId: actorId, roles: ["nurse"], aal: "aal2", purpose: "本人確認此機構自訂表單填答" } };
const props = { clients: [{ id: clientId, label: "合成個案" }, { id: actorId, label: "另一合成個案" }], initialClient: clientId, today: "2026-09-22", canWrite: true, canSign: true };
const ok = (data: unknown, status = 200) => Response.json({ requestId: actorId, status: "ok", data, errors: [] }, { status });
const readReply = (value = snapshot) => ok({ snapshot: value, demo: false });
const writeReply = (value: ResponseRecord, replayed = false) => ok({ receipt: { record: value, replayed }, persisted: true, demo: false }, replayed ? 200 : 201);
const errorReply = (status: number, code = "CUSTOM_RESPONSE_FORBIDDEN") => Response.json({ requestId: actorId, status: "error", data: null, errors: [{ code, message: "合成拒絕，請核對" }] }, { status });
const acquire = leases.tryAcquirePendingOperation;
const operationReleases: Mock<() => void>[] = [];
beforeEach(() => {
  vi.spyOn(leases, "tryAcquirePendingOperation").mockImplementation(() => {
    const release = acquire(); if (!release) return null;
    const tracked = vi.fn(release); operationReleases.push(tracked); return tracked;
  });
  vi.spyOn(window, "confirm").mockReturnValue(false);
});
afterEach(() => { cleanup(); operationReleases.splice(0).forEach((release) => release()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function open(fetchMock: ReturnType<typeof vi.fn>, value = snapshot, extra: Partial<typeof props> = {}) {
  fetchMock.mockResolvedValueOnce(readReply(value)); vi.stubGlobal("fetch", fetchMock);
  const view = render(<FormResponsesWorkspace {...props} {...extra} />);
  fireEvent.click(screen.getByRole("button", { name: "載入個案表單" }));
  await screen.findByRole("button", { name: "查看／接續處理" });
  fireEvent.click(screen.getByRole("button", { name: "查看／接續處理" }));
  return view;
}
const save = () => fireEvent.click(screen.getByRole("button", { name: "儲存填答草稿" }));
function externalLink() {
  const link = document.createElement("a"); link.href = "/app/other"; document.body.append(link);
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }); link.dispatchEvent(event); link.remove(); return event;
}

describe("custom form response interaction and receipt safety", () => {
  it("loads, saves then signs only the saved version", async () => {
    const fetchMock = vi.fn(); await open(fetchMock);
    fireEvent.change(screen.getByLabelText("紀錄（必填）"), { target: { value: "新保存內容" } });
    expect(screen.getByRole("button", { name: "本人確認並簽署已保存版本" })).toBeDisabled();
    const saved: ResponseRecord = { ...record, id: "e1400000-0000-4000-8000-000000000003", previousId: record.id, revision: 2,
      answers: { ...record.answers, note: { state: "answered", value: "新保存內容" } } };
    fetchMock.mockResolvedValueOnce(writeReply(saved)); save();
    await screen.findByText("已保存填答；尚未簽署。"); expect(leases.hasPendingOperations()).toBe(false);
    const signed: ResponseRecord = { ...saved, id: signedRecord.id, revision: 3, previousId: saved.id, status: "signed", signatureEvidence: signedRecord.signatureEvidence };
    fetchMock.mockResolvedValueOnce(writeReply(signed));
    fireEvent.click(screen.getByRole("button", { name: "本人確認並簽署已保存版本" }));
    await screen.findByText("已簽署；此版本已鎖定，更正需建立新版。");
    const sent = JSON.parse(fetchMock.mock.calls[2][1].body) as { input: ResponseInput };
    expect(sent.input).toMatchObject({ action: "sign", previousId: saved.id, baseRevision: 2, answers: null });
    expect(screen.getByLabelText("紀錄（必填）")).toBeDisabled(); expect(operationReleases.every((release) => release.mock.calls.length === 1)).toBe(true);
  });
  it("does not turn the boolean placeholder into false", async () => {
    const fetchMock = vi.fn(); await open(fetchMock);
    fireEvent.change(screen.getByLabelText("已確認（必填）"), { target: { value: "" } });
    expect(screen.getByLabelText("已確認填答狀態")).toHaveValue("missing");
    const saved = { ...record, id: actorId, previousId: record.id, revision: 2, answers: { ...record.answers, flag: { state: "missing" as const } } };
    fetchMock.mockResolvedValueOnce(writeReply(saved)); save(); await screen.findByText("已保存填答；尚未簽署。");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).input.answers.flag).toEqual({ state: "missing" });
    fireEvent.click(screen.getByRole("button", { name: "本人確認並簽署已保存版本" }));
    expect(screen.getByRole("alert")).toHaveTextContent("必填，不可留白"); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("retains the same key, body and lease after unknown 500 then 403", async () => {
    const fetchMock = vi.fn(); await open(fetchMock);
    fetchMock.mockResolvedValueOnce(errorReply(500, "CUSTOM_RESPONSE_UNAVAILABLE")).mockResolvedValueOnce(errorReply(403)); save();
    const retry = await screen.findByRole("button", { name: "核對並重試原操作" });
    expect(leases.hasPendingOperations()).toBe(true); expect(leases.tryAcquireViewTransition()).toBeNull();
    expect(externalLink().defaultPrevented).toBe(true); expect(window.confirm).not.toHaveBeenCalled();
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(retry).toBeEnabled());
    expect(fetchMock.mock.calls[2][1].body).toBe(fetchMock.mock.calls[1][1].body);
    expect(fetchMock.mock.calls[2][1].headers).toEqual(fetchMock.mock.calls[1][1].headers);
    expect(screen.getByLabelText("紀錄（必填）")).toBeDisabled(); expect(operationReleases[0]).not.toHaveBeenCalled();
    expect(screen.queryByText("已保存填答；尚未簽署。")).toBeNull();
    fireEvent.change(screen.getByLabelText("紀錄（必填）"), { target: { value: "不應採用的變更" } });
    expect(screen.getByLabelText("紀錄（必填）")).toHaveValue("保存原文");
    fetchMock.mockResolvedValueOnce(writeReply({ ...record, id: actorId, revision: 2, previousId: record.id }, true));
    fireEvent.click(retry); await screen.findByText("已保存填答；尚未簽署。");
    expect(fetchMock.mock.calls[3][1].body).toBe(fetchMock.mock.calls[1][1].body);
    expect(leases.hasPendingOperations()).toBe(false); expect(operationReleases[0]).toHaveBeenCalledOnce();
  });
  it("keeps unresolved lease through unmount", async () => {
    const fetchMock = vi.fn(); const view = await open(fetchMock);
    fetchMock.mockRejectedValueOnce(new Error("network")); save(); await screen.findByRole("button", { name: "核對並重試原操作" });
    view.unmount(); expect(leases.hasPendingOperations()).toBe(true); expect(operationReleases[0]).not.toHaveBeenCalled();
  });
  it.each(["success", "rejection"] as const)("releases a late definite %s without touching another page", async (outcome) => {
    const fetchMock = vi.fn(); const view = await open(fetchMock);
    let resolve!: (reply: Response) => void; const pending = new Promise<Response>((r) => { resolve = r; });
    fetchMock.mockReturnValueOnce(pending); save(); view.unmount(); expect(leases.hasPendingOperations()).toBe(true);
    await act(async () => { resolve(outcome === "success" ? writeReply({ ...record, id: actorId, revision: 2, previousId: record.id }) : errorReply(403)); await pending; });
    await waitFor(() => expect(leases.hasPendingOperations()).toBe(false)); expect(operationReleases[0]).toHaveBeenCalledOnce();
  });
  it("keeps dirty text and correction reasons guarded against SPA navigation", async () => {
    const fetchMock = vi.fn(); await open(fetchMock, { ...snapshot, records: [signedRecord] });
    fireEvent.change(screen.getByLabelText("更正原因"), { target: { value: "核對後補充" } });
    expect(screen.getByLabelText("個案")).toBeDisabled(); expect(externalLink().defaultPrevented).toBe(true);
    expect(window.confirm).toHaveBeenCalledOnce(); expect(screen.getByLabelText("更正原因")).toHaveValue("核對後補充");
    const corrected = { ...signedRecord, id: actorId, revision: 3, previousId: signedRecord.id, correctionSourceId: signedRecord.id,
      status: "draft" as const, signatureEvidence: null, reason: "核對後補充" };
    fetchMock.mockResolvedValueOnce(writeReply(corrected)); fireEvent.click(screen.getByRole("button", { name: "建立更正版" }));
    await screen.findByText("已保存填答；尚未簽署。"); expect(screen.getByLabelText("紀錄（必填）")).toBeEnabled();
  });
  it.each(["answers", "schema", "recordKey", "signer"] as const)("treats mismatched signing %s receipt as unknown", async (mismatch) => {
    const fetchMock = vi.fn(); await open(fetchMock);
    const wrong = mismatch === "answers" ? { ...signedRecord, answers: { ...record.answers, note: { state: "answered", value: "不同內容" } } }
      : mismatch === "schema" ? { ...signedRecord, schema: { ...schema, fields: schema.fields.map((f) => ({ ...f, label: "不同標籤" })) } }
        : mismatch === "recordKey" ? { ...signedRecord, recordKey: clientId }
          : { ...signedRecord, signatureEvidence: { ...signedRecord.signatureEvidence!, signerId: clientId } };
    fetchMock.mockResolvedValueOnce(writeReply(wrong as ResponseRecord)); fireEvent.click(screen.getByRole("button", { name: "本人確認並簽署已保存版本" }));
    await screen.findByRole("button", { name: "核對並重試原操作" });
    expect(screen.queryByText("已簽署；此版本已鎖定，更正需建立新版。")).toBeNull(); expect(leases.hasPendingOperations()).toBe(true);
    expect(screen.getByLabelText("紀錄（必填）")).toHaveValue("保存原文");
  });
  it("does not create keys or POST during a branch/view transition", async () => {
    const fetchMock = vi.fn(); await open(fetchMock); const release = leases.tryAcquireViewTransition()!;
    const random = vi.spyOn(crypto, "randomUUID"); save();
    expect(screen.getByRole("alert")).toHaveTextContent("畫面正在更新或切換分支");
    expect(random).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledTimes(1); release();
  });
  it("does not interpret first definite rejection as a save", async () => {
    const fetchMock = vi.fn(); await open(fetchMock); fetchMock.mockResolvedValueOnce(errorReply(409, "CUSTOM_RESPONSE_CONFLICT")); save();
    await screen.findByText("合成拒絕，請核對"); expect(leases.hasPendingOperations()).toBe(false);
    expect(screen.queryByText("已保存填答；尚未簽署。")).toBeNull(); expect(screen.getByRole("button", { name: "儲存填答草稿" })).toBeEnabled();
  });
  it("loads synthetic demo for read-only inspection without fetch or mutation", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    render(<FormResponsesWorkspace {...props} demo demoSnapshot={snapshot} canWrite={false} canSign={false} />);
    fireEvent.click(screen.getByRole("button", { name: "載入個案表單" })); fireEvent.click(await screen.findByRole("button", { name: "查看／接續處理" }));
    expect(screen.getByLabelText("紀錄（必填）")).toBeDisabled(); expect(screen.getByLabelText("紀錄（必填）")).toHaveValue("保存原文");
    expect(screen.getByRole("button", { name: "儲存填答草稿" })).toBeDisabled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("ignores supplied demo data in a real session", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(errorReply(403)); vi.stubGlobal("fetch", fetchMock);
    render(<FormResponsesWorkspace {...props} demoSnapshot={snapshot} />); fireEvent.click(screen.getByRole("button", { name: "載入個案表單" }));
    await screen.findByRole("alert"); expect(fetchMock).toHaveBeenCalledOnce(); expect(screen.queryByText("保存原文")).toBeNull();
  });
  it("renders older revisions read-only and never adds a nested main landmark", async () => {
    const fetchMock = vi.fn(); await open(fetchMock, { ...snapshot, records: [signedRecord, record], total: 2 });
    fireEvent.click(screen.getByRole("button", { name: "查看歷史版本" }));
    expect(screen.getByText("此為歷史版本，僅供查閱。請選擇此紀錄最新版本接續處理。")).toBeVisible();
    expect(screen.getByLabelText("紀錄（必填）")).toBeDisabled();
    expect(screen.getByRole("button", { name: "儲存填答草稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "本人確認並簽署已保存版本" })).toBeDisabled();
    expect(screen.queryByRole("main")).toBeNull(); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("does not allow correction of a historical signed revision", async () => {
    const fetchMock = vi.fn(); const newer: ResponseRecord = { ...record, id: actorId, revision: 3, previousId: signedRecord.id, correctionSourceId: signedRecord.id, reason: "已另建更正" };
    await open(fetchMock, { ...snapshot, records: [newer, signedRecord], total: 2 });
    fireEvent.click(screen.getByRole("button", { name: "查看歷史版本" }));
    expect(screen.getByLabelText("更正原因")).toBeDisabled(); expect(screen.getByRole("button", { name: "建立更正版" })).toBeDisabled();
  });
});
