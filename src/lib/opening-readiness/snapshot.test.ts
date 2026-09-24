import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { buildDemoOpeningReadinessSources } from "./demo";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ institution: vi.fn(), staff: vi.fn(), clients: vi.fn(), roster: vi.fn() }));
vi.mock("@/lib/organization-profile/snapshot", () => ({ loadOrganizationProfileSnapshot: mocks.institution }));
vi.mock("@/lib/staff-management/snapshot", () => ({ loadStaffManagementSnapshot: mocks.staff }));
vi.mock("@/lib/clients/master-snapshot", () => ({ loadClientMasterSnapshot: mocks.clients }));
vi.mock("@/lib/care-roster/snapshot", () => ({ loadCareRosterSnapshot: mocks.roster }));
import { loadOpeningReadinessSnapshot } from "./snapshot";
const date = "2026-09-13";
const actor: TenantContext = { organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222",
  userId: "33333333-3333-4333-8333-333333333333", organizationName: "合成機構", branchName: "合成分支", displayName: "合成主管",
  roles: ["branch_supervisor"], scopes: [], assuranceLevel: "aal1", recentAal2At: null, demo: false };

describe("opening readiness trusted loader composition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const sources = buildDemoOpeningReadinessSources({ ...actor, demo: true }, date);
    for (const [key, value] of Object.entries(sources)) if (value.status === "available") mocks[key as keyof typeof mocks].mockResolvedValue({ ...value.data, demo: false });
  });
  it("uses each authorized loader with unchanged context, filters and date", async () => {
    const result = await loadOpeningReadinessSnapshot(actor, date);
    expect(result.status).not.toBe("forbidden");
    expect(mocks.institution).toHaveBeenCalledWith(actor, { status: "all", effectiveOn: date, query: "" });
    expect(mocks.staff).toHaveBeenCalledWith(actor, { status: "all", roleId: null, qualification: "all", query: "" });
    expect(mocks.clients).toHaveBeenCalledWith(actor);
    expect(mocks.roster).toHaveBeenCalledWith(actor, date);
    expect(actor.assuranceLevel).toBe("aal1");
  });
  it("rejects ordinary employees before fetching any counts", async () => {
    expect(await loadOpeningReadinessSnapshot({ ...actor, roles: ["care_worker"] }, date)).toEqual({ status: "forbidden" });
    Object.values(mocks).forEach((mock) => expect(mock).not.toHaveBeenCalled());
  });
  it("contains query errors without leaking their messages or hiding successful independent checks", async () => {
    mocks.staff.mockRejectedValue(new Error("secret database detail"));
    const result = await loadOpeningReadinessSnapshot(actor, date);
    if (result.status === "forbidden") throw new Error("unexpected forbidden");
    expect(result.items.find((item) => item.id === "staff")?.status).toBe("unavailable");
    expect(result.items.find((item) => item.id === "institution")?.status).toBe("ready");
    expect(JSON.stringify(result)).not.toContain("secret database detail");
  });
  it("does not call production loaders in explicitly labeled synthetic preview", async () => {
    const result = await loadOpeningReadinessSnapshot({ ...actor, demo: true }, date);
    expect(result.status !== "forbidden" && result.demo).toBe(true);
    Object.values(mocks).forEach((mock) => expect(mock).not.toHaveBeenCalled());
  });
  it("invalid requested date never triggers source reads", async () => {
    await expect(loadOpeningReadinessSnapshot(actor, "2026-02-30")).rejects.toThrow("INVALID_SERVICE_DATE");
    Object.values(mocks).forEach((mock) => expect(mock).not.toHaveBeenCalled());
  });
});
