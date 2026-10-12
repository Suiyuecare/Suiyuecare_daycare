import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import type { SocialWorkRecordFilters } from "./types";

const stubs = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn(), row: vi.fn(), project: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.client }));
vi.mock("./projection", async (original) => ({
  ...await original<typeof import("./projection")>(), projectSocialWorkRecordSnapshot: stubs.project,
}));
import { loadSocialWorkRecordSnapshot } from "./snapshot";

const id = "29100000-0000-4000-8000-000000000001";
const context: TenantContext = { organizationId: id, branchId: id, userId: id,
  organizationName: "合成機構", branchName: "合成分支", displayName: "合成社工",
  roles: ["case_manager_social_worker"], scopes: ["clients.read", "social_work_records.read"],
  assuranceLevel: "aal1", recentAal2At: null, demo: false };
const DEFAULT_SOCIAL_WORK_FILTERS: SocialWorkRecordFilters = {
  dateFrom: null, dateTo: null, serviceType: null, authorUserId: null, clientId: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  stubs.client.mockResolvedValue({ rpc: stubs.rpc });
  stubs.rpc.mockReturnValue({ maybeSingle: stubs.row });
  stubs.row.mockResolvedValue({ data: { organization_id: id, branch_id: id }, error: null });
  stubs.project.mockReturnValue({ demo: false });
});

describe("social-work ordinary staff read boundary", () => {
  it.each([{ scopes: ["clients.read"] }, { scopes: ["social_work_records.read"] }, { scopes: [] }])("rejects missing exact read grants before any database access", async ({ scopes }) => {
    await expect(loadSocialWorkRecordSnapshot({ ...context, scopes }, DEFAULT_SOCIAL_WORK_FILTERS)).rejects.toThrow("SNAPSHOT_UNAVAILABLE");
    expect(stubs.client).not.toHaveBeenCalled();
  });
  it("loads AAL1 admitted staff through only the exact actor scope RPC", async () => {
    expect((await loadSocialWorkRecordSnapshot(context, DEFAULT_SOCIAL_WORK_FILTERS)).demo).toBe(false);
    expect(stubs.rpc).toHaveBeenCalledWith("social_work_service_snapshot", expect.objectContaining({
      p_expected_organization_id: context.organizationId, p_expected_branch_id: context.branchId,
    }));
    expect(stubs.project).toHaveBeenCalledWith(expect.objectContaining({
      expectedOrganizationId: context.organizationId, expectedBranchId: context.branchId, demo: false,
    }));
  });
  it("does not replace a denied native snapshot with synthetic data", async () => {
    stubs.row.mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(loadSocialWorkRecordSnapshot(context, DEFAULT_SOCIAL_WORK_FILTERS)).rejects.toThrow("SNAPSHOT_UNAVAILABLE");
    expect(stubs.project).not.toHaveBeenCalled();
  });
  it("does not accept cross-scope or malformed projection rows", async () => {
    stubs.project.mockImplementation(() => { throw new Error("scope mismatch"); });
    await expect(loadSocialWorkRecordSnapshot(context, DEFAULT_SOCIAL_WORK_FILTERS)).rejects.toThrow("SNAPSHOT_UNAVAILABLE");
  });
});
