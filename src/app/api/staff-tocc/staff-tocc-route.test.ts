import { beforeEach, describe, expect, it, vi } from "vitest";

import { deterministicUuid } from "@/lib/integrations/security";

const stubs = vi.hoisted(() => ({
  authorizeStaffRequest: vi.fn(), readJsonObject: vi.fn(),
  createServerSupabaseClient: vi.fn(), rpc: vi.fn(), maybeSingle: vi.fn(),
}));

vi.mock("@/lib/integrations/http", () => ({
  authorizeStaffRequest: stubs.authorizeStaffRequest,
  readJsonObject: stubs.readJsonObject,
  databaseFailure: (code: string, message: string, httpStatus = 500) =>
    Object.assign(new Error(message), { code, httpStatus }),
  handleIntegrationRoute: async (operation: (requestId: string) => Promise<Response>) => {
    const requestId = "74000000-0000-4000-8000-000000000099";
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

const ORG = "74000000-0000-4000-8000-000000000001";
const BRANCH = "74000000-0000-4000-8000-000000000002";
const ACTOR = "74000000-0000-4000-8000-000000000003";
const KEY = "74000000-0000-4000-8000-000000000004";
const TOCC = "74071000-0000-4000-8000-000000000005";
const VERSION = "74070000-0000-4000-8000-000000000005";
const STAFF = "74040000-0000-4000-8000-000000000005";
const actor = {
  organizationId: ORG, organizationName: "機構", branchId: BRANCH,
  branchName: "分支", userId: ACTOR, displayName: "主管",
  roles: ["branch_supervisor"], scopes: ["staff_tocc.read", "staff_tocc.manage"],
  assuranceLevel: "aal2", recentAal2At: new Date().toISOString(), demo: false,
};
const body = {
  action: "create", tocc_key: TOCC, previous_version_id: null,
  expected_base_version: 0, staff_membership_id: STAFF,
  assessed_on: "2026-08-01", valid_through: "2026-08-31",
  validity_source: "合成來源人工效期", result_text: "合成結果文字",
  manual_attention_flag: true, attention_note: "人工標記需確認",
  evidence_status: "missing", attachment_reference: null,
  attachment_sha256: null, disposition_status: "pending",
  disposition_note: "等待人工處置", correction_reason: null,
};
function request() {
  return new Request("https://example.invalid/api/staff-tocc", {
    method: "POST", headers: { "content-type": "application/json",
      "idempotency-key": KEY }, body: "{}",
  });
}

describe("page-74 staff TOCC API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks(); stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.readJsonObject.mockResolvedValue(body);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it.each([
    { ...actor, scopes: ["staff_tocc.read"] },
    { ...actor, scopes: ["clients.read", "client_tocc.manage"] },
    { ...actor, assuranceLevel: "aal1" },
    { ...actor, demo: true },
  ])("rejects sensitive writes before body parsing %#", async (unauthorizedActor) => {
    stubs.authorizeStaffRequest.mockResolvedValue(unauthorizedActor);
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("binds tenant, actor idempotency and exact warning receipt", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: {
      organization_id: ORG, branch_id: BRANCH, tocc_key: TOCC,
      record_version_id: VERSION, version: 1, previous_version_id: null,
      record_status: "active", staff_membership_id: STAFF,
      content_hash: "a".repeat(64), evaluated_on: "2026-09-02",
      expiry_warning: true, manual_attention_warning: true,
      warning_basis: "manual_valid_through_and_manual_attention_flag",
      recorded_at: "2026-09-02T04:00:00.000Z", replayed: false,
    }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect((await response.json()).data.receipt).toMatchObject({
      toccKey: TOCC, evaluatedOn: "2026-09-02", expiryWarning: true,
      manualAttentionWarning: true, persisted: true, demo: false,
    });
    expect(stubs.rpc).toHaveBeenCalledWith("append_staff_tocc",
      expect.objectContaining({
        p_expected_organization_id: ORG, p_expected_branch_id: BRANCH,
        p_staff_membership_id: STAFF, p_valid_through: "2026-08-31",
        p_attachment_reference: null, p_attachment_sha256: null,
        p_idempotency_key: deterministicUuid(
          "page74-staff-tocc-record", ORG, ACTOR, KEY,
        ),
      }));
  });

  it.each([
    { expiry_warning: false }, { manual_attention_warning: false },
    { warning_basis: "untrusted_basis" }, { branch_id: ACTOR },
  ])("fails closed on a mismatched receipt %#", async (override) => {
    stubs.maybeSingle.mockResolvedValue({ data: {
      organization_id: ORG, branch_id: BRANCH, tocc_key: TOCC,
      record_version_id: VERSION, version: 1, previous_version_id: null,
      record_status: "active", staff_membership_id: STAFF,
      content_hash: "a".repeat(64), evaluated_on: "2026-09-02",
      expiry_warning: true, manual_attention_warning: true,
      warning_basis: "manual_valid_through_and_manual_attention_flag",
      recorded_at: "2026-09-02T04:00:00.000Z", replayed: false, ...override,
    }, error: null });
    expect((await POST(request())).status).toBe(409);
  });

  it("sanitizes database detail", async () => {
    stubs.maybeSingle.mockResolvedValue({ data: null,
      error: { code: "42501", message: "private health detail" } });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("private health detail");
  });
});
