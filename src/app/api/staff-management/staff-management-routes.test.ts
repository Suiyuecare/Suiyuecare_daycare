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
    const requestId = "59000000-0000-4000-8000-000000000099";
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

import { PATCH as employmentPATCH, POST as employmentPOST } from "./employment/route";
import { PATCH as rolePATCH, POST as rolePOST } from "./roles/route";
import { PATCH as terminationPATCH, POST as terminationPOST } from "./termination/route";

const ORG = "59000000-0000-4000-8000-000000000001";
const BRANCH = "59000000-0000-4000-8000-000000000002";
const ACTOR = "59000000-0000-4000-8000-000000000003";
const KEY = "59000000-0000-4000-8000-000000000004";
const MEMBER = "59000000-0000-4000-8000-000000000005";
const PROFILE = "59000000-0000-4000-8000-000000000006";
const PROPOSAL = "59000000-0000-4000-8000-000000000007";
const PROPOSAL_KEY = "59000000-0000-4000-8000-000000000008";
const VERSION = "59000000-0000-4000-8000-000000000009";
const ROLE = "59000000-0000-4000-8000-000000000010";
const ROLE_REQUEST = "59000000-0000-4000-8000-000000000011";
const JOB = "59000000-0000-4000-8000-000000000012";
const HASH = "a".repeat(64);
const scopes = ["staff_management.read", "staff_management.manage",
  "staff_management.approve", "staff_management.identity.read",
  "staff_management.employment.read", "staff_management.employment.manage",
  "staff_management.roles.read", "staff_management.roles.manage",
  "staff_management.termination.manage", "roles.manage"];
const actor = { organizationId: ORG, organizationName: "合成機構",
  branchId: BRANCH, branchName: "合成分支", userId: ACTOR,
  displayName: "合成主管", roles: ["organization_manager"], scopes,
  assuranceLevel: "aal2", recentAal2At: new Date().toISOString(), demo: false };
const employmentBody = { action: "propose", proposal_action: "employment_change",
  proposal_key: PROPOSAL_KEY, target_membership_id: MEMBER,
  target_profile_id: PROFILE, expected_membership_version: 3,
  target_membership_status: "active", starts_on: "2025-01-01", ends_on: null,
  employment_type_text: "合成人工聘僱", job_title_text: "合成照顧職務",
  registration_status_text: "人工登錄中", change_reason: "合成聘僱異動" };
const decisionBody = { action: "decide", proposal_action: "employment_change",
  proposal_id: PROPOSAL, expected_proposal_number: 5,
  expected_membership_version: 3, expected_content_hash: HASH,
  expected_target_membership_id: MEMBER, expected_target_profile_id: PROFILE,
  decision: "approve", decision_reason: "合成獨立核准" };
const terminationBody = { action: "terminate", proposal_key: PROPOSAL_KEY,
  target_membership_id: MEMBER, target_profile_id: PROFILE,
  expected_membership_version: 3, starts_on: "2025-01-01",
  termination_effective_on: "2026-09-02", change_reason: "合成立即離職停用" };
const roleBody = { action: "request_role", operation: "assign_role",
  target_membership_id: MEMBER, target_role_id: ROLE,
  expected_membership_version: 3 };
const roleApprovalBody = { action: "approve_role", request_id: ROLE_REQUEST,
  expected_membership_version: 3, expected_operation: "assign_role",
  expected_target_membership_id: MEMBER, expected_target_role_id: ROLE };

function request(path: "employment" | "termination" | "roles",
  method: "POST" | "PATCH", governedAction?: string | null) {
  const expected = {
    "employment:POST": "propose_employment",
    "employment:PATCH": "decide_employment",
    "termination:POST": "propose_termination",
    "termination:PATCH": "decide_termination",
    "roles:POST": "request_role",
    "roles:PATCH": "approve_role",
  }[`${path}:${method}`]!;
  const action = governedAction === undefined ? expected : governedAction;
  return new Request(`https://example.invalid/api/staff-management/${path}`, {
    method, headers: { "content-type": "application/json", "idempotency-key": KEY,
      ...(action ? { "x-staff-management-action": action } : {}) },
    body: "{}",
  });
}
function proposalResult(action = "employment_change", replayed = false) {
  return { data: { organization_id: ORG, branch_id: BRANCH,
    proposal_id: PROPOSAL, proposal_key: PROPOSAL_KEY, proposal_number: 5,
    action, proposal_status: "pending", target_membership_id: MEMBER,
    target_profile_id: PROFILE, expected_membership_version: 3,
    content_hash: HASH, requested_at: "2026-09-02T04:00:00.000Z", replayed },
    error: null };
}
function decisionResult(action = "employment_change", replayed = false) {
  const termination = action === "terminate";
  return { data: { organization_id: ORG, branch_id: BRANCH,
    proposal_id: PROPOSAL, proposal_number: 5, action, decision: "approve",
    proposal_status: "approved", target_membership_id: MEMBER,
    target_profile_id: PROFILE, result_employment_version_id: VERSION,
    result_employment_version: 2, result_membership_version: 4,
    result_revocation_job_id: termination ? JOB : null,
    revocation_provider_status: termination ? "not_configured" : null,
    revocation_verification_status: termination ? "not_verified" : null,
    revocation_queued_at: termination ? "2026-09-02T04:00:00.000Z" : null,
    revocation_deadline_at: termination ? "2026-09-02T04:05:00.000Z" : null,
    content_hash: HASH, decided_at: "2026-09-02T04:00:00.000Z", replayed },
    error: null };
}

