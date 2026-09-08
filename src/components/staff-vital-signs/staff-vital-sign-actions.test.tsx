// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { staffPages } from "@/lib/catalog";
import { buildDemoStaffVitalSignSnapshot } from "@/lib/staff-vital-signs/demo";

import { StaffVitalSignCreateForm } from "./staff-vital-sign-actions";
import { StaffVitalSignsWorkspace } from "./staff-vital-signs-workspace";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const ORG = "69000000-0000-4000-8000-000000000001";
const BRANCH = "69000000-0000-4000-8000-000000000002";
const filters = { staffMembershipId: null, measurementType: null,
  stateStatus: "all" as const, dateFrom: null, dateTo: null, query: "" };
const snapshot = buildDemoStaffVitalSignSnapshot({
  organizationId: ORG, branchId: BRANCH, filters,
  now: new Date("2026-09-02T04:00:00.000Z"),
});
const page = staffPages.find((item) => item.number === 69)!;

function headerKey(call: unknown[]) {
  return ((call[1] as RequestInit).headers as Record<string, string>)["idempotency-key"];
}
function vitalKey(call: unknown[]) {
  return (JSON.parse(String((call[1] as RequestInit).body)) as {
    vital_sign_key: string;
  }).vital_sign_key;
}
function fillCreate() {
  fireEvent.change(screen.getByLabelText("員工"), {
    target: { value: snapshot.staffOptions[0]!.staffMembershipId },
  });
  fireEvent.change(screen.getByLabelText("量測種類"), {
    target: { value: "合成量測" },
  });
  fireEvent.change(screen.getByLabelText("精確 decimal 文字"), {
    target: { value: "00120.00" },
  });
  fireEvent.change(screen.getByLabelText("單位"), {
    target: { value: "合成單位" },
  });
  fireEvent.change(screen.getByLabelText("發生時間（台北時間）"), {
    target: { value: "2026-09-02T08:30" },
  });
  fireEvent.change(screen.getByLabelText("來源"), {
    target: { value: "合成手動來源" },
  });
}

describe("staff vital-sign UI boundary", () => {
  beforeEach(() => {
    refresh.mockReset(); let sequence = 20;
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() =>
      `69000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`) });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("shows no health snapshot until recent same-session AAL2 exists", () => {
    render(<StaffVitalSignsWorkspace canManage filters={filters}
      hasRecentAal2={false} loadError={false} page={page} snapshot={snapshot} />);
    expect(screen.getByRole("heading", {
      name: "需要重新完成雙重驗證",
    })).toBeTruthy();
    expect(screen.queryByText("118.500")).toBeNull();
    expect(screen.queryByText("合成資料，不代表任何健康判定")).toBeNull();
  });

  it("labels demo, threshold, attachment, export, and offline boundaries", () => {
    render(<StaffVitalSignsWorkspace canManage filters={filters}
      hasRecentAal2 loadError={false} page={page} snapshot={snapshot} />);
    expect(screen.getByText(/展示模式：以下均為合成資料/u)).toBeTruthy();
    expect(screen.getByText(/警示數與待確認數皆為「未設定」/u)).toBeTruthy();
    expect(screen.getByText(/附件、匯出與離線功能未啟用/u)).toBeTruthy();
    expect(screen.queryByText("新增生命徵象紀錄")).toBeNull();
  });

  it("keeps unchanged unknown-result operation and record keys", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    render(<StaffVitalSignCreateForm canManage snapshot={snapshot} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "追加原始版本" }));
    await screen.findByText(/結果未知.*相同操作鍵重試/u);
    const firstHeader = headerKey(fetchMock.mock.calls[0]!);
    const firstVital = vitalKey(fetchMock.mock.calls[0]!);
    fireEvent.click(screen.getByRole("button", { name: "追加原始版本" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(headerKey(fetchMock.mock.calls[1]!)).toBe(firstHeader);
    expect(vitalKey(fetchMock.mock.calls[1]!)).toBe(firstVital);
    fireEvent.change(screen.getByLabelText("精確 decimal 文字"), {
      target: { value: "120.10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "追加原始版本" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(headerKey(fetchMock.mock.calls[2]!)).not.toBe(firstHeader);
    expect(vitalKey(fetchMock.mock.calls[2]!)).not.toBe(firstVital);
  });

  it("treats bounded timeout as unknown and retains retry key", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new ClientFetchTimeoutError(20_000));
    vi.stubGlobal("fetch", fetchMock);
    render(<StaffVitalSignCreateForm canManage snapshot={snapshot} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "追加原始版本" }));
    await screen.findByText(/連線中斷或逾時，結果未知/u);
    const first = headerKey(fetchMock.mock.calls[0]!);
    fireEvent.click(screen.getByRole("button", { name: "追加原始版本" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(headerKey(fetchMock.mock.calls[1]!)).toBe(first);
  });

  it("sends missing with null value and unit plus a distinct reason", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(sent.value_status).toBe("missing");
      expect(sent.value_decimal_text).toBeNull();
      expect(sent.unit).toBeNull();
      expect(sent.status_reason).toBe("合成缺值原因");
      return Response.json({ requestId: "69000000-0000-4000-8000-000000000099",
        status: "ok", errors: [], data: { persisted: true, demo: false, receipt: {
          organizationId: ORG, branchId: BRANCH,
          vitalSignKey: sent.vital_sign_key,
          recordVersionId: "69070000-0000-4000-8000-000000000099",
          version: 1, previousVersionId: null, recordStatus: "active",
          completionStatus: "completed",
          staffMembershipId: snapshot.staffOptions[0]!.staffMembershipId,
          contentHash: "a".repeat(64), thresholdEvaluationStatus: "not_configured",
          recordedAt: "2026-09-02T04:00:00.000Z", replayed: false,
          persisted: true, demo: false,
        } },
      }, { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<StaffVitalSignCreateForm canManage snapshot={snapshot} />);
    fireEvent.change(screen.getByLabelText("員工"), {
      target: { value: snapshot.staffOptions[0]!.staffMembershipId },
    });
    fireEvent.change(screen.getByLabelText("量測種類"), {
      target: { value: "合成量測" },
    });
    fireEvent.change(screen.getByLabelText("值狀態"), {
      target: { value: "missing" },
    });
    fireEvent.change(screen.getByLabelText("缺值原因"), {
      target: { value: "合成缺值原因" },
    });
    fireEvent.change(screen.getByLabelText("發生時間（台北時間）"), {
      target: { value: "2026-09-02T08:30" },
    });
    fireEvent.change(screen.getByLabelText("來源"), {
      target: { value: "合成來源" },
    });
    fireEvent.click(screen.getByRole("button", { name: "追加原始版本" }));
    await screen.findByText(/「缺值」已與量測值分開保存/u);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("locks the full form while persistence is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(<StaffVitalSignCreateForm canManage snapshot={snapshot} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "追加原始版本" }));
    const fieldset = screen.getByLabelText("量測種類")
      .closest("fieldset") as HTMLFieldSetElement;
    await waitFor(() => expect(fieldset.disabled).toBe(true));
  });
});
