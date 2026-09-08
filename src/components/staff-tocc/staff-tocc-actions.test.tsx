// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { buildDemoStaffToccSnapshot } from "@/lib/staff-tocc/demo";

import { StaffToccCreateForm } from "./staff-tocc-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const ORG = "74000000-0000-4000-8000-000000000001";
const BRANCH = "74000000-0000-4000-8000-000000000002";
const snapshot = buildDemoStaffToccSnapshot({
  organizationId: ORG, branchId: BRANCH,
  filters: { staffMembershipId: null, validityStatus: "all",
    attentionStatus: "all", dispositionStatus: "all",
    dateFrom: null, dateTo: null, query: "" },
  now: new Date("2026-09-02T04:00:00.000Z"),
});

function headerKey(call: unknown[]) {
  return ((call[1] as RequestInit).headers as Record<string, string>)["idempotency-key"];
}
function fillCreate() {
  fireEvent.change(screen.getByLabelText("員工（穩定人員識別）"), {
    target: { value: snapshot.staffOptions[0]!.staffMembershipId },
  });
  fireEvent.change(screen.getByLabelText("評估日期"), {
    target: { value: "2026-09-01" },
  });
  fireEvent.change(screen.getByLabelText("人工輸入有效至"), {
    target: { value: "2026-09-30" },
  });
  fireEvent.change(screen.getByLabelText("效期來源"), {
    target: { value: "合成來源人工效期" },
  });
  fireEvent.change(screen.getByLabelText("結果（依機構來源照錄）"), {
    target: { value: "合成結果文字" },
  });
}

describe("staff TOCC mutation form", () => {
  beforeEach(() => {
    refresh.mockReset(); let sequence = 20;
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() =>
      `74000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`) });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("keeps an unchanged unknown-result key and rotates it after editing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    render(<StaffToccCreateForm canManage snapshot={snapshot} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "追加 TOCC 版本" }));
    await screen.findByText("網路中斷，結果未知；內容未修改時請保留相同操作鍵重試。");
    const first = headerKey(fetchMock.mock.calls[0]!);
    fireEvent.click(screen.getByRole("button", { name: "追加 TOCC 版本" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(headerKey(fetchMock.mock.calls[1]!)).toBe(first);
    fireEvent.change(screen.getByLabelText("效期來源"), {
      target: { value: "變更後來源" },
    });
    fireEvent.click(screen.getByRole("button", { name: "追加 TOCC 版本" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(headerKey(fetchMock.mock.calls[2]!)).not.toBe(first);
  });

  it("labels bounded timeout as unknown and keeps the retry key", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new ClientFetchTimeoutError(20_000));
    vi.stubGlobal("fetch", fetchMock);
    render(<StaffToccCreateForm canManage snapshot={snapshot} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "追加 TOCC 版本" }));
    await screen.findByText("連線逾時，結果未知；內容未修改時請保留相同操作鍵重試。");
    const first = headerKey(fetchMock.mock.calls[0]!);
    fireEvent.click(screen.getByRole("button", { name: "追加 TOCC 版本" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(headerKey(fetchMock.mock.calls[1]!)).toBe(first);
  });

  it("locks the complete form while persistence is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(<StaffToccCreateForm canManage snapshot={snapshot} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "追加 TOCC 版本" }));
    const fieldset = screen.getByLabelText("效期來源").closest("fieldset") as HTMLFieldSetElement;
    await waitFor(() => expect(fieldset.disabled).toBe(true));
  });

  it("sends only explicit human warning facts and shows exact receipt meaning", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const key = (init.headers as Record<string, string>)["idempotency-key"]!;
      const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(sent.manual_attention_flag).toBe(true);
      expect(sent.attention_note).toBe("人工標記說明");
      expect(sent.disposition_status).toBe("pending");
      expect(sent.disposition_note).toBe("等待人工處置");
      expect(sent.attachment_reference).toBeNull();
      expect(sent.attachment_sha256).toBeNull();
      return Response.json({
        requestId: "74000000-0000-4000-8000-000000000099",
        status: "ok", errors: [], data: { persisted: true, demo: false, receipt: {
          organizationId: ORG, branchId: BRANCH, toccKey: key,
          recordVersionId: "74070000-0000-4000-8000-000000000099",
          version: 1, previousVersionId: null, recordStatus: "active",
          staffMembershipId: snapshot.staffOptions[0]!.staffMembershipId,
          contentHash: "a".repeat(64), evaluatedOn: "2026-09-02",
          expiryWarning: false, manualAttentionWarning: true,
          warningBasis: "manual_valid_through_and_manual_attention_flag",
          recordedAt: "2026-09-02T04:00:00.000Z", replayed: false,
          persisted: true, demo: false,
        } },
      }, { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<StaffToccCreateForm canManage snapshot={snapshot} />);
    fillCreate();
    fireEvent.click(screen.getByLabelText(
      "由授權人員人工標記異常／positive-like，需要提示",
    ));
    fireEvent.change(screen.getByLabelText("人工標記理由"), {
      target: { value: "人工標記說明" },
    });
    fireEvent.change(screen.getByLabelText("處置狀態"), { target: { value: "pending" } });
    fireEvent.change(screen.getByLabelText("處置內容"), {
      target: { value: "等待人工處置" },
    });
    fireEvent.click(screen.getByRole("button", { name: "追加 TOCC 版本" }));
    await screen.findByText(/本筆已由人員人工標記需注意.*此提示不是診斷/u);
    expect(refresh).toHaveBeenCalledOnce();
  });
});
