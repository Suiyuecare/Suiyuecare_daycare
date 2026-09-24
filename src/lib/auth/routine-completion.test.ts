import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
const mocks = vi.hoisted(() => ({ context: vi.fn(), client: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: mocks.context }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
import { authorizeCompletionActor, canUseRoutineCompletion, type RoutineCompletionAction } from "./routine-completion";
const actor: TenantContext = { organizationId: "11111111-1111-4111-8111-111111111111", organizationName: "合成", branchId: "22222222-2222-4222-8222-222222222222", branchName: "合成", userId: "33333333-3333-4333-8333-333333333333", displayName: "合成主管", roles: ["branch_supervisor"], scopes: ["clients.read", "clients.manage", "clients.view_all", "staff_scheduling.manage"], assuranceLevel: "aal1", recentAal2At: null, demo: false };
beforeEach(() => { vi.resetAllMocks(); mocks.context.mockResolvedValue(actor); mocks.client.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: true, error: null }); });
describe("scoped Google completion preflight", () => {
  it.each(["admission.create", "roster.manage"] as const)("requires a real database approval for %s", async (action) => {
    expect(await canUseRoutineCompletion(actor, action, actor.userId)).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("has_routine_completion_access", { target_org_id: actor.organizationId, target_branch_id: actor.branchId, target_action: action, target_client_id: actor.userId });
    expect(actor.assuranceLevel).toBe("aal1"); expect(actor.recentAal2At).toBeNull();
  });
  it.each(["death", "close", "care_records.sign", "roles.manage", "claims.export"])("rejects action expansion %s", async (action) => { expect(await canUseRoutineCompletion(actor, action as RoutineCompletionAction)).toBe(false); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it.each([false, null, "true", 1])("denies nonapproval %s", async (data) => { mocks.rpc.mockResolvedValue({ data, error: null }); expect(await canUseRoutineCompletion(actor, "admission.create")).toBe(false); });
  it("denies missing branch, scope, demo and malformed client before data access", async () => {
    for (const context of [{ ...actor, branchId: "" }, { ...actor, scopes: [] }, { ...actor, demo: true }]) expect(await canUseRoutineCompletion(context, "roster.manage")).toBe(false);
    expect(await canUseRoutineCompletion(actor, "admission.create", "other-client")).toBe(false); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("fails closed on denied, missing and unavailable RPC even at AAL2", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: { code: "PGRST202" } }); expect(await canUseRoutineCompletion({ ...actor, assuranceLevel: "aal2" }, "admission.create")).toBe(false);
    mocks.rpc.mockRejectedValue(new Error("unavailable")); expect(await canUseRoutineCompletion(actor, "roster.manage")).toBe(false);
    mocks.client.mockResolvedValue(null); expect(await canUseRoutineCompletion(actor, "roster.manage")).toBe(false);
  });
  it("requires a current tenant actor and never upgrades its assurance", async () => {
    expect(await authorizeCompletionActor()).toBe(actor);
    for (const [context, code] of [[null, "AUTH_REQUIRED"], [{ ...actor, demo: true }, "DEMO_READ_ONLY"], [{ ...actor, branchId: "" }, "BRANCH_CONTEXT_REQUIRED"]] as const) {
      mocks.context.mockResolvedValue(context); await expect(authorizeCompletionActor()).rejects.toMatchObject({ code });
    }
  });
});
