import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TenantContext } from "@/lib/domain/types";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), serverClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.serverClient }));

import { AssessmentMatrixSnapshotError, loadAssessmentMatrixSnapshot } from "./snapshot";

const actor: TenantContext = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  branchId: "22222222-2222-4222-8222-222222222222",
  userId: "33333333-3333-4333-8333-333333333333",
  organizationName: "合成機構", branchName: "合成分支", displayName: "合成員工",
  roles: ["nurse"], scopes: ["clients.read", "questionnaire_cognition.read"],
  assuranceLevel: "aal1", recentAal2At: null, demo: false,
};
const filters = { month: "2026-10", page: 1 };
const clientId = "44444444-4444-4444-8444-444444444444";
const versionId = "55555555-5555-4555-8555-555555555555";

function response() {
  return {
    month: "2026-10", generatedAt: "2026-10-08T10:00:00.000Z",
    page: 1, pageSize: 20, totalClients: 1, forms: ["spmsq"],
    clients: [{ clientId, clientCode: "SYN-1", displayName: "合成甲", serviceStatus: "active",
      cells: { spmsq: { state: "draft", versionId, version: 2, assessedOn: "2026-10-03" } } }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.serverClient.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: response(), error: null });
});

describe("assessment matrix fail-closed snapshot", () => {
  it("uses the authenticated RPC with exact tenant, branch, month and bounded pagination", async () => {
    expect(await loadAssessmentMatrixSnapshot(actor, filters)).toMatchObject({ totalClients: 1, forms: ["spmsq"] });
    expect(mocks.rpc).toHaveBeenCalledWith("assessment_matrix_snapshot", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_month: "2026-10-01", p_page: 1, p_page_size: 20,
    });
  });

  it("does not query without a matching read permission", async () => {
    await expect(loadAssessmentMatrixSnapshot({ ...actor, scopes: ["clients.read"] }, filters))
      .rejects.toBeInstanceOf(AssessmentMatrixSnapshotError);
    expect(mocks.serverClient).not.toHaveBeenCalled();
  });

  it("never turns missing RPC or malformed data into invented unrecorded statuses", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202" } });
    await expect(loadAssessmentMatrixSnapshot(actor, filters)).rejects.toBeInstanceOf(AssessmentMatrixSnapshotError);
    const extra = response();
    extra.clients[0]!.cells.spmsq.assessedOn = "2026-09-30";
    mocks.rpc.mockResolvedValueOnce({ data: extra, error: null });
    await expect(loadAssessmentMatrixSnapshot(actor, filters)).rejects.toBeInstanceOf(AssessmentMatrixSnapshotError);
  });

  it("rejects a form outside the caller's current app scopes", async () => {
    const extra = { ...response(), forms: ["spmsq", "gds_15"],
      clients: [{ ...response().clients[0]!, cells: { ...response().clients[0]!.cells, gds_15: { state: "none" } } }] };
    mocks.rpc.mockResolvedValueOnce({ data: extra, error: null });
    await expect(loadAssessmentMatrixSnapshot(actor, filters)).rejects.toBeInstanceOf(AssessmentMatrixSnapshotError);
  });

  it("uses only a labelled synthetic empty state in demo mode", async () => {
    const demo = await loadAssessmentMatrixSnapshot({ ...actor, demo: true }, filters);
    expect(demo).toMatchObject({ demo: true, clients: [], totalClients: 0 });
    expect(mocks.serverClient).not.toHaveBeenCalled();
  });
});
