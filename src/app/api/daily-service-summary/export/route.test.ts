import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ authorizeStaffRequest: vi.fn(),
  requireRecentAal2: vi.fn(), createServerSupabaseClient: vi.fn(), rpc: vi.fn(),
  maybeSingle: vi.fn(), project: vi.fn(), demo: vi.fn(), csv: vi.fn() }));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  requireRecentAal2: stubs.requireRecentAal2,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: () => Promise<Response>) => {
    try { return await operation(); } catch (error) {
      const value = error as { code?: string; message?: string; httpStatus?: number };
      return Response.json({ requestId: "54900000-0000-4000-8000-000000000099",
        status: "error", data: null, errors: [{ code: value.code ?? "ERROR",
          message: value.message ?? "error" }] }, { status: value.httpStatus ?? 500 });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));
vi.mock("@/lib/daily-service-summary/projection", () => ({
  projectDailyServiceSummary: stubs.project,
}));
vi.mock("@/lib/daily-service-summary/demo", () => ({
  buildDemoDailyServiceSummary: stubs.demo,
}));
vi.mock("@/lib/daily-service-summary/csv", () => ({
  dailyServiceSummaryCsv: stubs.csv,
}));

import { GET } from "./route";

const organizationId = "54900000-0000-4000-8000-000000000001";
const branchId = "54900000-0000-4000-8000-000000000002";
const snapshotId = "54900000-0000-4000-8000-000000000004";
const actor = { organizationId, branchId,
  userId: "54900000-0000-4000-8000-000000000003",
  organizationName: "合成機構", branchName: "合成分支", displayName: "合成人員",
  roles: ["branch_supervisor"], scopes: ["clients.read",
    "daily_service_summary.read", "daily_service_summary.export"],
  assuranceLevel: "aal2", recentAal2At: null, demo: false };
const projected = { snapshotId, snapshotHash: "a".repeat(64),
  filters: { serviceDate: "2026-09-07", clientId: null, completeness: "all" },
  matchingRowTotal: 3, metrics: { coveredCellTotal: 18 } };

function request(extra = "") {
  return new Request(`https://example.invalid/api/daily-service-summary/export?` +
    `snapshot=${snapshotId}&date=2026-09-07&completeness=all${extra}`);
}

describe("Page 54 immutable snapshot export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
    stubs.maybeSingle.mockResolvedValue({ data: { snapshot_id: snapshotId }, error: null });
    stubs.project.mockReturnValue(projected); stubs.demo.mockReturnValue(projected);
    stubs.csv.mockReturnValue("\ufeff合成 CSV\r\n");
  });

  it("rejects unknown, duplicate and malformed filters before the database", async () => {
    expect((await GET(request("&branch=x"))).status).toBe(400);
    expect((await GET(request(`&snapshot=${snapshotId}`))).status).toBe(400);
    expect((await GET(new Request("https://example.invalid/api/daily-service-summary/export?snapshot=bad&date=2026-09-07"))).status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("requires export scope and recent same-session AAL2 before snapshot access", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor,
      scopes: ["clients.read", "daily_service_summary.read"] });
    expect((await GET(request())).status).toBe(403);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("reauth"),
      { code: "AAL2_REQUIRED", httpStatus: 403 }));
    expect((await GET(request())).status).toBe(403);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("retrieves and exports exactly the actor and branch scoped snapshot", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(stubs.rpc).toHaveBeenCalledWith("daily_service_summary_export_snapshot_v2", {
      p_expected_organization_id: organizationId,
      p_expected_branch_id: branchId, p_snapshot_id: snapshotId,
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-summary-client-total")).toBe("3");
    expect(response.headers.get("x-summary-covered-cell-total")).toBe("18");
    expect(await response.text()).toContain("合成 CSV");
  });

  it.each([["42501", 403, "DAILY_SUMMARY_EXPORT_NOT_AUTHORIZED"],
    ["55000", 409, "DAILY_SUMMARY_EXPORT_INTEGRITY_FAILED"],
    ["XX000", 409, "DAILY_SUMMARY_EXPORT_UNAVAILABLE"]])(
    "maps database error %s without internals", async (code, status, expected) => {
      stubs.maybeSingle.mockResolvedValue({ data: null, error: { code } });
      const response = await GET(request());
      expect(response.status).toBe(status);
      expect((await response.json()).errors[0].code).toBe(expected);
    });

  it("rejects a mismatched snapshot identity or filter", async () => {
    stubs.project.mockReturnValue({ ...projected,
      filters: { ...projected.filters, serviceDate: "2026-09-08" } });
    const response = await GET(request());
    expect(response.status).toBe(409);
    expect((await response.json()).errors[0].code)
      .toBe("DAILY_SUMMARY_EXPORT_INTEGRITY_FAILED");
  });

  it("exports deterministic synthetic demo without database access", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(stubs.demo).toHaveBeenCalledWith({ serviceDate: "2026-09-07",
      clientId: null, completeness: "all" });
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
});
