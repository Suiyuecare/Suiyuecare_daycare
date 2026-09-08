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
    const requestId = "78000000-0000-4000-8000-000000000099";
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

const ORG = "78000000-0000-4000-8000-000000000001";
const BRANCH = "78000000-0000-4000-8000-000000000002";
const ACTOR = "78000000-0000-4000-8000-000000000003";
const KEY = "78000000-0000-4000-8000-000000000004";
const REPORT = "78071000-0000-4000-8000-000000000005";
const VERSION = "78070000-0000-4000-8000-000000000005";
const STAFF = "78040000-0000-4000-8000-000000000005";
const actor = {
  organizationId: ORG, organizationName: "機構", branchId: BRANCH,
  branchName: "分支", userId: ACTOR, displayName: "主管",
  roles: ["branch_supervisor"],
  scopes: ["staff_health.read", "staff_health.manage"],
  assuranceLevel: "aal2", recentAal2At: new Date().toISOString(), demo: false,
};
const body = {
  action: "create", report_key: REPORT, previous_version_id: null,
  expected_base_version: 0, staff_membership_id: STAFF,
  report_type: "合成檢驗", tested_on: "2026-08-20",
  provider_name: "合成院所", result_text: "合成結果文字",
  valid_through: "2026-10-20", validity_basis: "合成人工效期依據",
  evidence_status: "missing", attachment_reference: null,
  attachment_sha256: null, correction_reason: null,
};
function request() {
  return new Request("https://example.invalid/api/staff-lab-reports", {
    method: "POST", headers: { "content-type": "application/json",
      "idempotency-key": KEY }, body: "{}",
  });
}

describe("page-78 staff lab report API boundary", () => {
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
    { ...actor, assuranceLevel: "aal1" },
    { ...actor, demo: true },
  ])("rejects writes without independent health authority before parsing %#",
    async (unauthorizedActor) => {
      stubs.authorizeStaffRequest.mockResolvedValue(unauthorizedActor);
      const response = await POST(request());
      expect(response.status).toBe(403);
      expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
      expect(stubs.readJsonObject).not.toHaveBeenCalled();
    });

  it("requires recent same-session AAL2 before parsing health content", async () => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(
      new Error("請重新驗證"), { code: "RECENT_AAL2_REQUIRED", httpStatus: 403 },
    ));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
    expect(stubs.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("binds tenant, actor idempotency and strict duplicate receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: {
      organization_id: ORG, branch_id: BRANCH, report_key: REPORT,
      record_version_id: VERSION, version: 1, previous_version_id: null,
      record_status: "active", completion_status: "completed",
      staff_membership_id: STAFF, content_hash: "a".repeat(64),
      exact_duplicate_count: 1, key_field_duplicate_count: 2,
      duplicate_warning: true,
      duplicate_basis: "exact_content_or_same_staff_type_tested_on_provider",
      recorded_at: "2026-09-02T04:00:00.000Z", replayed: false,
    }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect((await response.json()).data.receipt).toMatchObject({
      reportKey: REPORT, exactDuplicateCount: 1,
      keyFieldDuplicateCount: 2, persisted: true, demo: false,
    });
    expect(stubs.rpc).toHaveBeenCalledWith("append_staff_lab_report",
      expect.objectContaining({
        p_expected_organization_id: ORG, p_expected_branch_id: BRANCH,
        p_staff_membership_id: STAFF, p_attachment_reference: null,
        p_attachment_sha256: null,
        p_idempotency_key: deterministicUuid(
          "page78-staff-lab-report-record", ORG, ACTOR, KEY,
        ),
      }));
  });

  it.each([
    { duplicate_warning: false },
    { exact_duplicate_count: 3, key_field_duplicate_count: 2 },
    { completion_status: "draft" },
    { branch_id: ACTOR },
  ])("fails closed on mismatched persistence receipt %#", async (override) => {
    stubs.maybeSingle.mockResolvedValue({ data: {
      organization_id: ORG, branch_id: BRANCH, report_key: REPORT,
      record_version_id: VERSION, version: 1, previous_version_id: null,
      record_status: "active", completion_status: "completed",
      staff_membership_id: STAFF, content_hash: "a".repeat(64),
      exact_duplicate_count: 1, key_field_duplicate_count: 2,
      duplicate_warning: true,
      duplicate_basis: "exact_content_or_same_staff_type_tested_on_provider",
      recorded_at: "2026-09-02T04:00:00.000Z", replayed: false,
      ...override,
    }, error: null });
    expect((await POST(request())).status).toBe(409);
  });

  it("does not expose database health detail", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: null,
      error: { code: "42501", message: "private result text" } });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("private result text");
  });
});
