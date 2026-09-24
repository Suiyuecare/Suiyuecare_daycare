import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { buildDemoStaffCertificateSnapshot } from "@/lib/staff-certificates/demo";

const mock = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/staff-certificates/snapshot", () => ({ loadStaffCertificateSnapshot: mock.load }));
import { canReadQualificationReport, loadQualificationReport } from "./server";

const context: TenantContext = { organizationId: "72000000-0000-4000-8000-000000000001", branchId: "72000000-0000-4000-8000-000000000002", organizationName: "合成機構", branchName: "合成分支", userId: "72000000-0000-4000-8000-000000000003", displayName: "主管", roles: ["branch_supervisor"], scopes: ["staff_certificates.read"], assuranceLevel: "aal2", recentAal2At: null, demo: false };
const filters = { staff: null, issue: "all" as const, query: "" };
describe("scoped qualification report loader", () => {
  beforeEach(() => { vi.clearAllMocks(); mock.load.mockResolvedValue(buildDemoStaffCertificateSnapshot({ organizationId: context.organizationId, branchId: context.branchId, filters: { staffMembershipId: null, certificateType: null, status: "all", query: "" } })); });
  it.each([
    { scopes: [] }, { scopes: ["staff_health.read"] }, { assuranceLevel: "aal1" as const },
  ])("rejects missing certificate permission or assurance before reading any data %#", async (patch) => {
    const actor = { ...context, ...patch };
    expect(canReadQualificationReport(actor)).toBe(false);
    await expect(loadQualificationReport(actor, filters)).rejects.toMatchObject({ httpStatus: 403 });
    expect(mock.load).not.toHaveBeenCalled();
  });
  it("uses only the existing audited certificate loader with server-owned tenant scope", async () => {
    const report = await loadQualificationReport(context, filters);
    expect(mock.load).toHaveBeenCalledExactlyOnceWith(context, { staffMembershipId: null, certificateType: null, status: "all", query: "" });
    expect(report.branchId).toBe(context.branchId);
  });
  it("does not leak data or raw database error when source scope is denied", async () => {
    mock.load.mockRejectedValue(new Error("database sensitive details"));
    await expect(loadQualificationReport(context, filters)).rejects.toMatchObject({ code: "QUALIFICATION_SOURCE_UNAVAILABLE", httpStatus: 503 });
  });
  it("rejects an unexpected cross-branch response", async () => {
    const source = await mock.load(); source.branchId = "foreign-branch"; mock.load.mockResolvedValue(source);
    await expect(loadQualificationReport(context, filters)).rejects.toMatchObject({ httpStatus: 503 });
  });
});
