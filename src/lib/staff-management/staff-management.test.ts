import { describe, expect, it } from "vitest";

import { IntegrationError } from "@/lib/integrations/errors";

import { isStaffManagementDate, staffManagementTaipeiDate } from "./date";
import {
  buildDemoStaffManagementSnapshot,
  buildDemoStaffManagementSourceRow,
} from "./demo";
import {
  parseStaffDecisionApiEnvelope,
  parseStaffEmploymentProposalInput,
  parseStaffProposalDecisionInput,
  parseStaffProposalDecisionReceipt,
  parseStaffProposalReceipt,
  parseStaffRoleApprovalInput,
  parseStaffRoleApprovalReceipt,
  parseStaffRoleChangeInput,
  parseStaffRoleRequestReceipt,
  parseStaffTerminationProposalInput,
} from "./parser";
import {
  projectStaffManagementSnapshot,
  type StaffManagementSnapshotSourceRow,
} from "./projection";
import { parseStaffManagementFilters } from "./query";

const ORG = "59000000-0000-4000-8000-000000000101";
const BRANCH = "59000000-0000-4000-8000-000000000102";
const MEMBER = "59000000-0000-4000-8000-000000000103";
const PROFILE = "59000000-0000-4000-8000-000000000104";
const PROPOSAL = "59000000-0000-4000-8000-000000000105";
const PROPOSAL_KEY = "59000000-0000-4000-8000-000000000106";
const REQUEST = "59000000-0000-4000-8000-000000000107";
const ROLE = "59000000-0000-4000-8000-000000000108";
const OPERATION = "59000000-0000-4000-8000-000000000109";
const HASH = "a".repeat(64);
const generatedAt = "2026-09-02T04:00:00.000Z";
const filters = { status: "all" as const, roleId: null,
  qualification: "all" as const, query: "" };

function emptySource(): StaffManagementSnapshotSourceRow {
  return {
    organization_id: ORG, branch_id: BRANCH, generated_at: generatedAt,
    snapshot_date: "2026-09-02", employees: [], employee_total: 0,
    employees_truncated: false, active_employee_total: 0, ended_employee_total: 0,
    disabled_account_total: 0, expired_qualification_membership_total: 0,
    employment_history: [], employment_history_total: 0,
    employment_history_truncated: false, proposals: [], proposal_total: 0,
    pending_proposal_total: 0, proposals_truncated: false, role_requests: [],
    role_request_total: 0, pending_role_request_total: 0,
    role_requests_truncated: false, role_options: [], role_option_total: 0,
    role_options_truncated: false, profile_options: [], profile_option_total: 0,
    profile_options_truncated: false,
    onboarding_candidate_source_status: "not_configured", revocation_jobs: [],
    revocation_job_total: 0, pending_revocation_total: 0, overdue_revocation_total: 0,
    identity_source: "profiles_memberships",
    role_source: "membership_roles_role_governance",
    qualification_source: "page72_terminal_projection",
    employment_taxonomy_status: "manual_unstandardized",
    registration_taxonomy_status: "manual_unstandardized",
    qualification_reminder_policy_status: "not_configured",
    qualification_notice_days: null, expiring_qualification_total: null,
    restricted_service_policy_status: "not_configured",
    qualification_evaluation_status: "not_evaluated",
    session_revocation_provider_status: "not_configured",
    session_revocation_sla_minutes: 5,
    session_revocation_verification_status: "not_verified",
    recent_aal2_max_age_minutes: 15, full_hr_payroll_scope: "excluded",
    attachment_pipeline_status: "not_configured", export_status: "disabled",
    offline_status: "disabled",
  };
}

function employmentBody(extra: Record<string, unknown> = {}) {
  return { action: "propose", proposal_action: "employment_change",
    proposal_key: PROPOSAL_KEY, target_membership_id: MEMBER,
    target_profile_id: PROFILE, expected_membership_version: 3,
    target_membership_status: "active", starts_on: "2025-01-01", ends_on: null,
    employment_type_text: "合成人工聘僱", job_title_text: "合成照顧職務",
    registration_status_text: "人工登錄中", change_reason: "合成異動理由", ...extra };
}

