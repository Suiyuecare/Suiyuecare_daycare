export const STAFF_MANAGEMENT_STATUS_FILTERS = [
  "all", "invited", "active", "suspended", "ended",
] as const;
export type StaffManagementStatusFilter =
  (typeof STAFF_MANAGEMENT_STATUS_FILTERS)[number];

export const STAFF_MANAGEMENT_QUALIFICATION_FILTERS = [
  "all", "has_expired", "no_certificates", "not_evaluated",
] as const;
export type StaffManagementQualificationFilter =
  (typeof STAFF_MANAGEMENT_QUALIFICATION_FILTERS)[number];

export type StaffManagementFilters = {
  status: StaffManagementStatusFilter;
  roleId: string | null;
  qualification: StaffManagementQualificationFilter;
  query: string;
};

export type StaffManagementRole = {
  roleId: string;
  roleKey: string;
  roleName: string;
};

export type StaffManagementEmployee = {
  membershipId: string;
  profileId: string;
  membershipVersion: number;
  displayName: string;
  employeeCode: string | null;
  profileKind: "staff" | "professional" | "driver" | "finance";
  profileIsActive: boolean;
  membershipStatus: "invited" | "active" | "suspended" | "ended";
  membershipStartsOn: string;
  membershipEndsOn: string | null;
  employmentVersionId: string | null;
  employmentVersion: number | null;
  employmentTypeText: string | null;
  jobTitleText: string | null;
  registrationStatusText: string | null;
  employmentGovernanceStatus: "not_initialized" | "versioned";
  roles: readonly StaffManagementRole[];
  roleCount: number;
  certificateTotal: number;
  expiredCertificateTotal: number;
  nearestCertificateExpiry: string | null;
  qualificationEvaluationStatus: "not_evaluated";
  revocationJobId: string | null;
  revocationProviderStatus: "not_configured" | null;
  revocationDeliveryStatus: "queued" | null;
  revocationVerificationStatus: "not_verified" | null;
  revocationQueuedAt: string | null;
  revocationDeadlineAt: string | null;
};

export type StaffEmploymentHistory = {
  employmentVersionId: string;
  membershipId: string;
  version: number;
  previousVersionId: string | null;
  membershipVersion: number;
  action: "onboard" | "employment_change" | "terminate";
  membershipStatus: "active" | "suspended" | "ended";
  startsOn: string;
  endsOn: string | null;
  employmentTypeText: string | null;
  jobTitleText: string | null;
  registrationStatusText: string | null;
  changeReason: string;
  sourceProposalId: string;
  approvedByDisplayName: string;
  approvedAt: string;
  contentHash: string;
};

export type StaffManagementProposal = {
  proposalId: string;
  proposalKey: string;
  proposalNumber: number;
  action: "onboard" | "employment_change" | "terminate";
  targetMembershipId: string;
  targetProfileId: string;
  targetDisplayName: string;
  targetEmployeeCode: string | null;
  expectedMembershipVersion: number;
  targetMembershipStatus: "active" | "suspended" | "ended";
  startsOn: string;
  endsOn: string | null;
  employmentTypeText: string | null;
  jobTitleText: string | null;
  registrationStatusText: string | null;
  terminationEffectiveOn: string | null;
  changeReason: string;
  status: "pending" | "approved" | "rejected";
  requestedBy: string;
  requestedByDisplayName: string;
  requestedAt: string;
  contentHash: string;
  decision: "approve" | "reject" | null;
  decisionReason: string | null;
  decidedBy: string | null;
  decidedByDisplayName: string | null;
  decidedAt: string | null;
  resultEmploymentVersionId: string | null;
  resultMembershipVersion: number | null;
  resultRevocationJobId: string | null;
};

export type StaffRoleRequest = {
  requestId: string;
  operation: "assign_role" | "revoke_role";
  targetMembershipId: string;
  targetRoleId: string;
  roleKey: string;
  roleName: string;
  expectedMembershipVersion: number;
  status: "pending" | "approved";
  requestedBy: string;
  requestedByDisplayName: string;
  requestedAt: string;
  requestHash: string;
  approvedBy: string | null;
  approvedByDisplayName: string | null;
  approvedAt: string | null;
  appliedAt: string | null;
};

export type StaffRoleOption = StaffManagementRole & { isSystem: boolean };
export type StaffProfileOption = {
  profileId: string;
  displayName: string;
  employeeCode: string | null;
  profileKind: "staff" | "professional" | "driver" | "finance";
};
export type StaffRevocationJob = {
  jobId: string;
  membershipId: string;
  profileId: string;
  sourceProposalId: string;
  providerStatus: "not_configured";
  deliveryStatus: "queued";
  verificationStatus: "not_verified";
  queuedAt: string;
  deadlineAt: string;
  completedAt: null;
  failedAt: null;
  contentHash: string;
  slaStatus: "pending_not_verified" | "overdue_not_verified";
};

