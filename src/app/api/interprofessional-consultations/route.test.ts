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
    const requestId = "37800000-0000-4000-8000-000000000090";
    try { return await operation(requestId); } catch (error) {
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

import { POST } from "./route";

const organizationId = "37100000-0000-4000-8000-000000000201";
const branchId = "37200000-0000-4000-8000-000000000201";
const clientId = "37300000-0000-4000-8000-000000000201";
const actorId = "37400000-0000-4000-8000-000000000201";
const key = "37500000-0000-4000-8000-000000000201";
const actor = {
  organizationId, branchId, organizationName: "合成機構", branchName: "合成分支",
  userId: actorId, displayName: "合成人員", roles: ["organization_manager"],
  scopes: ["clients.read", "interprofessional_consultations.read", "interprofessional_consultations.create",
    "interprofessional_consultations.assign", "interprofessional_consultations.respond",
    "interprofessional_consultations.close"],
  assuranceLevel: "aal2", recentAal2At: null, demo: false,
};
const createBody = {
  action: "create", clientId, assigneeUserId: null, disciplineCode: "PT-MANUAL",
  disciplineLabel: "物理治療", urgency: "soon",
  requestedAt: "2026-09-02T09:00:00+08:00", deadlineState: "missing", dueAt: null,
  problemSummary: "合成跨專業問題摘要",
};
function request(action = "create") {
  return new Request("https://example.invalid/api/interprofessional-consultations", {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": key,
      "x-interprofessional-consultation-action": action },
    body: "{}",
  });
}
function receipt(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: organizationId, branch_id: branchId,
    operation_id: "37600000-0000-4000-8000-000000000201",
    operation_kind: "create", consultation_key: "37600000-0000-4000-8000-000000000202",
    event_id: "37600000-0000-4000-8000-000000000203", event_sequence: 1,
    previous_event_id: null, event_kind: "created", consultation_status: "unassigned",
    assignment_state: "unassigned", assignee_user_id: null, deadline_state: "missing",
    notification_count: 1, notification_queue_status: "queued",
    notification_delivery_claim: "queued_not_delivered",
    external_provider_status: "not_configured", committed_at: "2026-09-02T01:01:00Z",
    replayed: false, ...overrides,
  };
}

describe("Page 37 interprofessional consultation API", () => {
  beforeEach(() => {
    vi.clearAllMocks(); stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue(createBody);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it("binds actor tenant scope and returns a correlated queued-only receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt(), error: null });
    const response = await POST(request()); const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({ organizationId, branchId, operationKind: "create",
      eventSequence: 1, deadlineState: "missing", notificationQueueStatus: "queued",
      notificationDeliveryClaim: "queued_not_delivered",
      externalProviderStatus: "not_configured", persisted: true, demo: false });
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_interprofessional_consultation",
      expect.objectContaining({ p_expected_organization_id: organizationId,
        p_expected_branch_id: branchId, p_client_id: clientId,
        p_deadline_state: "missing", p_due_at: null, p_idempotency_key: key }));
    expect(stubs.requireRecentAal2).toHaveBeenCalledOnce();
  });

  it("allows an MFA reply without demanding a fresh high-risk reauth", async () => {
    const consultationKey = "37600000-0000-4000-8000-000000000210";
    const previousEventId = "37600000-0000-4000-8000-000000000211";
    stubs.readJsonObject.mockResolvedValue({ action: "reply", consultationKey,
      previousEventId, expectedSequence: 1, entryContent: "合成專業回覆內容" });
    stubs.maybeSingle.mockResolvedValue({ data: receipt({ operation_kind: "reply",
      consultation_key: consultationKey, event_id: "37600000-0000-4000-8000-000000000212",
      event_sequence: 2, previous_event_id: previousEventId, event_kind: "reply",
      consultation_status: "answered", assignment_state: "assigned",
      assignee_user_id: actorId, deadline_state: "dated", notification_count: 2,
    }), error: null });
    const response = await POST(request("reply"));
    expect(response.status).toBe(201);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
  });

  it("fails closed on a forged tenant or external delivery receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt({
      organization_id: actorId, notification_delivery_claim: "delivered",
    }), error: null });
    const response = await POST(request()); const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.errors[0].code).toBe("INTERPROFESSIONAL_CONSULTATION_RECEIPT_INVALID");
  });

  it("authorizes before parsing so invalid content is not an oracle", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true });
    let response = await POST(request()); expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: false, scopes: [] });
    response = await POST(request()); expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: false,
      scopes: ["interprofessional_consultations.read"] });
    response = await POST(request()); expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: false,
      scopes: ["clients.read"] });
    response = await POST(request()); expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("rejects an unauthorized action and stale high-risk reauth before parsing the body", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, scopes: [
      "clients.read", "interprofessional_consultations.read",
    ] });
    let response = await POST(request("create"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();

    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockRejectedValueOnce(Object.assign(new Error("reauth"), {
      code: "RECENT_AAL2_REQUIRED", httpStatus: 403,
    }));
    response = await POST(request("create"));
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("rejects missing or mismatched action headers without reaching the database", async () => {
    let response = await POST(request("reply"));
    expect(response.status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();

    const missingHeader = new Request("https://example.invalid/api/interprofessional-consultations", {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": key },
      body: "{}",
    });
    response = await POST(missingHeader);
    expect(response.status).toBe(400);
    expect(stubs.readJsonObject).toHaveBeenCalledOnce();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("maps stale expected-sequence evidence to a retryable conflict", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code: "40001" } });
    const response = await POST(request()); const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.errors[0].code).toBe("INTERPROFESSIONAL_CONSULTATION_SEQUENCE_CONFLICT");
  });
});
