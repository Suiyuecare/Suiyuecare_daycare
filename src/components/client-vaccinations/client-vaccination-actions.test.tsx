// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { buildDemoClientVaccinationSnapshot } from "@/lib/client-vaccinations/demo";

import { ClientVaccinationBatchForm, ClientVaccinationCreateForm,
  ClientVaccinationFreshness, ClientVaccinationRevisionForm } from "./client-vaccination-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const ORG = "23000000-0000-4000-8000-000000000001";
const BRANCH = "23000000-0000-4000-8000-000000000002";
const demoSnapshot = buildDemoClientVaccinationSnapshot({
  organizationId: ORG, branchId: BRANCH,
  filters: { clientId: null, vaccineName: null, doseNumber: null,
    dateFrom: null, dateTo: null, status: "all", query: "" },
  now: new Date("2026-09-07T04:00:00.000Z"),
});
const snapshot = { ...demoSnapshot, demo: false as const };

function headerKey(call: unknown[]) {
  return ((call[1] as RequestInit).headers as Record<string, string>)["idempotency-key"];
}

function fillCreate() {
  fireEvent.change(screen.getByLabelText("個案（穩定識別）"), {
    target: { value: snapshot.clientOptions[0]!.clientId },
  });
  fireEvent.change(screen.getByLabelText("疫苗名稱（依來源照錄）"), {
    target: { value: "合成疫苗" },
  });
  fireEvent.change(screen.getByLabelText("劑次（依來源照錄）"), {
    target: { value: "合成第 1 劑" },
  });
  fireEvent.change(screen.getByLabelText("接種日期"), {
    target: { value: "2026-09-06" },
  });
  fireEvent.change(screen.getByLabelText("接種院所"), {
    target: { value: "合成院所" },
  });
}

function fillBatch(index = 0) {
  const row = screen.getByRole("group", { name: `第 ${index + 1} 筆` });
  const fields = within(row);
  fireEvent.change(fields.getByLabelText("疫苗"), { target: { value: "合成疫苗" } });
  fireEvent.change(fields.getByLabelText("劑次"), { target: { value: `第 ${index + 1} 劑` } });
  fireEvent.change(fields.getByLabelText("院所"), { target: { value: "合成院所" } });
}

function batchResponse(init: RequestInit, rejectedIndices: number[] = []) {
  const items = (JSON.parse(String(init.body)) as {
    items: Array<{ idempotency_key: string; record: Record<string, unknown> }> }).items;
  const results = items.map((item, index) => {
    const rejected = rejectedIndices.includes(index);
    return { index, idempotencyKey: item.idempotency_key,
      status: rejected ? "rejected" : "created",
      receipt: rejected ? null : {
        recordPayload: Object.fromEntries(Object.entries(item.record).filter(([key]) =>
          !["action", "vaccination_key", "previous_version_id", "expected_base_version", "correction_reason"].includes(key))),
        organizationId: ORG, branchId: BRANCH, vaccinationKey: item.record.vaccination_key,
        recordVersionId: `23020000-0000-4000-8000-${String(index + 99).padStart(12, "0")}`,
        version: 1, previousVersionId: null, recordStatus: "active", clientId: item.record.client_id,
        contentHash: "a".repeat(64), duplicateWarning: false, duplicateCount: 0,
        duplicateBasis: "same_client_normalized_vaccine_and_dose",
        recordedAt: "2026-09-07T04:00:00.000Z", replayed: false, persisted: true, demo: false,
      }, error: rejected ? { code: "CLIENT_VACCINATION_IDEMPOTENCY_CONFLICT",
        message: "紀錄識別已存在，請核對來源" } : null };
  });
  return Response.json({ requestId: "23000000-0000-4000-8000-000000000099", status: "ok", errors: [],
    data: { batchId: "23020000-0000-4000-8000-000000000098",
      batchIdempotencyKey: (init.headers as Record<string, string>)["idempotency-key"],
      requestHash: "b".repeat(64), replayed: false, itemTotal: items.length,
      succeededTotal: items.length - rejectedIndices.length, rejectedTotal: rejectedIndices.length,
      results, persisted: true, demo: false } });
}

