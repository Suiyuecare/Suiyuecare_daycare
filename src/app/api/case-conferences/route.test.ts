import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(), requireRecentAal2: vi.fn(), readJsonObject: vi.fn(),
  createServerSupabaseClient: vi.fn(), rpc: vi.fn(), maybeSingle: vi.fn(),
}));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  requireRecentAal2: stubs.requireRecentAal2,
  readJsonObject: stubs.readJsonObject,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "38800000-0000-4000-8000-000000000090";
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

const organizationId = "38100000-0000-4000-8000-000000000201";
const branchId = "38200000-0000-4000-8000-000000000201";
const clientId = "38400000-0000-4000-8000-000000000201";
const key = "38800000-0000-4000-8000-000000000201";
const actor = {
  organizationId, branchId, organizationName: "合成機構", branchName: "合成分支",
  userId: "38000000-0000-4000-8000-000000000201", displayName: "合成人員",
  roles: ["organization_manager"],
  scopes: ["clients.read", "case_conferences.read", "case_conferences.manage", "case_conferences.sign"],
  assuranceLevel: "aal2", recentAal2At: null, demo: false,
};
const createBody = {
  action: "create", clientId,
  meetingStartsAt: "2026-09-01T09:00:00+08:00",
  meetingEndsAt: "2026-09-01T10:00:00+08:00",
  problemStatement: "合成個案移位安全需跨專業研討",
  decisionSummary: "建立合成行動並於會後人工追蹤",
  attendees: [{ userId: actor.userId, attendanceStatus: "attended" }],
  actionItems: [{ actionId: "38600000-0000-4000-8000-000000000201", itemOrder: 1,
    actionText: "完成合成移位觀察摘要", responsibleUserId: actor.userId,
    deadlineState: "dated", dueDate: "2026-09-02", actionStatus: "open" }],
};

function request(operation = "create") {
  return new Request("https://example.invalid/api/case-conferences", {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": key,
      "x-case-conference-operation": operation },
    body: "{}",
  });
}
function receipt(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: organizationId, branch_id: branchId,
    operation_id: "38800000-0000-4000-8000-000000000202", operation_kind: "create",
    meeting_key: "38800000-0000-4000-8000-000000000203",
    version_id: "38800000-0000-4000-8000-000000000204", version: 1,
    previous_version_id: null, corrects_version_id: null, version_kind: "created",
    conference_status: "draft", signed_at: null, content_hash: "a".repeat(64),
    attachment_status: "not_configured", export_status: "not_configured",
    notification_status: "not_configured", external_delivery_status: "not_configured",
    delivery_claim: "no_external_delivery_claim", offline_status: "not_configured",
    committed_at: "2026-09-02T01:01:00Z", replayed: false, ...overrides,
  };
}

describe("Page 38 case conference API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue(createBody);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it("binds tenant scope and maps attendee/action snapshots", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt(), error: null });
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect((await response.json()).data).toMatchObject({
      organizationId, branchId, operationKind: "create", version: 1,
      conferenceStatus: "draft", attachmentStatus: "not_configured",
      externalDeliveryStatus: "not_configured", deliveryClaim: "no_external_delivery_claim",
      persisted: true, demo: false,
    });
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_case_conference", expect.objectContaining({
      p_expected_organization_id: organizationId, p_expected_branch_id: branchId,
      p_client_id: clientId, p_attendees: [{ user_id: actor.userId, attendance_status: "attended" }],
      p_action_items: [expect.objectContaining({ deadline_state: "dated", due_date: "2026-09-02" })],
      p_idempotency_key: key,
    }));
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
  });

  it("requires recent AAL2 for sign but not draft revision", async () => {
    stubs.readJsonObject.mockResolvedValue({
      action: "sign", meetingKey: "38800000-0000-4000-8000-000000000203",
      previousVersionId: "38800000-0000-4000-8000-000000000204", expectedVersion: 1,
    });
    stubs.maybeSingle.mockResolvedValue({ data: receipt({
      operation_kind: "sign", version: 2, previous_version_id: "38800000-0000-4000-8000-000000000204",
      version_kind: "signed", conference_status: "signed", signed_at: "2026-09-02T01:01:00Z",
    }), error: null });
    expect((await POST(request("sign"))).status).toBe(201);
    expect(stubs.requireRecentAal2).toHaveBeenCalledOnce();
  });

  it("fails before parsing for missing base or operation permissions", async () => {
    for (const scopes of [
      ["case_conferences.read", "case_conferences.manage"],
      ["clients.read", "case_conferences.manage"],
      ["clients.read", "case_conferences.read"],
    ]) {
      stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, scopes });
      expect((await POST(request())).status).toBe(403);
    }
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("checks declared operation authority and recent AAL2 before body parsing", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor,
      scopes: ["clients.read", "case_conferences.read", "case_conferences.sign"] });
    expect((await POST(request("create"))).status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();

    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor,
      scopes: ["clients.read", "case_conferences.read", "case_conferences.manage"] });
    expect((await POST(request("sign"))).status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();

    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockRejectedValueOnce(Object.assign(new Error("reauth"), {
      code: "RECENT_AAL2_REQUIRED", httpStatus: 403,
    }));
    expect((await POST(request("correct"))).status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("rejects invalid or body-mismatched operation declarations", async () => {
    expect((await POST(request("delete"))).status).toBe(400);
    expect(stubs.authorizeStaffRequest).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();

    expect((await POST(request("revise"))).status).toBe(400);
    expect(stubs.readJsonObject).toHaveBeenCalledOnce();
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("rejects demo writes before parsing", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true });
    expect((await POST(request())).status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("fails closed on forged tenant or delivery receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt({
      organization_id: actor.userId, external_delivery_status: "delivered",
    }), error: null });
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect((await response.json()).errors[0].code).toBe("CASE_CONFERENCE_RECEIPT_INVALID");
  });

  it("maps stale expected-version evidence to a retryable conflict", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code: "40001" } });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect((await response.json()).errors[0].code).toBe("CASE_CONFERENCE_VERSION_CONFLICT");
  });
});
