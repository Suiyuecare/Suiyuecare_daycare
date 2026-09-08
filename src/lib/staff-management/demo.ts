import { staffManagementTaipeiDate } from "./date";
import {
  projectStaffManagementSnapshot,
  type StaffManagementSnapshotSourceRow,
} from "./projection";
import type { StaffManagementFilters } from "./types";

const ID = {
  employeeA: "59000000-0000-4000-8000-000000000001",
  employeeB: "59000000-0000-4000-8000-000000000002",
  employeeC: "59000000-0000-4000-8000-000000000003",
  profileA: "59000000-0000-4000-8000-000000000011",
  profileB: "59000000-0000-4000-8000-000000000012",
  profileC: "59000000-0000-4000-8000-000000000013",
  roleCare: "10000000-0000-4000-8000-000000000006",
  roleNurse: "10000000-0000-4000-8000-000000000005",
  historyA1: "59000000-0000-4000-8000-000000000021",
  historyA2: "59000000-0000-4000-8000-000000000022",
  historyC1: "59000000-0000-4000-8000-000000000023",
  historyC2: "59000000-0000-4000-8000-000000000024",
  proposalA1: "59000000-0000-4000-8000-000000000031",
  proposalA2: "59000000-0000-4000-8000-000000000032",
  proposalC1: "59000000-0000-4000-8000-000000000033",
  proposalC2: "59000000-0000-4000-8000-000000000034",
  proposalPending: "59000000-0000-4000-8000-000000000035",
  proposalKeyA1: "59000000-0000-4000-8000-000000000041",
  proposalKeyA2: "59000000-0000-4000-8000-000000000042",
  proposalKeyC1: "59000000-0000-4000-8000-000000000043",
  proposalKeyC2: "59000000-0000-4000-8000-000000000044",
  proposalKeyPending: "59000000-0000-4000-8000-000000000045",
  requester: "59000000-0000-4000-8000-000000000051",
  approver: "59000000-0000-4000-8000-000000000052",
  roleRequest: "59000000-0000-4000-8000-000000000061",
  job: "59000000-0000-4000-8000-000000000071",
};

const hash = (character: "a" | "b" | "c" | "d" | "e" | "f") =>
  character.repeat(64);

