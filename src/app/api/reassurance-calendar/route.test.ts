import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(), requireRecentAal2: vi.fn(),
  readJsonObject: vi.fn(), createServerSupabaseClient: vi.fn(),
  rpc: vi.fn(), maybeSingle: vi.fn(),
}));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  requireRecentAal2: stubs.requireRecentAal2,
  readJsonObject: stubs.readJsonObject,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "44800000-0000-4000-8000-000000000090";
    try { return await operation(requestId); } catch (error) {
      const candidate = error as { code?: unknown; message?: unknown; httpStatus?: unknown };
      return Response.json({ requestId, status: "error", data: null, errors: [{
        code: typeof candidate.code === "string" ? candidate.code : "ERROR",
        message: typeof candidate.message === "string" ? candidate.message : "error",
      }] }, { status: typeof candidate.httpStatus === "number" ? candidate.httpStatus : 500 });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { POST } from "./route";

const organizationId = "44100000-0000-4000-8000-000000000201";
const branchId = "44200000-0000-4000-8000-000000000201";
const eventKey = "44300000-0000-4000-8000-000000000201";
const versionId = "44400000-0000-4000-8000-000000000201";
const key = "44600000-0000-4000-8000-000000000201";
const responsible = "44000000-0000-4000-8000-000000000201";
const actor = {
  organizationId, branchId, organizationName: "測試機構", branchName: "測試分支",
  userId: responsible, displayName: "測試人員", roles: ["organization_manager"],
  scopes: ["reassurance_calendar.read", "reassurance_calendar.manage", "reassurance_calendar.cancel"],
  assuranceLevel: "aal2", recentAal2At: null, demo: false,
};
const createBody = {
  action: "create", category: "care", title: "合成安心行程",
  summary: "合成行程摘要", startsAt: "2026-09-10T09:00:00+08:00",
  endsAt: "2026-09-10T10:00:00+08:00", location: "合成活動室",
  audienceKind: "all_branch_clients", targetClientIds: [], responsibleUserId: responsible,
};

function request() {
  return new Request("https://example.invalid/api/reassurance-calendar", {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": key },
    body: "{}",
  });
}
function receipt(overrides: Record<string, unknown> = {}) {
  return {
    operation_id: "44700000-0000-4000-8000-000000000201",
    operation_kind: "create", event_key: eventKey, version_id: versionId,
    event_version: 1, previous_version_id: null, record_kind: "original",
    event_status: "scheduled", event_category: "care", audience_count: 1,
    publication_state: "published", signature_status: "not_configured",
    notification_status: "not_configured", notification_delivery: "none_not_sent",
    committed_at: "2026-09-02T01:01:00.000Z", replayed: false, ...overrides,
  };
}

describe("Page 44 reassurance calendar API", () => {
  beforeEach(() => {
    vi.clearAllMocks(); stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue(createBody);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it("binds tenant scope and returns only a correlated published receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt(), error: null });
    const response = await POST(request()); const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({ operationKind: "create", eventKey,
      eventVersion: 1, eventStatus: "scheduled", publicationState: "published",
      signatureStatus: "not_configured", notificationStatus: "not_configured",
      notificationDelivery: "none_not_sent", persisted: true, demo: false });
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_reassurance_calendar_event",
      expect.objectContaining({ p_expected_organization_id: organizationId,
        p_expected_branch_id: branchId, p_action: "create",
        p_target_client_ids: [], p_idempotency_key: key }));
  });

  it("sends cancellation as a narrow reasoned version operation", async () => {
    stubs.readJsonObject.mockResolvedValue({ action: "cancel", eventKey,
      previousVersionId: versionId, expectedVersion: 1, reason: "家屬另約時間" });
    const cancelledId = "44400000-0000-4000-8000-000000000202";
    stubs.maybeSingle.mockResolvedValue({ data: receipt({
      operation_kind: "cancel", version_id: cancelledId, event_version: 2,
      previous_version_id: versionId, record_kind: "cancellation",
      event_status: "cancelled",
    }), error: null });
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_reassurance_calendar_event",
      expect.objectContaining({ p_action: "cancel", p_event_key: eventKey,
        p_previous_version_id: versionId, p_reason: "家屬另約時間" }));
  });

  it("fails closed on a forged delivered or signed receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt({
      signature_status: "signed", notification_delivery: "delivered",
    }), error: null });
    const response = await POST(request()); const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.errors[0].code).toBe("REASSURANCE_CALENDAR_RECEIPT_INVALID");
  });

  it("requires staff, read scope and recent AAL2 before reading content", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true });
    let response = await POST(request()); expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: false, scopes: [] });
    response = await POST(request()); expect(response.status).toBe(403);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(
      new Error("需要近期雙因素驗證"), { code: "AAL2_REQUIRED", httpStatus: 403 },
    ));
    response = await POST(request()); expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("maps stale version evidence to a retryable conflict", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code: "40001" } });
    const response = await POST(request()); const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.errors[0].code).toBe("REASSURANCE_CALENDAR_VERSION_CONFLICT");
  });
});
