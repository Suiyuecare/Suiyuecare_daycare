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
    const requestId = "39800000-0000-4000-8000-000000000090";
    try {
      return await operation(requestId);
    } catch (error) {
      const value = error as { code?: unknown; message?: unknown; httpStatus?: unknown };
      return Response.json({
        requestId, status: "error", data: null,
        errors: [{
          code: typeof value.code === "string" ? value.code : "ERROR",
          message: typeof value.message === "string" ? value.message : "error",
        }],
      }, { status: typeof value.httpStatus === "number" ? value.httpStatus : 500 });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { POST } from "./route";

const organizationId = "39100000-0000-4000-8000-000000000201";
const branchId = "39200000-0000-4000-8000-000000000201";
const clientId = "39400000-0000-4000-8000-000000000201";
const key = "39600000-0000-4000-8000-000000000201";
const actor = {
  organizationId, branchId, organizationName: "合成機構", branchName: "合成分支",
  userId: "39000000-0000-4000-8000-000000000201", displayName: "合成人員",
  roles: ["organization_manager"],
  scopes: [
    "clients.read", "referral_management.read", "referral_management.create",
    "referral_management.submit", "referral_management.receive",
    "referral_management.respond", "referral_management.close", "referral_management.correct",
  ],
  assuranceLevel: "aal2", recentAal2At: null, demo: false,
};
const createBody = {
  action: "create", clientId, receivingUnitState: "missing",
  receivingUnitCode: null, receivingUnitName: null,
  referralDate: "2026-09-02T09:00:00+08:00",
  referralReason: "合成轉介原因摘要",
};

function request() {
  return new Request("https://example.invalid/api/referrals", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: "{}",
  });
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: organizationId, branch_id: branchId,
    operation_id: "39600000-0000-4000-8000-000000000202",
    operation_kind: "create", referral_key: "39600000-0000-4000-8000-000000000203",
    event_id: "39600000-0000-4000-8000-000000000204", event_sequence: 1,
    previous_event_id: null, event_kind: "created", referral_status: "draft",
    receiving_unit_state: "missing", notification_count: 1,
    notification_queue_status: "queued", notification_provider_status: "not_configured",
    external_delivery_status: "not_configured", delivery_claim: "no_external_delivery_claim",
    attachment_status: "not_configured", export_status: "not_configured",
    committed_at: "2026-09-02T01:01:00Z", replayed: false,
    ...overrides,
  };
}

describe("Page 39 referral management API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue(createBody);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it("binds tenant scope and returns a correlated fail-closed receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt(), error: null });
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      organizationId, branchId, operationKind: "create", eventSequence: 1,
      referralStatus: "draft", receivingUnitState: "missing",
      notificationQueueStatus: "queued", notificationProviderStatus: "not_configured",
      externalDeliveryStatus: "not_configured", deliveryClaim: "no_external_delivery_claim",
      attachmentStatus: "not_configured", exportStatus: "not_configured",
      persisted: true, demo: false,
    });
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_referral_management",
      expect.objectContaining({
        p_expected_organization_id: organizationId,
        p_expected_branch_id: branchId, p_client_id: clientId,
        p_receiving_unit_state: "missing", p_receiving_unit_code: null,
        p_idempotency_key: key,
      }));
    expect(stubs.requireRecentAal2).toHaveBeenCalledOnce();
  });

  it("returns HTTP 200 only for an exact replay receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt({ replayed: true }), error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
  });

  it("requires recent AAL2 for response writes too", async () => {
    stubs.readJsonObject.mockResolvedValue({
      action: "respond", referralKey: "39600000-0000-4000-8000-000000000203",
      previousEventId: "39600000-0000-4000-8000-000000000204",
      expectedSequence: 3, entryContent: "人工登錄合成回覆",
    });
    stubs.maybeSingle.mockResolvedValue({ data: receipt({
      operation_kind: "respond", event_kind: "response_recorded",
      event_sequence: 4, previous_event_id: "39600000-0000-4000-8000-000000000204",
      referral_status: "responded", receiving_unit_state: "manual_unstandardized",
    }), error: null });
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(stubs.requireRecentAal2).toHaveBeenCalledOnce();
  });

  it("authorizes both read scopes before parsing content", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true });
    let response = await POST(request());
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: false,
      scopes: ["referral_management.read"] });
    response = await POST(request());
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: false,
      scopes: ["clients.read"] });
    response = await POST(request());
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("fails closed on forged tenant or external delivery receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt({
      organization_id: actor.userId, external_delivery_status: "delivered",
    }), error: null });
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.errors[0].code).toBe("REFERRAL_MANAGEMENT_RECEIPT_INVALID");
  });

  it("maps stale expected-sequence evidence to a retryable conflict", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code: "40001" } });
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.errors[0].code).toBe("REFERRAL_MANAGEMENT_SEQUENCE_CONFLICT");
  });
});
