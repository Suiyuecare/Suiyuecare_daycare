import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getTenantContext: vi.fn(), rpc: vi.fn(), requireRecentAal2: vi.fn() }));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: mocks.getTenantContext }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/integrations/http", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/integrations/http")>(), requireRecentAal2: mocks.requireRecentAal2,
}));
import { GET, POST } from "./route";
import { loadJuboAdmissionPreparation } from "@/lib/jubo-admission-preparation/server";
import type { TenantContext } from "@/lib/domain/types";

const id = "dcb10000-0000-4000-8000-000000000001";
const actor = { organizationId: "dcb20000-0000-4000-8000-000000000001", branchId: "dcb30000-0000-4000-8000-000000000001",
  userId: "dcb40000-0000-4000-8000-000000000001", roles: ["branch_director"], scopes: ["clients.read", "clients.demographics.read", "clients.manage"],
  assuranceLevel: "aal2", demo: false } as TenantContext;
const input = { action: "propose", clientId: id, clientRowVersion: 1, admittedOn: "2026-10-11", eligibilityFrom: "2026-10-01",
  eligibilityTo: "2026-10-31", eligibilityReference: "SYNTHETIC-ELIGIBILITY", eligibilitySha256: "a".repeat(64),
  agreementReference: "SYNTHETIC-AGREEMENT", agreementSha256: "b".repeat(64), reason: "合成收案日期及資格契約均已核對" };
const snapshot = { clientId: id, clientRowVersion: 1, intakeVersion: 1, sourceKind: "operator_master", sourceStatus: "服務中",
  canSubmit: true, admissionEnabled: false, sourceVerified: false, proposals: [] };
const receipt = { proposalId: id, proposalSha256: "c".repeat(64), version: 1, status: "awaiting_second_review",
  sourceVerified: false, admissionEnabled: false, replayed: false };
function request(body: unknown = input, key: string | null = id) {
  return new Request("https://example.invalid/api/jubo-admission-preparation", { method: "POST",
    headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) }, body: JSON.stringify(body) });
}
describe("JUBO preparation HTTP/loader boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.getTenantContext.mockResolvedValue(actor);
    mocks.requireRecentAal2.mockResolvedValue(undefined); mocks.rpc.mockResolvedValue({ data: receipt, error: null }); });
  it("binds submitted source preparation to server tenant, branch and operation key", async () => {
    const response = await POST(request()); expect(response.status).toBe(200);
    expect(mocks.requireRecentAal2).toHaveBeenCalledWith(actor);
    expect(mocks.rpc).toHaveBeenCalledWith("propose_jubo_pending_admission", expect.objectContaining({
      p_org: actor.organizationId, p_branch: actor.branchId, p_client: id, p_idempotency_key: id, p_expected_client_row_version: 1,
    }));
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await response.json()).data.admissionEnabled).toBe(false);
  });
  it.each([null, "invalid"])("rejects missing/malformed idempotency key %s", async key => {
    expect((await POST(request(input, key))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not accept caller-controlled branch, evidence verification or formal activation", async () => {
    expect((await POST(request({ ...input, branchId: id, sourceVerified: true }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ demo: true }, { roles: ["care_worker"] }, { scopes: ["clients.read"] }])("refuses context without management authority %j", async patch => {
    mocks.getTenantContext.mockResolvedValue({ ...actor, ...patch });
    expect((await POST(request())).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires actual recent verification, not merely an AAL2 label", async () => {
    const { IntegrationError } = await import("@/lib/integrations/errors");
    mocks.requireRecentAal2.mockRejectedValue(new IntegrationError("AAL2_REQUIRED", "請重新驗證", 403));
    expect((await POST(request())).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("keeps failed independent review a denial without SQL diagnostics", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "private diagnostic forbidden" } });
    const response = await POST(request({ action: "review", clientId: id, proposalId: id, expectedSha256: "c".repeat(64),
      decision: "approved", reason: "合成獨立主任核對資格及契約" }));
    expect(response.status).toBe(403); expect(JSON.stringify(await response.json())).not.toContain("private diagnostic");
  });
  it("maps replay/conflict to explicit conflict rather than fake success", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "23505" } });
    expect((await POST(request())).status).toBe(409);
  });
  it("holds an untrusted activation receipt as unknown", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...receipt, admissionEnabled: true }, error: null });
    expect((await POST(request())).status).toBe(503);
  });
  it("rejects a review receipt for a propose operation", async () => {
    mocks.rpc.mockResolvedValue({ data: { reviewId: id, decision: "approved", status: "source_verification_required", admissionEnabled: false, replayed: false }, error: null });
    expect((await POST(request())).status).toBe(503);
  });
  it.each([receipt, { reviewId: id, decision: "held", status: "source_verification_required", admissionEnabled: false, replayed: false }])("rejects a proposal or mismatched-decision receipt for a review operation", async data => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    expect((await POST(request({ action: "review", clientId: id, proposalId: id, expectedSha256: "c".repeat(64),
      decision: "approved", reason: "合成獨立主任核對資格及契約" }))).status).toBe(503);
  });
  it("returns only this selected pending client, not another otherwise valid snapshot", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...snapshot, clientId: actor.userId }, error: null });
    await expect(loadJuboAdmissionPreparation(actor, id)).rejects.toMatchObject({ code: "ADMISSION_PREPARATION_UNKNOWN" });
  });
  it("renders no panel for an unrelated/unbound client denial, without substituting data", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect(await loadJuboAdmissionPreparation(actor, id)).toBeNull();
  });
  it("provides a no-store scoped GET with no extra ambiguous client filters", async () => {
    mocks.rpc.mockResolvedValue({ data: snapshot, error: null });
    expect((await GET(new Request(`https://example.invalid/api/jubo-admission-preparation?client=${id}`))).status).toBe(200);
    mocks.rpc.mockClear();
    expect((await GET(new Request(`https://example.invalid/api/jubo-admission-preparation?client=${id}&client=${actor.userId}`))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
