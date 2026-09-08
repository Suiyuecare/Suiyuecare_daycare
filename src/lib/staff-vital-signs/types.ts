export const STAFF_VITAL_SIGN_STATE_FILTERS = [
  "all", "measured", "missing", "not_applicable", "voided",
] as const;
export type StaffVitalSignStateFilter =
  (typeof STAFF_VITAL_SIGN_STATE_FILTERS)[number];

export type StaffVitalSignFilters = {
  staffMembershipId: string | null;
  measurementType: string | null;
  stateStatus: StaffVitalSignStateFilter;
  dateFrom: string | null;
  dateTo: string | null;
  query: string;
};

export type StaffVitalSignValueStatus =
  | "measured"
  | "missing"
  | "not_applicable";

export type StaffVitalSignRecord = {
  recordVersionId: string;
  vitalSignKey: string;
  version: number;
  previousVersionId: string | null;
  recordStatus: "active" | "voided";
  correctionReason: string | null;
  completionStatus: "completed";
  staffMembershipId: string;
  staffUserId: string;
  staffDisplayName: string;
  staffEmployeeCode: string | null;
  measurementType: string;
  valueStatus: StaffVitalSignValueStatus;
  valueDecimalText: string | null;
  unit: string | null;
  statusReason: string | null;
  occurredAt: string;
  source: string;
  note: string | null;
  thresholdEvaluationStatus: "not_configured";
  thresholdVersionId: null;
  warningStatus: null;
  medicalInterpretationStatus: "not_evaluated";
  recordedBy: string;
  recordedByDisplayName: string;
  recordedAt: string;
  contentHash: string;
};

export type StaffVitalSignHistory = Pick<StaffVitalSignRecord,
  "recordVersionId" | "vitalSignKey" | "version" | "previousVersionId" |
  "recordStatus" | "correctionReason" | "completionStatus" |
  "measurementType" | "valueStatus" | "valueDecimalText" | "unit" |
  "statusReason" | "occurredAt" | "source" | "note" |
  "recordedByDisplayName" | "recordedAt" | "contentHash">;

export type StaffVitalSignStaffOption = {
  staffMembershipId: string;
  staffUserId: string;
  displayName: string;
  employeeCode: string | null;
  isCurrent: boolean;
};

export type StaffVitalSignTypeOption = {
  measurementType: string;
  recordCount: number;
};

export type StaffVitalSignTrendPoint = {
  recordVersionId: string;
  occurredAt: string;
  valueDecimalText: string;
};

export type StaffVitalSignTrendSeries = {
  staffMembershipId: string;
  staffDisplayName: string;
  measurementType: string;
  unit: string;
  points: readonly StaffVitalSignTrendPoint[];
};

export type StaffVitalSignSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  snapshotDate: string;
  staleAfter: string;
  filters: StaffVitalSignFilters;
  records: readonly StaffVitalSignRecord[];
  recordTotal: number;
  recordsTruncated: boolean;
  measuredTotal: number;
  missingTotal: number;
  notApplicableTotal: number;
  voidedTotal: number;
  history: readonly StaffVitalSignHistory[];
  historyTotal: number;
  historyTruncated: boolean;
  staffOptions: readonly StaffVitalSignStaffOption[];
  staffTotal: number;
  staffTruncated: boolean;
  typeOptions: readonly StaffVitalSignTypeOption[];
  typeTotal: number;
  typesTruncated: boolean;
  trendSeries: readonly StaffVitalSignTrendSeries[];
  trendPointTotal: number;
  thresholdRuleStatus: "not_configured";
  thresholdVersionId: null;
  thresholdWarningTotal: null;
  thresholdPendingConfirmationTotal: null;
  scheduledMissingRuleStatus: "not_configured";
  scheduledMissingTotal: null;
  decimalPreservation: "verbatim_after_outer_trim";
  valueStatusSeparation: "measured_missing_not_applicable";
  medicalInterpretationStatus: "not_evaluated";
  attachmentPipelineStatus: "not_configured";
  exportStatus: "disabled";
  offlineStatus: "disabled";
  recentAal2MaxAgeMinutes: 15;
  demo: boolean;
};

type StaffVitalSignContentInput = {
  measurementType: string;
  valueStatus: StaffVitalSignValueStatus;
  valueDecimalText: string | null;
  unit: string | null;
  statusReason: string | null;
  occurredAt: string;
  source: string;
  note: string | null;
};

export type StaffVitalSignRecordInput =
  | (StaffVitalSignContentInput & {
    action: "create" | "correct";
    vitalSignKey: string;
    previousVersionId: string | null;
    expectedBaseVersion: number;
    staffMembershipId: string;
    correctionReason: string | null;
    idempotencyKey: string;
  })
  | {
    action: "void";
    vitalSignKey: string;
    previousVersionId: string;
    expectedBaseVersion: number;
    staffMembershipId: string;
    measurementType: null;
    valueStatus: null;
    valueDecimalText: null;
    unit: null;
    statusReason: null;
    occurredAt: null;
    source: null;
    note: null;
    correctionReason: string;
    idempotencyKey: string;
  };

export type StaffVitalSignRecordReceipt = {
  organizationId: string;
  branchId: string;
  vitalSignKey: string;
  recordVersionId: string;
  version: number;
  previousVersionId: string | null;
  recordStatus: "active" | "voided";
  completionStatus: "completed";
  staffMembershipId: string;
  contentHash: string;
  thresholdEvaluationStatus: "not_configured";
  recordedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
