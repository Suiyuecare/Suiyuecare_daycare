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
    const requestId = "34800000-0000-4000-8000-000000000099";
    try {
      return await operation(requestId);
    } catch (error) {
      const value = error as {
        code?: string;
        message?: string;
        httpStatus?: number;
        field?: string;
      };
      return Response.json({
        requestId,
        status: "error",
        data: null,
        errors: [{
          code: value.code ?? "ERROR",
          message: value.message ?? "error",
          ...(value.field ? { field: value.field } : {}),
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

const organizationId = "34100000-0000-4000-8000-000000000091";
const branchId = "34200000-0000-4000-8000-000000000091";
const clientId = "34300000-0000-4000-8000-000000000091";
const therapistUserId = "34400000-0000-4000-8000-000000000091";
const recordKey = "34500000-0000-4000-8000-000000000091";
const draftVersionId = "34600000-0000-4000-8000-000000000091";
const signedVersionId = "34600000-0000-4000-8000-000000000092";
const operationId = "34700000-0000-4000-8000-000000000091";
const idempotencyKey = "34800000-0000-4000-8000-000000000091";
const occurredAt = "2026-09-02T01:30:00.000Z";

const actor = {
  organizationId,
  organizationName: "合成測試機構",
  branchId,
  branchName: "合成測試分支",
  userId: therapistUserId,
  displayName: "合成物理治療師",
  roles: ["professional"],
  scopes: [
    "clients.read",
    "physical_therapy_services.read",
    "physical_therapy_services.manage",
    "physical_therapy_services.sign",
  ],
  assuranceLevel: "aal2",
  recentAal2At: "2026-09-02T01:29:00Z",
  demo: false,
};

const recorded = { state: "recorded", text: "合成服務內容", reason: null };
const missing = {
  state: "missing", text: null, reason: "合成示例：本次未取得反應",
};
const notApplicable = {
  state: "not_applicable", text: null, reason: "合成示例：本次不適用",
};
const createBody = {
  action: "create_draft",
  clientId,
  occurredAt,
  serviceContent: recorded,
  clientReaction: missing,
  recommendation: notApplicable,
};

function request(
  method: "POST" | "PATCH",
  operation: "create_draft" | "revise_draft" | "sign" | "correct" =
    method === "POST" ? "create_draft" : "revise_draft",
) {
  return new Request("https://example.invalid/api/physical-therapy-services", {
    method,
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "X-Physical-Therapy-Service-Operation": operation,
    },
    body: "{}",
  });
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    operation_id: operationId,
    organization_id: organizationId,
    branch_id: branchId,
    client_id: clientId,
    record_key: recordKey,
    version_id: draftVersionId,
    record_version: 1,
    record_state: "draft",
    occurred_at: occurredAt,
    therapist_user_id: therapistUserId,
    service_status_at_occurrence: "active",
    assessment_reference_version_id: null,
    committed_at: "2026-09-02T01:31:00.000Z",
    replayed: false,
    ...overrides,
  };
}

describe("physical therapy service API boundary", () => {
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
    [{ ...actor, roles: ["nurse"] },
      "PHYSICAL_THERAPY_SERVICE_NOT_AUTHORIZED"],
    [{ ...actor, scopes: ["physical_therapy_services.manage"] },
      "PHYSICAL_THERAPY_SERVICE_NOT_AUTHORIZED"],
  ])("rejects denied create before parsing sensitive content", async (denied, code) => {
    stubs.authorizeStaffRequest.mockResolvedValue(denied);
    const response = await POST(request("POST"));
    expect(response.status).toBe(403);
    expect((await response.json()).errors[0].code).toBe(code);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("rejects denied revision before parsing narrative content", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({
      ...actor,
      scopes: ["clients.read", "physical_therapy_services.read"],
    });
    const response = await PATCH(request("PATCH", "revise_draft"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("checks recent AAL2 for sign before parsing a body", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({
      ...actor,
      scopes: [
        "clients.read", "physical_therapy_services.read",
        "physical_therapy_services.sign",
      ],
    });
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(
      new Error("reauth"), { code: "AAL2_REQUIRED", httpStatus: 403 },
    ));
    const response = await PATCH(request("PATCH", "sign"));
    expect(response.status).toBe(403);
    expect(stubs.requireRecentAal2).toHaveBeenCalledTimes(1);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("does not require recent reauthentication for a draft", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt(), error: null });
    const response = await POST(request("POST"));
    expect(response.status).toBe(201);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
  });

  it("binds tenant branch client exact values and server-selected assessment", async () => {
    const assessmentId = "34900000-0000-4000-8000-000000000091";
    stubs.maybeSingle.mockResolvedValue({
      data: receipt({ assessment_reference_version_id: assessmentId }),
      error: null,
    });
    const response = await POST(request("POST"));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      action: "create_draft",
      organizationId,
      branchId,
      clientId,
      therapistUserId,
      assessmentReferenceVersionId: assessmentId,
      persisted: true,
      demo: false,
    });
    expect(stubs.rpc).toHaveBeenCalledWith(
      "create_physical_therapy_service_draft",
      {
        p_expected_organization_id: organizationId,
        p_expected_branch_id: branchId,
        p_client_id: clientId,
        p_occurred_at: occurredAt,
        p_service_content: recorded,
        p_client_reaction: missing,
        p_recommendation: notApplicable,
        p_idempotency_key: idempotencyKey,
      },
    );
    expect(stubs.rpc.mock.calls[0]?.[1]).not.toHaveProperty(
      "p_assessment_reference_version_id",
    );
  });

  it.each([
    [{ organization_id: "34100000-0000-4000-8000-000000000099" }, "org"],
    [{ branch_id: "34200000-0000-4000-8000-000000000099" }, "branch"],
    [{ client_id: "34300000-0000-4000-8000-000000000099" }, "client"],
    [{ therapist_user_id: "34400000-0000-4000-8000-000000000099" }, "therapist"],
    [{ occurred_at: "2026-09-02T02:30:00.000Z" }, "occurrence"],
  ])("fails closed on a mismatched %s receipt", async (changes, _label) => {
    expect(_label.length).toBeGreaterThan(0);
    stubs.maybeSingle.mockResolvedValue({ data: receipt(changes), error: null });
    const response = await POST(request("POST"));
    expect(response.status).toBe(502);
    expect((await response.json()).errors[0].code)
      .toBe("PHYSICAL_THERAPY_SERVICE_RECEIPT_INVALID");
  });

  it("rejects partial or widened database receipts", async () => {
    stubs.maybeSingle.mockResolvedValue({
      data: { ...receipt(), therapist_user_id: undefined }, error: null,
    });
    expect((await (await POST(request("POST"))).json()).errors[0].code)
      .toBe("PHYSICAL_THERAPY_SERVICE_RECEIPT_INVALID");
    stubs.maybeSingle.mockResolvedValue({
      data: { ...receipt(), diagnosis: "forged" }, error: null,
    });
    expect((await (await POST(request("POST"))).json()).errors[0].code)
      .toBe("PHYSICAL_THERAPY_SERVICE_RECEIPT_INVALID");
  });

  it("correlates signing to the exact immutable chain", async () => {
    stubs.readJsonObject.mockResolvedValue({
      action: "sign",
      clientId,
      recordKey,
      previousVersionId: draftVersionId,
      expectedVersion: 1,
    });
    stubs.maybeSingle.mockResolvedValue({
      data: receipt({
        version_id: signedVersionId,
        record_version: 2,
        record_state: "signed",
      }),
      error: null,
    });
    const response = await PATCH(request("PATCH", "sign"));
    expect(response.status).toBe(201);
    expect(stubs.requireRecentAal2).toHaveBeenCalledWith(actor);
    expect(stubs.rpc).toHaveBeenCalledWith(
      "sign_physical_therapy_service_record",
      expect.objectContaining({
        p_record_key: recordKey,
        p_previous_version_id: draftVersionId,
        p_expected_version: 1,
      }),
    );
  });

  it("rejects a header body action mismatch before database execution", async () => {
    stubs.readJsonObject.mockResolvedValue({
      action: "sign",
      clientId,
      recordKey,
      previousVersionId: draftVersionId,
      expectedVersion: 1,
    });
    const response = await PATCH(request("PATCH", "revise_draft"));
    expect(response.status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("rejects an unsupported operation header before authorization and body", async () => {
    const forged = new Request("https://example.invalid/api/physical-therapy-services", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        "X-Physical-Therapy-Service-Operation": "diagnose",
      },
      body: "{}",
    });
    const response = await PATCH(forged);
    expect(response.status).toBe(400);
    expect(stubs.authorizeStaffRequest).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("returns 200 only for exact replay", async () => {
    stubs.maybeSingle.mockResolvedValue({
      data: receipt({ replayed: true }), error: null,
    });
    const response = await POST(request("POST"));
    expect(response.status).toBe(200);
    expect((await response.json()).data.replayed).toBe(true);
  });

  it.each([
    ["40001", 409, "PHYSICAL_THERAPY_SERVICE_VERSION_CONFLICT"],
    ["23505", 409, "PHYSICAL_THERAPY_SERVICE_IDEMPOTENCY_CONFLICT"],
    ["42501", 403, "PHYSICAL_THERAPY_SERVICE_NOT_AUTHORIZED"],
    ["22023", 400, "INVALID_PHYSICAL_THERAPY_SERVICE"],
    ["XX000", 500, "PHYSICAL_THERAPY_SERVICE_SAVE_FAILED"],
  ])("maps database code %s without leaking content", async (
    code, status, expected,
  ) => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code } });
    const response = await POST(request("POST"));
    const body = await response.json();
    expect(response.status).toBe(status);
    expect(body.errors[0].code).toBe(expected);
    expect(JSON.stringify(body)).not.toMatch(/合成服務內容|stack/u);
  });
});
