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
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "29800000-0000-4000-8000-000000000099";
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

import { PATCH, POST } from "./route";

const organizationId = "29100000-0000-4000-8000-000000000001";
const branchId = "29200000-0000-4000-8000-000000000001";
const clientId = "29400000-0000-4000-8000-000000000001";
const recordKey = "29700000-0000-4000-8000-000000000001";
const draftVersionId = "29710000-0000-4000-8000-000000000001";
const signedVersionId = "29710000-0000-4000-8000-000000000002";
const operationId = "29800000-0000-4000-8000-000000000001";
const idempotencyKey = "29900000-0000-4000-8000-000000000001";

const actor = {
  organizationId,
  organizationName: "測試機構",
  branchId,
  branchName: "測試分支",
  userId: "29000000-0000-4000-8000-000000001001",
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

const createBody = {
  action: "create_draft",
  clientId,
  occurredAt: "2026-09-02T01:00:00Z",
  serviceType: "家庭支持",
  serviceContent: "合成服務內容",
  serviceResult: "合成服務結果",
};

function request(method: "POST" | "PATCH") {
  return new Request("https://example.invalid/api/social-work-records", {
    method,
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: "{}",
  });
}

function recordReceipt(overrides: Record<string, unknown> = {}) {
  return {
    operation_id: operationId,
    record_key: recordKey,
    version_id: draftVersionId,
    record_version: 1,
    record_state: "draft",
    committed_at: "2026-09-02T01:15:00Z",
    replayed: false,
    ...overrides,
  };
}

function followUpReceipt(overrides: Record<string, unknown> = {}) {
  return {
    operation_id: operationId,
    record_key: recordKey,
    follow_up_event_id: "29720000-0000-4000-8000-000000000001",
    follow_up_sequence: 1,
    follow_up_status: "pending",
    committed_at: "2026-09-02T01:30:00Z",
    replayed: false,
    ...overrides,
  };
}

describe("social-work service API boundary", () => {
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
      "SOCIAL_WORK_NOT_AUTHORIZED"],
  ])("rejects a denied create before detailed body parsing", async (denied, code) => {
    stubs.authorizeStaffRequest.mockResolvedValue(denied);
    const response = await POST(request("POST"));
    expect(response.status).toBe(403);
    expect((await response.json()).errors[0].code).toBe(code);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("binds tenant scope from the actor and returns a strict create receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: recordReceipt(), error: null });
    const response = await POST(request("POST"));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      receiptKind: "record",
      action: "create_draft",
      recordKey,
      recordVersion: 1,
      recordState: "draft",
      persisted: true,
      demo: false,
    });
    expect(stubs.rpc).toHaveBeenCalledWith(
      "create_social_work_service_draft",
      expect.objectContaining({
        p_expected_organization_id: organizationId,
        p_expected_branch_id: branchId,
        p_client_id: clientId,
        p_occurred_at: "2026-09-02T01:00:00.000Z",
        p_idempotency_key: idempotencyKey,
      }),
    );
  });

  it("fails closed on a forged database receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({
      data: recordReceipt({ record_version: 2 }), error: null,
    });
    const response = await POST(request("POST"));
    expect(response.status).toBe(502);
    expect((await response.json()).errors[0].code)
      .toBe("SOCIAL_WORK_RECEIPT_INVALID");
  });

  it("requires recent AAL2 before executing a signed correction", async () => {
    stubs.readJsonObject.mockResolvedValue({
      action: "correct",
      clientId,
      recordKey,
      previousVersionId: signedVersionId,
      expectedVersion: 2,
      occurredAt: "2026-09-02T01:00:00Z",
      serviceType: "家庭支持",
      serviceContent: "更正合成內容",
      serviceResult: "更正合成結果",
      correctionReason: "修正實際事實",
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

  it("correlates a signed version to the expected immutable chain", async () => {
    stubs.readJsonObject.mockResolvedValue({
      action: "sign",
      clientId,
      recordKey,
      previousVersionId: draftVersionId,
      expectedVersion: 1,
    });
    stubs.maybeSingle.mockResolvedValue({
      data: recordReceipt({
        version_id: signedVersionId,
        record_version: 2,
        record_state: "signed",
      }),
      error: null,
    });
    const response = await PATCH(request("PATCH"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(stubs.requireRecentAal2).toHaveBeenCalledWith(actor);
    expect(body.data).toMatchObject({
      action: "sign", recordVersion: 2, recordState: "signed",
    });
  });

  it("routes follow-up fields without inventing notification delivery", async () => {
    stubs.readJsonObject.mockResolvedValue({
      action: "track",
      clientId,
      recordKey,
      serviceVersionId: signedVersionId,
      expectedSequence: 0,
      dueOn: "2026-09-08",
      followUpPlan: "合成追蹤計畫",
    });
    stubs.maybeSingle.mockResolvedValue({ data: followUpReceipt(), error: null });
    const response = await PATCH(request("PATCH"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      receiptKind: "follow_up",
      action: "track",
      followUpSequence: 1,
      followUpStatus: "pending",
      persisted: true,
    });
    expect(stubs.rpc).toHaveBeenCalledWith(
      "mutate_social_work_follow_up",
      expect.objectContaining({
        p_action: "track",
        p_due_on: "2026-09-08",
        p_follow_up_plan: "合成追蹤計畫",
        p_follow_up_outcome: null,
        p_transition_reason: null,
      }),
    );
  });

  it("maps stale database versions to a deterministic conflict", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code: "40001" } });
    const response = await POST(request("POST"));
    expect(response.status).toBe(409);
    expect((await response.json()).errors[0].code)
      .toBe("SOCIAL_WORK_VERSION_CONFLICT");
  });
});
