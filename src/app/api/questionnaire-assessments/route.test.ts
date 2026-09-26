import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ getTenantContext: vi.fn(), readJsonObject: vi.fn(), createServerSupabaseClient: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth/context", () => ({ getTenantContext: stubs.getTenantContext }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.createServerSupabaseClient }));
vi.mock("@/lib/integrations/http", () => ({
  readJsonObject: stubs.readJsonObject,
  databaseFailure: (code: string, message: string, httpStatus = 500) => Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    try { return await operation("10000000-0000-4000-8000-000000000099"); }
    catch (error) {
      const value = error as { code?: string; message?: string; httpStatus?: number };
      return Response.json({ data: null, errors: [{ code: value.code, message: value.message }] }, { status: value.httpStatus ?? 500 });
    }
  },
}));

import { QUESTIONNAIRE_FORMS } from "@/lib/questionnaire-assessments/forms";
import { GET, POST } from "./route";

const organizationId = "10000000-0000-4000-8000-000000000001";
const branchId = "20000000-0000-4000-8000-000000000001";
const clientId = "3000000a-0000-4000-8000-000000000001";
const assessmentKey = "4000000b-0000-4000-8000-000000000001";
const versionId = "5000000c-0000-4000-8000-000000000001";
const operationId = "6000000d-0000-4000-8000-000000000001";
const actor = { organizationId, branchId, userId: versionId, demo: false, assuranceLevel: "aal1", scopes: ["clients.read", "questionnaire_cognition.read", "questionnaire_cognition.manage"] };
const form = QUESTIONNAIRE_FORMS.spmsq;
const body = { action: "create", clientId, formKey: form.key, formVersion: form.version, assessedOn: "2026-09-25",
  answers: Object.fromEntries(form.questions.map(({ id }) => [id, { state: "missing" }])), context: {} };
const receipt = { action: "create", clientId, formKey: form.key, assessmentKey, versionId, version: 1, recordState: "draft",
  assessedOn: "2026-09-25", contentHash: "a".repeat(64), committedAt: "2026-09-25T01:00:00Z", replayed: false };
const draft = { assessmentKey, versionId, version: 1, formVersion: form.version, assessedOn: "2026-09-25", answers: body.answers,
  context: {}, recordState: "draft", authorDisplayName: "護理員", createdAt: "2026-09-25T01:00:00Z", contentHash: "a".repeat(64) };
const page = { formKey: "spmsq", clientId, assessments: [{ ...draft, assessmentCreatedAt: draft.createdAt }], total: 1, nextCursor: null };
const history = { formKey: "spmsq", clientId, assessmentKey, versions: [draft], total: 1, nextBeforeVersion: null };
const get = (query: string) => GET(new Request(`https://example.invalid/api/questionnaire-assessments?form_key=spmsq&${query}`));
const post = (key = operationId) => POST(new Request("https://example.invalid/api/questionnaire-assessments?form_key=spmsq", { method: "POST", headers: { "Idempotency-Key": key }, body: "{}" }));

