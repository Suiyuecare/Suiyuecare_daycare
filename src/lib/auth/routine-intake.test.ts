import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), client: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: mocks.context }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
import { authorizeRoutineIntake, ROUTINE_INTAKE_ACTIONS, type RoutineIntakeAction } from "./routine-intake";
const clientId = "d1000000-0000-4000-8000-000000000001";
const actor = { organizationId: "a1000000-0000-4000-8000-000000000001", branchId: "b1000000-0000-4000-8000-000000000001", userId: "c1000000-0000-4000-8000-000000000001", demo: false, assuranceLevel: "aal1", recentAal2At: null };
beforeEach(() => { vi.resetAllMocks(); mocks.context.mockResolvedValue(actor); mocks.client.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: true, error: null }); });
describe("action-scoped Google intake authorization", () => {
  it.each(ROUTINE_INTAKE_ACTIONS)("checks %s against live authority and returns unchanged AAL1", async (action) => {
    expect(await authorizeRoutineIntake(action, clientId)).toBe(actor);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("has_routine_intake_access", { target_org_id: actor.organizationId, target_branch_id: actor.branchId, target_action: action, target_client_id: clientId });
    expect(actor).toMatchObject({ assuranceLevel: "aal1", recentAal2At: null });
  });
  it.each([false, null, {}, "true"])("fails closed for non-true decision %j", async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null }); await expect(authorizeRoutineIntake("profile.update", clientId)).rejects.toMatchObject({ code: "INTAKE_NOT_AUTHORIZED" });
  });
  it("rejects errors even with true data without exposing upstream details", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: { message: "SYNTHETIC_PRIVATE_TOKEN" } });
    const error = await authorizeRoutineIntake("cms.commit", clientId).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: "INTAKE_NOT_AUTHORIZED" }); expect(String(error)).not.toContain("SYNTHETIC_PRIVATE_TOKEN");
  });
  it.each(["sign", "medication.administer", "claims.export", "roles.manage", "abcd.export", "imports.approve"])("does not allow privileged action %s", async (action) => {
    await expect(authorizeRoutineIntake(action as RoutineIntakeAction, clientId)).rejects.toMatchObject({ code: "INVALID_INTAKE_ACTION" }); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("denies anonymous, demo and absent branch before database reads", async () => {
    mocks.context.mockResolvedValue(null); await expect(authorizeRoutineIntake("profile.create")).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    mocks.context.mockResolvedValue({ ...actor, demo: true }); await expect(authorizeRoutineIntake("profile.create")).rejects.toMatchObject({ code: "DEMO_READ_ONLY" });
    mocks.context.mockResolvedValue({ ...actor, branchId: null }); await expect(authorizeRoutineIntake("profile.create")).rejects.toMatchObject({ code: "BRANCH_CONTEXT_REQUIRED" }); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("fails closed for a missing database and malformed client", async () => {
    await expect(authorizeRoutineIntake("profile.update", "injected")).rejects.toMatchObject({ code: "INVALID_INTAKE_ACTION" });
    mocks.client.mockResolvedValue(null); await expect(authorizeRoutineIntake("profile.create")).rejects.toMatchObject({ code: "INTAKE_UNAVAILABLE" }); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
