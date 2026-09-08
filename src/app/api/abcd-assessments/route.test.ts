import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ authorizeStaffRequest: vi.fn(), readJsonObject: vi.fn(),
  requireRecentAal2: vi.fn(), createServerSupabaseClient: vi.fn(), rpc: vi.fn(), maybeSingle: vi.fn() }));

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
    stubs.requireRecentAal2.mockResolvedValue(undefined); stubs.readJsonObject.mockResolvedValue(body);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
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
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_abcd_assessment", {
      p_expected_organization_id: organizationId, p_expected_branch_id: branchId,
      p_action: "save_assessment", p_payload: expect.objectContaining({ client_id: clientId,
        assessment_type: "A", assessment_year: 2026,
        result: { state: "recorded", text: "人工候選結果", reason: null } }),
      p_idempotency_key: key,
    });
    const sent = stubs.rpc.mock.calls[0]?.[1].p_payload;
    expect(sent).not.toHaveProperty("score"); expect(sent).not.toHaveProperty("diagnosis");
    expect((await response.json()).data).toMatchObject({ assessmentKey, persisted: true, demo: false });
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
    const response = await POST(request("sign")); expect(response.status).toBe(502);
    expect((await response.json()).errors[0].code).toBe("ABCD_ASSESSMENT_RECEIPT_INVALID");
  });

  it("fails closed on a mismatched receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: { ...receipt, assessment_type: "B" }, error: null });
    const response = await POST(request("create")); expect(response.status).toBe(502);
    expect((await response.json()).errors[0].code).toBe("ABCD_ASSESSMENT_RECEIPT_INVALID");
  });

  it.each([
    { organization_id: userId },
    { branch_id: userId },
    { client_id: userId },
    { record_payload: { ...receipt.record_payload, manual_summary: "遭置換的摘要" } },
  ])("rejects a receipt detached from the authorized context or canonical content", async (forgery) => {
    stubs.maybeSingle.mockResolvedValue({ data: { ...receipt, ...forgery }, error: null });
    const response = await POST(request("create")); expect(response.status).toBe(502);
    expect((await response.json()).errors[0].code).toBe("ABCD_ASSESSMENT_RECEIPT_INVALID");
  });

  it.each([["42501", 403, "ABCD_ASSESSMENT_NOT_AUTHORIZED"],
    ["40001", 409, "ABCD_ASSESSMENT_VERSION_CONFLICT"],
    ["23505", 409, "ABCD_ASSESSMENT_IDEMPOTENCY_CONFLICT"],
    ["23514", 409, "ABCD_ASSESSMENT_STATE_CONFLICT"],
    ["22023", 400, "INVALID_ABCD_ASSESSMENT_OPERATION"],
    ["XX000", 409, "ABCD_ASSESSMENT_RESULT_UNCERTAIN"]])
  ("maps database code %s without leaking details", async (code, status, expected) => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code, message: "sensitive detail" } });
    const response = await POST(request("create")); expect(response.status).toBe(status);
    const payload = await response.json(); expect(payload.errors[0].code).toBe(expected);
    expect(JSON.stringify(payload)).not.toContain("sensitive detail");
  });
});
