// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { staffPages } from "@/lib/catalog";
import { buildDemoStaffLabReportSnapshot } from "@/lib/staff-lab-reports/demo";

import { StaffLabReportCreateForm } from "./staff-lab-report-actions";
import { StaffLabReportsWorkspace } from "./staff-lab-reports-workspace";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const ORG = "78000000-0000-4000-8000-000000000001";
const BRANCH = "78000000-0000-4000-8000-000000000002";
const filters = { staffMembershipId: null, reportType: null,
  validityStatus: "all" as const, duplicateStatus: "all" as const,
  evidenceStatus: "all" as const, dateFrom: null, dateTo: null, query: "" };
const snapshot = buildDemoStaffLabReportSnapshot({
  organizationId: ORG, branchId: BRANCH, filters,
  now: new Date("2026-09-02T04:00:00.000Z"),
});
const page = staffPages.find((item) => item.number === 78)!;

function headerKey(call: unknown[]) {
  return ((call[1] as RequestInit).headers as Record<string, string>)["idempotency-key"];
}
function reportKey(call: unknown[]) {
  return (JSON.parse(String((call[1] as RequestInit).body)) as {
    report_key: string;
  }).report_key;
}
function fillCreate() {
  fireEvent.change(screen.getByLabelText("員工"), {
    target: { value: snapshot.staffOptions[0]!.staffMembershipId },
  });
  fireEvent.change(screen.getByLabelText("檢驗類型"), {
    target: { value: "合成檢驗" },
  });
  fireEvent.change(screen.getByLabelText("檢驗日期"), {
    target: { value: "2026-08-20" },
  });
  fireEvent.change(screen.getByLabelText("院所／檢驗單位"), {
    target: { value: "合成院所" },
  });
  fireEvent.change(screen.getByLabelText("結果文字（依來源照錄）"), {
    target: { value: "合成結果文字" },
  });
  fireEvent.change(screen.getByLabelText("人工輸入有效至"), {
    target: { value: "2026-10-20" },
  });
  fireEvent.change(screen.getByLabelText("效期依據"), {
    target: { value: "合成人工依據" },
  });
}

describe("staff lab report UI boundary", () => {
  beforeEach(() => {
    refresh.mockReset(); let sequence = 20;
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() =>
      `78000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`) });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("shows no health snapshot until recent same-session AAL2 exists", () => {
    render(<StaffLabReportsWorkspace canManage filters={filters}
      hasRecentAal2={false} loadError={false} page={page} snapshot={snapshot} />);
    expect(screen.getByRole("heading", {
      name: "需要重新完成雙重驗證",
    })).toBeTruthy();
    expect(screen.queryByText("展示結果：依來源逐字照錄")).toBeNull();
  });

  it("keeps an unchanged unknown-result key and rotates it after editing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    render(<StaffLabReportCreateForm canManage snapshot={snapshot} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "追加原始版本" }));
    await screen.findByText(/結果未知.*相同操作鍵重試/u);
    const first = headerKey(fetchMock.mock.calls[0]!);
    const firstReport = reportKey(fetchMock.mock.calls[0]!);
    fireEvent.click(screen.getByRole("button", { name: "追加原始版本" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(headerKey(fetchMock.mock.calls[1]!)).toBe(first);
    expect(reportKey(fetchMock.mock.calls[1]!)).toBe(firstReport);
    fireEvent.change(screen.getByLabelText("結果文字（依來源照錄）"), {
      target: { value: "修改後的合成結果" },
    });
    fireEvent.click(screen.getByRole("button", { name: "追加原始版本" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(headerKey(fetchMock.mock.calls[2]!)).not.toBe(first);
    expect(reportKey(fetchMock.mock.calls[2]!)).not.toBe(firstReport);
  });

  it("treats a bounded timeout as unknown and retains the retry key", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new ClientFetchTimeoutError(20_000));
    vi.stubGlobal("fetch", fetchMock);
    render(<StaffLabReportCreateForm canManage snapshot={snapshot} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "追加原始版本" }));
    await screen.findByText(/連線中斷或逾時，結果未知/u);
    const first = headerKey(fetchMock.mock.calls[0]!);
    fireEvent.click(screen.getByRole("button", { name: "追加原始版本" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(headerKey(fetchMock.mock.calls[1]!)).toBe(first);
  });

  it("locks the full form while persistence is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(<StaffLabReportCreateForm canManage snapshot={snapshot} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "追加原始版本" }));
    const fieldset = screen.getByLabelText("檢驗類型")
      .closest("fieldset") as HTMLFieldSetElement;
    await waitFor(() => expect(fieldset.disabled).toBe(true));
  });

  it("shows exact and key-field warning receipt without merging", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(sent.attachment_reference).toBeNull();
      expect(sent.attachment_sha256).toBeNull();
      return Response.json({
        requestId: "78000000-0000-4000-8000-000000000099",
        status: "ok", errors: [], data: { persisted: true, demo: false, receipt: {
          organizationId: ORG, branchId: BRANCH, reportKey: sent.report_key,
          recordVersionId: "78070000-0000-4000-8000-000000000099",
          version: 1, previousVersionId: null, recordStatus: "active",
          completionStatus: "completed",
          staffMembershipId: snapshot.staffOptions[0]!.staffMembershipId,
          contentHash: "a".repeat(64), exactDuplicateCount: 1,
          keyFieldDuplicateCount: 2, duplicateWarning: true,
          duplicateBasis: "exact_content_or_same_staff_type_tested_on_provider",
          recordedAt: "2026-09-02T04:00:00.000Z", replayed: false,
          persisted: true, demo: false,
        } },
      }, { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<StaffLabReportCreateForm canManage snapshot={snapshot} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "追加原始版本" }));
    await screen.findByText(/內容完全相同.*系統只提示，未自動合併/u);
    expect(refresh).toHaveBeenCalledOnce();
  });
});