describe("Page 23 client vaccination mutation form", () => {
  beforeEach(() => {
    refresh.mockReset(); let sequence = 30;
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() =>
      `23000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`) });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("keeps the exact key after an unknown network outcome and rotates after editing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network failed"));
    vi.stubGlobal("fetch", fetchMock);
    render(<ClientVaccinationCreateForm canManage snapshot={snapshot} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "追加疫苗版本" }));
    await screen.findByText(/結果未知.*保留相同操作鍵重試/u);
    const first = headerKey(fetchMock.mock.calls[0]!);
    const firstVaccinationKey = JSON.parse(String(
      (fetchMock.mock.calls[0]![1] as RequestInit).body,
    )).vaccination_key as string;
    fireEvent.click(screen.getByRole("button", { name: "追加疫苗版本" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(headerKey(fetchMock.mock.calls[1]!)).toBe(first);
    fireEvent.change(screen.getByLabelText("劑次（依來源照錄）"), {
      target: { value: "合成第 2 劑" },
    });
    fireEvent.click(screen.getByRole("button", { name: "追加疫苗版本" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(headerKey(fetchMock.mock.calls[2]!)).not.toBe(first);
    expect(JSON.parse(String((fetchMock.mock.calls[2]![1] as RequestInit).body))
      .vaccination_key).toBe(firstVaccinationKey);
  });

  it("labels a bounded timeout as unknown and preserves the retry key", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new ClientFetchTimeoutError(20_000));
    vi.stubGlobal("fetch", fetchMock);
    render(<ClientVaccinationCreateForm canManage snapshot={snapshot} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "追加疫苗版本" }));
    await screen.findByText(/結果未知.*保留相同操作鍵重試/u);
    const first = headerKey(fetchMock.mock.calls[0]!);
    fireEvent.click(screen.getByRole("button", { name: "追加疫苗版本" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(headerKey(fetchMock.mock.calls[1]!)).toBe(first);
  });

  it("locks all create fields while persistence is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(<ClientVaccinationCreateForm canManage snapshot={snapshot} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "追加疫苗版本" }));
    const fieldset = screen.getByLabelText("接種院所").closest("fieldset") as HTMLFieldSetElement;
    await waitFor(() => expect(fieldset.disabled).toBe(true));
  });

  it("submits no browser attachment reference and renders warning-only duplicate result", async () => {
    let submittedOperationKey = "";
    let submittedVaccinationKey: unknown = null;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const key = (init.headers as Record<string, string>)["idempotency-key"]!;
      const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      submittedOperationKey = key;
      submittedVaccinationKey = sent.vaccination_key;
      expect(sent.evidence_reference_id).toBeNull();
      expect(sent.evidence_sha256).toBeNull();
      expect(sent.evidence_file_name).toBeNull();
      return Response.json({
        requestId: "23000000-0000-4000-8000-000000000099",
        status: "ok", errors: [], data: { persisted: true, demo: false, receipt: {
          recordPayload: Object.fromEntries(Object.entries(sent).filter(([key]) =>
            !["action", "vaccination_key", "previous_version_id", "expected_base_version", "correction_reason"].includes(key))),
          organizationId: ORG, branchId: BRANCH,
          vaccinationKey: sent.vaccination_key,
          recordVersionId: "23020000-0000-4000-8000-000000000099",
          version: 1, previousVersionId: null, recordStatus: "active",
          clientId: snapshot.clientOptions[0]!.clientId,
          contentHash: "a".repeat(64), duplicateWarning: true, duplicateCount: 2,
          duplicateBasis: "same_client_normalized_vaccine_and_dose",
          recordedAt: "2026-09-07T04:00:00.000Z", replayed: false,
          persisted: true, demo: false,
        } },
      }, { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ClientVaccinationCreateForm canManage snapshot={snapshot} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "追加疫苗版本" }));
    await screen.findByText(/另有 2 筆同一個案.*未自動合併/u);
    expect(refresh).toHaveBeenCalledOnce();
    expect(submittedOperationKey).not.toBe(submittedVaccinationKey);
  });

  it("freezes an unknown batch and retries the exact body and outer/item keys", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("network failed"))
      .mockImplementationOnce(async (_url: string, init: RequestInit) => batchResponse(init));
    vi.stubGlobal("fetch", fetchMock);
    render(<ClientVaccinationBatchForm canManage hasRecentAal2 snapshot={snapshot} />);
    fireEvent.click(screen.getByText("批次登錄（逐筆回報，最多 20 筆）"));
    fillBatch();
    fireEvent.click(screen.getByRole("button", { name: "批次送出" }));
    await screen.findByText(/已保留原資料並暫停編輯/u);
    expect((screen.getByRole("group", { name: "第 1 筆" }) as HTMLFieldSetElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "新增一筆" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("疫苗"), { target: { value: "不得修改送出內容" } });
    fireEvent.click(screen.getByRole("button", { name: "核對上次送出結果" }));
    await screen.findByText("第 1 筆：已登錄");
    expect(headerKey(fetchMock.mock.calls[1]!)).toBe(headerKey(fetchMock.mock.calls[0]!));
    expect((fetchMock.mock.calls[1]![1] as RequestInit).body).toBe((fetchMock.mock.calls[0]![1] as RequestInit).body);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("retains a rejected vaccination identity and never retries successful rows", async () => {
    const fetchMock = vi.fn().mockImplementationOnce(async (_url: string, init: RequestInit) => batchResponse(init, [1]))
      .mockImplementationOnce(async (_url: string, init: RequestInit) => batchResponse(init, [0]));
    vi.stubGlobal("fetch", fetchMock);
    render(<ClientVaccinationBatchForm canManage hasRecentAal2 snapshot={snapshot} />);
    fireEvent.click(screen.getByText("批次登錄（逐筆回報，最多 20 筆）"));
    fillBatch(); fireEvent.click(screen.getByRole("button", { name: "新增一筆" })); fillBatch(1);
    fireEvent.click(screen.getByRole("button", { name: "批次送出" }));
    await screen.findByText(/第 2 筆：未登錄/u);
    expect(screen.getAllByRole("group", { name: /^第 \d+ 筆$/u })).toHaveLength(1);
    expect(screen.getByRole("group", { name: "第 2 筆" })).toBeDefined();
    expect(within(screen.getByRole("region", { name: "上次送出結果" }))
      .getByText("第 1 筆：已登錄")).toBeDefined();
    fireEvent.change(screen.getByLabelText("劑次"), { target: { value: "修正第 2 劑" } });
    expect(screen.queryByText("第 1 筆：已登錄")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "批次送出" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    const second = JSON.parse(String((fetchMock.mock.calls[1]![1] as RequestInit).body));
    expect(second.items).toHaveLength(1);
    expect(second.items[0].record.vaccination_key).toBe(first.items[1].record.vaccination_key);
    expect(second.items[0].idempotency_key).not.toBe(first.items[1].idempotency_key);
    expect(headerKey(fetchMock.mock.calls[1]!)).not.toBe(headerKey(fetchMock.mock.calls[0]!));
  });

  it("allows correction after a confirmed authorization rejection without losing the draft", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      requestId: "23000000-0000-4000-8000-000000000099", status: "error", data: null,
      errors: [{ code: "CLIENT_VACCINATION_NOT_AUTHORIZED", message: "目前沒有批次登錄權限。" }],
    }, { status: 403 })));
    render(<ClientVaccinationBatchForm canManage hasRecentAal2 snapshot={snapshot} />);
    fireEvent.click(screen.getByText("批次登錄（逐筆回報，最多 20 筆）")); fillBatch();
    fireEvent.click(screen.getByRole("button", { name: "批次送出" }));
    await screen.findByText("目前沒有批次登錄權限。");
    expect((screen.getByRole("group", { name: "第 1 筆" }) as HTMLFieldSetElement).disabled).toBe(false);
    expect((screen.getByLabelText("疫苗") as HTMLInputElement).value).toBe("合成疫苗");
    fireEvent.change(screen.getByLabelText("劑次"), { target: { value: "待核對第 1 劑" } });
    expect(screen.queryByText("目前沒有批次登錄權限。")).toBeNull();
    expect(screen.queryByText(/已保留原資料並暫停編輯/u)).toBeNull();
  });

  it("keeps uncertain 409 outcomes locked even when an error message is present", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      requestId: "23000000-0000-4000-8000-000000000099", status: "error", data: null,
      errors: [{ code: "CLIENT_VACCINATION_SAVE_UNCERTAIN", message: "資料庫結果未知。" }],
    }, { status: 409 })));
    render(<ClientVaccinationBatchForm canManage hasRecentAal2 snapshot={snapshot} />);
    fireEvent.click(screen.getByText("批次登錄（逐筆回報，最多 20 筆）")); fillBatch();
    fireEvent.click(screen.getByRole("button", { name: "批次送出" }));
    await screen.findByText(/已保留原資料並暫停編輯/u);
    expect((screen.getByRole("group", { name: "第 1 筆" }) as HTMLFieldSetElement).disabled).toBe(true);
  });

  it("cannot submit a bulk operation without recent MFA, but retains editable drafts", () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<ClientVaccinationBatchForm canManage hasRecentAal2={false} snapshot={snapshot} />);
    fireEvent.click(screen.getByText("批次登錄（逐筆回報，最多 20 筆）")); fillBatch();
    fireEvent.submit(container.querySelector("form")!);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "批次送出" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("疫苗") as HTMLInputElement).value).toBe("合成疫苗");
    expect(screen.getByRole("link", { name: "另開分頁重新驗證" }).getAttribute("target")).toBe("_blank");
  });

  it("does not freeze a batch that failed validation before any network request", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<ClientVaccinationBatchForm canManage hasRecentAal2 snapshot={snapshot} />);
    fireEvent.submit(container.querySelector("form")!);
    await screen.findByText(/請完整填寫個案/u);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((container.querySelector("fieldset") as HTMLFieldSetElement).disabled).toBe(false);
    expect(screen.queryByText(/已保留原資料並暫停編輯/u)).toBeNull();
  });

  it("honors a server-expired MFA result until a fresh verified snapshot arrives", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({
      requestId: "23000000-0000-4000-8000-000000000099", status: "error", data: null,
      errors: [{ code: "AAL2_REQUIRED", message: "請重新完成雙因素驗證。" }],
    }, { status: 403 })).mockImplementationOnce(async (_url: string, init: RequestInit) => batchResponse(init));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender, container } = render(<ClientVaccinationBatchForm canManage hasRecentAal2 snapshot={snapshot} />);
    fireEvent.click(screen.getByText("批次登錄（逐筆回報，最多 20 筆）")); fillBatch();
    fireEvent.click(screen.getByRole("button", { name: "批次送出" }));
    await screen.findByText("請重新完成雙因素驗證。");
    expect(screen.getByRole("link", { name: "另開分頁重新驗證" })).toBeDefined();
    expect((screen.getByLabelText("疫苗") as HTMLInputElement).value).toBe("合成疫苗");
    rerender(<ClientVaccinationBatchForm canManage hasRecentAal2 snapshot={{ ...snapshot }} />);
    fireEvent.submit(container.querySelector("form")!);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((screen.getByRole("button", { name: "批次送出" }) as HTMLButtonElement).disabled).toBe(true);
    const fresh = { ...snapshot, generatedAt: "2026-09-07T04:01:00.000Z", staleAfter: "2026-09-07T04:02:00.000Z" };
    rerender(<ClientVaccinationBatchForm canManage hasRecentAal2={false} snapshot={fresh} />);
    expect((screen.getByRole("button", { name: "批次送出" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<ClientVaccinationBatchForm canManage hasRecentAal2 snapshot={fresh} />);
    expect(screen.queryByRole("link", { name: "另開分頁重新驗證" })).toBeNull();
    expect((screen.getByLabelText("疫苗") as HTMLInputElement).value).toBe("合成疫苗");
    fireEvent.click(screen.getByRole("button", { name: "批次送出" }));
    await screen.findByText("第 1 筆：已登錄");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(headerKey(fetchMock.mock.calls[1]!)).not.toBe(headerKey(fetchMock.mock.calls[0]!));
  });

  it("cannot silently replace trusted provenance or proof during correction", () => {
    const trusted = { ...snapshot, records: [{ ...snapshot.records[0]!,
      sourceSystem: "central_html_import" as const, sourceRecordId: "SYNTH-SOURCE-23" }] };
    render(<ClientVaccinationRevisionForm canManage hasRecentAal2 snapshot={trusted} />);
    fireEvent.click(screen.getByText("建立更正版或作廢版本"));
    expect(screen.getByText(/不能將原證明改成缺件/u)).toBeDefined();
    expect((screen.getByRole("button", { name: "追加更正版" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByLabelText("證明狀態")).toBeNull();
    fireEvent.change(screen.getByLabelText("操作"), { target: { value: "void" } });
    expect((screen.getByRole("button", { name: "追加作廢版本" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("selects another current record after the selected record is voided", () => {
    const { rerender } = render(<ClientVaccinationRevisionForm canManage hasRecentAal2 snapshot={snapshot} />);
    rerender(<ClientVaccinationRevisionForm canManage hasRecentAal2
      snapshot={{ ...snapshot, records: snapshot.records.slice(1) }} />);
    fireEvent.click(screen.getByText("建立更正版或作廢版本"));
    expect((screen.getByLabelText("目前終端版本") as HTMLSelectElement).value)
      .toBe(snapshot.records[1]!.vaccinationKey);
  });

  it("shows stale and offline states and clears staleness on a fresh snapshot", async () => {
    const { rerender } = render(<ClientVaccinationFreshness demo={false}
      staleAfter={new Date(Date.now() - 1_000).toISOString()} />);
    await screen.findByText(/資料已超過一分鐘/u);
    rerender(<ClientVaccinationFreshness demo={false}
      staleAfter={new Date(Date.now() + 60_000).toISOString()} />);
    await screen.findByText(/目前資料已更新/u);
    vi.stubGlobal("navigator", { onLine: false });
    fireEvent(window, new Event("offline"));
    await screen.findByText(/目前離線/u);
    expect((screen.getByRole("button", { name: "更新疫苗清單" }) as HTMLButtonElement).disabled).toBe(true);
    vi.stubGlobal("navigator", { onLine: true });
    fireEvent(window, new Event("online"));
    fireEvent.click(screen.getByRole("button", { name: "更新疫苗清單" }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
