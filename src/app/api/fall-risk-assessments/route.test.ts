import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(),
  readJsonObject: vi.fn(),
  requireRecentAal2: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  readJsonObject: stubs.readJsonObject,
  requireRecentAal2: stubs.requireRecentAal2,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (
    operation: (requestId: string) => Promise<Response>,
  ) => {
    const requestId = "12900000-0000-4000-8000-000000000099";
    try {
      return await operation(requestId);
    } catch (error) {
      const value = error as { code?: string; message?: string; httpStatus?: number };
      return Response.json({
        requestId,
        status: "error",
        data: null,
        errors: [{ code: value.code ?? "ERROR", message: value.message ?? "error" }],
      }, {
        status: value.httpStatus ?? 500,
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      });
    }
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { candidateAnswers } from "@/lib/fall-risk-assessments/demo";
import { PATCH, POST } from "./route";

const organizationId = "12100000-0000-4000-8000-000000000091";
const branchId = "12200000-0000-4000-8000-000000000091";
const clientId = "12300000-0000-4000-8000-000000000091";
const authorUserId = "12400000-0000-4000-8000-000000000091";
const assessmentKey = "12500000-0000-4000-8000-000000000091";
const versionId = "12600000-0000-4000-8000-000000000091";
const operationId = "12700000-0000-4000-8000-000000000091";
const idempotencyKey = "12800000-0000-4000-8000-000000000091";
const ruleVersionId = "fall-risk-manual-factors-candidate-v1";
const answers = candidateAnswers(5);

const actor = {
  organizationId,
  organizationName: "測試機構",
  branchId,
  branchName: "測試分支",
  userId: authorUserId,
  displayName: "測試評估人員",
  roles: ["professional"],
  scopes: ["clients.read", "fall_risk_assessments.read", "fall_risk_assessments.manage"],
  assuranceLevel: "aal2",
  recentAal2At: "2026-09-02T01:59:00Z",
  demo: false,
};
const createBody = {
  action: "create_draft",
  clientId,
  assessedOn: "2026-09-02",
  answers,
  ruleVersionId,
};

function request(method: "POST" | "PATCH", operation?: string) {
  return new Request("https://example.invalid/api/fall-risk-assessments", {
    method,
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      ...(operation ? { "X-Fall-Risk-Operation": operation } : {}),
    },
    body: "{}",
  });
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    operation_id: operationId,
    client_id: clientId,
    assessment_key: assessmentKey,
    version_id: versionId,
    assessment_version: 1,
    record_state: "draft_preview",
    assessed_on: "2026-09-02",
    author_user_id: authorUserId,
    service_status_at_assessment: "active",
    rule_version_id: ruleVersionId,
    governance_status: "candidate_unactivated",
    preview_status: "candidate_complete",
    preview_candidate_points: 5,
    preview_band_key: "candidate_high_review_4_6",
    content_hash: "a".repeat(64),
    committed_at: "2026-09-02T02:00:00Z",
    replayed: false,
    ...overrides,
  };
}