function daysBefore(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function matchesFilters(
  employee: {
    membership_status: string;
    roles: Array<{ role_id: string; role_name: string }>;
    certificate_total: number;
    expired_certificate_total: number;
    display_name: string;
    employee_code: string | null;
    job_title_text: string | null;
  },
  filters: StaffManagementFilters,
) {
  if (filters.status !== "all" && employee.membership_status !== filters.status) return false;
  if (filters.roleId && !employee.roles.some((role) => role.role_id === filters.roleId)) {
    return false;
  }
  if (filters.qualification === "has_expired" && employee.expired_certificate_total === 0) {
    return false;
  }
  if (filters.qualification === "no_certificates" && employee.certificate_total !== 0) {
    return false;
  }
  if (filters.query) {
    const text = [employee.display_name, employee.employee_code ?? "",
      employee.job_title_text ?? "", ...employee.roles.map((role) => role.role_name)]
      .join("\n").toLocaleLowerCase("zh-TW");
    if (!text.includes(filters.query.toLocaleLowerCase("zh-TW"))) return false;
  }
  return true;
}

type DemoStaffManagementArgs = {
  organizationId: string;
  branchId: string;
  filters: StaffManagementFilters;
  now?: Date;
};

export function buildDemoStaffManagementSourceRow({
  organizationId, branchId, filters, now = new Date(),
}: DemoStaffManagementArgs): StaffManagementSnapshotSourceRow {
  const snapshotDate = staffManagementTaipeiDate(now);
  const generatedAt = now.toISOString();
  const approvedAt1 = new Date(now.getTime() - 120 * 86_400_000).toISOString();
  const approvedAt2 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const requestedAt = new Date(now.getTime() - 86_400_000).toISOString();
  const queuedAt = new Date(now.getTime() - 10 * 60_000).toISOString();
  const deadlineAt = new Date(now.getTime() - 5 * 60_000).toISOString();
  const startA = daysBefore(snapshotDate, 400);
  const startC = daysBefore(snapshotDate, 500);
  const history = [
    { employment_version_id: ID.historyA1, membership_id: ID.employeeA, version: 1,
      previous_version_id: null, membership_version: 1, action: "onboard" as const,
      membership_status: "active" as const, starts_on: startA, ends_on: null,
      employment_type_text: "合成人工聘僱類型", job_title_text: "合成照顧職務",
      registration_status_text: "合成人工登錄中", change_reason: "合成到職建檔",
      source_proposal_id: ID.proposalA1, approved_by_display_name: "合成審核人",
      approved_at: approvedAt1, content_hash: hash("a") },
    { employment_version_id: ID.historyA2, membership_id: ID.employeeA, version: 2,
      previous_version_id: ID.historyA1, membership_version: 3,
      action: "employment_change" as const, membership_status: "active" as const,
      starts_on: startA, ends_on: null, employment_type_text: "合成人工聘僱類型",
      job_title_text: "合成資深照顧職務", registration_status_text: "合成人工登錄中",
      change_reason: "合成職務異動", source_proposal_id: ID.proposalA2,
      approved_by_display_name: "合成審核人", approved_at: approvedAt2,
      content_hash: hash("b") },
    { employment_version_id: ID.historyC1, membership_id: ID.employeeC, version: 1,
      previous_version_id: null, membership_version: 1, action: "onboard" as const,
      membership_status: "active" as const, starts_on: startC, ends_on: null,
      employment_type_text: "合成人工聘僱類型", job_title_text: "合成行政職務",
      registration_status_text: "合成人工登錄中", change_reason: "合成到職建檔",
      source_proposal_id: ID.proposalC1, approved_by_display_name: "合成審核人",
      approved_at: approvedAt1, content_hash: hash("c") },
    { employment_version_id: ID.historyC2, membership_id: ID.employeeC, version: 2,
      previous_version_id: ID.historyC1, membership_version: 3,
      action: "terminate" as const, membership_status: "ended" as const,
      starts_on: startC, ends_on: snapshotDate,
      employment_type_text: "合成人工聘僱類型", job_title_text: "合成行政職務",
      registration_status_text: "合成人工登錄中", change_reason: "合成立即離職停用",
      source_proposal_id: ID.proposalC2, approved_by_display_name: "合成審核人",
      approved_at: queuedAt, content_hash: hash("d") },
  ];
  const approved = <T extends Record<string, unknown>>(overrides: T) => ({
    target_employee_code: null, ends_on: null, termination_effective_on: null,
    status: "approved" as const, requested_by: ID.requester,
    requested_by_display_name: "合成提案人", requested_at: approvedAt1,
    decision: "approve" as const, decision_reason: "合成獨立核准",
    decided_by: ID.approver, decided_by_display_name: "合成審核人",
    decided_at: approvedAt1, result_revocation_job_id: null, ...overrides,
  });
  const proposals = [
    approved({ proposal_id: ID.proposalA1, proposal_key: ID.proposalKeyA1,
      proposal_number: 1, action: "onboard" as const, target_membership_id: ID.employeeA,
      target_profile_id: ID.profileA, target_display_name: "合成員工甲",
      expected_membership_version: 0, target_membership_status: "active" as const,
      starts_on: startA, employment_type_text: "合成人工聘僱類型",
      job_title_text: "合成照顧職務", registration_status_text: "合成人工登錄中",
      change_reason: "合成到職建檔", content_hash: hash("a"),
      result_employment_version_id: ID.historyA1, result_membership_version: 1 }),
    approved({ proposal_id: ID.proposalA2, proposal_key: ID.proposalKeyA2,
      proposal_number: 2, action: "employment_change" as const, target_membership_id: ID.employeeA,
      target_profile_id: ID.profileA, target_display_name: "合成員工甲",
      expected_membership_version: 2, target_membership_status: "active" as const,
      starts_on: startA, employment_type_text: "合成人工聘僱類型",
      job_title_text: "合成資深照顧職務", registration_status_text: "合成人工登錄中",
      change_reason: "合成職務異動", requested_at: approvedAt2,
      decided_at: approvedAt2, content_hash: hash("b"),
      result_employment_version_id: ID.historyA2, result_membership_version: 3 }),
    approved({ proposal_id: ID.proposalC1, proposal_key: ID.proposalKeyC1,
      proposal_number: 3, action: "onboard" as const, target_membership_id: ID.employeeC,
      target_profile_id: ID.profileC, target_display_name: "合成離職員工",
      expected_membership_version: 0, target_membership_status: "active" as const,
      starts_on: startC, employment_type_text: "合成人工聘僱類型",
      job_title_text: "合成行政職務", registration_status_text: "合成人工登錄中",
      change_reason: "合成到職建檔", content_hash: hash("c"),
      result_employment_version_id: ID.historyC1, result_membership_version: 1 }),
    approved({ proposal_id: ID.proposalC2, proposal_key: ID.proposalKeyC2,
      proposal_number: 4, action: "terminate" as const, target_membership_id: ID.employeeC,
      target_profile_id: ID.profileC, target_display_name: "合成離職員工",
      expected_membership_version: 2, target_membership_status: "ended" as const,
      starts_on: startC, employment_type_text: "合成人工聘僱類型",
      job_title_text: "合成行政職務", registration_status_text: "合成人工登錄中",
      termination_effective_on: snapshotDate, change_reason: "合成立即離職停用",
      requested_at: queuedAt, decided_at: queuedAt, content_hash: hash("d"),
      result_employment_version_id: ID.historyC2, result_membership_version: 3,
      result_revocation_job_id: ID.job }),
    { proposal_id: ID.proposalPending, proposal_key: ID.proposalKeyPending,
      proposal_number: 5, action: "employment_change" as const,
      target_membership_id: ID.employeeA, target_profile_id: ID.profileA,
      target_display_name: "合成員工甲", target_employee_code: "SYNTH-001",
      expected_membership_version: 3, target_membership_status: "suspended" as const,
      starts_on: startA, ends_on: null, employment_type_text: "合成人工聘僱類型",
      job_title_text: "合成資深照顧職務", registration_status_text: "合成人工登錄中",
      termination_effective_on: null, change_reason: "合成待審暫停異動",
      status: "pending" as const, requested_by: ID.requester,
      requested_by_display_name: "合成提案人", requested_at: requestedAt,
      content_hash: hash("e"), decision: null, decision_reason: null,
      decided_by: null, decided_by_display_name: null, decided_at: null,
      result_employment_version_id: null, result_membership_version: null,
      result_revocation_job_id: null },
  ];
  const employees = [
    { membership_id: ID.employeeA, profile_id: ID.profileA, membership_version: 3,
      display_name: "合成員工甲", employee_code: "SYNTH-001", profile_kind: "staff" as const,
      profile_is_active: true, membership_status: "active" as const,
      membership_starts_on: startA, membership_ends_on: null,
      employment_version_id: ID.historyA2, employment_version: 2,
      employment_type_text: "合成人工聘僱類型", job_title_text: "合成資深照顧職務",
      registration_status_text: "合成人工登錄中",
      employment_governance_status: "versioned" as const,
      roles: [{ role_id: ID.roleCare, role_key: "care_worker", role_name: "照顧服務員" }],
      role_count: 1, certificate_total: 2, expired_certificate_total: 1,
      nearest_certificate_expiry: daysBefore(snapshotDate, 2),
      qualification_evaluation_status: "not_evaluated" as const,
      revocation_job_id: null, revocation_provider_status: null,
      revocation_delivery_status: null, revocation_verification_status: null,
      revocation_queued_at: null, revocation_deadline_at: null },
    { membership_id: ID.employeeB, profile_id: ID.profileB, membership_version: 2,
      display_name: "合成專業人員", employee_code: "SYNTH-002",
      profile_kind: "professional" as const, profile_is_active: true,
      membership_status: "active" as const, membership_starts_on: daysBefore(snapshotDate, 90),
      membership_ends_on: null, employment_version_id: null, employment_version: null,
      employment_type_text: null, job_title_text: null, registration_status_text: null,
      employment_governance_status: "not_initialized" as const,
      roles: [{ role_id: ID.roleNurse, role_key: "nurse", role_name: "護理人員" }],
      role_count: 1, certificate_total: 0, expired_certificate_total: 0,
      nearest_certificate_expiry: null,
      qualification_evaluation_status: "not_evaluated" as const,
      revocation_job_id: null, revocation_provider_status: null,
      revocation_delivery_status: null, revocation_verification_status: null,
      revocation_queued_at: null, revocation_deadline_at: null },
    { membership_id: ID.employeeC, profile_id: ID.profileC, membership_version: 3,
      display_name: "合成離職員工", employee_code: "SYNTH-003", profile_kind: "staff" as const,
      profile_is_active: true, membership_status: "ended" as const,
      membership_starts_on: startC, membership_ends_on: snapshotDate,
      employment_version_id: ID.historyC2, employment_version: 2,
      employment_type_text: "合成人工聘僱類型", job_title_text: "合成行政職務",
      registration_status_text: "合成人工登錄中",
      employment_governance_status: "versioned" as const,
      roles: [{ role_id: ID.roleCare, role_key: "care_worker", role_name: "照顧服務員" }],
      role_count: 1, certificate_total: 1, expired_certificate_total: 0,
      nearest_certificate_expiry: null,
      qualification_evaluation_status: "not_evaluated" as const,
      revocation_job_id: ID.job, revocation_provider_status: "not_configured" as const,
      revocation_delivery_status: "queued" as const,
      revocation_verification_status: "not_verified" as const,
      revocation_queued_at: queuedAt, revocation_deadline_at: deadlineAt },
  ].filter((employee) => matchesFilters(employee, filters));
  const jobs = [{ job_id: ID.job, membership_id: ID.employeeC, profile_id: ID.profileC,
    source_proposal_id: ID.proposalC2, provider_status: "not_configured" as const,
    delivery_status: "queued" as const, verification_status: "not_verified" as const,
    queued_at: queuedAt, deadline_at: deadlineAt, completed_at: null, failed_at: null,
    content_hash: hash("f"), sla_status: "overdue_not_verified" as const }];
  const row: StaffManagementSnapshotSourceRow = {
    organization_id: organizationId, branch_id: branchId, generated_at: generatedAt,
    snapshot_date: snapshotDate, employees, employee_total: employees.length,
    employees_truncated: false,
    active_employee_total: employees.filter((employee) =>
      employee.membership_status === "active" && employee.profile_is_active).length,
    ended_employee_total: employees.filter((employee) =>
      employee.membership_status === "ended").length,
    disabled_account_total: employees.filter((employee) =>
      employee.membership_status !== "active" || !employee.profile_is_active).length,
    expired_qualification_membership_total: employees.filter((employee) =>
      employee.expired_certificate_total > 0).length,
    employment_history: history, employment_history_total: history.length,
    employment_history_truncated: false, proposals, proposal_total: proposals.length,
    pending_proposal_total: 1, proposals_truncated: false,
    role_requests: [{ request_id: ID.roleRequest, operation: "assign_role",
      target_membership_id: ID.employeeA, target_role_id: ID.roleNurse,
      role_key: "nurse", role_name: "護理人員", expected_membership_version: 3,
      status: "pending", requested_by: ID.requester,
      requested_by_display_name: "合成提案人", requested_at: requestedAt,
      request_hash: hash("f"), approved_by: null,
      approved_by_display_name: null, approved_at: null, applied_at: null }],
    role_request_total: 1, pending_role_request_total: 1,
    role_requests_truncated: false,
    role_options: [
      { role_id: ID.roleCare, role_key: "care_worker", role_name: "照顧服務員",
        is_system: true },
      { role_id: ID.roleNurse, role_key: "nurse", role_name: "護理人員",
        is_system: true },
    ], role_option_total: 2, role_options_truncated: false,
    profile_options: [], profile_option_total: 0, profile_options_truncated: false,
    onboarding_candidate_source_status: "not_configured",
    revocation_jobs: jobs, revocation_job_total: 1, pending_revocation_total: 1,
    overdue_revocation_total: 1, identity_source: "profiles_memberships",
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
  return row;
}

export function buildDemoStaffManagementSnapshot(args: DemoStaffManagementArgs) {
  return projectStaffManagementSnapshot({
    row: buildDemoStaffManagementSourceRow(args),
    expectedOrganizationId: args.organizationId,
    expectedBranchId: args.branchId,
    filters: args.filters,
    demo: true,
  });
}
