import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
const mocks = vi.hoisted(() => ({ db: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.db }));
import { loadClaimReadSnapshot, ServiceManagementSnapshotError } from "./snapshot";
const context: TenantContext = {
  organizationId: "a0000000-0000-4000-8000-000000000001", branchId: "a0000000-0000-4000-8000-000000000002",
  userId: "a0000000-0000-4000-8000-000000000003", organizationName: "合成機構", branchName: "合成店",
  displayName: "合成人員", roles: ["finance_claims"], scopes: ["claims.read"], assuranceLevel: "aal2", recentAal2At: null, demo: false,
};
const row = {
  id: "a0000000-0000-4000-8000-000000000004", claim_period_start: "2026-09-01", claim_period_end: "2026-09-30",
  format_version: "fixture-v1", status: "draft", item_count: 3, total_amount: "1200.10",
  responded_item_count: 0, rejected_item_count: 0, legacy_response_unknown: false,
  has_immutable_snapshot: false, exported_at: null, submitted_at: null, reconciled_at: null,
  updated_at: "2026-09-26T10:10:10.123456+08:00",
};
beforeEach(() => {
  vi.resetAllMocks(); mocks.db.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: [row], error: null });
});
describe("claims list read boundary", () => {
  it("requires read authority before accessing the database", async () => {
    await expect(loadClaimReadSnapshot({ ...context, scopes: [] })).rejects.toBeInstanceOf(ServiceManagementSnapshotError);
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it("uses the fixed current branch and parses a bounded exact projection", async () => {
    const result = await loadClaimReadSnapshot(context);
    expect(mocks.rpc).toHaveBeenCalledWith("claim_batch_summaries", { p_branch_id: context.branchId, p_limit: 200 });
    expect(result.batches).toEqual([expect.objectContaining({ id: row.id, itemCount: 3, totalAmount: "1200.10" })]);
    expect(JSON.stringify(result)).not.toContain(context.userId);
  });
  it.each([null, {}, [{ ...row, item_count: -1 }], [{ ...row, total_amount: "NaN" }], [row, row]])
    ("returns a sanitized unavailable error, never fake empty/success for malformed RPC %j", async (data) => {
      mocks.rpc.mockResolvedValue({ data, error: null });
      await expect(loadClaimReadSnapshot(context)).rejects.toMatchObject({ message: "SERVICE_MANAGEMENT_SNAPSHOT_UNAVAILABLE" });
    });
  it("keeps a legitimate empty list distinct from database failure", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect((await loadClaimReadSnapshot(context)).batches).toEqual([]);
    mocks.rpc.mockResolvedValue({ data: [], error: { message: "private database details" } });
    await expect(loadClaimReadSnapshot(context)).rejects.toMatchObject({ message: "SERVICE_MANAGEMENT_SNAPSHOT_UNAVAILABLE" });
  });
  it("does not contact the database in synthetic demonstration mode", async () => {
    expect((await loadClaimReadSnapshot({ ...context, demo: true })).demo).toBe(true);
    expect(mocks.db).not.toHaveBeenCalled();
  });
});
