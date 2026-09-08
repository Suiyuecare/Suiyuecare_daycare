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
    const requestId = "28900000-0000-4000-8000-000000000099";
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

const organizationId = "28100000-0000-4000-8000-000000000091";
const branchId = "28200000-0000-4000-8000-000000000091";
const clientId = "28300000-0000-4000-8000-000000000091";
const therapistUserId = "28400000-0000-4000-8000-000000000091";
const assessmentKey = "28500000-0000-4000-8000-000000000091";
const draftVersionId = "28600000-0000-4000-8000-000000000091";
const signedVersionId = "28600000-0000-4000-8000-000000000092";
const operationId = "28700000-0000-4000-8000-000000000091";
const idempotencyKey = "28800000-0000-4000-8000-000000000091";

const actor = {
  organizationId,
  organizationName: "測試機構",
  branchId,
  branchName: "測試分支",
  userId: therapistUserId,
  displayName: "測試物理治療師",
  roles: ["professional"],
  scopes: [
    "clients.read",
    "physical_therapy_assessments.read",
    "physical_therapy_assessments.manage",
    "physical_therapy_assessments.sign",
  ],
  assuranceLevel: "aal2",
  recentAal2At: "2026-09-02T01:59:00Z",
  demo: false,
};

const measurements = [
  { name: "活動持續時間", state: "numeric", value: "12.50", unit: "分鐘", reason: null },
  { name: "操作觀察", state: "text", value: "合成人工觀察內容", unit: null, reason: null },
  { name: "握力", state: "missing", value: null, unit: null, reason: "本次未取得有效測量" },
];

const createBody = {
  action: "create_draft",
  clientId,
  assessedOn: "2026-09-01",
  reassessmentDueOn: "2026-09-15",
  dueBasis: "人工排定：合成服務會議紀錄",
  measurements,
  functionalObservation: "合成人工功能觀察",
  goals: "合成人工目標",
  recommendations: "合成人工專業建議",
  followUpPlan: "合成人工追蹤計畫",
  formVersionReference: "manual-physical-therapy-v1",
};

function request(
  method: "POST" | "PATCH",
  operation: "create_draft" | "revise_draft" | "sign" | "correct" =
    method === "POST" ? "create_draft" : "revise_draft",
) {
  return new Request("https://example.invalid/api/physical-therapy-assessments", {
    method,
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "X-Physical-Therapy-Operation": operation,
    },
    body: "{}",
  });
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    operation_id: operationId,
    client_id: clientId,
    assessment_key: assessmentKey,
    version_id: draftVersionId,
    assessment_version: 1,
    record_state: "draft",
    assessed_on: "2026-09-01",
    therapist_user_id: therapistUserId,
    service_status_at_assessment: "active",
    reassessment_due_on: "2026-09-15",
    form_version_reference: "manual-physical-therapy-v1",
    committed_at: "2026-09-02T01:15:00Z",
    replayed: false,
    ...overrides,
  };
}

