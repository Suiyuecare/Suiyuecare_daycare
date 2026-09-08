// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { staffPages } from "@/lib/catalog";
import { buildDemoCaseServiceRecordSnapshot } from "@/lib/case-service-records/demo";
import { parseCaseServiceRecordMutation } from "@/lib/case-service-records/parser";
import { emptyCaseServiceRecordFilters } from "@/lib/case-service-records/query";
import type { CaseServiceRecordMutationInput } from "@/lib/case-service-records/types";

import { recordMutationBody } from "./case-service-record-request";
import { CaseServiceRecordsWorkspace } from "./case-service-records-workspace";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const page = staffPages.find((entry) => entry.number === 50)!;
const actorId = "33333333-3333-4333-8333-333333333333";
const filters = emptyCaseServiceRecordFilters();
function props() {
  return { page, filters, snapshot: { ...buildDemoCaseServiceRecordSnapshot(filters), demo: false },
    loadError: false, actorUserId: actorId, canManage: true, canSign: true, hasRecentAal2: true };
}
type Props = ReturnType<typeof props>;
const unknownResponse = () => new Response(JSON.stringify({ status: "ok" }), { status: 201 });
function rejection(status = 403, code = "CASE_SERVICE_RECORD_NOT_AUTHORIZED") {
  return new Response(JSON.stringify({ requestId: crypto.randomUUID(), status: "error", data: null,
    errors: [{ code, message: "SERVER_SECRET_SHOULD_NOT_RENDER" }] }), { status });
}
function success(input: CaseServiceRecordMutationInput, properties: Props, replayed = false) {
  const persistedFields = input.action === "sign_record" ? input.expectedRecordPayload : input;
  const data = { organizationId: properties.snapshot.organizationId, branchId: properties.snapshot.branchId,
    clientId: input.clientId, actorUserId: properties.actorUserId, operationId: crypto.randomUUID(),
    idempotencyKey: input.idempotencyKey, action: input.action, recordKey: input.recordKey ?? crypto.randomUUID(),
    versionId: crypto.randomUUID(), version: input.expectedVersion + 1,
    recordState: input.action === "save_record" ? "draft" : input.action === "sign_record" ? "signed" : "corrected",
    previousVersionId: input.previousVersionId, sourceContentHash: input.expectedContentHash, contentHash: "a".repeat(64),
    recordPayload: { clientId: input.clientId, startedAt: persistedFields.startedAt, endedAt: persistedFields.endedAt,
      serviceType: persistedFields.serviceType, serviceContent: persistedFields.serviceContent,
      serviceResult: persistedFields.serviceResult, executionReferenceId: persistedFields.executionReferenceId,
      executionReferenceStatus: input.action === "sign_record" ? input.expectedRecordPayload.executionReferenceStatus : "not_linked",
      executionReferenceContentHash: input.action === "sign_record" ? input.expectedRecordPayload.executionReferenceContentHash : null,
      authorUserId: input.action === "sign_record" ? input.expectedRecordPayload.authorUserId : actorId,
      sourceKind: "manual_local", schemaKind: "manual_service_narrative_v1", statutoryRuleStatus: "not_configured",
      claimEligibilityStatus: "not_configured" }, committedAt: new Date().toISOString(), replayed, persisted: true, demo: false };
  return new Response(JSON.stringify({ requestId: crypto.randomUUID(), status: "ok", data, errors: [] }), { status: replayed ? 200 : 201 });
}
function capturedInput(mock: ReturnType<typeof vi.fn>, index = 0) {
  const init = mock.mock.calls[index]![1] as RequestInit;
  return parseCaseServiceRecordMutation(JSON.parse(init.body as string), new Headers(init.headers).get("idempotency-key"));
}
function fillCreate(properties = props()) {
  fireEvent.click(screen.getByRole("button", { name: "新增服務紀錄" }));
  fireEvent.change(screen.getByLabelText("個案（切換後清空未送出內容）"), { target: { value: properties.snapshot.clients[0]!.clientId } });
  fireEvent.change(screen.getByLabelText("開始時間（台北）"), { target: { value: "2026-09-08T09:00:00" } });
  fireEvent.change(screen.getByLabelText("結束時間（台北）"), { target: { value: "2026-09-08T09:30:00" } });
  fireEvent.change(screen.getByLabelText("機構自訂服務類型"), { target: { value: "人工陪伴" } });
  fireEvent.change(screen.getByLabelText("人工服務內容"), { target: { value: "合成測試：完成人工陪伴" } });
  fireEvent.change(screen.getByLabelText("人工服務結果"), { target: { value: "合成測試：已完成" } });
  fireEvent.change(screen.getByLabelText("建立／修訂理由"), { target: { value: "建立合成測試草稿" } });
  return screen.getByRole("form", { name: "新增人工服務草稿" });
}

