import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
const mocks = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
import { canUseRoutineCare, ROUTINE_CARE_PERMISSIONS, type RoutineCarePermission } from "./routine-care";

const actor: TenantContext = {
  organizationId: "11111111-1111-4111-8111-111111111111", organizationName: "合成機構",
  branchId: "22222222-2222-4222-8222-222222222222", branchName: "合成分支",
  userId: "33333333-3333-4333-8333-333333333333", displayName: "合成照服員",
  roles: ["care_worker"], scopes: [...ROUTINE_CARE_PERMISSIONS], assuranceLevel: "aal1",
  recentAal2At: null, demo: false,
};
beforeEach(() => { vi.resetAllMocks(); mocks.client.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: true, error: null }); });

describe("explicit routine care policy, never an AAL2 substitute", () => {
  it.each(ROUTINE_CARE_PERMISSIONS)("checks the live grant for exact actor branch and %s", async (permission) => {
    expect(await canUseRoutineCare(actor, permission)).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("has_routine_care_access", {
      target_org_id: actor.organizationId, target_branch_id: actor.branchId, target_permission: permission,
    });
    expect(actor.assuranceLevel).toBe("aal1"); expect(actor.recentAal2At).toBeNull();
  });
  it.each([false, null, undefined, "true", 1])("fails closed on non-boolean approval %s", async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    expect(await canUseRoutineCare(actor, "health.write")).toBe(false);
  });
  it("never substitutes privileged credentials, missing schema or failed checks", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: { code: "PGRST202" } });
    expect(await canUseRoutineCare(actor, "attendance.write")).toBe(false);
    mocks.rpc.mockRejectedValue(new Error("sensitive details"));
    expect(await canUseRoutineCare(actor, "attendance.write")).toBe(false);
    mocks.client.mockResolvedValue(null);
    expect(await canUseRoutineCare(actor, "attendance.write")).toBe(false);
  });
  it("does not query or approve when branch or live membership scope is missing", async () => {
    expect(await canUseRoutineCare({ ...actor, scopes: [] }, "health.write")).toBe(false);
    expect(await canUseRoutineCare({ ...actor, branchId: "" }, "health.write")).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["care_records.sign", "claims.export", "roles.manage", "staff_management.manage"])("cannot expand into %s even when passed from untyped code", async (permission) => {
    expect(await canUseRoutineCare(actor, permission as RoutineCarePermission)).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("preserves existing AAL2 scope checks and separates demo from real policy", async () => {
    expect(await canUseRoutineCare({ ...actor, assuranceLevel: "aal2" }, "health.write")).toBe(true);
    expect(await canUseRoutineCare({ ...actor, assuranceLevel: "aal2", scopes: [] }, "health.write")).toBe(false);
    expect(await canUseRoutineCare({ ...actor, demo: true, scopes: [] }, "health.write")).toBe(true);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
