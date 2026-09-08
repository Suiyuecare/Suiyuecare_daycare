import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(), readJsonObject: vi.fn(), requireRecentAal2: vi.fn(),
  createServerSupabaseClient: vi.fn(), rpc: vi.fn(), maybeSingle: vi.fn(),
}));
vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  readJsonObject: stubs.readJsonObject,
  requireRecentAal2: stubs.requireRecentAal2,
  databaseFailure: (code: string, message: string, httpStatus = 500) => Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "30000000-0000-4000-8000-000000000090";
    try { return await operation(requestId); } catch (error) {
      const candidate = error as { code?: unknown; message?: unknown; httpStatus?: unknown };
      return Response.json({ requestId, status: "error", data: null, errors: [{
        code: typeof candidate.code === "string" ? candidate.code : "ERROR",
        message: typeof candidate.message === "string" ? candidate.message : "error",
      }] }, { status: typeof candidate.httpStatus === "number" ? candidate.httpStatus : 500,
        headers: { "Cache-Control": "private, no-store, max-age=0" } });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: stubs.createServerSupabaseClient }));

import { PATCH, POST } from "./route";

const organizationId = "30000000-0000-4000-8000-000000000001";
const branchId = "30000000-0000-4000-8000-000000000002";
const activityId = "30000000-0000-4000-8000-000000000003";
const scheduleId = "30000000-0000-4000-8000-000000000004";
const statusId = "30000000-0000-4000-8000-000000000005";
const responsibleId = "30000000-0000-4000-8000-000000000006";
const clientId = "30000000-0000-4000-8000-000000000007";
const key = "30000000-0000-4000-8000-000000000008";
const actor = { organizationId, branchId, organizationName: "測試機構", branchName: "測試分支",
  userId: "30000000-0000-4000-8000-000000000009", displayName: "測試人員", roles: ["social_worker"],
  scopes: ["clients.read", "activity.read", "activity.manage", "activity.cancel"], assuranceLevel: "aal2",
  recentAal2At: "2026-09-01T00:00:00.000Z", demo: false };
const createBody = { action: "create", activityType: "健康促進", title: "團體活動",
  searchSummary: "機構活動摘要", location: "一樓", startsAt: "2026-09-03T09:00:00+08:00",
  endsAt: "2026-09-03T10:00:00+08:00", responsibleUserId: responsibleId,
  participantClientIds: [clientId], capacity: 12 };
function request(method: "POST" | "PATCH") { return new Request("https://example.invalid/api/activities", {
  method, headers: { "content-type": "application/json", "idempotency-key": key }, body: "{}",
}); }
function receipt(overrides: Record<string, unknown> = {}) { return {
  operation_id: "30000000-0000-4000-8000-000000000010", operation_kind: "create",
  activity_id: activityId, schedule_version_id: scheduleId, schedule_version: 1,
  previous_schedule_version_id: null, status_event_id: statusId, status_sequence: 1,
  previous_status_event_id: null, status: "scheduled", responsible_user_id: responsibleId,
  participant_client_ids: [clientId], committed_at: "2026-09-01T00:00:00.000Z", replayed: false,
  ...overrides,
}; }

describe("activity API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks(); stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined); stubs.readJsonObject.mockResolvedValue(createBody);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it("binds tenant and branch from actor and correlates a create receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt(), error: null });
    const response = await POST(request("POST")); const body = await response.json();
    expect(response.status).toBe(201); expect(body.data).toMatchObject({ activityId, scheduleVersion: 1, persisted: true });
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_activity", expect.objectContaining({
      p_expected_organization_id: organizationId, p_expected_branch_id: branchId,
      p_participant_client_ids: [clientId], p_idempotency_key: key,
    }));
  });

  it("fails closed on unknown or mismatched 2xx receipt data", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt({ responsible_user_id: "30000000-0000-4000-8000-000000000099" }), error: null });
    const response = await POST(request("POST")); const body = await response.json();
    expect(response.status).toBe(502); expect(body.errors[0].code).toBe("ACTIVITY_RECEIPT_INVALID");
  });

  it("rejects demo and missing narrow permission without a database mutation", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true });
    let response = await POST(request("POST")); expect(response.status).toBe(403); expect(stubs.rpc).not.toHaveBeenCalled();
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: false, scopes: ["clients.read", "activity.read"] });
    response = await POST(request("POST")); expect(response.status).toBe(403); expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("requires recent AAL2 before cancellation reaches the database", async () => {
    stubs.readJsonObject.mockResolvedValue({ action: "cancel", activityId,
      expectedScheduleVersionId: scheduleId, expectedScheduleVersion: 1,
      expectedStatusEventId: statusId, expectedStatusSequence: 1, reason: "場地取消" });
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("reauth"), { code: "RECENT_AAL2_REQUIRED", httpStatus: 403 }));
    const response = await PATCH(request("PATCH")); expect(response.status).toBe(403);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("rejects method/action mismatch and maps stale conflicts", async () => {
    let response = await PATCH(request("PATCH")); expect(response.status).toBe(400);
    stubs.readJsonObject.mockResolvedValue({ action: "start", activityId,
      expectedScheduleVersionId: scheduleId, expectedScheduleVersion: 1,
      expectedStatusEventId: statusId, expectedStatusSequence: 1 });
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code: "40001" } });
    response = await PATCH(request("PATCH")); const body = await response.json();
    expect(response.status).toBe(409); expect(body.errors[0].code).toBe("ACTIVITY_VERSION_CONFLICT");
  });
});