describe("physical therapy assessment API boundary", () => {
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
    [{ ...actor, roles: ["case_manager_social_worker"] },
      "PHYSICAL_THERAPY_NOT_AUTHORIZED"],
    [{ ...actor, scopes: ["clients.read", "physical_therapy_assessments.read"] },
      "PHYSICAL_THERAPY_NOT_AUTHORIZED"],
  ])("rejects a denied create before detailed body parsing", async (denied, code) => {
    stubs.authorizeStaffRequest.mockResolvedValue(denied);
    const response = await POST(request("POST"));
    expect(response.status).toBe(403);
    expect((await response.json()).errors[0].code).toBe(code);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("rejects a denied mutation before parsing assessment content", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({
      ...actor,
      scopes: ["clients.read", "physical_therapy_assessments.read"],
    });
    const response = await PATCH(request("PATCH"));
    expect(response.status).toBe(403);
    expect((await response.json()).errors[0].code)
      .toBe("PHYSICAL_THERAPY_NOT_AUTHORIZED");
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("rejects stale AAL2 for a sign-only actor before parsing content", async () => {
    const signOnlyActor = {
      ...actor,
      scopes: [
        "clients.read",
        "physical_therapy_assessments.read",
        "physical_therapy_assessments.sign",
      ],
    };
    stubs.authorizeStaffRequest.mockResolvedValue(signOnlyActor);
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("reauth"), {
      code: "AAL2_REQUIRED",
      httpStatus: 403,
    }));
    const response = await PATCH(request("PATCH", "sign"));
    expect(response.status).toBe(403);
    expect(stubs.requireRecentAal2).toHaveBeenCalledWith(signOnlyActor);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("rejects stale AAL2 for draft creation before parsing clinical content", async () => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("reauth"), {
      code: "AAL2_REQUIRED",
      httpStatus: 403,
    }));
    const response = await POST(request("POST"));
    expect(response.status).toBe(403);
    expect(stubs.requireRecentAal2).toHaveBeenCalledWith(actor);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("binds tenant, branch, exact client and every structured manual field", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt(), error: null });
    const response = await POST(request("POST"));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      action: "create_draft",
      clientId,
      therapistUserId,
      assessmentVersion: 1,
      recordState: "draft",
      formVersionReference: "manual-physical-therapy-v1",
      persisted: true,
      demo: false,
    });
    expect(stubs.rpc).toHaveBeenCalledWith(
      "create_physical_therapy_assessment_draft",
      {
        p_expected_organization_id: organizationId,
        p_expected_branch_id: branchId,
        p_client_id: clientId,
        p_assessed_on: "2026-09-01",
        p_reassessment_due_on: "2026-09-15",
        p_due_basis: "人工排定：合成服務會議紀錄",
        p_measurements: measurements,
        p_functional_observation: "合成人工功能觀察",
        p_goals: "合成人工目標",
        p_recommendations: "合成人工專業建議",
        p_follow_up_plan: "合成人工追蹤計畫",
        p_form_version_reference: "manual-physical-therapy-v1",
        p_idempotency_key: idempotencyKey,
      },
    );
  });

  it.each([
    [{ client_id: "28300000-0000-4000-8000-000000000099" }, "different client"],
    [{ therapist_user_id: "28400000-0000-4000-8000-000000000099" }, "different therapist"],
    [{ form_version_reference: "invented-official-scale" }, "different form"],
  ])("fails closed on a mismatched receipt", async (receiptChanges, _label) => {
    expect(_label.length).toBeGreaterThan(0);
    stubs.maybeSingle.mockResolvedValue({
      data: receipt(receiptChanges),
      error: null,
    });
    const response = await POST(request("POST"));
    expect(response.status).toBe(502);
    expect((await response.json()).errors[0].code)
      .toBe("PHYSICAL_THERAPY_RECEIPT_INVALID");
  });

  it("fails closed when a receipt is partial or widened", async () => {
    stubs.maybeSingle.mockResolvedValue({
      data: { ...receipt(), therapist_user_id: undefined },
      error: null,
    });
    expect((await (await POST(request("POST"))).json()).errors[0].code)
      .toBe("PHYSICAL_THERAPY_RECEIPT_INVALID");
    stubs.maybeSingle.mockResolvedValue({
      data: { ...receipt(), clinical_score: 9 },
      error: null,
    });
    expect((await (await POST(request("POST"))).json()).errors[0].code)
      .toBe("PHYSICAL_THERAPY_RECEIPT_INVALID");
  });

  it("requires recent AAL2 before executing a signed correction", async () => {
    stubs.readJsonObject.mockResolvedValue({
      ...createBody,
      action: "correct",
      assessmentKey,
      previousVersionId: signedVersionId,
      expectedVersion: 2,
      correctionReason: "修正實際觀察事實",
    });
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("reauth"), {
      code: "AAL2_REQUIRED",
      httpStatus: 403,
    }));
    const response = await PATCH(request("PATCH", "correct"));
    expect(response.status).toBe(403);
    expect(stubs.requireRecentAal2).toHaveBeenCalledWith(actor);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("correlates signing to the expected immutable chain", async () => {
    stubs.readJsonObject.mockResolvedValue({
      action: "sign",
      clientId,
      assessmentKey,
      previousVersionId: draftVersionId,
      expectedVersion: 1,
    });
    stubs.maybeSingle.mockResolvedValue({
      data: receipt({
        version_id: signedVersionId,
        assessment_version: 2,
        record_state: "signed",
      }),
      error: null,
    });
    const response = await PATCH(request("PATCH", "sign"));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(stubs.requireRecentAal2).toHaveBeenCalledWith(actor);
    expect(stubs.rpc).toHaveBeenCalledWith(
      "sign_physical_therapy_assessment",
      expect.objectContaining({
        p_assessment_key: assessmentKey,
        p_previous_version_id: draftVersionId,
        p_expected_version: 1,
      }),
    );
    expect(body.data).toMatchObject({
      action: "sign",
      clientId,
      assessmentVersion: 2,
      recordState: "signed",
    });
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
    ["40001", 409, "PHYSICAL_THERAPY_VERSION_CONFLICT"],
    ["23505", 409, "PHYSICAL_THERAPY_IDEMPOTENCY_CONFLICT"],
    ["42501", 403, "PHYSICAL_THERAPY_NOT_AUTHORIZED"],
    ["22023", 400, "INVALID_PHYSICAL_THERAPY_ASSESSMENT"],
  ])("maps database code %s without leaking details", async (code, status, expected) => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code } });
    const response = await POST(request("POST"));
    const body = await response.json();
    expect(response.status).toBe(status);
    expect(body.errors[0].code).toBe(expected);
    expect(JSON.stringify(body)).not.toMatch(/stack|measurements|functionalObservation/u);
  });

  it("rejects unsupported or invented clinical actions before a database call", async () => {
    stubs.readJsonObject.mockResolvedValue({ action: "diagnose", clientId });
    const response = await PATCH(request("PATCH"));
    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].code)
      .toBe("INVALID_PHYSICAL_THERAPY_ASSESSMENT");
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("rejects a header/body action mismatch before a database call", async () => {
    stubs.readJsonObject.mockResolvedValue({
      action: "sign",
      clientId,
      assessmentKey,
      previousVersionId: draftVersionId,
      expectedVersion: 1,
    });
    const response = await PATCH(request("PATCH", "revise_draft"));
    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].code)
      .toBe("INVALID_PHYSICAL_THERAPY_ASSESSMENT");
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
});
