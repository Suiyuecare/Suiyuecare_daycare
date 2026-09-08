import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { isStaffManagementDate, staffManagementTaipeiDate } from "./date";
import type {
  StaffEmploymentHistory,
  StaffManagementEmployee,
  StaffManagementFilters,
  StaffManagementProposal,
  StaffManagementSnapshot,
  StaffRevocationJob,
  StaffRoleRequest,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const date = z.string().refine(isStaffManagementDate);
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const clean = (max: number, multiline = false) => z.string().trim().min(1).max(max)
  .refine((value) => multiline
    ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    : !/[\u0000-\u001f\u007f]/u.test(value));
const count = z.preprocess((value) => typeof value === "string" && /^\d+$/u.test(value)
  ? Number(value) : value, z.number().int().nonnegative().safe());
const positive = z.preprocess((value) => typeof value === "string" && /^\d+$/u.test(value)
  ? Number(value) : value, z.number().int().positive().safe());
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const membershipStatus = z.enum(["invited", "active", "suspended", "ended"]);
const terminalMembershipStatus = z.enum(["active", "suspended", "ended"]);
const profileKind = z.enum(["staff", "professional", "driver", "finance"]);

const roleSchema = z.object({
  role_id: uuid, role_key: clean(64), role_name: clean(120),
}).strict();

const employeeSchema = z.object({
  membership_id: uuid, profile_id: uuid, membership_version: positive,
  display_name: clean(120), employee_code: clean(120).nullable(),
  profile_kind: profileKind, profile_is_active: z.boolean(),
  membership_status: membershipStatus, membership_starts_on: date,
  membership_ends_on: date.nullable(), employment_version_id: uuid.nullable(),
  employment_version: positive.nullable(),
  employment_type_text: clean(120).nullable(), job_title_text: clean(160).nullable(),
  registration_status_text: clean(160).nullable(),
  employment_governance_status: z.enum(["not_initialized", "versioned"]),
  roles: z.array(roleSchema).max(100), role_count: count,
  certificate_total: count, expired_certificate_total: count,
  nearest_certificate_expiry: date.nullable(),
  qualification_evaluation_status: z.literal("not_evaluated"),
  revocation_job_id: uuid.nullable(),
  revocation_provider_status: z.literal("not_configured").nullable(),
  revocation_delivery_status: z.literal("queued").nullable(),
  revocation_verification_status: z.literal("not_verified").nullable(),
  revocation_queued_at: timestamp.nullable(),
  revocation_deadline_at: timestamp.nullable(),
}).strict();

const historySchema = z.object({
  employment_version_id: uuid, membership_id: uuid, version: positive,
  previous_version_id: uuid.nullable(), membership_version: positive,
  action: z.enum(["onboard", "employment_change", "terminate"]),
  membership_status: terminalMembershipStatus, starts_on: date, ends_on: date.nullable(),
  employment_type_text: clean(120).nullable(), job_title_text: clean(160).nullable(),
  registration_status_text: clean(160).nullable(), change_reason: clean(1_000, true),
  source_proposal_id: uuid, approved_by_display_name: clean(120),
  approved_at: timestamp, content_hash: hash,
}).strict();

const proposalSchema = z.object({
  proposal_id: uuid, proposal_key: uuid, proposal_number: positive,
  action: z.enum(["onboard", "employment_change", "terminate"]),
  target_membership_id: uuid, target_profile_id: uuid,
  target_display_name: clean(120), target_employee_code: clean(120).nullable(),
  expected_membership_version: count,
  target_membership_status: terminalMembershipStatus,
  starts_on: date, ends_on: date.nullable(),
  employment_type_text: clean(120).nullable(), job_title_text: clean(160).nullable(),
  registration_status_text: clean(160).nullable(),
  termination_effective_on: date.nullable(), change_reason: clean(1_000, true),
  status: z.enum(["pending", "approved", "rejected"]),
  requested_by: uuid, requested_by_display_name: clean(120), requested_at: timestamp,
  content_hash: hash, decision: z.enum(["approve", "reject"]).nullable(),
  decision_reason: clean(1_000, true).nullable(), decided_by: uuid.nullable(),
  decided_by_display_name: clean(120).nullable(), decided_at: timestamp.nullable(),
  result_employment_version_id: uuid.nullable(),
  result_membership_version: positive.nullable(),
  result_revocation_job_id: uuid.nullable(),
}).strict();

const roleRequestSchema = z.object({
  request_id: uuid, operation: z.enum(["assign_role", "revoke_role"]),
  target_membership_id: uuid, target_role_id: uuid,
  role_key: clean(64), role_name: clean(120), expected_membership_version: positive,
  status: z.enum(["pending", "approved"]), requested_by: uuid,
  requested_by_display_name: clean(120), requested_at: timestamp, request_hash: hash,
  approved_by: uuid.nullable(), approved_by_display_name: clean(120).nullable(),
  approved_at: timestamp.nullable(), applied_at: timestamp.nullable(),
}).strict();

const roleOptionSchema = z.object({
  role_id: uuid, role_key: clean(64), role_name: clean(120), is_system: z.boolean(),
}).strict();
const profileOptionSchema = z.object({
  profile_id: uuid, display_name: clean(120), employee_code: clean(120).nullable(),
  profile_kind: profileKind,
}).strict();
const revocationJobSchema = z.object({
  job_id: uuid, membership_id: uuid, profile_id: uuid, source_proposal_id: uuid,
  provider_status: z.literal("not_configured"), delivery_status: z.literal("queued"),
  verification_status: z.literal("not_verified"), queued_at: timestamp,
  deadline_at: timestamp, completed_at: z.null(), failed_at: z.null(),
  content_hash: hash,
  sla_status: z.enum(["pending_not_verified", "overdue_not_verified"]),
}).strict();

const sourceSchema = z.object({
  organization_id: uuid, branch_id: uuid, generated_at: timestamp, snapshot_date: date,
  employees: z.array(employeeSchema).max(200), employee_total: count,
  employees_truncated: z.boolean(), active_employee_total: count,
  ended_employee_total: count, disabled_account_total: count,
  expired_qualification_membership_total: count,
  employment_history: z.array(historySchema).max(500), employment_history_total: count,
  employment_history_truncated: z.boolean(),
  proposals: z.array(proposalSchema).max(200), proposal_total: count,
  pending_proposal_total: count, proposals_truncated: z.boolean(),
  role_requests: z.array(roleRequestSchema).max(200), role_request_total: count,
  pending_role_request_total: count, role_requests_truncated: z.boolean(),
  role_options: z.array(roleOptionSchema).max(100), role_option_total: count,
  role_options_truncated: z.boolean(), profile_options: z.array(profileOptionSchema).max(100),
  profile_option_total: count, profile_options_truncated: z.boolean(),
  onboarding_candidate_source_status: z.literal("not_configured"),
  revocation_jobs: z.array(revocationJobSchema).max(200), revocation_job_total: count,
  pending_revocation_total: count, overdue_revocation_total: count,
  identity_source: z.literal("profiles_memberships"),
  role_source: z.literal("membership_roles_role_governance"),
  qualification_source: z.literal("page72_terminal_projection"),
  employment_taxonomy_status: z.literal("manual_unstandardized"),
  registration_taxonomy_status: z.literal("manual_unstandardized"),
  qualification_reminder_policy_status: z.literal("not_configured"),
  qualification_notice_days: z.null(), expiring_qualification_total: z.null(),
  restricted_service_policy_status: z.literal("not_configured"),
  qualification_evaluation_status: z.literal("not_evaluated"),
  session_revocation_provider_status: z.literal("not_configured"),
  session_revocation_sla_minutes: z.literal(5),
  session_revocation_verification_status: z.literal("not_verified"),
  recent_aal2_max_age_minutes: z.literal(15),
  full_hr_payroll_scope: z.literal("excluded"),
  attachment_pipeline_status: z.literal("not_configured"),
  export_status: z.literal("disabled"), offline_status: z.literal("disabled"),
}).strict();

export type StaffManagementSnapshotSourceRow = z.input<typeof sourceSchema>;

function invalid(): never {
  throw new Error("STAFF_MANAGEMENT_SNAPSHOT_INVALID");
}

function mapEmployee(value: z.output<typeof employeeSchema>): StaffManagementEmployee {
  return {
    membershipId: value.membership_id, profileId: value.profile_id,
    membershipVersion: value.membership_version, displayName: value.display_name,
    employeeCode: value.employee_code, profileKind: value.profile_kind,
    profileIsActive: value.profile_is_active, membershipStatus: value.membership_status,
    membershipStartsOn: value.membership_starts_on,
    membershipEndsOn: value.membership_ends_on,
    employmentVersionId: value.employment_version_id,
    employmentVersion: value.employment_version,
    employmentTypeText: value.employment_type_text, jobTitleText: value.job_title_text,
    registrationStatusText: value.registration_status_text,
    employmentGovernanceStatus: value.employment_governance_status,
    roles: value.roles.map((role) => ({ roleId: role.role_id,
      roleKey: role.role_key, roleName: role.role_name })),
    roleCount: value.role_count, certificateTotal: value.certificate_total,
    expiredCertificateTotal: value.expired_certificate_total,
    nearestCertificateExpiry: value.nearest_certificate_expiry,
    qualificationEvaluationStatus: value.qualification_evaluation_status,
    revocationJobId: value.revocation_job_id,
    revocationProviderStatus: value.revocation_provider_status,
    revocationDeliveryStatus: value.revocation_delivery_status,
    revocationVerificationStatus: value.revocation_verification_status,
    revocationQueuedAt: value.revocation_queued_at,
    revocationDeadlineAt: value.revocation_deadline_at,
  };
}

function mapHistory(value: z.output<typeof historySchema>): StaffEmploymentHistory {
  return {
    employmentVersionId: value.employment_version_id,
    membershipId: value.membership_id, version: value.version,
    previousVersionId: value.previous_version_id,
    membershipVersion: value.membership_version, action: value.action,
    membershipStatus: value.membership_status, startsOn: value.starts_on,
    endsOn: value.ends_on, employmentTypeText: value.employment_type_text,
    jobTitleText: value.job_title_text,
    registrationStatusText: value.registration_status_text,
    changeReason: value.change_reason, sourceProposalId: value.source_proposal_id,
    approvedByDisplayName: value.approved_by_display_name,
    approvedAt: value.approved_at, contentHash: value.content_hash,
  };
}

function mapProposal(value: z.output<typeof proposalSchema>): StaffManagementProposal {
  return {
    proposalId: value.proposal_id, proposalKey: value.proposal_key,
    proposalNumber: value.proposal_number, action: value.action,
    targetMembershipId: value.target_membership_id,
    targetProfileId: value.target_profile_id,
    targetDisplayName: value.target_display_name,
    targetEmployeeCode: value.target_employee_code,
    expectedMembershipVersion: value.expected_membership_version,
    targetMembershipStatus: value.target_membership_status,
    startsOn: value.starts_on, endsOn: value.ends_on,
    employmentTypeText: value.employment_type_text,
    jobTitleText: value.job_title_text,
    registrationStatusText: value.registration_status_text,
    terminationEffectiveOn: value.termination_effective_on,
    changeReason: value.change_reason, status: value.status,
    requestedBy: value.requested_by,
    requestedByDisplayName: value.requested_by_display_name,
    requestedAt: value.requested_at, contentHash: value.content_hash,
    decision: value.decision, decisionReason: value.decision_reason,
    decidedBy: value.decided_by,
    decidedByDisplayName: value.decided_by_display_name,
    decidedAt: value.decided_at,
    resultEmploymentVersionId: value.result_employment_version_id,
    resultMembershipVersion: value.result_membership_version,
    resultRevocationJobId: value.result_revocation_job_id,
  };
}

function mapRoleRequest(value: z.output<typeof roleRequestSchema>): StaffRoleRequest {
  return {
    requestId: value.request_id, operation: value.operation,
    targetMembershipId: value.target_membership_id,
    targetRoleId: value.target_role_id, roleKey: value.role_key,
    roleName: value.role_name,
    expectedMembershipVersion: value.expected_membership_version,
    status: value.status, requestedBy: value.requested_by,
    requestedByDisplayName: value.requested_by_display_name,
    requestedAt: value.requested_at, requestHash: value.request_hash,
    approvedBy: value.approved_by,
    approvedByDisplayName: value.approved_by_display_name,
    approvedAt: value.approved_at, appliedAt: value.applied_at,
  };
}

function mapJob(value: z.output<typeof revocationJobSchema>): StaffRevocationJob {
  return {
    jobId: value.job_id, membershipId: value.membership_id,
    profileId: value.profile_id, sourceProposalId: value.source_proposal_id,
    providerStatus: value.provider_status, deliveryStatus: value.delivery_status,
    verificationStatus: value.verification_status, queuedAt: value.queued_at,
    deadlineAt: value.deadline_at, completedAt: null, failedAt: null,
    contentHash: value.content_hash, slaStatus: value.sla_status,
  };
}

export function projectStaffManagementSnapshot({
  row: value, expectedOrganizationId, expectedBranchId, filters, demo,
}: {
  row: StaffManagementSnapshotSourceRow;
  expectedOrganizationId: string;
  expectedBranchId: string;
  filters: StaffManagementFilters;
  demo: boolean;
}): StaffManagementSnapshot {
  const parsed = sourceSchema.safeParse(value);
  if (!parsed.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== expectedOrganizationId ||
    row.branch_id !== expectedBranchId ||
    row.snapshot_date !== staffManagementTaipeiDate(new Date(row.generated_at)) ||
    row.employees_truncated !== (row.employee_total > 200) ||
    row.employment_history_truncated !== (row.employment_history_total > 500) ||
    row.proposals_truncated !== (row.proposal_total > 200) ||
    row.role_requests_truncated !== (row.role_request_total > 200) ||
    row.role_options_truncated !== (row.role_option_total > 100) ||
    row.profile_options_truncated !== (row.profile_option_total > 100) ||
    row.employees.length > row.employee_total ||
    row.employment_history.length > row.employment_history_total ||
    row.proposals.length > row.proposal_total ||
    row.role_requests.length > row.role_request_total ||
    row.role_options.length > row.role_option_total ||
    row.profile_options.length > row.profile_option_total ||
    row.onboarding_candidate_source_status === "not_configured" &&
      (row.profile_option_total !== 0 || row.profile_options.length !== 0) ||
    row.revocation_jobs.length > row.revocation_job_total ||
    row.active_employee_total + row.ended_employee_total > row.employee_total ||
    row.disabled_account_total > row.employee_total ||
    row.expired_qualification_membership_total > row.employee_total ||
    row.pending_proposal_total > row.proposal_total ||
    row.pending_role_request_total > row.role_request_total ||
    row.pending_revocation_total > row.revocation_job_total ||
    row.overdue_revocation_total > row.revocation_job_total) invalid();

  const membershipIds = new Set<string>();
  for (const employee of row.employees) {
    const roleIds = employee.roles.map((role) => role.role_id);
    const jobNull = employee.revocation_job_id === null;
    if (membershipIds.has(employee.membership_id) ||
      employee.membership_ends_on !== null &&
        employee.membership_ends_on < employee.membership_starts_on ||
      employee.role_count !== employee.roles.length ||
      new Set(roleIds).size !== roleIds.length ||
      employee.expired_certificate_total > employee.certificate_total ||
      (employee.employment_governance_status === "not_initialized") !==
        (employee.employment_version_id === null && employee.employment_version === null) ||
      (employee.employment_version_id === null) !== (employee.employment_version === null) ||
      (jobNull !== (employee.revocation_provider_status === null)) ||
      (jobNull !== (employee.revocation_delivery_status === null)) ||
      (jobNull !== (employee.revocation_verification_status === null)) ||
      (jobNull !== (employee.revocation_queued_at === null)) ||
      (jobNull !== (employee.revocation_deadline_at === null)) ||
      (!jobNull && Date.parse(employee.revocation_deadline_at!) -
        Date.parse(employee.revocation_queued_at!) !== 5 * 60_000)) invalid();
    membershipIds.add(employee.membership_id);
  }

  const historyIds = new Set<string>();
  const historyByMembership = new Map<string, z.output<typeof historySchema>[]>();
  for (const item of row.employment_history) {
    if (historyIds.has(item.employment_version_id) ||
      item.ends_on !== null && item.ends_on < item.starts_on ||
      (item.version === 1) !== (item.previous_version_id === null) ||
      item.action === "terminate" && item.membership_status !== "ended" ||
      item.action !== "terminate" && item.membership_status === "ended") invalid();
    historyIds.add(item.employment_version_id);
    historyByMembership.set(item.membership_id,
      [...(historyByMembership.get(item.membership_id) ?? []), item]);
  }
  if (!row.employment_history_truncated) {
    if (row.employment_history_total !== row.employment_history.length) invalid();
    for (const versions of historyByMembership.values()) {
      versions.sort((a, b) => a.version - b.version);
      for (const [index, item] of versions.entries()) {
        if (item.version !== index + 1 || (index === 0
          ? item.previous_version_id !== null
          : item.previous_version_id !== versions[index - 1]!.employment_version_id) ||
          index > 0 && item.membership_version <= versions[index - 1]!.membership_version) {
          invalid();
        }
      }
    }
    for (const employee of row.employees) {
      if (employee.employment_version_id !== null && !row.employment_history.some((item) =>
        item.employment_version_id === employee.employment_version_id &&
        item.membership_id === employee.membership_id &&
        item.version === employee.employment_version &&
        item.membership_version <= employee.membership_version)) invalid();
    }
  }

  const proposalIds = new Set<string>();
  const proposalKeys = new Set<string>();
  const proposalNumbers = new Set<number>();
  for (const proposal of row.proposals) {
    const onboarding = proposal.action === "onboard" &&
      proposal.expected_membership_version === 0 &&
      proposal.target_membership_status === "active" &&
      proposal.termination_effective_on === null &&
      proposal.employment_type_text !== null && proposal.job_title_text !== null &&
      proposal.registration_status_text !== null;
    const employment = proposal.action === "employment_change" &&
      proposal.expected_membership_version > 0 &&
      proposal.target_membership_status !== "ended" &&
      proposal.termination_effective_on === null &&
      proposal.employment_type_text !== null && proposal.job_title_text !== null &&
      proposal.registration_status_text !== null;
    const termination = proposal.action === "terminate" &&
      proposal.expected_membership_version > 0 &&
      proposal.target_membership_status === "ended" &&
      proposal.termination_effective_on !== null &&
      proposal.termination_effective_on <= row.snapshot_date;
    const pending = proposal.status === "pending" && proposal.decision === null &&
      proposal.decision_reason === null && proposal.decided_by === null &&
      proposal.decided_by_display_name === null && proposal.decided_at === null &&
      proposal.result_employment_version_id === null &&
      proposal.result_membership_version === null &&
      proposal.result_revocation_job_id === null;
    const rejected = proposal.status === "rejected" && proposal.decision === "reject" &&
      proposal.decision_reason !== null && proposal.decided_by !== null &&
      proposal.decided_by !== proposal.requested_by &&
      proposal.decided_by_display_name !== null && proposal.decided_at !== null &&
      proposal.result_employment_version_id === null &&
      proposal.result_membership_version === null &&
      proposal.result_revocation_job_id === null;
    const approved = proposal.status === "approved" && proposal.decision === "approve" &&
      proposal.decision_reason !== null && proposal.decided_by !== null &&
      proposal.decided_by !== proposal.requested_by &&
      proposal.decided_by_display_name !== null && proposal.decided_at !== null &&
      proposal.result_employment_version_id !== null &&
      proposal.result_membership_version === proposal.expected_membership_version + 1 &&
      ((proposal.action === "terminate") ===
        (proposal.result_revocation_job_id !== null));
    if (proposalIds.has(proposal.proposal_id) || proposalKeys.has(proposal.proposal_key) ||
      proposalNumbers.has(proposal.proposal_number) ||
      proposal.ends_on !== null && proposal.ends_on < proposal.starts_on ||
      (!onboarding && !employment && !termination) ||
      (!pending && !rejected && !approved)) invalid();
    proposalIds.add(proposal.proposal_id); proposalKeys.add(proposal.proposal_key);
    proposalNumbers.add(proposal.proposal_number);
  }
  if (!row.proposals_truncated && (row.proposal_total !== row.proposals.length ||
    row.pending_proposal_total !== row.proposals.filter((item) =>
      item.status === "pending").length)) invalid();
  if (!row.employment_history_truncated && row.proposals.some((proposal) =>
    proposal.status === "approved" && !row.employment_history.some((history) =>
      history.employment_version_id === proposal.result_employment_version_id &&
      history.source_proposal_id === proposal.proposal_id &&
      history.membership_id === proposal.target_membership_id &&
      history.membership_version === proposal.result_membership_version &&
      history.action === proposal.action))) invalid();

  const roleRequestIds = new Set<string>();
  for (const request of row.role_requests) {
    const pending = request.status === "pending" && request.approved_by === null &&
      request.approved_by_display_name === null && request.approved_at === null &&
      request.applied_at === null;
    const approved = request.status === "approved" && request.approved_by !== null &&
      request.approved_by !== request.requested_by &&
      request.approved_by_display_name !== null && request.approved_at !== null &&
      request.applied_at !== null;
    if (roleRequestIds.has(request.request_id) || (!pending && !approved)) invalid();
    roleRequestIds.add(request.request_id);
  }
  if (!row.role_requests_truncated && (row.role_request_total !== row.role_requests.length ||
    row.pending_role_request_total !== row.role_requests.filter((item) =>
      item.status === "pending").length)) invalid();

  if (!row.employees_truncated && (row.employee_total !== row.employees.length ||
    row.active_employee_total !== row.employees.filter((item) =>
      item.membership_status === "active" && item.profile_is_active).length ||
    row.ended_employee_total !== row.employees.filter((item) =>
      item.membership_status === "ended").length ||
    row.disabled_account_total !== row.employees.filter((item) =>
      item.membership_status !== "active" || !item.profile_is_active).length ||
    row.expired_qualification_membership_total !== row.employees.filter((item) =>
      item.expired_certificate_total > 0).length)) invalid();
  if (!row.role_options_truncated && row.role_option_total !== row.role_options.length) invalid();
  if (!row.profile_options_truncated && row.profile_option_total !== row.profile_options.length) {
    invalid();
  }

  const jobIds = new Set<string>();
  for (const job of row.revocation_jobs) {
    const expectedSla = Date.parse(job.deadline_at) < Date.parse(row.generated_at)
      ? "overdue_not_verified" : "pending_not_verified";
    if (jobIds.has(job.job_id) ||
      Date.parse(job.deadline_at) - Date.parse(job.queued_at) !== 5 * 60_000 ||
      job.sla_status !== expectedSla ||
      !row.proposals.some((proposal) => proposal.proposal_id === job.source_proposal_id &&
        proposal.action === "terminate" && proposal.status === "approved" &&
        proposal.target_membership_id === job.membership_id &&
        proposal.target_profile_id === job.profile_id &&
        proposal.result_revocation_job_id === job.job_id)) invalid();
    jobIds.add(job.job_id);
  }
  if (row.revocation_job_total <= 200 && row.revocation_jobs.length !== row.revocation_job_total) {
    invalid();
  }
  if (row.pending_revocation_total !== row.revocation_job_total ||
    row.overdue_revocation_total !== row.revocation_jobs.filter((job) =>
      job.sla_status === "overdue_not_verified").length && row.revocation_job_total <= 200) {
    invalid();
  }
  if (row.revocation_job_total <= 200) {
    for (const employee of row.employees) {
      if (employee.revocation_job_id !== null && !row.revocation_jobs.some((job) =>
        job.job_id === employee.revocation_job_id &&
        job.membership_id === employee.membership_id &&
        job.profile_id === employee.profile_id &&
        job.queued_at === employee.revocation_queued_at &&
        job.deadline_at === employee.revocation_deadline_at)) invalid();
    }
    for (const proposal of row.proposals) {
      if (proposal.action === "terminate" && proposal.status === "approved" &&
        !row.revocation_jobs.some((job) =>
          job.job_id === proposal.result_revocation_job_id &&
          job.source_proposal_id === proposal.proposal_id &&
          job.membership_id === proposal.target_membership_id &&
          job.profile_id === proposal.target_profile_id)) invalid();
    }
  }

  return {
    organizationId: row.organization_id, branchId: row.branch_id,
    generatedAt: row.generated_at, snapshotDate: row.snapshot_date,
    staleAfter: new Date(Date.parse(row.generated_at) + 5 * 60_000).toISOString(),
    filters, employees: row.employees.map(mapEmployee), employeeTotal: row.employee_total,
    employeesTruncated: row.employees_truncated,
    activeEmployeeTotal: row.active_employee_total,
    endedEmployeeTotal: row.ended_employee_total,
    disabledAccountTotal: row.disabled_account_total,
    expiredQualificationMembershipTotal: row.expired_qualification_membership_total,
    employmentHistory: row.employment_history.map(mapHistory),
    employmentHistoryTotal: row.employment_history_total,
    employmentHistoryTruncated: row.employment_history_truncated,
    proposals: row.proposals.map(mapProposal), proposalTotal: row.proposal_total,
    pendingProposalTotal: row.pending_proposal_total,
    proposalsTruncated: row.proposals_truncated,
    roleRequests: row.role_requests.map(mapRoleRequest),
    roleRequestTotal: row.role_request_total,
    pendingRoleRequestTotal: row.pending_role_request_total,
    roleRequestsTruncated: row.role_requests_truncated,
    roleOptions: row.role_options.map((role) => ({ roleId: role.role_id,
      roleKey: role.role_key, roleName: role.role_name, isSystem: role.is_system })),
    roleOptionTotal: row.role_option_total,
    roleOptionsTruncated: row.role_options_truncated,
    profileOptions: row.profile_options.map((profile) => ({
      profileId: profile.profile_id, displayName: profile.display_name,
      employeeCode: profile.employee_code, profileKind: profile.profile_kind,
    })), profileOptionTotal: row.profile_option_total,
    profileOptionsTruncated: row.profile_options_truncated,
    onboardingCandidateSourceStatus: row.onboarding_candidate_source_status,
    revocationJobs: row.revocation_jobs.map(mapJob),
    revocationJobTotal: row.revocation_job_total,
    pendingRevocationTotal: row.pending_revocation_total,
    overdueRevocationTotal: row.overdue_revocation_total,
    identitySource: row.identity_source, roleSource: row.role_source,
    qualificationSource: row.qualification_source,
    employmentTaxonomyStatus: row.employment_taxonomy_status,
    registrationTaxonomyStatus: row.registration_taxonomy_status,
    qualificationReminderPolicyStatus: row.qualification_reminder_policy_status,
    qualificationNoticeDays: null, expiringQualificationTotal: null,
    restrictedServicePolicyStatus: row.restricted_service_policy_status,
    qualificationEvaluationStatus: row.qualification_evaluation_status,
    sessionRevocationProviderStatus: row.session_revocation_provider_status,
    sessionRevocationSlaMinutes: 5,
    sessionRevocationVerificationStatus: row.session_revocation_verification_status,
    fullHrPayrollScope: row.full_hr_payroll_scope,
    attachmentPipelineStatus: row.attachment_pipeline_status,
    exportStatus: row.export_status, offlineStatus: row.offline_status,
    recentAal2MaxAgeMinutes: 15, demo,
  };
}
