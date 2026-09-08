import { beforeEach, describe, expect, it, vi } from "vitest";

import { deterministicUuid } from "@/lib/integrations/security";

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
    const requestId = "63000000-0000-4000-8000-000000000099";
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

import { PATCH, POST } from "./route";

const ORG = "63000000-0000-4000-8000-000000000001";
const BRANCH = "63000000-0000-4000-8000-000000000002";
const ACTOR = "63000000-0000-4000-8000-000000000003";
const KEY = "63000000-0000-4000-8000-000000000004";
const SCHEDULE = "63000000-0000-4000-8000-000000000005";
const VERSION = "63000000-0000-4000-8000-000000000006";
const RESULT = "63000000-0000-4000-8000-000000000007";
const STAFF = "63000000-0000-4000-8000-000000000008";
const RULE = "63000000-0000-4000-8000-000000000009";
const DECISION = "63000000-0000-4000-8000-000000000010";
const HASH = "a".repeat(64);
const scopes = ["staff_scheduling.read", "staff_scheduling.manage",
  "staff_scheduling.approve", "staff_scheduling.override", "staff_certificates.read"];
const actor = { organizationId: ORG, organizationName: "合成機構",
  branchId: BRANCH, branchName: "合成分支", userId: ACTOR,
  displayName: "合成主管", roles: ["organization_manager"], scopes,
  assuranceLevel: "aal2", recentAal2At: new Date().toISOString(), demo: false };
const submitBody = { action: "create", schedule_key: SCHEDULE,
  previous_version_id: null, expected_version: 0, expected_content_hash: null,
  staff_membership_id: STAFF, starts_at: "2026-09-03T01:00:00.000Z",
  ends_at: "2026-09-03T09:00:00.000Z", role_text: "合成人工角色",
  service_need_text: "合成服務需求", facility_code: "ROOM_A",
  vehicle_code: "VAN_A", planned_clients: 6,
  revision_reason: "依人工規則建立合成班表。" };
const decisionBody = { action: "decide", schedule_version_id: VERSION,
  expected_schedule_key: SCHEDULE, expected_version: 1,
  expected_content_hash: HASH, expected_conflict_count: 2,
  expected_rule_version_id: RULE, decision: "override",
  reason: "合成獨立覆核理由" };

function request(method: "POST" | "PATCH", action?: string) {
  return new Request("http://localhost/api/staff-scheduling", { method, headers: {
    ...(action ? { "x-staff-scheduling-action": action } : {}),
    "idempotency-key": KEY, "content-type": "application/json",
  }, body: "{}" });
}

function submitResult(replayed = false) {
  return { data: { organization_id: ORG, branch_id: BRANCH,
    schedule_key: SCHEDULE, schedule_version_id: VERSION, schedule_version: 1,
    schedule_status: "draft_ready", staff_membership_id: STAFF,
    rule_version_id: RULE, conflict_count: 0, content_hash: HASH,
    committed_at: "2026-09-02T04:00:00.000Z", replayed }, error: null };
}

function decisionResult() {
  return { data: { organization_id: ORG, branch_id: BRANCH,
    schedule_key: SCHEDULE, decided_version_id: VERSION, expected_version: 1,
    decision_id: DECISION, decision: "override", result_version_id: RESULT,
    result_version: 2, result_status: "published", review_mode: "override",
    conflict_count: 2, rule_version_id: RULE, content_hash: HASH,
    decided_at: "2026-09-02T04:00:00.000Z", replayed: false }, error: null };
}