function decisionInput(action: "employment_change" | "terminate" = "employment_change") {
  return parseStaffProposalDecisionInput({ action: "decide", proposal_action: action,
    proposal_id: PROPOSAL, expected_proposal_number: 5,
    expected_membership_version: 3, expected_content_hash: HASH,
    expected_target_membership_id: MEMBER, expected_target_profile_id: PROFILE,
    decision: "approve", decision_reason: "合成獨立核准" }, OPERATION,
  action === "terminate" ? ["terminate"] : ["employment_change", "onboard"]);
}

describe("Page 59 staff management contracts", () => {
  it("strictly parses only scalar Page-59 query fields", () => {
    expect(parseStaffManagementFilters({
      status: "active", role: ROLE.toUpperCase(),
      qualification: "has_expired", q: "  合成員工  ",
    })).toEqual({ filters: { status: "active", roleId: ROLE,
      qualification: "has_expired", query: "合成員工" }, invalid: false });
    expect(parseStaffManagementFilters({ status: ["active", "ended"] }).invalid)
      .toBe(true);
    expect(parseStaffManagementFilters({ role: "not-a-uuid" }).invalid).toBe(true);
    expect(parseStaffManagementFilters({ qualification: "expiring" }).invalid)
      .toBe(true);
    expect(parseStaffManagementFilters({ q: "unsafe\u0000query" }).invalid).toBe(true);
    expect(parseStaffManagementFilters({ payroll: "all" }).invalid).toBe(true);
  });

  it("uses strict real Taipei calendar dates", () => {
    expect(isStaffManagementDate("2024-02-29")).toBe(true);
    expect(isStaffManagementDate("2025-02-29")).toBe(false);
    expect(staffManagementTaipeiDate(new Date(generatedAt))).toBe("2026-09-02");
  });

  it("projects a complete empty fail-closed snapshot", () => {
    const result = projectStaffManagementSnapshot({ row: emptySource(),
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false });
    expect(result.employeeTotal).toBe(0);
    expect(result.onboardingCandidateSourceStatus).toBe("not_configured");
    expect(result.profileOptions).toEqual([]);
    expect(result.qualificationNoticeDays).toBeNull();
  });

  it("rejects tenant drift and forged totals", () => {
    expect(() => projectStaffManagementSnapshot({
      row: { ...emptySource(), organization_id: PROFILE },
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false,
    })).toThrow("STAFF_MANAGEMENT_SNAPSHOT_INVALID");
    expect(() => projectStaffManagementSnapshot({
      row: { ...emptySource(), active_employee_total: 1 },
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false,
    })).toThrow("STAFF_MANAGEMENT_SNAPSHOT_INVALID");
  });

  it("rejects global profile candidates while candidate source is not configured", () => {
    expect(() => projectStaffManagementSnapshot({ row: { ...emptySource(),
      profile_options: [{ profile_id: PROFILE, display_name: "不應出現的人員",
        employee_code: "LEAK", profile_kind: "staff" }], profile_option_total: 1 },
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: false,
    })).toThrow("STAFF_MANAGEMENT_SNAPSHOT_INVALID");
  });

  it("builds a synthetic read-only demo with live Page-72 facts and honest gaps", () => {
    const result = buildDemoStaffManagementSnapshot({ organizationId: ORG,
      branchId: BRANCH, filters, now: new Date(generatedAt) });
    expect(result.demo).toBe(true);
    expect(result.employeeTotal).toBe(3);
    expect(result.expiredQualificationMembershipTotal).toBe(1);
    expect(result.expiringQualificationTotal).toBeNull();
    expect(result.sessionRevocationProviderStatus).toBe("not_configured");
    expect(result.revocationJobs[0]?.slaStatus).toBe("overdue_not_verified");
  });

  it("rejects drift between employee, termination, and revocation projections", () => {
    const source = buildDemoStaffManagementSourceRow({ organizationId: ORG,
      branchId: BRANCH, filters, now: new Date(generatedAt) });
    const job = source.revocation_jobs[0]!;
    const employee = source.employees[0]!;
    expect(() => projectStaffManagementSnapshot({ row: { ...source,
      employees: [{ ...employee, revocation_job_id: job.job_id,
        revocation_provider_status: job.provider_status,
        revocation_delivery_status: job.delivery_status,
        revocation_verification_status: job.verification_status,
        revocation_queued_at: job.queued_at,
        revocation_deadline_at: job.deadline_at }, ...source.employees.slice(1)] },
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: true,
    })).toThrow("STAFF_MANAGEMENT_SNAPSHOT_INVALID");

    const ended = source.employees.find((item) => item.membership_status === "ended")!;
    expect(() => projectStaffManagementSnapshot({ row: { ...source,
      employees: source.employees.map((item) => item.membership_id === ended.membership_id
        ? { ...item, revocation_job_id: null, revocation_provider_status: null,
          revocation_delivery_status: null, revocation_verification_status: null,
          revocation_queued_at: null, revocation_deadline_at: null }
        : item), revocation_jobs: [], revocation_job_total: 0,
      pending_revocation_total: 0, overdue_revocation_total: 0 },
      expectedOrganizationId: ORG, expectedBranchId: BRANCH, filters, demo: true,
    })).toThrow("STAFF_MANAGEMENT_SNAPSHOT_INVALID");
  });

  it("applies demo filters to the same employee snapshot", () => {
    const result = buildDemoStaffManagementSnapshot({ organizationId: ORG,
      branchId: BRANCH, filters: { ...filters, qualification: "has_expired" },
      now: new Date(generatedAt) });
    expect(result.employeeTotal).toBe(1);
    expect(result.employees[0]?.displayName).toBe("合成員工甲");
  });

  it("strictly parses employment fields and rejects unknown keys", () => {
    const result = parseStaffEmploymentProposalInput(employmentBody(), OPERATION);
    expect(result.expectedMembershipVersion).toBe(3);
    expect(() => parseStaffEmploymentProposalInput(
      employmentBody({ hidden: "value" }), OPERATION,
    )).toThrow(IntegrationError);
  });

  it("rejects reversed employment dates", () => {
    expect(() => parseStaffEmploymentProposalInput(employmentBody({
      starts_on: "2026-09-02", ends_on: "2026-09-01",
    }), OPERATION)).toThrow("聘僱迄日不可早於到職日");
  });

  it("rejects a future termination before it can imply immediate deactivation", () => {
    expect(() => parseStaffTerminationProposalInput({ action: "terminate",
      proposal_key: PROPOSAL_KEY, target_membership_id: MEMBER,
      target_profile_id: PROFILE, expected_membership_version: 3,
      starts_on: "2025-01-01", termination_effective_on: "2026-09-03",
      change_reason: "合成離職" }, OPERATION, new Date(generatedAt)))
      .toThrow("未來離職日不可立即停用帳號");
  });

  it("correlates proposal receipts to tenant, target, version, and key", () => {
    const input = parseStaffEmploymentProposalInput(employmentBody(), OPERATION);
    const source = { organization_id: ORG, branch_id: BRANCH,
      proposal_id: PROPOSAL, proposal_key: PROPOSAL_KEY, proposal_number: 5,
      action: "employment_change", proposal_status: "pending",
      target_membership_id: MEMBER, target_profile_id: PROFILE,
      expected_membership_version: 3, content_hash: HASH,
      requested_at: generatedAt, replayed: false };
    expect(parseStaffProposalReceipt(source, input, ORG, BRANCH).proposalId)
      .toBe(PROPOSAL);
    expect(() => parseStaffProposalReceipt({ ...source, branch_id: PROFILE },
      input, ORG, BRANCH)).toThrow("無法與送出內容核對");
  });

  it("requires an exact termination revocation receipt", () => {
    const input = decisionInput("terminate");
    const queued = "2026-09-02T04:00:00.000Z";
    const source = { organization_id: ORG, branch_id: BRANCH,
      proposal_id: PROPOSAL, proposal_number: 5, action: "terminate",
      decision: "approve", proposal_status: "approved",
      target_membership_id: MEMBER, target_profile_id: PROFILE,
      result_employment_version_id: PROPOSAL_KEY, result_employment_version: 2,
      result_membership_version: 4, result_revocation_job_id: REQUEST,
      revocation_provider_status: "not_configured",
      revocation_verification_status: "not_verified", revocation_queued_at: queued,
      revocation_deadline_at: "2026-09-02T04:05:00.000Z", content_hash: HASH,
      decided_at: generatedAt, replayed: false };
    expect(parseStaffProposalDecisionReceipt(source, input, ORG, BRANCH)
      .resultRevocationJobId).toBe(REQUEST);
    expect(() => parseStaffProposalDecisionReceipt({ ...source,
      revocation_deadline_at: "2026-09-02T04:06:00.000Z" }, input, ORG, BRANCH))
      .toThrow("無法與待審版本核對");
  });

  it("requires every rejected receipt result field to remain null", () => {
    const input = { ...decisionInput(), decision: "reject" as const };
    const source = { organization_id: ORG, branch_id: BRANCH,
      proposal_id: PROPOSAL, proposal_number: 5, action: "employment_change",
      decision: "reject", proposal_status: "rejected",
      target_membership_id: MEMBER, target_profile_id: PROFILE,
      result_employment_version_id: null, result_employment_version: null,
      result_membership_version: null, result_revocation_job_id: null,
      revocation_provider_status: null, revocation_verification_status: null,
      revocation_queued_at: null, revocation_deadline_at: null,
      content_hash: HASH, decided_at: generatedAt, replayed: false };
    expect(parseStaffProposalDecisionReceipt(source, input, ORG, BRANCH)
      .proposalStatus).toBe("rejected");
    expect(() => parseStaffProposalDecisionReceipt({ ...source,
      result_membership_version: 4 }, input, ORG, BRANCH))
      .toThrow("無法與待審版本核對");
  });

  it("binds role requests to the exact target and membership version", () => {
    const input = parseStaffRoleChangeInput({ action: "request_role",
      operation: "assign_role", target_membership_id: MEMBER,
      target_role_id: ROLE, expected_membership_version: 3 }, OPERATION);
    const source = { organization_id: ORG, branch_id: BRANCH, request_id: REQUEST,
      operation: "assign_role", target_membership_id: MEMBER, target_role_id: ROLE,
      expected_membership_version: 3, request_status: "pending", request_hash: HASH,
      requested_at: generatedAt, replayed: false };
    expect(parseStaffRoleRequestReceipt(source, input, ORG, BRANCH).requestId)
      .toBe(REQUEST);
    expect(() => parseStaffRoleRequestReceipt({ ...source,
      expected_membership_version: 2 }, input, ORG, BRANCH))
      .toThrow("無法與送出內容核對");
  });

  it("binds role approval to the expected request and exact next version", () => {
    const input = parseStaffRoleApprovalInput({ action: "approve_role",
      request_id: REQUEST, expected_membership_version: 3,
      expected_operation: "assign_role", expected_target_membership_id: MEMBER,
      expected_target_role_id: ROLE }, OPERATION);
    const source = { organization_id: ORG, branch_id: BRANCH, request_id: REQUEST,
      operation: "assign_role", target_membership_id: MEMBER, target_role_id: ROLE,
      expected_membership_version: 3, result_membership_version: 4,
      request_status: "approved", applied_at: generatedAt, replayed: false };
    expect(parseStaffRoleApprovalReceipt(source, input, ORG, BRANCH)
      .resultMembershipVersion).toBe(4);
    expect(() => parseStaffRoleApprovalReceipt({ ...source,
      result_membership_version: 5 }, input, ORG, BRANCH))
      .toThrow("無法與待審異動核對");
  });

  it("rejects API envelopes whose HTTP status contradicts replay", () => {
    const input = decisionInput();
    const receipt = { organizationId: ORG, branchId: BRANCH,
      proposalId: PROPOSAL, proposalNumber: 5, proposalAction: "employment_change",
      decision: "approve", proposalStatus: "approved", targetMembershipId: MEMBER,
      targetProfileId: PROFILE, resultEmploymentVersionId: PROPOSAL_KEY,
      resultEmploymentVersion: 2, resultMembershipVersion: 4,
      resultRevocationJobId: null, revocationProviderStatus: null,
      revocationVerificationStatus: null, revocationQueuedAt: null,
      revocationDeadlineAt: null, contentHash: HASH, decidedAt: generatedAt,
      replayed: false, persisted: true, demo: false };
    const envelope = { requestId: REQUEST, status: "ok", data: {
      receipt, persisted: true, demo: false }, errors: [] };
    expect(() => parseStaffDecisionApiEnvelope(envelope, input, ORG, BRANCH, 200))
      .toThrow("HTTP 狀態與完成憑證不一致");
  });
});