describe("fall-risk candidate assessment API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.readJsonObject.mockResolvedValue(createBody);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it.each([
    [{ ...actor, demo: true }, "DEMO_READ_ONLY"],
    [{ ...actor, scopes: ["clients.read", "fall_risk_assessments.read"] }, "FALL_RISK_NOT_AUTHORIZED"],
    [{ ...actor, scopes: ["fall_risk_assessments.read", "fall_risk_assessments.manage"] }, "FALL_RISK_NOT_AUTHORIZED"],
  ])("rejects denied create writes before parsing body", async (denied, code) => {
    stubs.authorizeStaffRequest.mockResolvedValue(denied);
    const response = await POST(request("POST"));
    expect(response.status).toBe(403);
    expect((await response.json()).errors[0].code).toBe(code);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("rejects stale AAL2 before parsing revision answers", async () => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("reauth"), {
      code: "AAL2_REQUIRED",
      httpStatus: 403,
    }));
    const response = await PATCH(request("PATCH", "revise_draft"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("binds tenant, branch, exact client and only the fall-risk candidate contract", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt(), error: null });
    const response = await POST(request("POST"));
    expect(response.status).toBe(201);
    expect(stubs.rpc).toHaveBeenCalledWith("create_fall_risk_assessment_draft", {
      p_expected_organization_id: organizationId,
      p_expected_branch_id: branchId,
      p_client_id: clientId,
      p_assessed_on: "2026-09-02",
      p_answers: answers,
      p_rule_version_id: ruleVersionId,
      p_idempotency_key: idempotencyKey,
    });
    const payload = await response.json();
    expect(payload.data).toMatchObject({
      action: "create_draft",
      previewCandidatePoints: 5,
      governanceStatus: "candidate_unactivated",
      persisted: true,
      demo: false,
    });
  });

  it.each([
    [{ client_id: "12300000-0000-4000-8000-000000000099" }, "client"],
    [{ author_user_id: "12400000-0000-4000-8000-000000000099" }, "actor"],
    [{ preview_candidate_points: 4 }, "candidate preview"],
    [{ content_hash: "forged" }, "content hash"],
    [{ governance_status: "activated" }, "governance"],
  ])("fails closed on mismatched %s receipt", async (changes, label) => {
    expect(label.length).toBeGreaterThan(0);
    stubs.maybeSingle.mockResolvedValue({ data: receipt(changes), error: null });
    const response = await POST(request("POST"));
    expect(response.status).toBe(502);
    expect((await response.json()).errors[0].code).toBe("FALL_RISK_RECEIPT_INVALID");
  });

  it("correlates a revision to the immutable previous version", async () => {
    stubs.readJsonObject.mockResolvedValue({
      ...createBody,
      action: "revise_draft",
      assessmentKey,
      previousVersionId: versionId,
      expectedVersion: 1,
    });
    stubs.maybeSingle.mockResolvedValue({
      data: receipt({
        version_id: "12600000-0000-4000-8000-000000000092",
        assessment_version: 2,
      }),
      error: null,
    });
    const response = await PATCH(request("PATCH", "revise_draft"));
    expect(response.status).toBe(201);
    expect(stubs.rpc).toHaveBeenCalledWith("revise_fall_risk_assessment_draft",
      expect.objectContaining({
        p_assessment_key: assessmentKey,
        p_previous_version_id: versionId,
        p_expected_version: 1,
      }));
  });

  it("requires sign scope before reading a signing body", async () => {
    const response = await PATCH(request("PATCH", "sign"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("sign permission still reaches a fail-closed unactivated rule", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({
      ...actor,
      scopes: ["clients.read", "fall_risk_assessments.read", "fall_risk_assessments.sign"],
    });
    stubs.readJsonObject.mockResolvedValue({
      action: "sign",
      clientId,
      assessmentKey,
      previousVersionId: versionId,
      expectedVersion: 1,
    });
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code: "55000" } });
    const response = await PATCH(request("PATCH", "sign"));
    const payload = await response.json();
    expect(response.status).toBe(409);
    expect(payload.errors[0].code).toBe("FALL_RISK_RULE_NOT_ACTIVATED");
    expect(payload.data).toBeNull();
    expect(stubs.rpc).toHaveBeenCalledWith("sign_fall_risk_assessment",
      expect.objectContaining({ p_assessment_key: assessmentKey }));
  });

  it("rejects undeclared or mismatched operations without a write", async () => {
    expect((await PATCH(request("PATCH"))).status).toBe(400);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    stubs.readJsonObject.mockResolvedValue(createBody);
    expect((await PATCH(request("PATCH", "revise_draft"))).status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("returns 200 only for an exact idempotent replay", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt({ replayed: true }), error: null });
    const response = await POST(request("POST"));
    expect(response.status).toBe(200);
    expect((await response.json()).data.replayed).toBe(true);
  });

  it.each([
    ["40001", 409, "FALL_RISK_VERSION_CONFLICT"],
    ["23505", 409, "FALL_RISK_IDEMPOTENCY_CONFLICT"],
    ["42501", 403, "FALL_RISK_NOT_AUTHORIZED"],
    ["55000", 409, "FALL_RISK_RULE_NOT_ACTIVATED"],
    ["22023", 400, "INVALID_FALL_RISK_ASSESSMENT"],
  ])("maps database code %s without leaking answers", async (
    code,
    status,
    expected,
  ) => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code } });
    const response = await POST(request("POST"));
    const payload = await response.json();
    expect(response.status).toBe(status);
    expect(payload.errors[0].code).toBe(expected);
    expect(JSON.stringify(payload)).not.toMatch(
      /fall_factor_01|stack|present|absent/u,
    );
  });
});
