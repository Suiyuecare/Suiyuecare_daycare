import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ authorizeStaffRequest: vi.fn(), readJsonObject: vi.fn(),
  requireRecentAal2: vi.fn(), createServerSupabaseClient: vi.fn(), rpc: vi.fn(), maybeSingle: vi.fn(),
  getTenantContext: vi.fn(), authorizeRoutineIntake: vi.fn() }));

vi.mock("@/lib/auth/context", () => ({ getTenantContext: stubs.getTenantContext }));
vi.mock("@/lib/auth/routine-intake", () => ({ authorizeRoutineIntake: stubs.authorizeRoutineIntake }));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest, readJsonObject: stubs.readJsonObject,
  requireRecentAal2: stubs.requireRecentAal2,
  databaseFailure: (code: string, message: string, httpStatus = 500) => Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "21aa0000-0000-4000-8000-000000000001";
    try { return await operation(requestId); } catch (error) {
      const value = error as { code?: string; message?: string; httpStatus?: number };
      return Response.json({ requestId, status: "error", data: null,
        errors: [{ code: value.code ?? "ERROR", message: value.message ?? "error" }] },
      { status: value.httpStatus ?? 500 });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.createServerSupabaseClient }));

import { POST } from "./route";

const organizationId = "21110000-0000-4000-8000-000000000001";
const branchId = "21120000-0000-4000-8000-000000000001";
const userId = "21130000-0000-4000-8000-000000000001";
const clientId = "21140000-0000-4000-8000-000000000001";
const key = "21150000-0000-4000-8000-000000000001";
const reservationId = "21150000-0000-4000-8000-000000000020";
const assessmentKey = "21160000-0000-4000-8000-000000000001";
const versionId = "21170000-0000-4000-8000-000000000001";
const hash = "a".repeat(64);
const actor = { organizationId, organizationName: "合成機構", branchId, branchName: "合成分支",
  userId, displayName: "合成評估員", roles: ["professional"], scopes: ["clients.read",
    "abcd_assessments.read", "abcd_assessments.manage"], assuranceLevel: "aal2",
  recentAal2At: null, demo: false };
const body = { action: "save_assessment", mode: "create", assessment_key: null,
  previous_version_id: null, expected_version: 0, expected_content_hash: null,
  client_id: clientId, assessment_type: "A", assessment_year: 2026,
  assessment_date: "2026-09-01", manual_summary: "人工非標準化候選摘要",
  result: { state: "recorded", text: "人工候選結果", reason: null },
  reassessment: { state: "recorded", date: "2026-12-01", basis: "人工指定複評依據" },
  revision_reason: "建立候選初稿" };
const receipt = { organization_id: organizationId, branch_id: branchId, client_id: clientId,
  operation_id: userId, idempotency_key: key,
  action: "save_assessment", assessment_key: assessmentKey,
  version_id: versionId, version: 1, assessment_state: "draft", assessment_type: "A",
  assessment_year: 2026, previous_version_id: null, source_content_hash: null,
  content_hash: hash, record_payload: { client_id: clientId, assessment_type: "A",
    assessment_year: 2026, assessment_date: "2026-09-01",
    manual_summary: "人工非標準化候選摘要",
    result: { state: "recorded", text: "人工候選結果", reason: null },
    reassessment: { state: "recorded", date: "2026-12-01", basis: "人工指定複評依據" },
    form_kind: "manual_unstandardized", formal_rule_status: "not_configured" },
  committed_at: "2026-09-07T01:01:00Z", replayed: false };

function request(operation?: string) {
  return new Request("https://example.invalid/api/abcd-assessments", { method: "POST", body: "{}",
    headers: { "content-type": "application/json", "idempotency-key": key,
      ...(operation ? { "x-abcd-assessment-operation": operation } : {}) } });
}