describe("Page50 dedicated workspace and exact-retry boundary", () => {
  beforeEach(() => { refresh.mockClear(); Object.defineProperty(navigator, "onLine", { value: true, configurable: true }); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("keeps statutory requirements, claims and external features explicitly unconfigured", () => {
    render(<CaseServiceRecordsWorkspace {...props()} />);
    expect(screen.getByRole("heading", { level: 1, name: "個案服務紀錄" })).toBeInTheDocument();
    expect(screen.getByText(/法定表單與申報資格尚未配置/u)).toBeInTheDocument();
    expect(screen.getByText(/正式附件、列印匯出、離線寫入與通知尚未開放/u)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /申報|匯出|刪除/u })).not.toBeInTheDocument();
  });

  it("demo never exposes mutation controls even when permissions are supplied", () => {
    const properties = props(); properties.snapshot.demo = true;
    render(<CaseServiceRecordsWorkspace {...properties} />);
    expect(screen.queryByRole("button", { name: /新增服務紀錄|修訂草稿|核對並簽署|建立更正版/u })).not.toBeInTheDocument();
  });

  it.each([{ snapshot: null }, { loadError: true }])("fails closed without fallback %j", (changes) => {
    render(<CaseServiceRecordsWorkspace {...props()} {...changes} />);
    expect(screen.getByRole("alert")).toHaveTextContent("不會改用展示資料");
    expect(screen.queryByText(/日照個案甲/u)).not.toBeInTheDocument();
  });

  it("separates date/type/author/state filters and full totals from truncation", () => {
    const properties = props(); properties.snapshot.recordsTruncated = true; properties.snapshot.matchingTotal = 501;
    properties.snapshot.metrics.serviceTotal = 501; properties.snapshot.clientsTruncated = true;
    render(<CaseServiceRecordsWorkspace {...properties} />);
    expect(screen.getByRole("form", { name: "服務紀錄篩選" })).toHaveAttribute("method", "get");
    expect(screen.getByLabelText("篩選紀錄作者")).toHaveAttribute("name", "author");
    expect(screen.getByText("符合 501 筆，顯示 3 筆")).toBeInTheDocument();
    expect(screen.getByText(/清單已截斷/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新增服務紀錄" })).toBeDisabled();
  });

  it("displays immutable history, reasons, hashes and Taipei time", () => {
    const properties = props(); render(<CaseServiceRecordsWorkspace {...properties} />);
    const record = properties.snapshot.records.find((item) => item.recordState === "corrected")!;
    expect(screen.getByText(`版本 ID：${record.versionId}`)).toBeInTheDocument();
    expect(screen.getByText(`前版 ID：${record.previousVersionId}`)).toBeInTheDocument();
    expect(screen.getByText(`本版理由：${record.correctionReason}`)).toBeInTheDocument();
    expect(screen.getAllByText(/13:30:00 ～ .*14:00:00/u).length).toBeGreaterThan(0);
    const summary = screen.getByText("檢視版本、理由與簽署證據（3 版）");
    fireEvent.click(summary); expect(summary.closest("details")).toHaveAttribute("open");
  });

  it("requires recent MFA for sign/correct but does not mislabel drafts as signed", () => {
    render(<CaseServiceRecordsWorkspace {...props()} hasRecentAal2={false} />);
    expect(screen.getByRole("button", { name: "核對並簽署" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "建立更正版" }).every((item) => item.hasAttribute("disabled"))).toBe(true);
    expect(screen.getByRole("button", { name: "新增服務紀錄" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "立即重新驗證" })).toHaveAttribute("href", "/mfa?audience=staff");
  });

  it("does not offer another author's draft revision even to a permitted co-worker", () => {
    render(<CaseServiceRecordsWorkspace {...props()} actorUserId="44444444-4444-4444-8444-444444444444" />);
    expect(screen.queryByRole("button", { name: "修訂草稿" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "核對並簽署" })).toBeEnabled();
  });

  it("does not carry one client's unfinished narrative to another client", () => {
    const properties = props(); render(<CaseServiceRecordsWorkspace {...properties} />); fillCreate(properties);
    fireEvent.change(screen.getByLabelText("個案（切換後清空未送出內容）"), { target: { value: properties.snapshot.clients[1]!.clientId } });
    expect(screen.getByLabelText("人工服務內容")).toHaveValue("");
    expect(screen.getByLabelText("建立／修訂理由")).toHaveValue("");
  });

  it("blocks negative duration locally without making any network request", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    render(<CaseServiceRecordsWorkspace {...props()} />); const form = fillCreate();
    fireEvent.change(screen.getByLabelText("結束時間（台北）"), { target: { value: "2026-09-08T08:30:00" } });
    fireEvent.submit(form);
    expect(await screen.findByRole("alert")).toHaveTextContent("尚未送出");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates a full create receipt, uses explicit Taipei offset and refreshes only after proof", async () => {
    const properties = props(); const fetchMock = vi.fn().mockImplementation(async (_url, init: RequestInit) => {
      const input = parseCaseServiceRecordMutation(JSON.parse(init.body as string), new Headers(init.headers).get("idempotency-key"));
      return success(input, properties);
    }); vi.stubGlobal("fetch", fetchMock);
    render(<CaseServiceRecordsWorkspace {...properties} />); fireEvent.submit(fillCreate(properties));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(screen.getByText(/已核對保存回執：v1・草稿/u)).toBeInTheDocument();
    const input = capturedInput(fetchMock);
    expect(input.action).toBe("save_record");
    if (input.action !== "save_record") throw new Error("Wrong action");
    expect(input.startedAt).toBe("2026-09-08T01:00:00.000Z");
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe("POST");
    expect(recordMutationBody(input)).toHaveProperty("revision_reason", "建立合成測試草稿");
    expect(recordMutationBody(input)).not.toHaveProperty("reason");
    expect(screen.queryByRole("form", { name: "新增人工服務草稿" })).not.toBeInTheDocument();
  });

  it("synchronously rejects double submits while the first request is in flight", async () => {
    let release!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { release = resolve; }));
    vi.stubGlobal("fetch", fetchMock); render(<CaseServiceRecordsWorkspace {...props()} />);
    const form = fillCreate(); fireEvent.submit(form); fireEvent.submit(form);
    expect(fetchMock).toHaveBeenCalledOnce();
    await act(async () => release(unknownResponse()));
    expect(await screen.findByRole("button", { name: "以原內容及相同操作鍵重試" })).toBeEnabled();
  });

  it("retains the exact body/key after malformed 2xx and a later rejection", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(unknownResponse()).mockResolvedValueOnce(rejection());
    vi.stubGlobal("fetch", fetchMock); render(<CaseServiceRecordsWorkspace {...props()} />); fireEvent.submit(fillCreate());
    fireEvent.click(await screen.findByRole("button", { name: "以原內容及相同操作鍵重試" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "以原內容及相同操作鍵重試" })).toBeEnabled());
    const first = fetchMock.mock.calls[0]![1] as RequestInit; const second = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(second.body).toBe(first.body); expect(second.headers).toEqual(first.headers);
    expect(screen.getByLabelText("人工服務內容")).toBeDisabled();
    expect(screen.queryByText("SERVER_SECRET_SHOULD_NOT_RENDER")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps pending visible through revoked permissions, missing snapshots and actor changes", async () => {
    const properties = props(); const fetchMock = vi.fn().mockResolvedValue(unknownResponse()); vi.stubGlobal("fetch", fetchMock);
    const view = render(<CaseServiceRecordsWorkspace {...properties} />); fireEvent.submit(fillCreate(properties));
    await screen.findByRole("button", { name: "以原內容及相同操作鍵重試" });
    view.rerender(<CaseServiceRecordsWorkspace {...properties} snapshot={null} loadError canManage={false} canSign={false} />);
    expect(screen.getByRole("region", { name: "原操作結果待核對" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "以原內容及相同操作鍵重試" })).toBeDisabled();
    view.rerender(<CaseServiceRecordsWorkspace {...properties} actorUserId="44444444-4444-4444-8444-444444444444" />);
    expect(screen.getByRole("button", { name: "以原內容及相同操作鍵重試" })).toBeDisabled();
    view.rerender(<CaseServiceRecordsWorkspace {...properties} />);
    expect(screen.getByRole("button", { name: "以原內容及相同操作鍵重試" })).toBeEnabled();
  });

  it("blocks cross-branch retry and accepts only the original operation's fully matching replay", async () => {
    const properties = props(); const fetchMock = vi.fn().mockResolvedValueOnce(unknownResponse());
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<CaseServiceRecordsWorkspace {...properties} />); fireEvent.submit(fillCreate(properties));
    await screen.findByRole("button", { name: "以原內容及相同操作鍵重試" });
    view.rerender(<CaseServiceRecordsWorkspace {...properties} snapshot={{ ...properties.snapshot,
      branchId: "55555555-5555-4555-8555-555555555555" }} />);
    expect(screen.getByRole("button", { name: "以原內容及相同操作鍵重試" })).toBeDisabled();
    const original = capturedInput(fetchMock);
    view.rerender(<CaseServiceRecordsWorkspace {...properties} snapshot={{ ...properties.snapshot, records: [] }} />);
    fetchMock.mockResolvedValueOnce(success(original, properties, true));
    fireEvent.click(screen.getByRole("button", { name: "以原內容及相同操作鍵重試" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(capturedInput(fetchMock, 1)).toEqual(original);
    expect(screen.queryByRole("region", { name: "原操作結果待核對" })).not.toBeInTheDocument();
    expect(screen.getByText(/已核對保存回執：v1・草稿/u)).toBeInTheDocument();
  });

  it("does not submit an editor whose source version changed before submission", () => {
    const properties = props(); const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const view = render(<CaseServiceRecordsWorkspace {...properties} />);
    fireEvent.click(screen.getByRole("button", { name: "核對並簽署" }));
    const form = screen.getByRole("form", { name: "核對並簽署本版" });
    fireEvent.click(within(form).getByRole("checkbox"));
    const records = properties.snapshot.records.map((row) => row.recordState !== "draft" ? row : {
      ...row, versionId: "66666666-6666-4666-8666-666666666666", version: row.version + 1, contentHash: "c".repeat(64),
    });
    view.rerender(<CaseServiceRecordsWorkspace {...properties} snapshot={{ ...properties.snapshot, records }} />);
    expect(screen.getByRole("button", { name: "核對並簽署本版" })).toBeDisabled();
    fireEvent.submit(form); expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses a fresh key only after a known first rejection and never renders server prose", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(rejection()).mockResolvedValueOnce(unknownResponse());
    vi.stubGlobal("fetch", fetchMock); render(<CaseServiceRecordsWorkspace {...props()} />); const form = fillCreate();
    fireEvent.submit(form); await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("沒有這項操作"));
    expect(screen.queryByText("SERVER_SECRET_SHOULD_NOT_RENDER")).not.toBeInTheDocument();
    fireEvent.submit(form); await screen.findByRole("button", { name: "以原內容及相同操作鍵重試" });
    expect(capturedInput(fetchMock, 1).idempotencyKey).not.toBe(capturedInput(fetchMock).idempotencyKey);
  });

  it("signs only the exact displayed draft with explicit consent and PATCH operation", async () => {
    const properties = props(); const fetchMock = vi.fn().mockResolvedValue(unknownResponse()); vi.stubGlobal("fetch", fetchMock);
    render(<CaseServiceRecordsWorkspace {...properties} />); fireEvent.click(screen.getByRole("button", { name: "核對並簽署" }));
    const form = screen.getByRole("form", { name: "核對並簽署本版" }); fireEvent.submit(form);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(within(form).getByRole("checkbox")); fireEvent.submit(form);
    await screen.findByRole("button", { name: "以原內容及相同操作鍵重試" });
    const input = capturedInput(fetchMock); expect(input.action).toBe("sign_record");
    if (input.action !== "sign_record") throw new Error("Wrong action");
    const draft = properties.snapshot.records.find((item) => item.recordState === "draft")!;
    expect(input.previousVersionId).toBe(draft.versionId);
    expect(input.expectedRecordPayload.serviceContent).toBe(draft.serviceContent);
    expect(input.expectedContentHash).toBe(draft.contentHash);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe("PATCH");
  });

  it("freezes correction source/version and requires a substantive reason", async () => {
    const fetchMock = vi.fn().mockResolvedValue(unknownResponse()); vi.stubGlobal("fetch", fetchMock);
    const properties = props(); render(<CaseServiceRecordsWorkspace {...properties} />);
    fireEvent.click(screen.getAllByRole("button", { name: "建立更正版" })[0]!);
    const form = screen.getByRole("form", { name: "建立並簽署更正版" });
    fireEvent.click(within(form).getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("更正理由（至少 8 字）"), { target: { value: "太短" } }); fireEvent.submit(form);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("更正理由（至少 8 字）"), { target: { value: "依現場紙本紀錄核對後更正結果" } });
    fireEvent.change(screen.getByLabelText("人工服務結果"), { target: { value: "合成測試：更正後人工結果" } }); fireEvent.submit(form);
    await screen.findByRole("button", { name: "以原內容及相同操作鍵重試" });
    const input = capturedInput(fetchMock); expect(input.action).toBe("correct_record");
    expect(input.expectedVersion).toBe(2); expect(input.previousVersionId).not.toBeNull();
  });

  it("closes sign for changed execution evidence and edits for truncated history", () => {
    const properties = props(); const draft = properties.snapshot.records.find((item) => item.recordState === "draft")!;
    draft.executionReferenceVerification = "changed_or_unavailable"; draft.historyTruncated = true;
    render(<CaseServiceRecordsWorkspace {...properties} />);
    expect(screen.getByRole("button", { name: "核對並簽署" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "修訂草稿" })).toBeDisabled();
  });

  it("offline does not write or persist drafts to local/session storage", () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const storage = vi.spyOn(Storage.prototype, "setItem");
    render(<CaseServiceRecordsWorkspace {...props()} />); const form = fillCreate();
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true }); fireEvent.offline(window);
    fireEvent.submit(form); expect(fetchMock).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("目前離線"); storage.mockRestore();
  });
});
