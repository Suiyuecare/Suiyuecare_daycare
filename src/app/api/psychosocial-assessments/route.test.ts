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
const userId = "28400000-0000-4000-8000-000000000091";
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
  userId,
  displayName: "測試社工",
  roles: ["case_manager_social_worker"],
  scopes: [
    "clients.read",
    "social_work_records.read",
    "social_work_records.manage",
    "social_work_records.sign",
  ],
  assuranceLevel: "aal2",
  recentAal2At: "2026-09-02T01:59:00Z",
  demo: false,
};

const dimensions = {
  family_relationships: { state: "provided", detail: "合成家庭互動" },
  social_support: { state: "missing", detail: null },
  social_participation: { state: "not_applicable", detail: null },
  communication_context: { state: "provided", detail: "合成溝通偏好" },
  resource_access: { state: "missing", detail: null },
};

const createBody = {
  action: "create_draft",
  clientId,
  assessedOn: "2026-09-01",
  reassessmentDueOn: "2026-09-15",
  dueBasis: "人工排定：合成服務會議紀錄",
  dimensions,
  assessmentSummary: "合成人工心理社會摘要",
  formVersionReference: "manual-psychosocial-v1",
};

function request(method: "POST" | "PATCH") {
  return new Request("https://example.invalid/api/psychosocial-assessments", {
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
    version_id: draftVersionId,
    assessment_version: 1,
    record_state: "draft",
    assessed_on: "2026-09-01",
    responsible_user_id: userId,
    service_status_at_assessment: "active",
    reassessment_due_on: "2026-09-15",
    form_version_reference: "manual-psychosocial-v1",
    committed_at: "2026-09-02T01:15:00Z",
    replayed: false,
    ...overrides,
  };
}

describe("psychosocial assessment API boundary", () => {
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
    [{ ...actor, scopes: ["clients.read", "social_work_records.read"] },
      "PSYCHOSOCIAL_NOT_AUTHORIZED"],
  ])("rejects denied create before detailed body parsing", async (denied, code) => {
    stubs.authorizeStaffRequest.mockResolvedValue(denied);
    const response = await POST(request("POST"));
    expect(response.status).toBe(403);
    expect((await response.json()).errors[0].code).toBe(code);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("binds actor scope, exact client and strict structured fields", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt(), error: null });
    const response = await POST(request("POST"));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      action: "create_draft",
      clientId,
      responsibleUserId: userId,
      assessmentVersion: 1,
      recordState: "draft",
      formVersionReference: "manual-psychosocial-v1",
      persisted: true,
      demo: false,
    });
    expect(stubs.rpc).toHaveBeenCalledWith(
      "create_psychosocial_assessment_draft",
      expect.objectContaining({
        p_expected_organization_id: organizationId,
        p_expected_branch_id: branchId,
        p_client_id: clientId,
        p_due_basis: "人工排定：合成服務會議紀錄",
        p_dimensions: dimensions,
        p_form_version_reference: "manual-psychosocial-v1",
        p_idempotency_key: idempotencyKey,
      }),
    );
  });

  it("fails closed when the receipt changes the selected client", async () => {
    stubs.maybeSingle.mockResolvedValue({
      data: receipt({ client_id: "28300000-0000-4000-8000-000000000099" }),
      error: null,
    });
    const response = await POST(request("POST"));
    expect(response.status).toBe(502);
    expect((await response.json()).errors[0].code)
      .toBe("PSYCHOSOCIAL_RECEIPT_INVALID");
  });

  it("fails closed when a receipt is partial", async () => {
    stubs.maybeSingle.mockResolvedValue({
      data: { ...receipt(), responsible_user_id: undefined },
      error: null,
    });
    const response = await POST(request("POST"));
    expect(response.status).toBe(502);
    expect((await response.json()).errors[0].code)
      .toBe("PSYCHOSOCIAL_RECEIPT_INVALID");
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
    const response = await PATCH(request("PATCH"));
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
    const response = await PATCH(request("PATCH"));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(stubs.requireRecentAal2).toHaveBeenCalledWith(actor);
    expect(body.data).toMatchObject({
      action: "sign",
      clientId,
      assessmentVersion: 2,
      recordState: "signed",
    });
  });

  it("maps stale versions to a deterministic conflict", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code: "40001" } });
    const response = await POST(request("POST"));
    expect(response.status).toBe(409);
    expect((await response.json()).errors[0].code)
      .toBe("PSYCHOSOCIAL_VERSION_CONFLICT");
  });

  it("rejects unsupported actions before any database call", async () => {
    stubs.readJsonObject.mockResolvedValue({ action: "diagnose", clientId });
    const response = await PATCH(request("PATCH"));
    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].code)
      .toBe("INVALID_PSYCHOSOCIAL_ASSESSMENT");
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
});
