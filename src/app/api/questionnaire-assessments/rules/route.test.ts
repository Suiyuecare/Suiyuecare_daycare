import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), read: vi.fn(), client: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/integrations/http", () => ({ authorizeStaffRequest: mocks.authorize, readJsonObject: mocks.read,
  databaseFailure: (code: string, message: string, httpStatus = 500) => Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (id: string) => Promise<Response>) => {
    try { return await operation("11111111-1111-4111-8111-111111111111"); } catch (error) {
      const failure = error as { code: string; httpStatus: number }; return Response.json({ code: failure.code }, { status: failure.httpStatus ?? 500 });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
import { POST } from "./route";
const actor = { organizationId: "22222222-2222-4222-8222-222222222222", branchId: "33333333-3333-4333-8333-333333333333", scopes: ["forms.manage"], demo: false, assuranceLevel: "aal2" };
const input = { action: "request", formKey: "spmsq", formVersion: "spmsq-pfeiffer-10-education-adjusted-v1", effectiveFrom: "2026-10-10", evidenceReference: "合成實際審查文件" };
function request() { return new Request("https://example.invalid/api/questionnaire-assessments/rules", { method: "POST", headers: { "idempotency-key": "44444444-4444-4444-8444-444444444444" } }); }
beforeEach(() => { vi.clearAllMocks(); mocks.authorize.mockResolvedValue(actor); mocks.read.mockResolvedValue(input); mocks.client.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: { publicationId: "55555555-5555-4555-8555-555555555555", status: "pending", replayed: false }, error: null }); });
describe("rule publication authorization and evidence", () => {
  it.each([{ scopes: [] }, { demo: true }, { assuranceLevel: "aal1" }])("denies unauthorized/demonstration/non-reverified publication", async (override) => {
    mocks.authorize.mockResolvedValue({ ...actor, ...override }); expect((await POST(request())).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("binds request to real caller scope and exact reviewed catalogue", async () => {
    expect((await POST(request())).status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("publish_questionnaire_rule", expect.objectContaining({
      p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId,
      p_payload: { action: "request", form_key: input.formKey, form_version: input.formVersion, effective_from: input.effectiveFrom, evidence_reference: input.evidenceReference },
    }));
  });
  it.each([{ evidenceReference: "" }, { formVersion: "fake" }, { effectiveFrom: "2026-02-30" }, { effectiveTo: "2026-01-01" }, { approvedBy: "forged" }])("rejects missing evidence, unknown formula, malformed periods and manufactured approvers", async (override) => {
    mocks.read.mockResolvedValue({ ...input, ...override }); expect((await POST(request())).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("maps database overlap and independence checks without disclosing internals", async () => {
    mocks.read.mockResolvedValue({ action: "approve", publicationId: "55555555-5555-4555-8555-555555555555" });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "sensitive" } }); expect((await POST(request())).status).toBe(403);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "23P01" } }); expect((await POST(request())).status).toBe(409);
  });
  it.each([{ publicationId: "55555555-5555-4555-8555-555555555555", status: "pending", replayed: false },
    { publicationId: "66666666-6666-4666-8666-666666666666", status: "approved", replayed: false }])("requires an approval receipt for the requested publication", async (data) => {
    mocks.read.mockResolvedValue({ action: "approve", publicationId: "55555555-5555-4555-8555-555555555555" });
    mocks.rpc.mockResolvedValue({ data, error: null });
    const response = await POST(request()); expect(response.status).toBe(500);
    expect((await response.json()).code).toBe("RULE_WRITE_UNKNOWN");
  });
});
