import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(),
  requireRecentAal2: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
  project: vi.fn(),
  demo: vi.fn(),
  csv: vi.fn(),
}));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  requireRecentAal2: stubs.requireRecentAal2,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (
    operation: (requestId: string) => Promise<Response>,
  ) => {
    try {
      return await operation("42190000-0000-4000-8000-000000000099");
    } catch (error) {
      const value = error as {
        code?: string; message?: string; httpStatus?: number;
      };
      return Response.json({
        requestId: "42190000-0000-4000-8000-000000000099",
        status: "error",
        data: null,
        errors: [{
          code: value.code ?? "ERROR",
          message: value.message ?? "error",
        }],
      }, { status: value.httpStatus ?? 500 });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));
vi.mock("@/lib/professional-service-summary/projection", () => ({
  projectProfessionalServiceSummary: stubs.project,
}));
vi.mock("@/lib/professional-service-summary/demo", () => ({
  buildDemoProfessionalServiceSummary: stubs.demo,
}));
vi.mock("@/lib/professional-service-summary/csv", () => ({
  professionalServiceSummaryCsv: stubs.csv,
}));

import { GET } from "./route";

const organizationId = "42190000-0000-4000-8000-000000000001";
const branchId = "42190000-0000-4000-8000-000000000002";
const userId = "42190000-0000-4000-8000-000000000003";
const snapshotId = "42190000-0000-4000-8000-000000000004";
const actor = {
  organizationId, branchId, userId,
  organizationName: "合成機構", branchName: "合成分支",
  displayName: "合成專業人員", roles: ["professional"],
  scopes: ["clients.read", "professional_service_summary.read",
    "professional_service_summary.export"],
  assuranceLevel: "aal2", recentAal2At: null, demo: false,
};
const projected = {
  snapshotId,
  snapshotHash: "a".repeat(64),
  month: "2026-09",
  matchingTotal: 8,
  metrics: {
    expected: 10, completed: 6, pending: 3, overdue: 1,
    serviceRecords: 5, notConfiguredItems: 1,
  },
};

function request(extra = "") {
  return new Request(
    `https://example.invalid/api/professional-service-summary/export?snapshot=${snapshotId}&month=2026-09&professional=all&status=all${extra}`,
  );
}

describe("Page 42 immutable snapshot export route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
    stubs.maybeSingle.mockResolvedValue({
      data: { snapshot_id: snapshotId }, error: null,
    });
    stubs.project.mockReturnValue(projected);
    stubs.demo.mockReturnValue(projected);
    stubs.csv.mockReturnValue("\\ufeff合成 CSV\\r\\n");
  });

  it("rejects unknown, duplicate or malformed query before database access", async () => {
    let response = await GET(request("&unknown=1"));
    expect(response.status).toBe(400);
    response = await GET(request(`&snapshot=${snapshotId}`));
    expect(response.status).toBe(400);
    response = await GET(new Request(
      "https://example.invalid/api/professional-service-summary/export?snapshot=bad&month=2026-09",
    ));
    expect(response.status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("rejects missing export scope before recent reauth and database", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({
      ...actor,
      scopes: ["clients.read", "professional_service_summary.read"],
    });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("requires recent AAL2 before reading the persisted snapshot", async () => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(
      new Error("reauth"),
      { code: "AAL2_REQUIRED", httpStatus: 403 },
    ));
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("exports exactly the actor-scoped database snapshot with count headers", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(stubs.rpc).toHaveBeenCalledWith(
      "professional_service_summary_export_snapshot",
      {
        p_expected_organization_id: organizationId,
        p_expected_branch_id: branchId,
        p_snapshot_id: snapshotId,
      },
    );
    expect(stubs.project).toHaveBeenCalledWith(expect.objectContaining({
      expectedOrganizationId: organizationId,
      expectedBranchId: branchId,
      demo: false,
    }));
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-summary-item-total")).toBe("8");
    expect(response.headers.get("x-summary-expected-total")).toBe("10");
    expect(response.headers.get("x-summary-completed-total")).toBe("6");
    expect(await response.text()).toContain("合成 CSV");
  });

  it.each([
    ["42501", 403, "PROFESSIONAL_SUMMARY_EXPORT_NOT_AUTHORIZED"],
    ["55000", 409, "PROFESSIONAL_SUMMARY_EXPORT_INTEGRITY_FAILED"],
    ["XX000", 409, "PROFESSIONAL_SUMMARY_EXPORT_UNAVAILABLE"],
  ])("maps database error %s without exposing internals", async (
    code, status, expected,
  ) => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code } });
    const response = await GET(request());
    expect(response.status).toBe(status);
    expect((await response.json()).errors[0].code).toBe(expected);
  });

  it("rejects a mismatched projected snapshot identity", async () => {
    stubs.project.mockReturnValue({ ...projected, snapshotId: userId });
    const response = await GET(request());
    expect(response.status).toBe(409);
    expect((await response.json()).errors[0].code)
      .toBe("PROFESSIONAL_SUMMARY_EXPORT_INTEGRITY_FAILED");
  });

  it("exports synthetic demo data without calling the database", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(stubs.demo).toHaveBeenCalledWith({
      month: "2026-09", clientId: null,
      professionalKind: "all", status: "all",
    });
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
});
