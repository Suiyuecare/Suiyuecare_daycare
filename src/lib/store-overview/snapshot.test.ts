import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
const mocks = vi.hoisted(() => ({ allowed: vi.fn(), synthetic: vi.fn(), db: vi.fn(), rpc: vi.fn(), abort: vi.fn(), finance: vi.fn(), audit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: {}, isSyntheticReadMode: mocks.synthetic }));
vi.mock("./access", () => ({ canReadStoreOverview: mocks.allowed }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.db }));
vi.mock("./finance-client", () => ({ fetchFinanceSummary: mocks.finance, financeConnection: () => null }));
import { loadStoreOverview } from "./snapshot";
const context: TenantContext = {
  organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222",
  userId: "33333333-3333-4333-8333-333333333333", organizationName: "合成機構", branchName: "合成店",
  displayName: "合成CEO", roles: ["organization_manager"], scopes: [], assuranceLevel: "aal1", recentAal2At: null, demo: false,
};
const periods = { date: "2026-09-12", month: "2026-08" };
function attendance(change: Record<string, unknown> = {}) {
  return { organization_id: context.organizationId, branch_id: context.branchId, service_date: periods.date,
    present: 12, leave: 2, absent: 1, generated_at: new Date().toISOString(), ...change };
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.allowed.mockResolvedValue(true); mocks.synthetic.mockReturnValue(false);
  mocks.db.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockImplementation((name) => ({ abortSignal: name === "record_store_finance_summary_read" ? mocks.audit : mocks.abort }));
  mocks.audit.mockResolvedValue({ data: true, error: null });
  mocks.abort.mockResolvedValue({ data: attendance(), error: null });
  mocks.finance.mockResolvedValue({ status: "not_connected" });
});
describe("single-store summary orchestration", () => {
  it("gates before reading either source", async () => {
    mocks.allowed.mockResolvedValue(false);
    expect(await loadStoreOverview(context, periods)).toBeNull();
    expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.finance).not.toHaveBeenCalled();
  });
  it("passes only a scoped date to the aggregate RPC and no health/client query", async () => {
    const result = await loadStoreOverview(context, periods);
    expect(mocks.rpc).toHaveBeenCalledWith("read_store_attendance_summary", {
      p_organization_id: context.organizationId, p_branch_id: context.branchId, p_service_date: periods.date,
    });
    expect(mocks.finance).toHaveBeenCalledWith({ connection: null, organizationId: context.organizationId,
      branchId: context.branchId, month: periods.month });
    expect(result).toMatchObject({ periods, demo: false, invalid: false, attendance: { status: "ready",
      data: { present: 12, leave: 2, absent: 1 } }, finance: { status: "not_connected" } });
    expect(JSON.stringify(result)).not.toContain(context.userId);
    expect(JSON.stringify(result)).not.toContain(context.organizationId);
  });
  it.each([{ date: "2026-02-30" }, { month: "2026-13" }, { date: ["2026-09-12", "2026-09-11"] },
    { month: ["2026-09"] }, { entity_id: "OTHER" }, { branch: "OTHER" }])("does not fetch invalid query %j", async (change) => {
    expect(await loadStoreOverview(context, { ...periods, ...change })).toMatchObject({ invalid: true });
    expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.finance).not.toHaveBeenCalled();
  });
  it("never activates real adapters for synthetic mode", async () => {
    mocks.synthetic.mockReturnValue(true);
    expect(await loadStoreOverview(context, periods)).toMatchObject({ demo: true, attendance: { status: "ready" }, finance: { status: "ready" } });
    expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.finance).not.toHaveBeenCalled();
  });
  it("does not let caller-supplied demo context select synthetic data", async () => {
    expect(await loadStoreOverview({ ...context, demo: true }, periods)).toMatchObject({ demo: false });
    expect(mocks.db).toHaveBeenCalled();
  });
  it.each([{ branch_id: context.organizationId }, { organization_id: context.branchId },
    { service_date: "2026-09-13" }, { present: -1 }, { absent: "1" }, { client_names: ["Private"] },
    { generated_at: "2020-01-01T00:00:00Z" }])("fails closed on inconsistent attendance %j", async (change) => {
    mocks.abort.mockResolvedValue({ data: attendance(change), error: null });
    expect(await loadStoreOverview(context, periods)).toMatchObject({ attendance: { status: "unavailable" } });
  });
  it("preserves real zero and doesn't turn source errors into zero", async () => {
    mocks.abort.mockResolvedValue({ data: attendance({ present: 0, leave: 0, absent: 0 }), error: null });
    expect(await loadStoreOverview(context, periods)).toMatchObject({ attendance: { status: "ready", data: { present: 0, leave: 0, absent: 0 } } });
    mocks.abort.mockResolvedValue({ data: null, error: { private: "secret" } });
    expect(await loadStoreOverview(context, periods)).toMatchObject({ attendance: { status: "unavailable" } });
  });
  it("Finance remains usable when attendance fails (and vice versa)", async () => {
    mocks.abort.mockRejectedValue(new Error("private"));
    mocks.finance.mockResolvedValue({ status: "ready", data: { income: "10.00", expenses: "5.00", entryCount: 2, generatedAt: new Date().toISOString() } });
    expect(await loadStoreOverview(context, periods)).toMatchObject({ attendance: { status: "unavailable" }, finance: { status: "ready" } });
    expect(mocks.rpc).toHaveBeenCalledWith("record_store_finance_summary_read", {
      p_organization_id: context.organizationId, p_branch_id: context.branchId, p_month: periods.month,
    });
  });
  it("does not release amounts when read audit or live reauthorization fails", async () => {
    mocks.finance.mockResolvedValue({ status: "ready", data: { income: "10.00", expenses: "5.00", entryCount: 2, generatedAt: new Date().toISOString() } });
    mocks.audit.mockResolvedValue({ data: false, error: null });
    expect(await loadStoreOverview(context, periods)).toMatchObject({ finance: { status: "unavailable" } });
    mocks.audit.mockRejectedValue(new Error("secret"));
    expect(await loadStoreOverview(context, periods)).toMatchObject({ finance: { status: "unavailable" } });
  });
});
