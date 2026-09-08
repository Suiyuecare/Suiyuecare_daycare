// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { buildDemoStaffVaccinationSnapshot } from "@/lib/staff-vaccinations/demo";

import { StaffVaccinationCreateForm } from "./staff-vaccination-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const ORG = "73000000-0000-4000-8000-000000000001";
const BRANCH = "73000000-0000-4000-8000-000000000002";
const snapshot = buildDemoStaffVaccinationSnapshot({
  organizationId: ORG, branchId: BRANCH,
  filters: { staffMembershipId: null, vaccineName: null, doseNumber: null,
    dateFrom: null, dateTo: null, status: "all", query: "" },
  now: new Date("2026-09-02T04:00:00.000Z"),
});

function headerKey(call: unknown[]) {
  return ((call[1] as RequestInit).headers as Record<string, string>)["idempotency-key"];
}
function fillCreate() {
  fireEvent.change(screen.getByLabelText("員工（穩定人員識別）"), {
    target: { value: snapshot.staffOptions[0]!.staffMembershipId },
  });
  fireEvent.change(screen.getByLabelText("疫苗名稱（依來源照錄）"), {
    target: { value: "合成疫苗" },
  });
  fireEvent.change(screen.getByLabelText("劑次（依來源照錄）"), {
    target: { value: "合成第 1 劑" },
  });
  fireEvent.change(screen.getByLabelText("接種日期"), {
    target: { value: "2026-08-20" },
  });
  fireEvent.change(screen.getByLabelText("接種院所"), {
    target: { value: "合成院所" },
  });
}

describe("staff vaccination mutation form", () => {
  beforeEach(() => {
    refresh.mockReset(); let sequence = 20;
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() =>
      `73000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`) });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("keeps an unchanged unknown-result key and rotates it after editing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    render(<StaffVaccinationCreateForm canManage snapshot={snapshot} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "追加疫苗版本" }));
    await screen.findByText("網路中斷，結果未知；內容未修改時請保留相同操作鍵重試。");
    const first = headerKey(fetchMock.mock.calls[0]!);
    fireEvent.click(screen.getByRole("button", { name: "追加疫苗版本" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(headerKey(fetchMock.mock.calls[1]!)).toBe(first);
    fireEvent.change(screen.getByLabelText("劑次（依來源照錄）"), {
      target: { value: "合成第 2 劑" },
    });
    fireEvent.click(screen.getByRole("button", { name: "追加疫苗版本" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(headerKey(fetchMock.mock.calls[2]!)).not.toBe(first);
  });

  it("labels bounded timeout as unknown and keeps the retry key", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new ClientFetchTimeoutError(20_000));
    vi.stubGlobal("fetch", fetchMock);
    render(<StaffVaccinationCreateForm canManage snapshot={snapshot} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "追加疫苗版本" }));
    await screen.findByText("連線逾時，結果未知；內容未修改時請保留相同操作鍵重試。");
    const first = headerKey(fetchMock.mock.calls[0]!);
    fireEvent.click(screen.getByRole("button", { name: "追加疫苗版本" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(headerKey(fetchMock.mock.calls[1]!)).toBe(first);
  });

  it("locks the complete form while persistence is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(<StaffVaccinationCreateForm canManage snapshot={snapshot} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "追加疫苗版本" }));
    const fieldset = screen.getByLabelText("接種院所").closest("fieldset") as HTMLFieldSetElement;
    await waitFor(() => expect(fieldset.disabled).toBe(true));
  });

  it("shows the exact warning-only duplicate receipt without merging records", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const key = (init.headers as Record<string, string>)["idempotency-key"]!;
      const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(sent.attachment_reference).toBeNull();
      expect(sent.attachment_sha256).toBeNull();
      return Response.json({
        requestId: "73000000-0000-4000-8000-000000000099",
        status: "ok", errors: [], data: { persisted: true, demo: false, receipt: {
          organizationId: ORG, branchId: BRANCH, vaccinationKey: key,
          recordVersionId: "73070000-0000-4000-8000-000000000099",
          version: 1, previousVersionId: null, recordStatus: "active",
          staffMembershipId: snapshot.staffOptions[0]!.staffMembershipId,
          contentHash: "a".repeat(64), duplicateWarning: true, duplicateCount: 2,
          duplicateBasis: "same_staff_normalized_vaccine_and_dose",
          recordedAt: "2026-09-02T04:00:00.000Z", replayed: false,
          persisted: true, demo: false,
        } },
      }, { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<StaffVaccinationCreateForm canManage snapshot={snapshot} />);
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "追加疫苗版本" }));
    await screen.findByText(/找到 2 筆同一員工.*已保留各筆，不會自動合併/u);
    expect(refresh).toHaveBeenCalledOnce();
  });
});
