import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TenantContext } from "@/lib/domain/types";

import type { IntegrationsAuditFilters } from "./types";

const { rpc, maybeSingle, createServerSupabaseClient, project } = vi.hoisted(() => ({
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  project: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient }));
vi.mock("./projection", () => ({ projectIntegrationsAuditSnapshot: project }));
vi.mock("server-only", () => ({}));

import { loadIntegrationsAuditSnapshot } from "./snapshot";

const filters: IntegrationsAuditFilters = { startDate: "2026-09-01", endDate: "2026-09-08",
  integrationKey: "all", activityState: "all", auditAction: "all", resourceCategory: "all",
  actorUserId: null, correlationId: null };
const context: TenantContext = { organizationId: "83200000-0000-4000-8000-000000000001",
  organizationName: "合成機構", branchId: "83200000-0000-4000-8000-000000000002",
  branchName: "合成分支", userId: "83200000-0000-4000-8000-000000000003",
  displayName: "合成稽核員", roles: ["organization_manager"], scopes: ["audit.view"],
  assuranceLevel: "aal2", recentAal2At: null, demo: false };

describe("Page 83 snapshot loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    maybeSingle.mockResolvedValue({ data: { formal: true }, error: null });
    rpc.mockReturnValue({ maybeSingle });
    createServerSupabaseClient.mockResolvedValue({ rpc });
    project.mockReturnValue({ projected: true });
  });

  it("loads when the separate server-verified recent-AAL2 proof is true", async () => {
    await expect(loadIntegrationsAuditSnapshot(context, filters, true))
      .resolves.toEqual({ projected: true });
    expect(rpc).toHaveBeenCalledWith("integrations_audit_snapshot", expect.objectContaining({
      p_expected_organization_id: context.organizationId,
      p_expected_branch_id: context.branchId,
      p_start_date: filters.startDate,
      p_correlation_id: null,
    }));
  });

  it("fails before RPC when recent proof is false despite context recentAal2At being null", async () => {
    await expect(loadIntegrationsAuditSnapshot(context, filters, false))
      .rejects.toThrow("INTEGRATIONS_AUDIT_SNAPSHOT_UNAVAILABLE");
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
