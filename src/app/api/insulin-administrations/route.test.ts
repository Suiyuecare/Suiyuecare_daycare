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
    const requestId = "05e00000-0000-4000-8000-000000000290";
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

const organizationId = "05100000-0000-4000-8000-000000000291";
const branchId = "05200000-0000-4000-8000-000000000291";
const planId = "05300000-0000-4000-8000-000000000291";
const key = "05400000-0000-4000-8000-000000000291";
const scheduledFor = "2026-09-02T01:00:00.000Z";
const actor = {
  organizationId, branchId, organizationName: "合成機構", branchName: "合成分支",
  userId: "05500000-0000-4000-8000-000000000291", displayName: "合成護理師",
  roles: ["nurse"], scopes: ["clients.read", "medications.read",
    "insulin_administrations.read", "insulin_administrations.execute",
    "insulin_administrations.verify", "insulin_administrations.authorize_late"],
  assuranceLevel: "aal2", recentAal2At: null, demo: false,
};
const executeBody = {
  action: "execute", administrationKey: null, previousEventId: null,
  expectedSequence: 0, medicationPlanId: planId,
  scheduledFor: "2026-09-02T09:00:00+08:00", doseText: "12.5",
  doseUnit: "U", siteCode: "LEFT_ARM", siteText: "左上臂",
};

function request(operation = "execute") {
  return new Request("https://example.invalid/api/insulin-administrations", {
    method: "POST", headers: { "content-type": "application/json",
      "idempotency-key": key, "x-insulin-operation": operation }, body: "{}",
  });
}
function receipt(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: organizationId, branch_id: branchId,
    operation_id: "05600000-0000-4000-8000-000000000291",
    operation_kind: "execute",
    administration_key: "05700000-0000-4000-8000-000000000291",
    event_id: "05800000-0000-4000-8000-000000000291", event_sequence: 1,
    previous_event_id: null, state: "pending_review", medication_plan_id: planId,
    governance_version_id: "05900000-0000-4000-8000-000000000291",
    scheduled_for: scheduledFor, executed_at: "2026-09-02T01:01:00.000Z",
    reviewed_at: null, content_hash: "a".repeat(64),
    qualification_status: "published", dose_rule_status: "published",
    late_entry_rule_status: "published",
    completion_status: "pending_independent_review", offline_status: "not_configured",
    replayed: false, committed_at: "2026-09-02T01:01:01.000Z", ...overrides,
  };
}

describe("Page 5 insulin administration API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue(executeBody);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it("binds tenant and maps the exact Page-8 execution evidence", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt(), error: null });
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect((await response.json()).data).toMatchObject({
      organizationId, branchId, operationKind: "execute", state: "pending_review",
      qualificationStatus: "published", completionStatus: "pending_independent_review",
      offlineStatus: "not_configured", persisted: true, demo: false,
    });
    expect(stubs.rpc).toHaveBeenCalledWith("mutate_insulin_administration",
      expect.objectContaining({
        p_expected_organization_id: organizationId,
        p_expected_branch_id: branchId, p_action: "execute",
        p_medication_plan_id: planId, p_scheduled_for: scheduledFor,
        p_dose_text: "12.5", p_site_code: "LEFT_ARM", p_idempotency_key: key,
      }));
    expect(stubs.requireRecentAal2).toHaveBeenCalledOnce();
  });

  it("checks base and operation permissions before sensitive body parsing", async () => {
    for (const scopes of [
      ["medications.read", "insulin_administrations.read", "insulin_administrations.execute"],
      ["clients.read", "insulin_administrations.read", "insulin_administrations.execute"],
      ["clients.read", "medications.read", "insulin_administrations.execute"],
      ["clients.read", "medications.read", "insulin_administrations.read"],
    ]) {
      stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, scopes });
      expect((await POST(request())).status).toBe(403);
    }
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("requires recent same-session AAL2 before body parsing for every action", async () => {
    for (const operation of ["execute", "review", "authorize_late"]) {
      stubs.requireRecentAal2.mockRejectedValueOnce(Object.assign(new Error("reauth"), {
        code: "RECENT_AAL2_REQUIRED", httpStatus: 403,
      }));
      expect((await POST(request(operation))).status).toBe(403);
    }
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("rejects invalid or body-mismatched operation declarations", async () => {
    expect((await POST(request("delete"))).status).toBe(400);
    expect(stubs.authorizeStaffRequest).not.toHaveBeenCalled();
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect((await POST(request("review"))).status).toBe(400);
    expect(stubs.rpc).not.toHaveBeenCalled();
  });

  it("rejects demo writes before parsing", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor, demo: true });
    expect((await POST(request())).status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("fails closed on a forged tenant or completion receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: receipt({ organization_id: actor.userId,
      state: "completed", completion_status: "completed" }), error: null });
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect((await response.json()).errors[0].code).toBe("INSULIN_RECEIPT_INVALID");
  });

  it("maps unconfigured governance without pretending success", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: null, error: { code: "55000" } });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect((await response.json()).errors[0].code)
      .toBe("INSULIN_GOVERNANCE_NOT_CONFIGURED");
  });

  it("maps stale event chains and unknown results to retryable conflicts", async () => {
    stubs.maybeSingle.mockResolvedValueOnce({ data: null, error: { code: "40001" } });
    expect((await POST(request())).status).toBe(409);
    stubs.maybeSingle.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect((await response.json()).errors[0].code).toBe("INSULIN_SAVE_RESULT_UNKNOWN");
  });
});
