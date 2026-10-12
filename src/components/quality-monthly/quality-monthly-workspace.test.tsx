// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QualityMonthlySnapshot } from "@/lib/quality-monthly/contract";
import { hasPendingOperations, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";
import { QualityMonthlyWorkspace } from "./quality-monthly-workspace";
import { getHeldQualityOperation, settleQualityOperation } from "./quality-monthly-pending";

const stubs = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: stubs.replace, refresh: stubs.refresh }) }));
const org = "d1300000-0000-4000-8000-000000000001", branch = "d1400000-0000-4000-8000-000000000001";
const actor = "d1100000-0000-4000-8000-000000000001", frozenId = "d1900000-0000-4000-8000-000000000001";
function snapshot(): QualityMonthlySnapshot {
  return { schemaVersion: 1, organizationId: org, branchId: branch, month: "2026-10", ruleVersion: "organization.quality-monthly-v1",
    officialIndicator: false, generatedAt: new Date().toISOString(), hash: "a".repeat(64), snapshotId: null, excludedVoidedWeights: 0,
    metrics: ["falls", "infections", "abnormal", "weight_coverage"].map((key) => ({ key: key as QualityMonthlySnapshot["metrics"][number]["key"],
      numerator: 0, denominator: 0, rate: null, numeratorItems: [], denominatorItems: [] })) };
}
beforeEach(() => { sessionStorage.clear(); stubs.replace.mockReset(); stubs.refresh.mockReset(); });
afterEach(() => { cleanup(); const held = getHeldQualityOperation(); if (held) settleQualityOperation(held.operation); sessionStorage.clear(); vi.unstubAllGlobals(); });

describe("quality report atomic freeze safe recovery", () => {
  it("retains original key through unmount, rejects changed scope, keeps unknown after later refusal, and correlates success", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("interrupted")); vi.stubGlobal("fetch", fetchMock);
    const first = render(<QualityMonthlyWorkspace snapshot={snapshot()} month="2026-10" actorUserId={actor} canExport />);
    fireEvent.click(screen.getByRole("button", { name: "固定月報並匯出" }));
    await waitFor(() => expect(getHeldQualityOperation()?.phase).toBe("unknown"));
    const original = getHeldQualityOperation()!.operation;
    expect(hasPendingOperations()).toBe(true); expect(tryAcquireViewTransition()).toBeNull(); first.unmount();
    const other = render(<QualityMonthlyWorkspace snapshot={{ ...snapshot(), branchId: frozenId }} month="2026-10" actorUserId={actor} canExport />);
    fireEvent.click(screen.getByRole("button", { name: "核對並重試原操作" }));
    expect(screen.getByRole("alert").textContent).toContain("原分支"); expect(fetchMock).toHaveBeenCalledTimes(1); other.unmount();
    fetchMock.mockResolvedValueOnce(Response.json({ status: "error", errors: [{ code: "QUALITY_MONTHLY_NOT_AUTHORIZED" }] }, { status: 403 }));
    render(<QualityMonthlyWorkspace snapshot={snapshot()} month="2026-10" actorUserId={actor} canExport />);
    fireEvent.click(screen.getByRole("button", { name: "核對並重試原操作" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getHeldQualityOperation()?.phase).toBe("unknown"));
    expect(getHeldQualityOperation()?.operation).toBe(original); expect(hasPendingOperations()).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(original.input);
    fetchMock.mockResolvedValueOnce(Response.json({ status: "ok", data: { ...snapshot(), snapshotId: frozenId,
      actorUserId: actor, idempotencyKey: original.input.idempotency_key } }));
    fireEvent.click(screen.getByRole("button", { name: "核對並重試原操作" }));
    await waitFor(() => expect(getHeldQualityOperation()).toBeNull());
    expect(stubs.replace).toHaveBeenCalledWith(`/app/quality-monthly?month=2026-10&snapshot=${frozenId}`);
    expect(hasPendingOperations()).toBe(false);
  }, 15000);
  it("rejects a mismatched actor/key receipt and disables new writes with a lost reload marker", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ status: "ok", data: { ...snapshot(), snapshotId: frozenId,
      actorUserId: frozenId, idempotencyKey: crypto.randomUUID() } })); vi.stubGlobal("fetch", fetchMock);
    const first = render(<QualityMonthlyWorkspace snapshot={snapshot()} month="2026-10" actorUserId={actor} canExport />);
    fireEvent.click(screen.getByRole("button", { name: "固定月報並匯出" }));
    await waitFor(() => expect(getHeldQualityOperation()?.phase).toBe("unknown"));
    expect(stubs.replace).not.toHaveBeenCalled(); first.unmount();
    settleQualityOperation(getHeldQualityOperation()!.operation);
    sessionStorage.setItem("quality-monthly-unresolved-v1", "1");
    render(<QualityMonthlyWorkspace snapshot={snapshot()} month="2026-10" actorUserId={actor} canExport />);
    expect(screen.getByRole("button", { name: "固定月報並匯出" }).hasAttribute("disabled")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
