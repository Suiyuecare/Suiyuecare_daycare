import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { buildDemoStaffCertificateSnapshot } from "@/lib/staff-certificates/demo";
const mock = vi.hoisted(() => ({ context: vi.fn(), source: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: mock.context, hasRecentAal2: vi.fn() }));
vi.mock("@/lib/env", () => ({ isDemoMode: () => false, hasSupabaseConfiguration: () => true, hasSupabaseAdminConfiguration: () => false }));
vi.mock("@/lib/staff-certificates/snapshot", () => ({ loadStaffCertificateSnapshot: mock.source }));
import { GET } from "./route";
const actor: TenantContext = { organizationId: "72000000-0000-4000-8000-000000000001", branchId: "72000000-0000-4000-8000-000000000002", organizationName: "合成機構", branchName: "合成分支", userId: "72000000-0000-4000-8000-000000000003", displayName: "主管", roles: ["branch_supervisor"], scopes: ["staff_certificates.read"], assuranceLevel: "aal2", recentAal2At: null, demo: false };
function request(query = "") { return new Request(`https://example.invalid/api/staff-qualification-readiness${query}`); }
describe("qualification report GET boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); mock.context.mockResolvedValue(actor);
    mock.source.mockResolvedValue(buildDemoStaffCertificateSnapshot({ organizationId: actor.organizationId, branchId: actor.branchId, filters: { staffMembershipId: null, certificateType: null, status: "all", query: "" } })); });
  it("denies anonymous access before any staff read", async () => {
    mock.context.mockResolvedValue(null); const response = await GET(request());
    expect(response.status).toBe(401); expect(mock.source).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it.each([{ scopes: [] }, { scopes: ["staff_health.read"] }, { assuranceLevel: "aal1" }])("denies insufficient permission or assurance %#", async (patch) => {
    mock.context.mockResolvedValue({ ...actor, ...patch });
    expect((await GET(request())).status).toBe(403); expect(mock.source).not.toHaveBeenCalled();
  });
  it.each(["?branch_id=other", "?organization_id=other", "?issue=all&issue=expired", "?staff=invalid"]) ("rejects untrusted filters %s", async (query) => {
    expect((await GET(request(query))).status).toBe(400); expect(mock.source).not.toHaveBeenCalled();
  });
  it("returns a minimized no-store envelope using server tenant scope", async () => {
    const response = await GET(request("?issue=expired"));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("private, no-store");
    const body = await response.json(); expect(body.requestId).toBeTruthy();
    expect(body.data.branchId).toBe(actor.branchId); expect(body.data.serviceEligibility).toBe("not_evaluated");
    expect(JSON.stringify(body)).not.toMatch(/certificateNumber|contentHash|SYNTH-/);
  });
  it("does not expose a denied cross-branch target or database detail", async () => {
    mock.source.mockRejectedValue(new Error("sensitive target details"));
    const response = await GET(request("?staff=72040000-0000-4000-8000-000000000099"));
    expect(response.status).toBe(503); const body = await response.text();
    expect(body).not.toContain("sensitive target"); expect(body).not.toContain("72040000");
  });
});