describe("Page-59 staff management API boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks(); stubs.authorizeStaffRequest.mockResolvedValue(actor);
    stubs.requireRecentAal2.mockResolvedValue(undefined);
    stubs.createServerSupabaseClient.mockResolvedValue({ rpc: stubs.rpc });
    stubs.rpc.mockReturnValue({ maybeSingle: stubs.maybeSingle });
  });

  it.each([
    [employmentPOST, "employment", "POST"],
    [employmentPATCH, "employment", "PATCH"],
    [terminationPOST, "termination", "POST"],
    [terminationPATCH, "termination", "PATCH"],
    [rolePOST, "roles", "POST"],
    [rolePATCH, "roles", "PATCH"],
  ] as const)("rejects %s without the exact governed action header before auth or body",
    async (handler, path, method) => {
      const response = await handler(request(path, method, null));
      expect(response.status).toBe(400);
      expect((await response.json()).errors[0].code)
        .toBe("INVALID_STAFF_MANAGEMENT_ACTION");
      expect(stubs.authorizeStaffRequest).not.toHaveBeenCalled();
      expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
      expect(stubs.readJsonObject).not.toHaveBeenCalled();
    });

  it.each([
    [employmentPOST, "employment", "staff_management.employment.manage"],
    [terminationPOST, "termination", "staff_management.termination.manage"],
    [rolePOST, "roles", "staff_management.roles.manage"],
  ] as const)("rejects %s writes before parsing when one field scope is missing",
    async (handler, path, missing) => {
      stubs.authorizeStaffRequest.mockResolvedValue({ ...actor,
        scopes: scopes.filter((scope) => scope !== missing) });
      expect((await handler(request(path, "POST"))).status).toBe(403);
      expect(stubs.requireRecentAal2).not.toHaveBeenCalled();
      expect(stubs.readJsonObject).not.toHaveBeenCalled();
    });

  it("rejects all approval bodies before parsing without independent approve scope", async () => {
    stubs.authorizeStaffRequest.mockResolvedValue({ ...actor,
      scopes: scopes.filter((scope) => scope !== "staff_management.approve") });
    for (const [handler, path] of [[employmentPATCH, "employment"],
      [terminationPATCH, "termination"], [rolePATCH, "roles"]] as const) {
      expect((await handler(request(path, "PATCH"))).status).toBe(403);
    }
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("requires recent same-session AAL2 before any sensitive body is read", async () => {
    stubs.requireRecentAal2.mockRejectedValue(Object.assign(new Error("重新驗證"),
      { code: "AAL2_REQUIRED", httpStatus: 403 }));
    expect((await terminationPOST(request("termination", "POST"))).status).toBe(403);
    expect(stubs.readJsonObject).not.toHaveBeenCalled();
  });

  it("fails onboarding closed without exposing or consuming a global profile", async () => {
    stubs.readJsonObject.mockResolvedValue({ ...employmentBody,
      proposal_action: "onboard", expected_membership_version: 0 });
    const response = await employmentPOST(request("employment", "POST"));
    expect(response.status).toBe(503);
    expect(stubs.createServerSupabaseClient).not.toHaveBeenCalled();
    expect((await response.json()).errors[0].code).toBe("ONBOARDING_NOT_CONFIGURED");
  });

  it("does not expose a legacy onboarding decision through the employment API", async () => {
    stubs.readJsonObject.mockResolvedValue({ ...decisionBody,
      proposal_action: "onboard", expected_membership_version: 0 });
    const response = await employmentPATCH(request("employment", "PATCH"));
    expect(response.status).toBe(400);
    expect(stubs.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("binds an employment proposal to tenant, target, version, and actor key", async () => {
    stubs.readJsonObject.mockResolvedValue(employmentBody);
    stubs.maybeSingle.mockResolvedValue(proposalResult());
    const response = await employmentPOST(request("employment", "POST"));
    expect(response.status).toBe(201);
    expect(stubs.rpc).toHaveBeenCalledWith("submit_staff_management_proposal",
      expect.objectContaining({ p_expected_organization_id: ORG,
        p_expected_branch_id: BRANCH, p_action: "employment_change",
        p_target_membership_id: MEMBER, p_expected_membership_version: 3,
        p_idempotency_key: deterministicUuid(
          "page59-staff-employment-proposal", ORG, ACTOR, KEY,
        ) }));
  });

  it("rejects unknown payroll or attachment fields before persistence", async () => {
    stubs.readJsonObject.mockResolvedValue({ ...employmentBody,
      salary: "999999", attachment_reference: "browser://fake" });
    expect((await employmentPOST(request("employment", "POST"))).status).toBe(400);
    expect(stubs.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("correlates the complete employment decision receipt", async () => {
    stubs.readJsonObject.mockResolvedValue(decisionBody);
    stubs.maybeSingle.mockResolvedValue(decisionResult());
    const response = await employmentPATCH(request("employment", "PATCH"));
    expect(response.status).toBe(201);
    expect(stubs.rpc).toHaveBeenCalledWith("decide_staff_management_proposal",
      expect.objectContaining({ p_proposal_id: PROPOSAL,
        p_expected_proposal_number: 5, p_expected_membership_version: 3,
        p_expected_content_hash: HASH }));
  });

  it("persists an immediate termination request and verifies the fail-closed job receipt", async () => {
    stubs.readJsonObject.mockResolvedValue(terminationBody);
    stubs.maybeSingle.mockResolvedValue(proposalResult("terminate"));
    expect((await terminationPOST(request("termination", "POST"))).status).toBe(201);
    stubs.readJsonObject.mockResolvedValue({ ...decisionBody, proposal_action: "terminate" });
    stubs.maybeSingle.mockResolvedValue(decisionResult("terminate"));
    const response = await terminationPATCH(request("termination", "PATCH"));
    expect(response.status).toBe(201);
    expect((await response.json()).data.receipt).toMatchObject({
      resultRevocationJobId: JOB, revocationProviderStatus: "not_configured",
      revocationVerificationStatus: "not_verified",
    });
  });

  it("rejects a termination receipt that claims an unverifiable provider result", async () => {
    stubs.readJsonObject.mockResolvedValue({ ...decisionBody, proposal_action: "terminate" });
    stubs.maybeSingle.mockResolvedValue({ ...decisionResult("terminate"), data: {
      ...decisionResult("terminate").data, revocation_provider_status: null } });
    expect((await terminationPATCH(request("termination", "PATCH"))).status).toBe(409);
  });

  it("binds role request and independent approval to exact versions", async () => {
    stubs.readJsonObject.mockResolvedValue(roleBody);
    stubs.maybeSingle.mockResolvedValue({ data: { organization_id: ORG,
      branch_id: BRANCH, request_id: ROLE_REQUEST, operation: "assign_role",
      target_membership_id: MEMBER, target_role_id: ROLE,
      expected_membership_version: 3, request_status: "pending", request_hash: HASH,
      requested_at: "2026-09-02T04:00:00.000Z", replayed: false }, error: null });
    expect((await rolePOST(request("roles", "POST"))).status).toBe(201);
    stubs.readJsonObject.mockResolvedValue(roleApprovalBody);
    stubs.maybeSingle.mockResolvedValue({ data: { organization_id: ORG,
      branch_id: BRANCH, request_id: ROLE_REQUEST, operation: "assign_role",
      target_membership_id: MEMBER, target_role_id: ROLE,
      expected_membership_version: 3, result_membership_version: 4,
      request_status: "approved", applied_at: "2026-09-02T04:00:00.000Z",
      replayed: false }, error: null });
    expect((await rolePATCH(request("roles", "PATCH"))).status).toBe(201);
  });

  it("never returns private database messages", async () => {
    stubs.readJsonObject.mockResolvedValue(employmentBody);
    stubs.maybeSingle.mockResolvedValue({ data: null,
      error: { code: "42501", message: "姓名與員編不應外洩" } });
    const response = await employmentPOST(request("employment", "POST"));
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("姓名與員編不應外洩");
  });
});
