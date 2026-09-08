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
    const requestId = "69000000-0000-4000-8000-000000000099";
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

const ORG = "69000000-0000-4000-8000-000000000001";
const BRANCH = "69000000-0000-4000-8000-000000000002";
const ACTOR = "69000000-0000-4000-8000-000000000003";
const KEY = "69000000-0000-4000-8000-000000000004";
const VITAL = "69071000-0000-4000-8000-000000000005";
const VERSION = "69070000-0000-4000-8000-000000000005";
const STAFF = "69040000-0000-4000-8000-000000000005";
const actor = {
  organizationId: ORG, organizationName: "機構", branchId: BRANCH,
  branchName: "分支", userId: ACTOR, displayName: "主管",
  roles: ["branch_supervisor"],
  scopes: ["staff_health.read", "staff_health.manage"],
  assuranceLevel: "aal2", recentAal2At: new Date().toISOString(), demo: false,
};
const body = {
  action: "create", vital_sign_key: VITAL, previous_version_id: null,
  expected_base_version: 0, staff_membership_id: STAFF,
  measurement_type: "合成量測", value_status: "measured",
  value_decimal_text: "00120.00", unit: "合成單位", status_reason: null,
  occurred_at: "2026-09-02T08:30:00+08:00", source: "合成來源",
  note: null, correction_reason: null,
};
function request() {
  return new Request("https://example.invalid/api/staff-vital-signs", {
    method: "POST", headers: { "content-type": "application/json",
      "idempotency-key": KEY }, body: "{}",
  });
}
function persisted(override: Record<string, unknown> = {}) {
  return { data: {
    organization_id: ORG, branch_id: BRANCH, vital_sign_key: VITAL,
    record_version_id: VERSION, version: 1, previous_version_id: null,
    record_status: "active", completion_status: "completed",
    staff_membership_id: STAFF, content_hash: "a".repeat(64),
    threshold_evaluation_status: "not_configured",
    recorded_at: "2026-09-02T04:00:00.000Z", replayed: false,
    ...override,
  }, error: null };
}

describe("page-69 staff vital-sign API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.readJsonObject.mockResolvedValue(body);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it.each([
    { ...actor, scopes: ["staff.read", "staff_health.manage"] },
    { ...actor, scopes: ["staff_health.read"] },
    { ...actor, assuranceLevel: "aal1" },
    { ...actor, demo: true },
  ])("rejects unauthorized writes before parsing health content %#",
    async (unauthorizedActor) => {
      stubs.authorizeStaffRequest.mockResolvedValue(unauthorizedActor);
      const response = await POST(request());
      expect(response.status).toBe(403);
      expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
      expect(stubs.readJsonObject).not.toHaveBeenCalled();
    });

  it("requires recent same-session AAL2 before parsing the request body", async () => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(
      new Error("請重新驗證"), { code: "AAL2_REQUIRED", httpStatus: 403 },
    ));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("binds tenant, precise text, nullable states, and actor idempotency", async () => {
    stubs.maybeSingle.mockResolvedValue(persisted());
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect((await response.json()).data.receipt).toMatchObject({
      vitalSignKey: VITAL, thresholdEvaluationStatus: "not_configured",
      persisted: true, demo: false,
    });
    expect(stubs.rpc).toHaveBeenCalledWith("append_staff_vital_sign",
      expect.objectContaining({
        p_expected_organization_id: ORG, p_expected_branch_id: BRANCH,
        p_staff_membership_id: STAFF, p_value_decimal_text: "00120.00",
        p_status_reason: null,
        p_idempotency_key: deterministicUuid(
          "page69-staff-vital-sign-record", ORG, ACTOR, KEY,
        ),
      }));
  });

  it("rejects unknown attachment and threshold fields before persistence", async () => {
    stubs.readJsonObject.mockResolvedValue({ ...body,
      attachment_reference: "browser://fake", warning_status: "normal",
    });
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(stubs.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it.each([
    { branch_id: ACTOR }, { version: 2 }, { record_status: "voided" },
    { completion_status: "draft" },
    { threshold_evaluation_status: "configured" },
  ])("fails closed on mismatched persistence receipt %#", async (override) => {
    stubs.maybeSingle.mockResolvedValue(persisted(override));
    expect((await POST(request())).status).toBe(409);
  });

  it("returns 200 only for a correlated replay receipt", async () => {
    stubs.maybeSingle.mockResolvedValue(persisted({ replayed: true }));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).data.receipt.replayed).toBe(true);
  });

  it("does not expose database health detail", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: null,
      error: { code: "42501", message: "private value 00120.00" } });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("00120.00");
  });
});
