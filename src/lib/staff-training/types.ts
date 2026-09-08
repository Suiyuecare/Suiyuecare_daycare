export const STAFF_TRAINING_STATUSES = [
  "all", "active", "voided", "missing_evidence", "expiring",
] as const;
export type StaffTrainingStatusFilter = (typeof STAFF_TRAINING_STATUSES)[number];
export type StaffTrainingEvidenceStatus = "provided" | "missing" | "not_applicable";

export type StaffTrainingFilters = {
  dateFrom: string | null;
  dateTo: string | null;
  staffMembershipId: string | null;
  courseType: string | null;
  status: StaffTrainingStatusFilter;
  query: string;
};

export type StaffTrainingRecord = {
  recordVersionId: string;
  trainingKey: string;
  version: number;
  previousVersionId: string | null;
  recordStatus: "active" | "voided";
  correctionReason: string | null;
  staffMembershipId: string;
  staffUserId: string;
  staffDisplayName: string;
  staffEmployeeCode: string | null;
  courseTitle: string;
  trainingDate: string;
  startsAt: string;
  endsAt: string;
  courseType: string;
  hours: string;
  credits: string | null;
  providerName: string;
  evidenceStatus: StaffTrainingEvidenceStatus;
  creditExpiresOn: string | null;
  isExpiring: boolean | null;
  recordedBy: string;
  recordedByDisplayName: string;
  recordedAt: string;
  contentHash: string;
};

export type StaffTrainingStaffOption = {
  staffMembershipId: string;
  staffUserId: string;
  displayName: string;
  employeeCode: string | null;
  isCurrent: boolean;
};

export type StaffTrainingCourseTypeOption = {
  courseType: string;
  recordCount: number;
};

export type StaffTrainingProgress = {
  staffMembershipId: string;
  staffUserId: string;
  displayName: string;
  employeeCode: string | null;
  activeRecordCount: number;
  knownCredits: string | null;
  missingCreditCount: number | null;
  requiredCredits: string | null;
  creditGap: string | null;
  progressStatus: "not_configured" | "indeterminate" | "complete" | "incomplete";
  windowStart: string | null;
  windowEnd: string | null;
  ruleVersion: number | null;
};

export type StaffTrainingRuleProposal = {
  proposalId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  windowYears: number;
  requiredCredits: string;
  expiryNoticeDays: number;
  proposedBy: string;
  proposerDisplayName: string;
  proposedAt: string;
  contentHash: string;
};

export type StaffTrainingSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  snapshotDate: string;
  staleAfter: string;
  filters: StaffTrainingFilters;
  policyStatus: "not_configured" | "published";
  ruleVersionId: string | null;
  ruleVersion: number | null;
  ruleEffectiveFrom: string | null;
  ruleEffectiveTo: string | null;
  windowYears: number | null;
  requiredCredits: string | null;
  expiryNoticeDays: number | null;
  records: readonly StaffTrainingRecord[];
  recordTotal: number;
  recordsTruncated: boolean;
  hoursTotal: string;
  creditsTotal: string | null;
  creditedRecordTotal: number;
  missingCreditTotal: number;
  missingEvidenceTotal: number;
  expiringTotal: number | null;
  staffOptions: readonly StaffTrainingStaffOption[];
  staffTotal: number;
  staffTruncated: boolean;
  courseTypeOptions: readonly StaffTrainingCourseTypeOption[];
  courseTypeTotal: number;
  courseTypesTruncated: boolean;
  staffProgress: readonly StaffTrainingProgress[];
  progressTotal: number;
  progressTruncated: boolean;
  gapStaffTotal: number | null;
  indeterminateStaffTotal: number | null;
  pendingRuleProposals: readonly StaffTrainingRuleProposal[];
  pendingRuleProposalTotal: number;
  pendingRuleProposalsTruncated: boolean;
  attachmentPipelineStatus: "not_configured";
  attachmentScanStatus: "not_configured";
  externalReporting: "not_implemented";
  progressScope: "published_rule_window_all_course_types";
  demo: boolean;
};

export type StaffTrainingRecordInput =
  | {
    action: "create" | "correct";
    trainingKey: string;
    previousVersionId: string | null;
    expectedBaseVersion: number;
    staffMembershipId: string;
    courseTitle: string;
    trainingDate: string;
    startsAt: string;
    endsAt: string;
    courseType: string;
    hours: string;
    credits: string | null;
    providerName: string;
    evidenceStatus: "missing" | "not_applicable";
    attachmentReference: null;
    attachmentSha256: null;
    correctionReason: string | null;
    idempotencyKey: string;
  }
  | {
    action: "void";
    trainingKey: string;
    previousVersionId: string;
    expectedBaseVersion: number;
    staffMembershipId: string;
    courseTitle: null;
    trainingDate: null;
    startsAt: null;
    endsAt: null;
    courseType: null;
    hours: null;
    credits: null;
    providerName: null;
    evidenceStatus: null;
    attachmentReference: null;
    attachmentSha256: null;
    correctionReason: string;
    idempotencyKey: string;
  };

export type StaffTrainingRecordReceipt = {
  organizationId: string;
  branchId: string;
  trainingKey: string;
  recordVersionId: string;
  version: number;
  previousVersionId: string | null;
  recordStatus: "active" | "voided";
  staffMembershipId: string;
  contentHash: string;
  recordedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};

export type StaffTrainingRuleInput =
  | {
    action: "propose";
    effectiveFrom: string;
    effectiveTo: string | null;
    windowYears: number;
    requiredCredits: string;
    expiryNoticeDays: number;
    proposalId: null;
    idempotencyKey: string;
  }
  | {
    action: "publish";
    proposalId: string;
    effectiveFrom: null;
    effectiveTo: null;
    windowYears: null;
    requiredCredits: null;
    expiryNoticeDays: null;
    idempotencyKey: string;
  };

export type StaffTrainingRuleReceipt = {
  organizationId: string;
  branchId: string;
  action: "propose" | "publish";
  proposalId: string;
  ruleVersionId: string | null;
  version: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  windowYears: number;
  requiredCredits: string;
  expiryNoticeDays: number;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
