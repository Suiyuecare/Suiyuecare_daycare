export const STAFF_SCHEDULING_STATUS_FILTERS = [
  "all", "ready", "conflicted", "published", "overridden", "rejected",
] as const;
export type StaffSchedulingStatusFilter =
  (typeof STAFF_SCHEDULING_STATUS_FILTERS)[number];

export type StaffSchedulingFilters = {
  periodStart: string;
  periodEnd: string;
  staffMembershipId: string | null;
  status: StaffSchedulingStatusFilter;
};

export type StaffSchedulingRuleStatus =
  "configured_manual_unstandardized" | "not_configured";

export type StaffQualificationRule = {
  roleText: string;
  requiredCertificateType: string;
  taxonomyStatus: "manual_unstandardized";
};

export type StaffSchedulingResourceRule = {
  code: string;
  name: string;
  capacity: number;
  taxonomyStatus: "manual_unstandardized";
};

export type StaffSchedulingRuleVersion = {
  ruleVersionId: string;
  ruleSetKey: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceStatus: "manual_unstandardized";
  qualificationRules: readonly StaffQualificationRule[];
  maxShiftMinutes: number;
  minRestMinutes: number;
  facilities: readonly StaffSchedulingResourceRule[];
  vehicles: readonly StaffSchedulingResourceRule[];
  branchCapacity: number;
  contentHash: string;
};

export type StaffScheduleConflict = {
  domain: "work_time" | "rest" | "qualification" | "facility" |
    "vehicle" | "branch_capacity";
  code: "shift_duration_exceeded" | "minimum_rest_not_met" |
    "terminal_certificate_evidence_missing" | "staff_time_overlap" |
    "facility_capacity_exceeded" | "vehicle_capacity_exceeded" |
    "branch_capacity_exceeded";
  message: string;
  observedMinutes?: number;
  ruleMinutes?: number;
  requiredCertificateType?: string;
  sourcePage?: 72;
  overlappingScheduleCount?: number;
  nearbyScheduleCount?: number;
  existingClients?: number;
  plannedClients?: number;
  ruleCapacity?: number;
};

export type StaffQualificationEvidence = {
  sourcePage: 72;
  recordVersionId: string;
  certificateKey: string;
  version: number;
  certificateType: string;
  validityStatus: "active" | "upcoming" | "expired" |
    "pending_verification" | "registration_not_active" | "voided";
  hasActiveException: boolean;
  snapshotDate: string;
};

export type StaffScheduleRecord = {
  scheduleVersionId: string;
  scheduleKey: string;
  version: number;
  previousVersionId: string | null;
  status: "draft_ready" | "draft_conflicted" | "published" | "voided";
  reviewMode: "standard" | "override" | "rejected" | null;
  ruleVersionId: string;
  staffMembershipId: string;
  staffUserId: string;
  staffDisplayName: string;
  staffEmployeeCode: string | null;
  startsAt: string;
  endsAt: string;
  roleText: string;
  serviceNeedText: string;
  facilityCode: string;
  vehicleCode: string;
  plannedClients: number;
  conflictCount: number;
  conflicts: readonly StaffScheduleConflict[];
  qualificationEvidence: readonly StaffQualificationEvidence[];
  qualificationProjection: "page72_terminal";
  revisionReason: string;
  createdBy: string;
  creatorDisplayName: string;
  createdAt: string;
  reviewedBy: string | null;
  reviewerDisplayName: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  contentHash: string;
};

export type StaffScheduleHistory = {
  scheduleVersionId: string;
  scheduleKey: string;
  version: number;
  previousVersionId: string | null;
  status: StaffScheduleRecord["status"];
  reviewMode: StaffScheduleRecord["reviewMode"];
  ruleVersionId: string;
  conflictCount: number;
  contentHash: string;
  createdAt: string;
  creatorDisplayName: string;
  reviewedAt: string | null;
  reviewerDisplayName: string | null;
};

export type StaffSchedulingStaffOption = {
  staffMembershipId: string;
  staffUserId: string;
  displayName: string;
  employeeCode: string | null;
};

export type StaffSchedulingSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  filters: StaffSchedulingFilters;
  records: readonly StaffScheduleRecord[];
  recordTotal: number;
  recordsTruncated: boolean;
  readyTotal: number;
  conflictedTotal: number;
  publishedTotal: number;
  overriddenTotal: number;
  rejectedTotal: number;
  history: readonly StaffScheduleHistory[];
  historyTotal: number;
  historyTruncated: boolean;
  staffOptions: readonly StaffSchedulingStaffOption[];
  staffTotal: number;
  staffTruncated: boolean;
  ruleConfigurationStatus: StaffSchedulingRuleStatus;
  ruleVersion: StaffSchedulingRuleVersion | null;
  qualificationRuleStatus: StaffSchedulingRuleStatus;
  workTimeRuleStatus: StaffSchedulingRuleStatus;
  restRuleStatus: StaffSchedulingRuleStatus;
  facilityRuleStatus: StaffSchedulingRuleStatus;
  vehicleRuleStatus: StaffSchedulingRuleStatus;
  capacityRuleStatus: StaffSchedulingRuleStatus;
  qualificationProjection: "page72_terminal";
  decisionEngine: "deterministic_rule_assisted";
  aiStatus: "not_used";
  automaticPublishStatus: "disabled";
  exportStatus: "disabled";
  offlineStatus: "disabled";
  recentAal2MaxAgeMinutes: 15;
  demo: boolean;
};

export type SubmitStaffScheduleInput = {
  action: "create" | "revise";
  scheduleKey: string;
  previousVersionId: string | null;
  expectedVersion: number;
  expectedContentHash: string | null;
  staffMembershipId: string;
  startsAt: string;
  endsAt: string;
  roleText: string;
  serviceNeedText: string;
  facilityCode: string;
  vehicleCode: string;
  plannedClients: number;
  revisionReason: string;
  idempotencyKey: string;
};

export type DecideStaffScheduleInput = {
  action: "decide";
  scheduleVersionId: string;
  expectedScheduleKey: string;
  expectedVersion: number;
  expectedContentHash: string;
  expectedConflictCount: number;
  expectedRuleVersionId: string;
  decision: "publish" | "override" | "reject";
  reason: string;
  idempotencyKey: string;
};

export type SubmitStaffScheduleReceipt = {
  organizationId: string;
  branchId: string;
  scheduleKey: string;
  scheduleVersionId: string;
  scheduleVersion: number;
  scheduleStatus: "draft_ready" | "draft_conflicted";
  staffMembershipId: string;
  ruleVersionId: string;
  conflictCount: number;
  contentHash: string;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};

export type DecideStaffScheduleReceipt = {
  organizationId: string;
  branchId: string;
  scheduleKey: string;
  decidedVersionId: string;
  expectedVersion: number;
  decisionId: string;
  decision: "publish" | "override" | "reject";
  resultVersionId: string;
  resultVersion: number;
  resultStatus: "published" | "voided";
  reviewMode: "standard" | "override" | "rejected";
  conflictCount: number;
  ruleVersionId: string;
  contentHash: string;
  decidedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