export type StaffManagementSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  snapshotDate: string;
  staleAfter: string;
  filters: StaffManagementFilters;
  employees: readonly StaffManagementEmployee[];
  employeeTotal: number;
  employeesTruncated: boolean;
  activeEmployeeTotal: number;
  endedEmployeeTotal: number;
  disabledAccountTotal: number;
  expiredQualificationMembershipTotal: number;
  employmentHistory: readonly StaffEmploymentHistory[];
  employmentHistoryTotal: number;
  employmentHistoryTruncated: boolean;
  proposals: readonly StaffManagementProposal[];
  proposalTotal: number;
  pendingProposalTotal: number;
  proposalsTruncated: boolean;
  roleRequests: readonly StaffRoleRequest[];
  roleRequestTotal: number;
  pendingRoleRequestTotal: number;
  roleRequestsTruncated: boolean;
  roleOptions: readonly StaffRoleOption[];
  roleOptionTotal: number;
  roleOptionsTruncated: boolean;
  profileOptions: readonly StaffProfileOption[];
  profileOptionTotal: number;
  profileOptionsTruncated: boolean;
  onboardingCandidateSourceStatus: "not_configured";
  revocationJobs: readonly StaffRevocationJob[];
  revocationJobTotal: number;
  pendingRevocationTotal: number;
  overdueRevocationTotal: number;
  identitySource: "profiles_memberships";
  roleSource: "membership_roles_role_governance";
  qualificationSource: "page72_terminal_projection";
  employmentTaxonomyStatus: "manual_unstandardized";
  registrationTaxonomyStatus: "manual_unstandardized";
  qualificationReminderPolicyStatus: "not_configured";
  qualificationNoticeDays: null;
  expiringQualificationTotal: null;
  restrictedServicePolicyStatus: "not_configured";
  qualificationEvaluationStatus: "not_evaluated";
  sessionRevocationProviderStatus: "not_configured";
  sessionRevocationSlaMinutes: 5;
  sessionRevocationVerificationStatus: "not_verified";
  fullHrPayrollScope: "excluded";
  attachmentPipelineStatus: "not_configured";
  exportStatus: "disabled";
  offlineStatus: "disabled";
  recentAal2MaxAgeMinutes: 15;
  demo: boolean;
};

export type StaffEmploymentProposalInput = {
  action: "propose";
  proposalAction: "onboard" | "employment_change";
  proposalKey: string;
  targetMembershipId: string;
  targetProfileId: string;
  expectedMembershipVersion: number;
  targetMembershipStatus: "active" | "suspended";
  startsOn: string;
  endsOn: string | null;
  employmentTypeText: string;
  jobTitleText: string;
  registrationStatusText: string;
  changeReason: string;
  idempotencyKey: string;
};

export type StaffTerminationProposalInput = {
  action: "terminate";
  proposalKey: string;
  targetMembershipId: string;
  targetProfileId: string;
  expectedMembershipVersion: number;
  startsOn: string;
  terminationEffectiveOn: string;
  changeReason: string;
  idempotencyKey: string;
};

export type StaffProposalDecisionInput = {
  action: "decide";
  proposalAction: "onboard" | "employment_change" | "terminate";
  proposalId: string;
  expectedProposalNumber: number;
  expectedMembershipVersion: number;
  expectedContentHash: string;
  expectedTargetMembershipId: string;
  expectedTargetProfileId: string;
  decision: "approve" | "reject";
  decisionReason: string;
  idempotencyKey: string;
};

export type StaffRoleChangeInput = {
  action: "request_role";
  operation: "assign_role" | "revoke_role";
  targetMembershipId: string;
  targetRoleId: string;
  expectedMembershipVersion: number;
  idempotencyKey: string;
};

export type StaffRoleApprovalInput = {
  action: "approve_role";
  requestId: string;
  expectedMembershipVersion: number;
  expectedOperation: "assign_role" | "revoke_role";
  expectedTargetMembershipId: string;
  expectedTargetRoleId: string;
  idempotencyKey: string;
};

export type StaffProposalReceipt = {
  organizationId: string;
  branchId: string;
  proposalId: string;
  proposalKey: string;
  proposalNumber: number;
  proposalAction: "onboard" | "employment_change" | "terminate";
  proposalStatus: "pending";
  targetMembershipId: string;
  targetProfileId: string;
  expectedMembershipVersion: number;
  contentHash: string;
  requestedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};

export type StaffProposalDecisionReceipt = {
  organizationId: string;
  branchId: string;
  proposalId: string;
  proposalNumber: number;
  proposalAction: "onboard" | "employment_change" | "terminate";
  decision: "approve" | "reject";
  proposalStatus: "approved" | "rejected";
  targetMembershipId: string;
  targetProfileId: string;
  resultEmploymentVersionId: string | null;
  resultEmploymentVersion: number | null;
  resultMembershipVersion: number | null;
  resultRevocationJobId: string | null;
  revocationProviderStatus: "not_configured" | null;
  revocationVerificationStatus: "not_verified" | null;
  revocationQueuedAt: string | null;
  revocationDeadlineAt: string | null;
  contentHash: string;
  decidedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};

export type StaffRoleRequestReceipt = {
  organizationId: string;
  branchId: string;
  requestId: string;
  operation: "assign_role" | "revoke_role";
  targetMembershipId: string;
  targetRoleId: string;
  expectedMembershipVersion: number;
  requestStatus: "pending";
  requestHash: string;
  requestedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};

export type StaffRoleApprovalReceipt = {
  organizationId: string;
  branchId: string;
  requestId: string;
  operation: "assign_role" | "revoke_role";
  targetMembershipId: string;
  targetRoleId: string;
  expectedMembershipVersion: number;
  resultMembershipVersion: number;
  requestStatus: "approved";
  appliedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
