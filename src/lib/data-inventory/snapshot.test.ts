import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { buildDemoDataInventorySnapshot } from "./demo";
const stubs = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn(), synthetic: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ isSyntheticReadMode: stubs.synthetic }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.client }));
import { loadDataInventorySnapshot } from "./snapshot";
const id = "83000000-0000-4000-8000-000000000001";
const context: TenantContext = { organizationId: id, branchId: id, userId: id, organizationName: "合成機構", branchName: "合成分支",
  displayName: "合成主管", roles: ["branch_supervisor"], scopes: ["audit.view"], assuranceLevel: "aal2", recentAal2At: null, demo: false };
beforeEach(() => { vi.resetAllMocks(); stubs.synthetic.mockReturnValue(false); stubs.client.mockResolvedValue({ rpc: stubs.rpc });
  const now = Date.now(); stubs.rpc.mockResolvedValue({ data: { ...buildDemoDataInventorySnapshot(id, id), demo: false,
    generatedAt: new Date(now).toISOString(), staleAfter: new Date(now + 300000).toISOString() }, error: null }); });
describe("inventory snapshot authority", () => {
  it.each([{ scopes: [] }, { assuranceLevel: "aal1" as const }, { roles: ["finance_claims" as const] }, { branchId: "" }])("denies formal insufficient scope %#", async (override) => {
    await expect(loadDataInventorySnapshot({ ...context, ...override })).rejects.toThrow("NOT_AUTHORIZED"); expect(stubs.client).not.toHaveBeenCalled();
  });
  it("allows fixed synthetic employee demo without production permission strings", async () => {
    expect((await loadDataInventorySnapshot({ ...context, demo: true, scopes: ["branch:read"] })).demo).toBe(true); expect(stubs.client).not.toHaveBeenCalled();
  });
  it("does not allow family through synthetic mode", async () => {
    stubs.synthetic.mockReturnValue(true);
    await expect(loadDataInventorySnapshot({ ...context, demo: true, roles: ["family"] })).rejects.toThrow("NOT_AUTHORIZED");
  });
  it("binds formal request to selected organization and branch", async () => {
    expect((await loadDataInventorySnapshot(context)).demo).toBe(false);
    expect(stubs.rpc).toHaveBeenCalledWith("data_inventory_snapshot", { p_expected_organization_id: id, p_expected_branch_id: id });
  });
  it("never falls back to synthetic on DB error", async () => {
    stubs.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(loadDataInventorySnapshot(context)).rejects.toThrow("UNAVAILABLE");
  });
});