describe("Page 21 ABCD assessment API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks(); stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.getTenantContext.mockResolvedValue(actor);
    stubs.authorizeRoutineIntake.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined); stubs.readJsonObject.mockResolvedValue(body);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockImplementation((name: string) => name === "reserve_abcd_assessment_operation" ?
      Promise.resolve({ data: reservationId, error: null }) : { maybeSingle: stubs.maybeSingle });
    stubs.maybeSingle.mockResolvedValue({ data: receipt, error: null });
  });

  it("requires governed operation before authority or sensitive body parsing", async () => {
    const response = await POST(request()); expect(response.status).toBe(400);
    expect(stubs.authorizeStaffRequest).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it.each([[{ ...actor, demo: true }, "DEMO_READ_ONLY"],
    [{ ...actor, scopes: ["clients.read", "abcd_assessments.read"] }, "ABCD_ASSESSMENT_NOT_AUTHORIZED"]])
  ("rejects denied writes before reading manual content", async (denied, code) => {
    stubs.authorizeStaffRequest.mockResolvedValue(denied);
    const response = await POST(request("create")); expect(response.status).toBe(403);
    expect((await response.json()).errors[0].code).toBe(code);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it.each(["sign", "correct"])("requires recent same-session AAL2 before parsing %s", async (operation) => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("reauth"),
      { code: "AAL2_REQUIRED", httpStatus: 403 }));
    const response = await POST(request(operation)); expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("binds tenant branch explicit identity and idempotency without invented fields", async () => {
    const response = await POST(request("create")); expect(response.status).toBe(201);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.rpc).toHaveBeenNthCalledWith(1, "reserve_abcd_assessment_operation", {
      p_expected_organization_id: organizationId, p_expected_branch_id: branchId,
      p_operation: "create", p_action: "save_assessment",
      p_payload: expect.objectContaining({ client_id: clientId }), p_idempotency_key: key,
    });
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_abcd_assessment", {
      p_expected_organization_id: organizationId, p_expected_branch_id: branchId,
      p_action: "save_assessment", p_payload: expect.objectContaining({ client_id: clientId,
        assessment_type: "A", assessment_year: 2026,
        result: { state: "recorded", text: "人工候選結果", reason: null } }),
      p_idempotency_key: key,
    });
    const sent = stubs.rpc.mock.calls[1]?.[1].p_payload;
    expect(sent).not.toHaveProperty("score"); expect(sent).not.toHaveProperty("diagnosis");
    expect((await response.json()).data).toMatchObject({ assessmentKey, reservationId,
      persisted: true, demo: false });
  });

  it("admits an approved Google AAL1 draft only through exact-client ABCD intake", async () => {
    const routineActor = { ...actor, assuranceLevel: "aal1" };
    stubs.getTenantContext.mockResolvedValue(routineActor);
    stubs.authorizeRoutineIntake.mockResolvedValue(routineActor);
    const response = await POST(request("create"));
    expect(response.status).toBe(201);
    expect(stubs.authorizeStaffRequest).not.toHaveBeenCalled();
    expect(stubs.authorizeRoutineIntake).toHaveBeenCalledExactlyOnceWith("abcd.save", clientId);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
  });

  it("denies unapproved or changed AAL1 intake identity before any database mutation", async () => {
    stubs.getTenantContext.mockResolvedValue({ ...actor, assuranceLevel: "aal1" });
    stubs.authorizeRoutineIntake.mockRejectedValueOnce(Object.assign(new Error("not approved"),
      { code: "INTAKE_NOT_AUTHORIZED", httpStatus: 403 }));
    const denied = await POST(request("create"));
    expect(denied.status).toBe(403);
    expect(stubs.rpc).not.toHaveBeenCalled();
    stubs.authorizeRoutineIntake.mockResolvedValueOnce({ ...actor, assuranceLevel: "aal1",
      userId: "21130000-0000-4000-8000-000000000099" });
    const changed = await POST(request("create"));
    expect(changed.status).toBe(403);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("keeps AAL1 sign behind recent AAL2 before reading the body", async () => {
    stubs.getTenantContext.mockResolvedValue({ ...actor, assuranceLevel: "aal1" });
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("reauth"),
      { code: "AAL2_REQUIRED", httpStatus: 403 }));
    const response = await POST(request("sign"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.authorizeRoutineIntake).not.toHaveBeenCalled();
  });

  it("does not mutate if reservation fails or its receipt is malformed", async () => {
    stubs.rpc.mockImplementation((name: string) => name === "reserve_abcd_assessment_operation" ?
      Promise.resolve({ data: null, error: { code: "42501" } }) : { maybeSingle: stubs.maybeSingle });
    const denied = await POST(request("create")); expect(denied.status).toBe(403);
    expect(stubs.rpc).toHaveBeenCalledTimes(1);
    stubs.rpc.mockClear();
    stubs.rpc.mockImplementation((name: string) => name === "reserve_abcd_assessment_operation" ?
      Promise.resolve({ data: "bad", error: null }) : { maybeSingle: stubs.maybeSingle });
    const malformed = await POST(request("create")); expect(malformed.status).toBe(409);
    expect(stubs.rpc).toHaveBeenCalledTimes(1);
  });

  it("rejects header and body disagreement without touching the database", async () => {
    const response = await POST(request("revise")); expect(response.status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("correlates signed replay receipt with frozen type and year", async () => {
    stubs.readJsonObject.mockResolvedValue({ action: "sign_assessment", client_id: clientId,
      assessment_key: assessmentKey, assessment_type: "A", assessment_year: 2026,
      previous_version_id: versionId, expected_version: 1, expected_content_hash: hash });
    stubs.maybeSingle.mockResolvedValue({ data: { ...receipt, action: "sign_assessment",
      version_id: "21170000-0000-4000-8000-000000000002", version: 2,
      assessment_state: "signed", previous_version_id: versionId,
      source_content_hash: hash, replayed: true }, error: null });
    const response = await POST(request("sign")); expect(response.status).toBe(200);
    expect(stubs.requireRecentAal2).toHaveBeenCalledWith(actor);
    expect((await response.json()).data).toMatchObject({ assessmentType: "A", assessmentYear: 2026,
      assessmentState: "signed", replayed: true });
  });

  it("rejects a signed receipt without the exact prior content binding", async () => {
    stubs.readJsonObject.mockResolvedValue({ action: "sign_assessment", client_id: clientId,
      assessment_key: assessmentKey, assessment_type: "A", assessment_year: 2026,
      previous_version_id: versionId, expected_version: 1, expected_content_hash: hash });
    stubs.maybeSingle.mockResolvedValue({ data: { ...receipt, action: "sign_assessment",
      version_id: "21170000-0000-4000-8000-000000000002", version: 2,
      assessment_state: "signed", previous_version_id: versionId,
      source_content_hash: "b".repeat(64) }, error: null });
    const response = await POST(request("sign")); expect(response.status).toBe(409);
    expect((await response.json()).errors[0].code).toBe("ABCD_ASSESSMENT_RESULT_UNCERTAIN");
  });

  it("fails closed on a mismatched receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: { ...receipt, assessment_type: "B" }, error: null });
    const response = await POST(request("create")); expect(response.status).toBe(409);
    expect((await response.json()).errors[0].code).toBe("ABCD_ASSESSMENT_RESULT_UNCERTAIN");
  });

  it.each([
    { organization_id: userId },
    { branch_id: userId },
    { client_id: userId },
    { record_payload: { ...receipt.record_payload, manual_summary: "遭置換的摘要" } },
  ])("rejects a receipt detached from the authorized context or canonical content", async (forgery) => {
    stubs.maybeSingle.mockResolvedValue({ data: { ...receipt, ...forgery }, error: null });
    const response = await POST(request("create")); expect(response.status).toBe(409);
    expect((await response.json()).errors[0].code).toBe("ABCD_ASSESSMENT_RESULT_UNCERTAIN");
  });

  it.each(["42501", "40001", "23505", "23514", "22023", "XX000"])
  ("keeps the reserved operation uncertain after mutation error %s", async (code) => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code, message: "sensitive detail" } });
    const response = await POST(request("create")); expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.errors[0].code).toBe("ABCD_ASSESSMENT_RESULT_UNCERTAIN");
    expect(JSON.stringify(payload)).not.toContain("sensitive detail");
  });

  it("keeps a reserved operation uncertain when the mutation transport rejects", async () => {
    stubs.maybeSingle.mockRejectedValue(new Error("transport lost after commit"));
    const response = await POST(request("create")); expect(response.status).toBe(409);
    expect((await response.json()).errors[0].code).toBe("ABCD_ASSESSMENT_RESULT_UNCERTAIN");
  });
});
