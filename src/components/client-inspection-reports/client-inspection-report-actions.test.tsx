// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { staffPages } from "@/lib/catalog";
import { buildDemoClientInspectionReportSnapshot } from "@/lib/client-inspection-reports/demo";
import type { ClientInspectionReportFilters } from "@/lib/client-inspection-reports/types";

import { ClientInspectionReportCreateForm } from "./client-inspection-report-actions";
import { ClientInspectionReportsWorkspace } from "./client-inspection-reports-workspace";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const ORG = "22000000-0000-4000-8000-000000000001";
const BRANCH = "22000000-0000-4000-8000-000000000002";
const filters: ClientInspectionReportFilters = {
  clientId: null, reportType: null, examinedFrom: null, examinedTo: null,
  recordStatus: "all", resultStatus: "all", sourceStatus: "all",
  attachmentStatus: "all", duplicateStatus: "all", query: "",
};
const snapshot = buildDemoClientInspectionReportSnapshot({
  organizationId: ORG, branchId: BRANCH, filters,
  now: new Date("2026-09-07T04:00:00.000Z"),
});
const page = staffPages.find(({ number }) => number === 22)!;

function fillCreate() {
  fireEvent.change(screen.getByLabelText("個案"), {
    target: { value: snapshot.clientOptions[0]!.clientId },
  });
  fireEvent.change(screen.getByLabelText("檢查類型"), {
    target: { value: "合成檢查" },
  });
  fireEvent.change(screen.getByLabelText("檢查日期"), {
    target: { value: "2026-08-20" },
  });
  fireEvent.change(screen.getByLabelText("結果文字（依來源照錄）"), {
    target: { value: "合成結果來源原文" },
  });
  fireEvent.change(screen.getByLabelText("來源狀態"), {
    target: { value: "missing" },
  });
  fireEvent.change(screen.getByLabelText("缺值理由（至少 8 字）"), {
    target: { value: "來源單位仍待人工確認補齊" },
  });
}

function keyFrom(call: unknown[]) {
  return ((call[1] as RequestInit).headers as Record<string, string>)["idempotency-key"];
}

describe("Page 22 client inspection report UI", () => {
  beforeEach(() => {
    refresh.mockReset(); let sequence = 40;
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() =>
      `22000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`) });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("does not reveal a health snapshot before employee AAL2", () => {
    render(<ClientInspectionReportsWorkspace canManage={false} filters={filters}
      hasAal2={false} hasRecentAal2={false} loadError={false} page={page}
      snapshot={snapshot} />);
    expect(screen.getByRole("heading", { name: "需要完成雙重驗證" })).toBeTruthy();
    expect(screen.queryByText("展示結果原文 A（僅照錄，不作判讀）")).toBeNull();
  });

  it("shows synthetic read-only boundaries without upload or download controls", () => {
    render(<ClientInspectionReportsWorkspace canManage={false} filters={filters}
      hasAal2 hasRecentAal2={false} loadError={false} page={page}
      snapshot={snapshot} />);
    expect(screen.getByRole("heading", { name: "檢查報告" })).toBeTruthy();
    expect(screen.getByText(/全合成展示資料/u)).toBeTruthy();
    expect(screen.getByText(/附件上傳、掃毒、私有下載與匯出均為 not_configured/u)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /上傳/u })).toBeNull();
    expect(screen.queryByRole("link", { name: /下載/u })).toBeNull();
    expect(screen.queryByText("新增個案檢查報告")).toBeNull();
  });

  it("keeps correction hidden until recent same-session AAL2", () => {
    render(<ClientInspectionReportsWorkspace canManage filters={filters}
      hasAal2 hasRecentAal2={false} loadError={false} page={page}
      snapshot={snapshot} />);
    expect(screen.getByText("新增個案檢查報告")).toBeTruthy();
    expect(screen.getByText(/更正與作廢需在同一工作階段最近 15 分鐘/u)).toBeTruthy();
    expect(screen.queryByText("建立更正或作廢終端版本")).toBeNull();
  });

  it("serializes tri-state fields and never claims an attachment on create", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(sent.result_status).toBe("present");
      expect(sent.source_status).toBe("missing");
      expect(sent.source_text).toBeNull();
      expect(sent.source_reason).toBe("來源單位仍待人工確認補齊");
      expect(sent.attachment_status).toBe("missing");
      expect(sent.attachment_id).toBeNull();
      expect((init.headers as Record<string, string>)["x-client-inspection-report-operation"])
        .toBe("create");
      return Response.json({ requestId: "22000000-0000-4000-8000-000000000099",
        status: "ok", errors: [], data: { persisted: true, demo: false,
          receipt: { organizationId: ORG, branchId: BRANCH,
            reportKey: sent.report_key,
            recordVersionId: "22000000-0000-4000-8000-000000000098",
            version: 1, previousVersionId: null, recordStatus: "active",
            clientId: sent.client_id, contentHash: "a".repeat(64),
            payloadHash: "b".repeat(64), exactDuplicateCount: 0,
            keyFieldDuplicateCount: 0, attachmentDuplicateCount: 0,
            duplicateWarning: false,
            duplicateResolution: "warning_only_no_auto_merge",
            recordedAt: "2026-09-07T04:00:00.000Z", replayed: false,
            persisted: true, demo: false } } }, { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ClientInspectionReportCreateForm canManage snapshot={snapshot} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "追加原始版本" }));
    await screen.findByText("原始版本已追加保存。");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("retains an unknown-operation key for exact retry and rotates after edits", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    render(<ClientInspectionReportCreateForm canManage snapshot={snapshot} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "追加原始版本" }));
    await screen.findByText(/結果未知.*相同操作鍵重試/u);
    const first = keyFrom(fetchMock.mock.calls[0]!);
    fireEvent.click(screen.getByRole("button", { name: "追加原始版本" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(keyFrom(fetchMock.mock.calls[1]!)).toBe(first);
    fireEvent.change(screen.getByLabelText("結果文字（依來源照錄）"), {
      target: { value: "已變更內容" },
    });
    fireEvent.click(screen.getByRole("button", { name: "追加原始版本" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(keyFrom(fetchMock.mock.calls[2]!)).not.toBe(first);
  });

  it("treats a bounded timeout as unknown and locks the form while pending", async () => {
    const timeoutFetch = vi.fn().mockRejectedValue(new ClientFetchTimeoutError(20_000));
    vi.stubGlobal("fetch", timeoutFetch);
    const { unmount } = render(<ClientInspectionReportCreateForm canManage snapshot={snapshot} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "追加原始版本" }));
    await screen.findByText(/連線中斷或逾時，結果未知/u);
    unmount();

    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(<ClientInspectionReportCreateForm canManage snapshot={snapshot} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "追加原始版本" }));
    const fieldset = screen.getByLabelText("檢查類型")
      .closest("fieldset") as HTMLFieldSetElement;
    await waitFor(() => expect(fieldset.disabled).toBe(true));
  });
});
