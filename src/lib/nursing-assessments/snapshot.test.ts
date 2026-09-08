import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { buildDemoNursingAssessmentSnapshot } from "./demo";
const stubs = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.client }));
import { loadNursingAssessmentSnapshot } from "./snapshot";
const id = "51000000-0000-4000-8000-000000000001";
const context: TenantContext = { organizationId: id, branchId: id, userId: id, organizationName: "合成機構", branchName: "合成分支",
  displayName: "合成人員", roles: ["nurse"], scopes: ["clients.read", "nursing_assessments.read"],
  assuranceLevel: "aal2", recentAal2At: null, demo: false };
beforeEach(() => {
  vi.resetAllMocks(); stubs.client.mockResolvedValue({ rpc: stubs.rpc });
  stubs.rpc.mockResolvedValue({ data: { ...buildDemoNursingAssessmentSnapshot(id, id), demo: false }, error: null });
});
describe("nursing snapshot scope boundary", () => {
  it.each([{ scopes: ["clients.read"] }, { scopes: ["nursing_assessments.read"] }, { assuranceLevel: "aal1" as const }])("requires complete read scope and AAL2", async (override) => {
    await expect(loadNursingAssessmentSnapshot({ ...context, ...override })).rejects.toThrow("NOT_AUTHORIZED");
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("rejects database errors without demo fallback", async () => {
    stubs.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(loadNursingAssessmentSnapshot(context)).rejects.toThrow("UNAVAILABLE");
  });
  it("binds the RPC and projection to current organization and branch", async () => {
    expect((await loadNursingAssessmentSnapshot(context)).demo).toBe(false);
    expect(stubs.rpc).toHaveBeenCalledWith("nursing_assessment_snapshot", {
      p_expected_organization_id: id, p_expected_branch_id: id });
  });
});
