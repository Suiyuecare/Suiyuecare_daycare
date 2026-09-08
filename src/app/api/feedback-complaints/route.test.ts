import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ authorizeStaffRequest: vi.fn(),
  readJsonObject: vi.fn(), requireRecentAal2: vi.fn(),
  createServerSupabaseClient: vi.fn(), rpc: vi.fn(), maybeSingle: vi.fn() }));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  readJsonObject: stubs.readJsonObject,
  requireRecentAal2: stubs.requireRecentAal2,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "56990000-0000-4000-8000-000000000001";
    try { return await operation(requestId); } catch (error) {
      const value = error as { code?: string; message?: string; httpStatus?: number };
      return Response.json({ requestId, status: "error", data: null,
        errors: [{ code: value.code ?? "ERROR", message: value.message ?? "error" }] },
      { status: value.httpStatus ?? 500 });
    }
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: stubs.createServerSupabaseClient,
}));

import { PATCH, POST } from "./route";

const organizationId = "56110000-0000-4000-8000-000000000001";
const branchId = "56120000-0000-4000-8000-000000000001";
const userId = "56130000-0000-4000-8000-000000000001";
const caseId = "56140000-0000-4000-8000-000000000001";
const eventId = "56150000-0000-4000-8000-000000000001";
const ruleId = "56160000-0000-4000-8000-000000000001";
const key = "56170000-0000-4000-8000-000000000001";
const assigneeId = "56180000-0000-4000-8000-000000000001";
const actor = { organizationId, organizationName: "合成機構", branchId,
  branchName: "合成分支", userId, displayName: "合成申訴主管",
  roles: ["branch_supervisor"], scopes: ["complaints.read", "complaints.manage",
    "complaints.sensitive", "complaints.close"], assuranceLevel: "aal2",
  recentAal2At: "2026-09-07T08:00:00Z", demo: false };
const createBody = { action: "create", deadline_rule_id: ruleId,
  received_at: "2026-09-07T09:00:00+08:00", reporter_name: "合成陳述人",
  reporter_contact: "feedback@example.invalid", subject: "合成安全意見",
  description: "合成案件內容" };
const receipt = { operation_id: key, action: "create", case_id: caseId,
  case_number: "FC-20260907-A1B2C3D4", event_id: eventId, version: 1,
  status: "escalated", effective_risk: "high",
  due_at: "2026-09-09T01:00:00Z", committed_at: "2026-09-07T01:01:00Z",
  replayed: false };

function request(method: "POST" | "PATCH", operation?: string) {
  return new Request("https://example.invalid/api/feedback-complaints", {
    method, body: "{}", headers: { "content-type": "application/json",
      "idempotency-key": key,
      ...(operation ? { "x-feedback-operation": operation } : {}) },
  });
}

describe("Page 56 feedback and complaint API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue(createBody);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
    stubs.maybeSingle.mockResolvedValue({ data: receipt, error: null });
  });

  it("requires the exact operation header before authority or body access", async () => {
    const response = await POST(request("POST"));
    expect(response.status).toBe(400);
    expect(stubs.authorizeStaffRequest).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...actor, demo: true }, "DEMO_READ_ONLY"],
    [{ ...actor, scopes: ["complaints.read"] }, "FEEDBACK_NOT_AUTHORIZED"],
  ])("rejects denied intake before reading sensitive content", async (denied, code) => {
    stubs.authorizeStaffRequest.mockResolvedValue(denied);
    const response = await POST(request("POST", "create"));
    expect(response.status).toBe(403);
    expect((await response.json()).errors[0].code).toBe(code);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("binds intake to tenant, exact rule, content and idempotency", async () => {
    const response = await POST(request("POST", "create"));
    expect(response.status).toBe(201);
    expect(stubs.rpc).toHaveBeenCalledWith("submit_feedback_complaint", {
      p_expected_organization_id: organizationId,
      p_expected_branch_id: branchId,
      p_deadline_rule_id: ruleId,
      p_received_at: "2026-09-07T01:00:00.000Z",
      p_reporter_name: "合成陳述人",
      p_reporter_contact: "feedback@example.invalid",
      p_subject: "合成安全意見",
      p_description: "合成案件內容",
      p_idempotency_key: key,
    });
    expect((await response.json()).data).toMatchObject({ caseId, version: 1,
      effectiveRisk: "high", persisted: true, demo: false });
  });

  it("returns an exact intake replay as 200 instead of duplicating a case", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: { ...receipt, replayed: true }, error: null });
    expect((await POST(request("POST", "create"))).status).toBe(200);
  });

  it("authorizes sensitive correction and recent AAL2 before body access", async () => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("reauth"),
      { code: "AAL2_REQUIRED", httpStatus: 403 }));
    const response = await PATCH(request("PATCH", "correct"));
    expect(response.status).toBe(403);
    expect(stubs.requireRecentAal2).toHaveBeenCalledWith(actor);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("requires complaints.sensitive independently for correction", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor,
      scopes: actor.scopes.filter((scope) => scope !== "complaints.sensitive") });
    const response = await PATCH(request("PATCH", "correct"));
    expect(response.status).toBe(403);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("sends an expected-version assignment with no surplus mutation fields", async () => {
    stubs.readJsonObject.mockResolvedValue({ action: "assign", case_id: caseId,
      expected_version: 1, assignee_membership_id: assigneeId, note: "合成指派" });
    stubs.maybeSingle.mockResolvedValue({ data: { ...receipt, action: "assign",
      version: 2, status: "assigned", effective_risk: "standard" }, error: null });
    const response = await PATCH(request("PATCH", "assign"));
    expect(response.status).toBe(200);
    expect(stubs.rpc).toHaveBeenCalledWith("append_feedback_complaint_event",
      expect.objectContaining({ p_action: "assign", p_case_id: caseId,
        p_expected_version: 1, p_assignee_membership_id: assigneeId,
        p_note: "合成指派", p_corrected_event_id: null, p_resolution: null,
        p_idempotency_key: key }));
  });

  it("rejects a header/body disagreement without touching the database", async () => {
    stubs.readJsonObject.mockResolvedValue({ action: "progress", case_id: caseId,
      expected_version: 1, note: "合成處理" });
    const response = await PATCH(request("PATCH", "assign"));
    expect(response.status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("fails closed on an uncorrelated database receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: { ...receipt, version: 2 }, error: null });
    const response = await POST(request("POST", "create"));
    expect(response.status).toBe(502);
    expect((await response.json()).errors[0].code).toBe("FEEDBACK_RECEIPT_INVALID");
  });

  it.each([
    ["42501", 403, "FEEDBACK_NOT_AUTHORIZED"],
    ["40001", 409, "FEEDBACK_VERSION_CONFLICT"],
    ["23505", 409, "FEEDBACK_IDEMPOTENCY_CONFLICT"],
    ["23514", 409, "FEEDBACK_STATE_CONFLICT"],
    ["22023", 400, "INVALID_FEEDBACK_OPERATION"],
    ["XX000", 500, "FEEDBACK_SAVE_FAILED"],
  ])("maps SQLSTATE %s without exposing database details", async (code, status, expected) => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code, message: "private" } });
    const response = await POST(request("POST", "create"));
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body.errors[0].code).toBe(expected);
    expect(JSON.stringify(body)).not.toContain("private");
  });
});
