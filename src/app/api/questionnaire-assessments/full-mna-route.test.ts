import { beforeEach, describe, expect, it, vi } from "vitest";
import { FULL_MNA_VERSION } from "@/lib/assessments/full-mna";
import { QUESTIONNAIRE_FORMS } from "@/lib/questionnaire-assessments/forms";

const stubs = vi.hoisted(() => ({ authorize: vi.fn(), read: vi.fn(), client: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorize, readJsonObject: stubs.read,
  databaseFailure: (code: string, message: string, httpStatus = 500) => Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (work: (id: string) => Promise<Response>) => {
    try { return await work("12100000-0000-4000-8000-000000000099"); }
    catch (error) { const e = error as { code?: string; httpStatus?: number };
      return Response.json({ data: null, errors: [{ code: e.code }] }, { status: e.httpStatus ?? 500 }); }
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.client }));
import { POST } from "./route";
const id = "12100000-0000-4000-8000-000000000091";
const actor = { organizationId: id, branchId: id, userId: id, demo: false, assuranceLevel: "aal1",
  scopes: ["clients.read", "questionnaire_nutrition.read", "questionnaire_nutrition.manage"] };
function input() {
  return { action: "create", clientId: id, formKey: "full_mna", formVersion: FULL_MNA_VERSION, assessedOn: "2026-10-08",
    answers: Object.fromEntries(QUESTIONNAIRE_FORMS.full_mna.questions.map((q) => [q.id, { state: "answered", value: q.choices[0]!.value }])),
    context: { height_cm: "160", weight_kg: "40", arm_circumference_cm: "20", calf_circumference_cm: "30",
      protein_dairy: "no", protein_legumes_eggs: "no", protein_meat_fish_poultry: "no" } as Record<string, string> };
}
const request = () => new Request("https://example.invalid/api/questionnaire-assessments?form_key=full_mna", {
  method: "POST", headers: { "Idempotency-Key": id }, body: "{}",
});
describe("independent full MNA API candidate", () => {
  beforeEach(() => {
    vi.resetAllMocks(); stubs.authorize.mockResolvedValue(actor); stubs.client.mockResolvedValue({ rpc: stubs.rpc });
    stubs.read.mockResolvedValue(input());
    stubs.rpc.mockImplementation(async (_name, { p_payload: payload }) => ({ data: {
      action: payload.action, clientId: payload.client_id, formKey: payload.form_key, assessmentKey: id,
      versionId: "12100000-0000-4000-8000-000000000092", version: 1, recordState: "draft", assessedOn: payload.assessed_on,
      contentHash: "a".repeat(64), committedAt: "2026-10-12T01:00:00Z", replayed: false,
    }, error: null }));
  });
  it("preserves the full18 form, measured data, three K inputs and operation binding", async () => {
    const response = await POST(request()); expect(response.status).toBe(201);
    expect((await response.json()).data).toMatchObject({ formKey: "full_mna", recordState: "draft" });
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_questionnaire_assessment", {
      p_expected_organization_id: id, p_expected_branch_id: id, p_idempotency_key: id,
      p_payload: expect.objectContaining({ form_key: "full_mna", form_version: FULL_MNA_VERSION, answers: input().answers, context: input().context }),
    });
  });
  it.each([
    ["height_cm", ""], ["weight_kg", "NaN"], ["arm_circumference_cm", "21"],
    ["calf_circumference_cm", "31"], ["protein_dairy", "yes"], ["protein_legumes_eggs", ""],
  ])("rejects inconsistent required input %s without a DB mutation", async (field, value) => {
    const body = input(); body.context[field] = value;
    // One yes still corresponds to the first K choice; make the actual mismatch two yes.
    if (field === "protein_dairy") body.context.protein_legumes_eggs = "yes";
    stubs.read.mockResolvedValue(body);
    expect((await POST(request())).status).toBe(400); expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("rejects SF calf replacement and unversioned full answers", async () => {
    const body = input(); body.answers.anthropometry.value = "calf_lt_31";
    stubs.read.mockResolvedValue(body); expect((await POST(request())).status).toBe(400);
    stubs.read.mockResolvedValue({ ...input(), formVersion: QUESTIONNAIRE_FORMS.mna_sf.version });
    expect((await POST(request())).status).toBe(400); expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("permits missing-answer drafts and keeps source data separate from caller scores", async () => {
    const body = { ...input(), context: {}, answers: Object.fromEntries(QUESTIONNAIRE_FORMS.full_mna.questions.map((q) => [q.id, { state: "missing" }])) };
    stubs.read.mockResolvedValue(body); expect((await POST(request())).status).toBe(201);
    stubs.rpc.mockClear(); stubs.read.mockResolvedValue({ ...body, score: 30 });
    expect((await POST(request())).status).toBe(400); expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("requires the existing nutrition sign scope and AAL2 instead of authorizing full by key alone", async () => {
    stubs.read.mockResolvedValue({ action: "sign", clientId: id, formKey: "full_mna", assessmentKey: id,
      previousVersionId: id, expectedVersion: 1 });
    expect((await POST(request())).status).toBe(403); expect(stubs.rpc).not.toHaveBeenCalled();
    stubs.authorize.mockResolvedValue({ ...actor, scopes: [...actor.scopes, "questionnaire_nutrition.sign"] });
    expect((await POST(request())).status).toBe(403); expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("fails closed on a success receipt from the SF form", async () => {
    stubs.rpc.mockResolvedValue({ data: { action: "create", clientId: id, formKey: "mna_sf", assessmentKey: id,
      versionId: "12100000-0000-4000-8000-000000000092", version: 1, recordState: "draft", assessedOn: "2026-10-08",
      contentHash: "a".repeat(64), committedAt: "2026-10-12T01:00:00Z", replayed: false }, error: null });
    expect((await POST(request())).status).toBe(500);
  });
});
