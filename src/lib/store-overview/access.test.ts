import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
const mocks = vi.hoisted(() => ({ synthetic: vi.fn(), db: vi.fn(), rpc: vi.fn(), abort: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/env", () => ({ isSyntheticReadMode: mocks.synthetic }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.db }));
import { canReadStoreOverview } from "./access";
const context: TenantContext = { organizationId: "org", branchId: "branch", userId: "user",
  organizationName: "Org", branchName: "Branch", displayName: "CEO", roles: ["organization_manager"],
  scopes: [], assuranceLevel: "aal1", recentAal2At: null, demo: false };
beforeEach(() => {
  vi.resetAllMocks(); mocks.synthetic.mockReturnValue(false);
  mocks.db.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockReturnValue({ abortSignal: mocks.abort });
  mocks.abort.mockResolvedValue({ data: true, error: null });
});
afterEach(() => vi.restoreAllMocks());
describe("owner summary permission gate", () => {
  it("requires the live DB scope gate, without a new MFA wall", async () => {
    expect(await canReadStoreOverview(context)).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("can_read_store_overview", { p_organization_id: "org", p_branch_id: "branch" });
    expect(mocks.abort).toHaveBeenCalledWith(expect.any(AbortSignal));
  });
  it.each([false, null, "true"])("denies non-boolean approval %s", async (data) => {
    mocks.abort.mockResolvedValue({ data, error: null });
    expect(await canReadStoreOverview(context)).toBe(false);
  });
  it("fails closed on unavailable/missing RPC/database and does not trust context.demo", async () => {
    mocks.abort.mockResolvedValue({ data: true, error: { code: "42883" } });
    expect(await canReadStoreOverview({ ...context, demo: true })).toBe(false);
    mocks.db.mockResolvedValue(null);
    expect(await canReadStoreOverview(context)).toBe(false);
    mocks.db.mockRejectedValue(new Error("private"));
    expect(await canReadStoreOverview(context)).toBe(false);
  });
  it("does not expand other staff roles to owner access", async () => {
    expect(await canReadStoreOverview({ ...context, roles: ["branch_supervisor"] })).toBe(false);
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it("offers a synthetic presentation only when the server-owned mode is enabled", async () => {
    mocks.synthetic.mockReturnValue(true);
    expect(await canReadStoreOverview(context)).toBe(true);
    expect(mocks.db).not.toHaveBeenCalled();
  });
});