describe("Page 63 staff scheduling API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue(submitBody);
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
  });

  it.each([[POST, "POST"], [PATCH, "PATCH"]] as const)(
    "rejects %s without a governed action before auth or body", async (handler, method) => {
      const response = await handler(request(method));
      expect(response.status).toBe(400);
      expect((await response.json()).errors[0].code)
        .toBe("INVALID_STAFF_SCHEDULING_ACTION");
      expect(stubs.authorizeStaffRequest).not.toHaveBeenCalled();
      expect(stubs.readJsonObject).not.toHaveBeenCalled();
    });

  it("rejects missing manage permission before AAL2 and sensitive body parsing", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor,
      scopes: scopes.filter((scope) => scope !== "staff_scheduling.manage") });
    expect((await POST(request("POST", "submit_schedule"))).status).toBe(403);
    expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("rejects missing Page-72 read permission before body parsing", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor,
      scopes: scopes.filter((scope) => scope !== "staff_certificates.read") });
    expect((await POST(request("POST", "submit_schedule"))).status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("requires recent same-session AAL2 before body parsing", async () => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("重新驗證"),
      { code: "AAL2_REQUIRED", httpStatus: 403 }));
    expect((await POST(request("POST", "submit_schedule"))).status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("requires the separate override permission before reading an override", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor,
      scopes: scopes.filter((scope) => scope !== "staff_scheduling.override") });
    expect((await PATCH(request("PATCH", "override_schedule"))).status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("rejects demo writes before body parsing", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true });
    expect((await POST(request("POST", "submit_schedule"))).status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("binds a new draft to tenant, branch, evidence fields, and actor-scoped key", async () => {
    stubs.maybeSingle.mockResolvedValue(submitResult());
    const response = await POST(request("POST", "submit_schedule"));
    expect(response.status).toBe(201);
    expect(stubs.rpc).toHaveBeenCalledWith("submit_staff_schedule",
      expect.objectContaining({ p_expected_organization_id: ORG,
        p_expected_branch_id: BRANCH, p_schedule_key: SCHEDULE,
        p_staff_membership_id: STAFF, p_role_text: "合成人工角色",
        p_idempotency_key: deterministicUuid(
          "page63-staff-schedule-submit", ORG, ACTOR, KEY,
        ) }));
  });

  it("returns 200 only for a correlated exact replay", async () => {
    stubs.maybeSingle.mockResolvedValue(submitResult(true));
    expect((await POST(request("POST", "submit_schedule"))).status).toBe(200);
  });

  it("rejects unknown AI or attachment input before database access", async () => {
    stubs.readJsonObject.mockResolvedValue({ ...submitBody,
      ai_recommendation: "publish", attachment_path: "browser://fake" });
    expect((await POST(request("POST", "submit_schedule"))).status).toBe(400);
    expect(stubs.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("binds an override to the header, exact draft, conflicts, and rule version", async () => {
    stubs.readJsonObject.mockResolvedValue(decisionBody);
    stubs.maybeSingle.mockResolvedValue(decisionResult());
    const response = await PATCH(request("PATCH", "override_schedule"));
    expect(response.status).toBe(201);
    expect(stubs.rpc).toHaveBeenCalledWith("decide_staff_schedule",
      expect.objectContaining({ p_expected_organization_id: ORG,
        p_expected_branch_id: BRANCH, p_schedule_version_id: VERSION,
        p_expected_schedule_key: SCHEDULE, p_expected_version: 1,
        p_expected_content_hash: HASH, p_expected_conflict_count: 2,
        p_decision: "override", p_idempotency_key: deterministicUuid(
          "page63-staff-schedule-decision", ORG, ACTOR, KEY,
        ) }));
  });

  it("rejects header/body decision mismatch before database access", async () => {
    stubs.readJsonObject.mockResolvedValue(decisionBody);
    expect((await PATCH(request("PATCH", "publish_schedule"))).status).toBe(400);
    expect(stubs.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("rejects a receipt whose rule evidence drifts", async () => {
    stubs.readJsonObject.mockResolvedValue(decisionBody);
    stubs.maybeSingle.mockResolvedValue({ ...decisionResult(), data: {
      ...decisionResult().data, rule_version_id: STAFF } });
    expect((await PATCH(request("PATCH", "override_schedule"))).status).toBe(409);
  });

  it("maps missing institution rules without leaking database messages", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code: "55000",
      message: "private staff name and exact certificate must not leak" } });
    const response = await POST(request("POST", "submit_schedule"));
    expect(response.status).toBe(503);
    const text = JSON.stringify(await response.json());
    expect(text).toContain("STAFF_SCHEDULING_RULES_NOT_CONFIGURED");
    expect(text).not.toContain("private staff name");
  });
});
