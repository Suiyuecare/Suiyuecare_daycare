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
  handleIntegrationRoute: async (
    operation: (requestId: string) => Promise<Response>,
  ) => {
    const requestId = "43800000-0000-4000-8000-000000000090";
    try {
      return await operation(requestId);
    } catch (error) {
      const candidate = error as {
        code?: unknown;
        message?: unknown;
        httpStatus?: unknown;
      };
      return Response.json({
        requestId,
        status: "error",
        data: null,
        errors: [{
          code: typeof candidate.code === "string" ? candidate.code : "ERROR",
          message: typeof candidate.message === "string"
            ? candidate.message
            : "error",
        }],
      }, {
        status: typeof candidate.httpStatus === "number"
          ? candidate.httpStatus
          : 500,
      });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { PATCH, POST } from "./route";

const organizationId = "43100000-0000-4000-8000-000000000001";
const branchId = "43200000-0000-4000-8000-000000000001";
const clientId = "43400000-0000-4000-8000-000000000001";
const communicationKey = "43c00000-0000-4000-8000-000000000001";
const versionId = "43b00000-0000-4000-8000-000000000001";
const correctedVersionId = "43b00000-0000-4000-8000-000000000002";
const key = "43700000-0000-4000-8000-000000000001";
const actor = {
  organizationId,
  branchId,
  organizationName: "測試機構",
  branchName: "測試分支",
  userId: "43000000-0000-4000-8000-000000000001",
  displayName: "測試人員",
  roles: ["case_manager_social_worker"],
  scopes: [
    "care_communications.read",
    "care_communications.manage",
    "care_communications.correct",
  ],
  assuranceLevel: "aal2",
  recentAal2At: null,
  demo: false,
};
const createBody = {
  action: "create",
  clientId,
  subject: "今日照顧摘要",
  body: "請登入系統查看。",
  occurredAt: "2026-09-02T09:00:00+08:00",
  attachments: [],
};

function request(method: "POST" | "PATCH") {
  return new Request("https://example.invalid/api/care-communications", {
    method,
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: "{}",
  });
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    operation_id: "43700000-0000-4000-8000-000000000002",
    operation_kind: "create",
    communication_key: communicationKey,
    version_id: versionId,
    communication_version: 1,
    previous_version_id: null,
    record_kind: "original",
    client_id: clientId,
    recipient_count: 1,
    delivery_status: "queued",
    read_status: "not_configured",
    family_confirmation_status: "not_configured",
    attachment_state: "none",
    submitted_at: "2026-09-02T01:01:00.000Z",
    replayed: false,
    ...overrides,
  };
}

describe("care communication API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue(createBody);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it("binds tenant, branch and client and returns only a correlated queued receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt(), error: null });
    const response = await POST(request("POST"));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      action: "create",
      clientId,
      deliveryStatus: "queued",
      readStatus: "not_configured",
      familyConfirmationStatus: "not_configured",
      persisted: true,
      demo: false,
    });
    expect(stubs.requireRecentAal2).toHaveBeenCalledWith(actor);
    expect(stubs.rpc).toHaveBeenCalledWith(
      "create_care_communication",
      expect.objectContaining({
        p_expected_organization_id: organizationId,
        p_expected_branch_id: branchId,
        p_client_id: clientId,
        p_attachments: [],
        p_idempotency_key: key,
      }),
    );
  });

  it("appends a correction from the exact current version", async () => {
    stubs.readJsonObject.mockResolvedValue({
      action: "correct",
      clientId,
      communicationKey,
      previousVersionId: versionId,
      expectedVersion: 1,
      subject: "今日照顧摘要（更正）",
      body: "補充活動地點。",
      correctionReason: "補充活動地點",
      attachments: [],
    });
    stubs.maybeSingle.mockResolvedValue({ data: receipt({
      operation_kind: "correct",
      version_id: correctedVersionId,
      communication_version: 2,
      previous_version_id: versionId,
      record_kind: "correction",
    }), error: null });
    const response = await PATCH(request("PATCH"));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      action: "correct",
      communicationKey,
      versionId: correctedVersionId,
      communicationVersion: 2,
      previousVersionId: versionId,
    });
    expect(stubs.rpc).toHaveBeenCalledWith(
      "correct_care_communication",
      expect.objectContaining({
        p_communication_key: communicationKey,
        p_previous_version_id: versionId,
        p_expected_version: 1,
        p_correction_reason: "補充活動地點",
      }),
    );
  });

  it("fails closed on a forged delivered/read receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt({
      delivery_status: "delivered",
      read_status: "read",
    }), error: null });
    const response = await POST(request("POST"));
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.errors[0].code).toBe("CARE_COMMUNICATION_RECEIPT_INVALID");
  });

  it("rejects URLs and trusted attachment references before the database", async () => {
    stubs.readJsonObject.mockResolvedValue({
      ...createBody,
      attachments: [{
        reference: "https://example.invalid/file.pdf",
        sha256: "a".repeat(64),
      }],
    });
    let response = await POST(request("POST"));
    expect(response.status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();

    stubs.readJsonObject.mockResolvedValue({
      ...createBody,
      attachments: [{
        reference: "trusted-upload:43e00000-0000-4000-8000-000000000001",
        sha256: "a".repeat(64),
      }],
    });
    response = await POST(request("POST"));
    expect(response.status).toBe(503);
    expect((await response.json()).errors[0].code)
      .toBe("ATTACHMENT_PIPELINE_NOT_CONFIGURED");
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("authorizes and enforces recent AAL2 before reading request content", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true });
    let response = await POST(request("POST"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();

    stubs.authorizeStaffRequest.mockResolvedValue({
      ...actor,
      demo: false,
      scopes: ["care_communications.read"],
    });
    response = await POST(request("POST"));
    expect(response.status).toBe(403);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();

    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(
      new Error("需要近期雙因素驗證"),
      { code: "AAL2_REQUIRED", httpStatus: 403 },
    ));
    response = await POST(request("POST"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("maps stale-version database evidence to a retryable conflict", async () => {
    stubs.maybeSingle.mockResolvedValue({
      data: null,
      error: { code: "40001" },
    });
    const response = await POST(request("POST"));
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.errors[0].code).toBe("CARE_COMMUNICATION_VERSION_CONFLICT");
  });
});
