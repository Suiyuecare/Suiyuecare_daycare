// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AbcdOperationRecovery } from "./abcd-operation-recovery";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const organizationId = "21110000-0000-4000-8000-000000000001";
const branchId = "21120000-0000-4000-8000-000000000001";
const clientId = "21140000-0000-4000-8000-000000000001";
const reservationId = "21180000-0000-4000-8000-000000000001";
const requestId = "21190000-0000-4000-8000-000000000001";
const reserved = { reservationId, clientId, operation: "create", assessmentType: "A", assessmentYear: 2026,
  baselineVersion: 0, state: "pending", createdAt: "2026-09-28T04:00:00Z", committedAt: null };
const clients = [{ clientId, displayName: "合成個案甲" }];

function response(operations: unknown[], extra: Record<string, unknown> = {}) {
  return Response.json({ requestId, status: "ok", errors: [], data: { organizationId, branchId,
    clientId: null, generatedAt: "2026-09-28T04:01:00Z", absenceIsFinal: false,
    truncated: false, pendingTruncated: false, operations, ...extra } });
}

function view(hasRecentAal2 = true, selectedClientId: string | null = null) {
  return render(<AbcdOperationRecovery branchId={branchId} clients={clients} enabled
    hasRecentAal2={hasRecentAal2} organizationId={organizationId} selectedClientId={selectedClientId} />);
}

describe("ABCD server-owned operation recovery", () => {
  beforeEach(() => refresh.mockReset());
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("does not write on mount and resumes only the selected reservation without a new browser key or clinical body", async () => {
    let reads = 0;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      if (init.method === "GET") return ++reads === 1 ? response([reserved]) :
        response([{ ...reserved, state: "committed", committedAt: "2026-09-28T04:02:00Z" }]);
      return Response.json({ requestId, status: "ok", errors: [], data: { reservationId,
        organizationId, branchId, clientId, persisted: true, demo: false } });
    });
    vi.stubGlobal("fetch", fetchMock);
    view();
    const resume = await screen.findByRole("button", { name: "續做原筆" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/合成個案甲・2026 年 A 類/u)).toBeVisible();
    fireEvent.click(resume);
    await screen.findByText("原筆已保存。畫面正在更新。");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const write = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(write.method).toBe("POST");
    expect(JSON.parse(write.body as string)).toEqual({ reservation_id: reservationId });
    expect(JSON.stringify(write)).not.toMatch(/manual_summary|idempotency-key|人工候選結果/u);
  });

  it("requires renewed AAL2 before a signed original can be continued", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([{ ...reserved, operation: "sign", baselineVersion: 2 }]));
    vi.stubGlobal("fetch", fetchMock);
    view(false);
    expect(await screen.findByRole("link", { name: "重新驗證" })).toHaveAttribute(
      "href", "/mfa?audience=staff&purpose=sensitive-action");
    expect(screen.queryByRole("button", { name: "續做原筆" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails visibly without treating a missing or cross-tenant lookup as proof of no write", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([], { organizationId: clientId }));
    vi.stubGlobal("fetch", fetchMock);
    view();
    expect(await screen.findByRole("alert")).toHaveTextContent(/原操作仍可能已保存/u);
    expect(screen.queryByText("沒有最近操作")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("narrows lookup to the selected client and checks the returned client scope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([reserved], { clientId }));
    vi.stubGlobal("fetch", fetchMock);
    view(true, clientId);
    expect(await screen.findByRole("button", { name: "續做原筆" })).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/abcd-assessments/recovery?client_id=${clientId}`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps an uncertain continuation pending when the follow-up read is unavailable", async () => {
    let reads = 0;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      if (init.method === "GET") return ++reads === 1 ? response([reserved]) : Response.json({}, { status: 503 });
      throw new TypeError("network unavailable");
    });
    vi.stubGlobal("fetch", fetchMock);
    view();
    fireEvent.click(await screen.findByRole("button", { name: "續做原筆" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/原操作仍可能已保存/u));
    expect(screen.getByRole("status")).toHaveTextContent(/原筆仍未確認/u);
    expect(refresh).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
