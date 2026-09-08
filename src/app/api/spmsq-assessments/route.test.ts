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
    const requestId = "11900000-0000-4000-8000-000000000099";
    try {
      return await operation(requestId);
    } catch (error) {
      const value = error as {
        code?: string;
        message?: string;
        httpStatus?: number;
      };
      return Response.json({
        requestId,
        status: "error",
        data: null,
        errors: [{
          code: value.code ?? "ERROR",
          message: value.message ?? "error",
        }],
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

import { PATCH, POST } from "./route";

const organizationId = "11100000-0000-4000-8000-000000000091";
const branchId = "11200000-0000-4000-8000-000000000091";
const clientId = "11300000-0000-4000-8000-000000000091";
const authorUserId = "11400000-0000-4000-8000-000000000091";
const assessmentKey = "11500000-0000-4000-8000-000000000091";
const versionId = "11600000-0000-4000-8000-000000000091";
const operationId = "11700000-0000-4000-8000-000000000091";
const idempotencyKey = "11800000-0000-4000-8000-000000000091";
const ruleVersionId = "spmsq-pfeiffer-10-education-adjusted-v1";

const actor = {
  organizationId,
  organizationName: "測試機構",
  branchId,
  branchName: "測試分支",
  userId: authorUserId,
  displayName: "測試評估人員",
  roles: ["professional"],
  scopes: ["clients.read", "assessments.read", "assessments.manage"],
  assuranceLevel: "aal2",
  recentAal2At: "2026-09-02T01:59:00Z",
  demo: false,
};

const answers = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [
  `spmsq_${String(index + 1).padStart(2, "0")}`,
  { state: "answered", value: [0, 2, 5].includes(index)
    ? "incorrect" : "correct" },
]));

const createBody = {
  action: "create_draft",
  clientId,
  assessedOn: "2026-09-02",
  answers,
  educationContext: {
    state: "answered",
    value: "middle_or_high_school",
  },
  culturalContext: {
    state: "recorded",
    note: "合成測試：以熟悉語言確認脈絡。",
  },
  ruleVersionId,
};

function request(method: "POST" | "PATCH") {
  return new Request("https://example.invalid/api/spmsq-assessments", {
    method,
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
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
    preview_raw_errors: 3,
    preview_adjusted_errors: 3,
    preview_band_key: "mild_3_4_errors",
    committed_at: "2026-09-02T02:00:00Z",
    replayed: false,
    ...overrides,
  };
}

describe("SPMSQ assessment API boundary", () => {
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
    [{ ...actor, scopes: ["clients.read", "assessments.read"] },
      "SPMSQ_NOT_AUTHORIZED"],
    [{ ...actor, scopes: ["assessments.read", "assessments.manage"] },
      "SPMSQ_NOT_AUTHORIZED"],
  ])("rejects denied writes before parsing the body", async (denied, code) => {
    stubs.authorizeStaffRequest.mockResolvedValue(denied);
    const response = await POST(request("POST"));
    expect(response.status).toBe(403);
    expect((await response.json()).errors[0].code).toBe(code);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("rejects stale AAL2 before parsing answer content", async () => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("reauth"), {
      code: "AAL2_REQUIRED",
      httpStatus: 403,
    }));
    const response = await PATCH(request("PATCH"));
    expect(response.status).toBe(403);
    expect(stubs.requireRecentAal2).toHaveBeenCalledWith(actor);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("binds tenant, branch, exact assigned client and the candidate rule", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt(), error: null });
    const response = await POST(request("POST"));
    const payload = await response.json();
    expect(response.status).toBe(201);
    expect(payload.data).toMatchObject({
      action: "create_draft",
      clientId,
      assessmentVersion: 1,
      governanceStatus: "candidate_unactivated",
      persisted: true,
      demo: false,
    });
    expect(stubs.rpc).toHaveBeenCalledWith("create_spmsq_assessment_draft", {
      p_expected_organization_id: organizationId,
      p_expected_branch_id: branchId,
      p_client_id: clientId,
      p_assessed_on: "2026-09-02",
      p_answers: answers,
      p_education_context: createBody.educationContext,
      p_cultural_context: createBody.culturalContext,
      p_rule_version_id: ruleVersionId,
      p_idempotency_key: idempotencyKey,
    });
  });

  it.each([
    [{ client_id: "11300000-0000-4000-8000-000000000099" }, "client"],
    [{ author_user_id: "11400000-0000-4000-8000-000000000099" }, "actor"],
    [{ preview_adjusted_errors: 4 }, "preview"],
    [{ governance_status: "activated" }, "governance"],
  ])("fails closed on a mismatched %s receipt", async (changes, label) => {
    expect(label.length).toBeGreaterThan(0);
    stubs.maybeSingle.mockResolvedValue({ data: receipt(changes), error: null });
    const response = await POST(request("POST"));
    expect(response.status).toBe(502);
    expect((await response.json()).errors[0].code).toBe("SPMSQ_RECEIPT_INVALID");
  });

  it("fails closed when a receipt is partial or widened", async () => {
    stubs.maybeSingle.mockResolvedValue({
      data: { ...receipt(), author_user_id: undefined },
      error: null,
    });
    expect((await (await POST(request("POST"))).json()).errors[0].code)
      .toBe("SPMSQ_RECEIPT_INVALID");
    stubs.maybeSingle.mockResolvedValue({
      data: { ...receipt(), official_score: 3 },
      error: null,
    });
    expect((await (await POST(request("POST"))).json()).errors[0].code)
      .toBe("SPMSQ_RECEIPT_INVALID");
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
        version_id: "11600000-0000-4000-8000-000000000092",
        assessment_version: 2,
      }),
      error: null,
    });
    const response = await PATCH(request("PATCH"));
    expect(response.status).toBe(201);
    expect(stubs.rpc).toHaveBeenCalledWith(
      "revise_spmsq_assessment_draft",
      expect.objectContaining({
        p_assessment_key: assessmentKey,
        p_previous_version_id: versionId,
        p_expected_version: 1,
      }),
    );
  });

  it("calls the database fail-closed sign boundary and returns no formal result", async () => {
    stubs.readJsonObject.mockResolvedValue({
      action: "sign",
      clientId,
      assessmentKey,
      previousVersionId: versionId,
      expectedVersion: 1,
    });
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code: "55000" } });
    const response = await PATCH(request("PATCH"));
    const payload = await response.json();
    expect(response.status).toBe(409);
    expect(payload.errors[0].code).toBe("SPMSQ_RULE_NOT_ACTIVATED");
    expect(payload.data).toBeNull();
    expect(stubs.rpc).toHaveBeenCalledWith("sign_spmsq_assessment",
      expect.objectContaining({
        p_assessment_key: assessmentKey,
        p_previous_version_id: versionId,
        p_expected_version: 1,
      }));
  });

  it("returns 200 only for an exact idempotent replay", async () => {
    stubs.maybeSingle.mockResolvedValue({
      data: receipt({ replayed: true }),
      error: null,
    });
    const response = await POST(request("POST"));
    expect(response.status).toBe(200);
    expect((await response.json()).data.replayed).toBe(true);
  });

  it.each([
    ["40001", 409, "SPMSQ_VERSION_CONFLICT"],
    ["23505", 409, "SPMSQ_IDEMPOTENCY_CONFLICT"],
    ["42501", 403, "SPMSQ_NOT_AUTHORIZED"],
    ["55000", 409, "SPMSQ_RULE_NOT_ACTIVATED"],
    ["22023", 400, "INVALID_SPMSQ_ASSESSMENT"],
  ])("maps database code %s without leaking answer content", async (
    code,
    status,
    expected,
  ) => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code } });
    const response = await POST(request("POST"));
    const payload = await response.json();
    expect(response.status).toBe(status);
    expect(payload.errors[0].code).toBe(expected);
    expect(JSON.stringify(payload)).not.toMatch(/spmsq_01|合成測試|stack/u);
  });

  it("rejects invented official actions before a database call", async () => {
    stubs.readJsonObject.mockResolvedValue({ action: "diagnose", clientId });
    const response = await PATCH(request("PATCH"));
    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].code)
      .toBe("INVALID_SPMSQ_ASSESSMENT");
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
});