describe("questionnaire draft and history API", () => {
  beforeEach(() => {
    vi.clearAllMocks(); stubs.getTenantContext.mockResolvedValue(actor);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.readJsonObject.mockResolvedValue(body); stubs.rpc.mockResolvedValue({ data: receipt, error: null });
  });
  it.each([[null, 401, "AUTH_REQUIRED"], [{ ...actor, branchId: null }, 409, "BRANCH_CONTEXT_REQUIRED"],
    [{ ...actor, demo: true }, 403, "DEMO_READ_ONLY"], [{ ...actor, scopes: ["clients.read"] }, 403, "QUESTIONNAIRE_NOT_AUTHORIZED"],
    [{ ...actor, scopes: ["questionnaire_cognition.read", "questionnaire_cognition.manage"] }, 403, "QUESTIONNAIRE_NOT_AUTHORIZED"],
    [{ ...actor, scopes: ["clients.read", "questionnaire_cognition.read"] }, 403, "QUESTIONNAIRE_NOT_AUTHORIZED"]])(
    "rejects an unauthorized actor before reading draft contents", async (denied, status, code) => {
      stubs.getTenantContext.mockResolvedValue(denied);
      const response = await post(); expect(response.status).toBe(status);
      expect((await response.json()).errors[0].code).toBe(code);
      expect(stubs.readJsonObject).not.toHaveBeenCalled(); expect(stubs.rpc).not.toHaveBeenCalled();
    });
  it("permits approved ordinary Google AAL1 staff to append an unsigned draft", async () => {
    const response = await post(); expect(response.status).toBe(201);
    expect(stubs.getTenantContext).toHaveBeenCalledWith("staff");
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_questionnaire_assessment", {
      p_expected_organization_id: organizationId, p_expected_branch_id: branchId, p_idempotency_key: operationId,
      p_payload: { action: "create", client_id: clientId, form_key: "spmsq", form_version: form.version, assessed_on: body.assessedOn, answers: body.answers, context: {} },
    });
    expect((await response.json()).data.recordState).toBe("draft");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("uses the specified draft version, not an arbitrary latest chain, for revision", async () => {
    stubs.readJsonObject.mockResolvedValue({ ...body, action: "revise", assessmentKey, previousVersionId: versionId, expectedVersion: 7 });
    stubs.rpc.mockResolvedValue({ data: { ...receipt, action: "revise", version: 8 }, error: null });
    expect((await post()).status).toBe(201);
    expect(stubs.rpc.mock.calls[0][1].p_payload).toMatchObject({ action: "revise", assessment_key: assessmentKey, previous_version_id: versionId, expected_version: 7 });
  });
  it("normalizes uppercase create IDs and retry key before committing and correlating the receipt", async () => {
    stubs.readJsonObject.mockResolvedValue({ ...body, clientId: clientId.toUpperCase() });
    expect((await post(operationId.toUpperCase())).status).toBe(201);
    expect(stubs.rpc.mock.calls[0][1]).toMatchObject({ p_idempotency_key: operationId, p_payload: { client_id: clientId } });
    stubs.rpc.mockResolvedValue({ data: { ...receipt, replayed: true }, error: null });
    const replay = await post(operationId.toUpperCase());
    expect(replay.status).toBe(201); expect((await replay.json()).data.replayed).toBe(true);
    expect(stubs.rpc.mock.calls[1][1]).toEqual(stubs.rpc.mock.calls[0][1]);
  });
  it("normalizes all uppercase revision IDs before receipt correlation", async () => {
    stubs.readJsonObject.mockResolvedValue({ ...body, action: "revise", clientId: clientId.toUpperCase(),
      assessmentKey: assessmentKey.toUpperCase(), previousVersionId: versionId.toUpperCase(), expectedVersion: 1 });
    stubs.rpc.mockResolvedValue({ data: { ...receipt, action: "revise", version: 2 }, error: null });
    expect((await post()).status).toBe(201);
    expect(stubs.rpc.mock.calls[0][1].p_payload).toMatchObject({ client_id: clientId, assessment_key: assessmentKey, previous_version_id: versionId });
  });
  it.each(["snapshot", "assessments", "versions"])("normalizes uppercase %s read IDs", async (mode) => {
    const snapshot = { formKey: "spmsq", generatedAt: draft.createdAt, matchingTotal: 1,
      clients: [{ clientId, displayName: "合成個案", serviceStatus: "active", latest: draft,
        assessments: page.assessments, assessmentTotal: 1, nextAssessmentCursor: null }] };
    stubs.rpc.mockResolvedValue({ data: mode === "snapshot" ? snapshot : mode === "assessments" ? page : history, error: null });
    expect((await get(`mode=${mode}&client_id=${clientId.toUpperCase()}${mode === "versions" ? `&assessment_key=${assessmentKey.toUpperCase()}` : ""}`)).status).toBe(200);
    expect(stubs.rpc.mock.calls[0][1].p_client_id).toBe(clientId);
    if (mode === "versions") expect(stubs.rpc.mock.calls[0][1].p_assessment_key).toBe(assessmentKey);
  });
  it("normalizes the uppercase assessment pagination cursor", async () => {
    stubs.rpc.mockResolvedValue({ data: page, error: null });
    expect((await get(`mode=assessments&client_id=${clientId.toUpperCase()}&before_created_at=${draft.createdAt}&before_assessment_key=${assessmentKey.toUpperCase()}`)).status).toBe(200);
    expect(stubs.rpc.mock.calls[0][1].p_before_assessment_key).toBe(assessmentKey);
  });
  it.each(["2026-02-30", "2026-02-29", "2024-04-31", "2026-13-01", "2026-00-01", "2026-09-00", "2026-9-25", "1999-12-31", "9999-01-01"])(
    "rejects invalid calendar or out-of-range assessment date %s before RPC", async (assessedOn) => {
      stubs.readJsonObject.mockResolvedValue({ ...body, assessedOn });
      const result = await post(); expect(result.status).toBe(400);
      expect((await result.json()).errors[0].code).toBe("QUESTIONNAIRE_INVALID");
      expect(stubs.rpc).not.toHaveBeenCalled();
    });
  it.each(["2000-02-29", "2024-02-29"])("accepts valid leap day %s", async (assessedOn) => {
    stubs.readJsonObject.mockResolvedValue({ ...body, assessedOn });
    stubs.rpc.mockResolvedValue({ data: { ...receipt, assessedOn }, error: null });
    expect((await post()).status).toBe(201);
    expect(stubs.rpc.mock.calls[0][1].p_payload.assessed_on).toBe(assessedOn);
  });
  it.each(["22007", "22008"])("maps database date rejection %s to a known input error, not an uncertain save", async (code) => {
    stubs.rpc.mockResolvedValue({ data: null, error: { code } });
    const result = await post(); expect(result.status).toBe(400);
    expect((await result.json()).errors[0]).toMatchObject({ code: "QUESTIONNAIRE_INVALID" });
  });
  it.each([{ ...body, action: "sign" }, { ...body, assessorUserId: versionId }, { ...body, organizationId }])("rejects signing and client-supplied authority", async (invalid) => {
    stubs.readJsonObject.mockResolvedValue(invalid); expect((await post()).status).toBe(400); expect(stubs.rpc).not.toHaveBeenCalled();
  });
  it("fails closed on a signed or mismatched mutation receipt", async () => {
    stubs.rpc.mockResolvedValue({ data: { ...receipt, recordState: "signed" }, error: null });
    expect((await post()).status).toBe(503);
    stubs.rpc.mockResolvedValue({ data: { ...receipt, clientId: branchId }, error: null });
    expect((await post()).status).toBe(503);
  });
  it("reads a bounded assessment page for AAL1 read-only staff using authoritative tenant values", async () => {
    stubs.getTenantContext.mockResolvedValue({ ...actor, scopes: ["clients.read", "questionnaire_cognition.read"] });
    stubs.rpc.mockResolvedValue({ data: page, error: null });
    const response = await get(`mode=assessments&client_id=${clientId}`); expect(response.status).toBe(200);
    expect(stubs.rpc).toHaveBeenCalledWith("questionnaire_assessment_list", { p_expected_organization_id: organizationId,
      p_expected_branch_id: branchId, p_form_key: "spmsq", p_client_id: clientId, p_before_created_at: null, p_before_assessment_key: null });
  });
  it("passes exact chain/version cursors to the bounded history RPC", async () => {
    stubs.rpc.mockResolvedValue({ data: history, error: null });
    expect((await get(`mode=versions&client_id=${clientId}&assessment_key=${assessmentKey}&before_version=21`)).status).toBe(200);
    expect(stubs.rpc.mock.calls[0][0]).toBe("questionnaire_assessment_history");
    expect(stubs.rpc.mock.calls[0][1]).toMatchObject({ p_assessment_key: assessmentKey, p_before_version: 21 });
  });
  it.each(["mode=versions", `mode=assessments&client_id=${clientId}&before_created_at=2026-09-25T01:00:00Z`,
    `mode=versions&client_id=${clientId}&assessment_key=${assessmentKey}&before_version=0`,
    `mode=assessments&client_id=${clientId}&client_id=${clientId}`, "form_key=gds_15", "mode=snapshot&assessment_key=bad", "mode=sign", "limit=100000"]) (
    "rejects malformed or unbounded read filters: %s", async (query) => {
      expect((await get(query)).status).toBe(400); expect(stubs.rpc).not.toHaveBeenCalled();
    });
  it("fails closed on out-of-scope history and assignment revocation", async () => {
    stubs.rpc.mockResolvedValue({ data: { ...history, clientId: branchId }, error: null });
    expect((await get(`mode=versions&client_id=${clientId}&assessment_key=${assessmentKey}`)).status).toBe(503);
    stubs.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect((await get(`mode=assessments&client_id=${clientId}`)).status).toBe(403);
  });
  it("blocks MNA BMI claims inconsistent with measured context", async () => {
    const mna = QUESTIONNAIRE_FORMS.mna_sf;
    stubs.getTenantContext.mockResolvedValue({ ...actor, scopes: ["clients.read", "questionnaire_nutrition.read", "questionnaire_nutrition.manage"] });
    stubs.readJsonObject.mockResolvedValue({ ...body, formKey: mna.key, formVersion: mna.version,
      answers: Object.fromEntries(mna.questions.map(({ id }) => [id, id === "anthropometry" ? { state: "answered", value: "bmi_gte_23" } : { state: "missing" }])),
      context: { height_cm: "160", weight_kg: "48" } });
    const response = await POST(new Request("https://example.invalid/api/questionnaire-assessments?form_key=mna_sf", { method: "POST", headers: { "Idempotency-Key": operationId }, body: "{}" }));
    expect(response.status).toBe(400); expect(stubs.rpc).not.toHaveBeenCalled();
  });
});
