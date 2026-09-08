import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(),
  requireRecentAal2: vi.fn(),
  readJsonObject: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  requireRecentAal2: stubs.requireRecentAal2,
  readJsonObject: stubs.readJsonObject,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "41000000-0000-4000-8000-000000000190";
    try {
      return await operation(requestId);
    } catch (error) {
      const value = error as { code?: unknown; message?: unknown; httpStatus?: unknown };
      return Response.json({ requestId, status: "error", data: null, errors: [{
        code: typeof value.code === "string" ? value.code : "ERROR",
        message: typeof value.message === "string" ? value.message : "error",
      }] }, { status: typeof value.httpStatus === "number" ? value.httpStatus : 500 });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { PATCH, POST } from "./route";

const organizationId = "41000000-0000-4000-8000-000000000101";
const branchId = "41000000-0000-4000-8000-000000000102";
const clientId = "41000000-0000-4000-8000-000000000103";
const actorId = "41000000-0000-4000-8000-000000000104";
const recordKey = "41000000-0000-4000-8000-000000000105";
const versionId = "41000000-0000-4000-8000-000000000106";
const idempotencyKey = "41000000-0000-4000-8000-000000000107";
const occurredAt = "2026-09-02T01:00:00.000Z";
const recorded = (text: string) => ({ state: "recorded", text, reason: null });
const missing = (reason: string) => ({ state: "missing", text: null, reason });
const notApplicable = (reason: string) => ({
  state: "not_applicable", text: null, reason,
});
const actor = {
  organizationId, branchId, organizationName: "合成機構", branchName: "合成分支",
  userId: actorId, displayName: "合成職能治療師", roles: ["professional"],
  scopes: ["clients.read", "occupational_therapy_services.read",
    "occupational_therapy_services.manage", "occupational_therapy_services.sign"],
  assuranceLevel: "aal2", recentAal2At: null, demo: false,
};
const createBody = {
  action: "create_draft", clientId, occurredAt,
  serviceContent: recorded("合成服務內容"),
  clientReaction: missing("本次尚未取得反應"),
  recommendation: notApplicable("本次沒有新增建議"),
};

function request(method: "POST" | "PATCH", action: string) {
  return new Request("https://example.invalid/api/occupational-therapy-services", {
    method,
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      "x-occupational-therapy-service-operation": action,
    },
    body: "{}",
  });
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    operation_id: "41000000-0000-4000-8000-000000000108",
    organization_id: organizationId,
    branch_id: branchId,
    client_id: clientId,
    record_key: recordKey,
    version_id: versionId,
    record_version: 1,
    record_state: "draft",
    occurred_at: occurredAt,
    therapist_user_id: actorId,
    service_status_at_occurrence: "active",
    assessment_reference_version_id: null,
    committed_at: "2026-09-02T01:01:00.000Z",
    replayed: false,
    ...overrides,
  };
}

describe("Page 41 occupational therapy service API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue(createBody);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it("creates a tenant-bound draft and returns a correlated 201 receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt(), error: null });
    const response = await POST(request("POST", "create_draft"));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({ action: "create_draft", organizationId,
      branchId, clientId, recordVersion: 1, recordState: "draft",
      therapistUserId: actorId, persisted: true, demo: false });
    expect(stubs.rpc).toHaveBeenCalledWith(
      "create_occupational_therapy_service_draft",
      expect.objectContaining({
        p_expected_organization_id: organizationId,
        p_expected_branch_id: branchId,
        p_client_id: clientId,
        p_occurred_at: occurredAt,
        p_idempotency_key: idempotencyKey,
      }),
    );
  });

  it("returns HTTP 200 only for an exact replay", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt({ replayed: true }), error: null });
    const response = await POST(request("POST", "create_draft"));
    expect(response.status).toBe(200);
  });

  it("rejects demo and missing action permission before parsing content", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true });
    let response = await POST(request("POST", "create_draft"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();

    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: false,
      scopes: ["clients.read", "occupational_therapy_services.read"] });
    response = await POST(request("POST", "create_draft"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("requires recent AAL2 for sign before reading the body", async () => {
    stubs.requireRecentAal2.mockRejectedValueOnce(Object.assign(new Error("reauth"), {
      code: "RECENT_AAL2_REQUIRED", httpStatus: 403,
    }));
    const response = await PATCH(request("PATCH", "sign"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("rejects a mismatched operation header before calling the database", async () => {
    stubs.readJsonObject.mockResolvedValue({
      action: "sign", clientId, recordKey, previousVersionId: versionId,
      expectedVersion: 1,
    });
    const response = await PATCH(request("PATCH", "correct"));
    expect(response.status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("signs only the exact version and returns a new immutable version", async () => {
    stubs.readJsonObject.mockResolvedValue({
      action: "sign", clientId, recordKey, previousVersionId: versionId,
      expectedVersion: 1,
    });
    stubs.maybeSingle.mockResolvedValue({ data: receipt({
      version_id: "41000000-0000-4000-8000-000000000109",
      record_version: 2, record_state: "signed",
    }), error: null });
    const response = await PATCH(request("PATCH", "sign"));
    expect(response.status).toBe(201);
    expect(stubs.requireRecentAal2).toHaveBeenCalledOnce();
    expect(stubs.rpc).toHaveBeenCalledWith(
      "sign_occupational_therapy_service_record",
      expect.objectContaining({ p_record_key: recordKey,
        p_previous_version_id: versionId, p_expected_version: 1 }),
    );
  });

  it("passes reasoned correction fields to the independent Page 41 RPC", async () => {
    const correction = {
      action: "correct", clientId, recordKey, previousVersionId: versionId,
      expectedVersion: 1, occurredAt,
      serviceContent: recorded("合成服務更正版"),
      clientReaction: missing("更正後仍未取得反應"),
      recommendation: recorded("合成人工建議更正版"),
      correctionReason: "原簽署紀錄需做狹義更正",
    };
    stubs.readJsonObject.mockResolvedValue(correction);
    stubs.maybeSingle.mockResolvedValue({ data: receipt({
      version_id: "41000000-0000-4000-8000-000000000109",
      record_version: 2, record_state: "corrected",
    }), error: null });
    const response = await PATCH(request("PATCH", "correct"));
    expect(response.status).toBe(201);
    expect(stubs.rpc).toHaveBeenCalledWith(
      "correct_occupational_therapy_service_record",
      expect.objectContaining({ p_correction_reason: correction.correctionReason,
        p_recommendation: correction.recommendation }),
    );
  });

  it("fails closed on a forged scope, actor or version receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt({
      branch_id: clientId, therapist_user_id: clientId, record_version: 8,
    }), error: null });
    const response = await POST(request("POST", "create_draft"));
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.errors[0].code).toBe("OCCUPATIONAL_THERAPY_SERVICE_RECEIPT_INVALID");
  });

  it.each([
    ["40001", 409, "OCCUPATIONAL_THERAPY_SERVICE_VERSION_CONFLICT"],
    ["23505", 409, "OCCUPATIONAL_THERAPY_SERVICE_IDEMPOTENCY_CONFLICT"],
    ["22023", 400, "INVALID_OCCUPATIONAL_THERAPY_SERVICE"],
    ["unexpected", 500, "OCCUPATIONAL_THERAPY_SERVICE_SAVE_FAILED"],
  ])("maps database error %s without exposing internals", async (code, status, expectedCode) => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code } });
    const response = await POST(request("POST", "create_draft"));
    const body = await response.json();
    expect(response.status).toBe(status);
    expect(body.errors[0].code).toBe(expectedCode);
  });
});
