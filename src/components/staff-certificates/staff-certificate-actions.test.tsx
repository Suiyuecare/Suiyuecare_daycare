// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { buildDemoStaffCertificateSnapshot } from "@/lib/staff-certificates/demo";

import {
  StaffCertificateCreateForm,
  StaffCertificateExceptionForms,
} from "./staff-certificate-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const ORG = "72000000-0000-4000-8000-000000000001";
const BRANCH = "72000000-0000-4000-8000-000000000002";
const snapshot = buildDemoStaffCertificateSnapshot({
  organizationId: ORG, branchId: BRANCH,
  filters: { staffMembershipId: null, certificateType: null, status: "all", query: "" },
  now: new Date("2026-09-02T04:00:00.000Z"),
});

function headerKey(call: unknown[]) {
  return ((call[1] as RequestInit).headers as Record<string, string>)["idempotency-key"];
}
function fillCreate() {
  fireEvent.change(screen.getByLabelText("員工（穩定人員識別）"), {
    target: { value: snapshot.staffOptions[0]!.staffMembershipId },
  });
  fireEvent.change(screen.getByLabelText("證照類型"), { target: { value: "合成證照" } });
  fireEvent.change(screen.getByLabelText("證號"), { target: { value: "SYNTH-NEW" } });
  fireEvent.change(screen.getByLabelText("生效日"), { target: { value: "2026-01-01" } });
  fireEvent.change(screen.getByLabelText("到期日（無明確期限可留空）"), {
    target: { value: "2027-01-01" },
  });
}

describe("staff certificate mutation forms", () => {
  beforeEach(() => {
    refresh.mockReset(); let sequence = 20;
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() =>
      `72000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`) });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("keeps an unchanged unknown-result key and rotates it after editing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    render(<StaffCertificateCreateForm canManage snapshot={snapshot} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "追加證照版本" }));
    await screen.findByText("網路中斷，結果未知；內容未修改時請保留相同操作鍵重試。");
    const first = headerKey(fetchMock.mock.calls[0]!);
    fireEvent.click(screen.getByRole("button", { name: "追加證照版本" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(headerKey(fetchMock.mock.calls[1]!)).toBe(first);
    fireEvent.change(screen.getByLabelText("證號"), { target: { value: "SYNTH-CHANGED" } });
    fireEvent.click(screen.getByRole("button", { name: "追加證照版本" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(headerKey(fetchMock.mock.calls[2]!)).not.toBe(first);
  });

  it("labels bounded timeout as unknown and keeps the retry key", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new ClientFetchTimeoutError(20_000));
    vi.stubGlobal("fetch", fetchMock);
    render(<StaffCertificateCreateForm canManage snapshot={snapshot} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "追加證照版本" }));
    await screen.findByText("連線逾時，結果未知；內容未修改時請保留相同操作鍵重試。");
    const first = headerKey(fetchMock.mock.calls[0]!);
    fireEvent.click(screen.getByRole("button", { name: "追加證照版本" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(headerKey(fetchMock.mock.calls[1]!)).toBe(first);
  });

  it("locks the complete form while persistence is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(<StaffCertificateCreateForm canManage snapshot={snapshot} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "追加證照版本" }));
    const fieldset = screen.getByLabelText("證號").closest("fieldset") as HTMLFieldSetElement;
    await waitFor(() => expect(fieldset.disabled).toBe(true));
  });

  it("blocks exception mutation controls without recent 15-minute AAL2", () => {
    const pendingSnapshot = { ...snapshot, exceptionRequests: snapshot.exceptionRequests.map(
      (request) => ({ ...request, approvalCount: 1,
        exceptionStatus: "pending" as const, approvals: request.approvals.slice(0, 1) }),
    ) };
    render(<StaffCertificateExceptionForms canExceptions hasRecentAal2={false}
      snapshot={pendingSnapshot} />);
    expect(screen.getByRole("alert").textContent).toContain("15 分鐘");
    expect((screen.getByRole("button", { name: "送出例外申請" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect((screen.getByRole("button", { name: "追加本人的獨立核准" }) as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it("keeps an unchanged unknown-result key for an exception request", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    render(<StaffCertificateExceptionForms canExceptions hasRecentAal2 snapshot={snapshot} />);
    fireEvent.change(screen.getByLabelText("證照終端版本"), {
      target: { value: snapshot.records[0]!.recordVersionId },
    });
    fireEvent.change(screen.getByLabelText("例外起始日"), {
      target: { value: "2026-09-02" },
    });
    fireEvent.change(screen.getByLabelText("例外截止日"), {
      target: { value: "2026-09-30" },
    });
    fireEvent.change(screen.getByLabelText("具體理由"), {
      target: { value: "合成有限期間理由" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送出例外申請" }));
    await screen.findByText("網路中斷，結果未知；內容未修改時請保留相同操作鍵重試。");
    const first = headerKey(fetchMock.mock.calls[0]!);
    fireEvent.click(screen.getByRole("button", { name: "送出例外申請" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(headerKey(fetchMock.mock.calls[1]!)).toBe(first);
  });
});
