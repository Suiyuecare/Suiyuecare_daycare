export const STAFF_TOCC_VALIDITY_FILTERS = [
  "all", "active", "expired", "voided",
] as const;
export type StaffToccValidityFilter = (typeof STAFF_TOCC_VALIDITY_FILTERS)[number];

export const STAFF_TOCC_ATTENTION_FILTERS = [
  "all", "flagged", "not_flagged",
] as const;
export type StaffToccAttentionFilter = (typeof STAFF_TOCC_ATTENTION_FILTERS)[number];

export const STAFF_TOCC_DISPOSITION_FILTERS = [
  "all", "not_recorded", "pending", "in_progress", "completed",
] as const;
export type StaffToccDispositionFilter =
  (typeof STAFF_TOCC_DISPOSITION_FILTERS)[number];

export type StaffToccFilters = {
  staffMembershipId: string | null;
  validityStatus: StaffToccValidityFilter;
  attentionStatus: StaffToccAttentionFilter;
  dispositionStatus: StaffToccDispositionFilter;
  dateFrom: string | null;
  dateTo: string | null;
  query: string;
};

export type StaffToccWarningReason =
  | "expired_manual_valid_through"
  | "manual_attention_flag";
export type StaffToccDispositionStatus =
  | "not_recorded" | "pending" | "in_progress" | "completed";

export type StaffToccRecord = {
  recordVersionId: string;
  toccKey: string;
  version: number;
  previousVersionId: string | null;
  recordStatus: "active" | "voided";
  correctionReason: string | null;
  staffMembershipId: string;
  staffUserId: string;
  staffDisplayName: string;
  staffEmployeeCode: string | null;
  assessedOn: string;
  validThrough: string;
  validitySource: string;
  resultText: string;
  manualAttentionFlag: boolean;
  attentionNote: string | null;
  evidenceStatus: "provided" | "missing" | "not_applicable";
  dispositionStatus: StaffToccDispositionStatus;
  dispositionNote: string | null;
  validityStatus: "active" | "expired" | "voided";
  expiryWarning: boolean;
  manualAttentionWarning: boolean;
  actionRequired: boolean;
  warningReasons: readonly StaffToccWarningReason[];
  warningBasis: "manual_valid_through_and_manual_attention_flag";
  medicalInterpretationStatus: "not_evaluated";
  recordedBy: string;
  recordedByDisplayName: string;
  recordedAt: string;
  contentHash: string;
};

export type StaffToccHistory = Pick<StaffToccRecord,
  "recordVersionId" | "toccKey" | "version" | "previousVersionId" |
  "recordStatus" | "correctionReason" | "assessedOn" | "validThrough" |
  "validitySource" | "resultText" | "manualAttentionFlag" | "attentionNote" |
  "evidenceStatus" | "dispositionStatus" | "dispositionNote" |
  "recordedByDisplayName" | "recordedAt" | "contentHash">;

export type StaffToccStaffOption = {
  staffMembershipId: string;
  staffUserId: string;
  displayName: string;
  employeeCode: string | null;
  isCurrent: boolean;
};

export type StaffToccSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  snapshotDate: string;
  staleAfter: string;
  filters: StaffToccFilters;
  records: readonly StaffToccRecord[];
  recordTotal: number;
  recordsTruncated: boolean;
  activeTotal: number;
  expiredTotal: number;
  manualAttentionTotal: number;
  actionRequiredTotal: number;
  history: readonly StaffToccHistory[];
  historyTotal: number;
  historyTruncated: boolean;
  staffOptions: readonly StaffToccStaffOption[];
  staffTotal: number;
  staffTruncated: boolean;
  validityRuleStatus: "not_configured";
  validThroughSourceMode: "manual_per_record";
  warningBasis: "manual_valid_through_and_manual_attention_flag";
  medicalInterpretationStatus: "not_evaluated";
  expiryReminderScheduleStatus: "not_configured";
  expiryNoticeDays: null;
  expiringTotal: null;
  attachmentPipelineStatus: "not_configured";
  attachmentScanStatus: "not_configured";
  demo: boolean;
};

type StaffToccContentInput = {
  assessedOn: string;
  validThrough: string;
  validitySource: string;
  resultText: string;
  manualAttentionFlag: boolean;
  attentionNote: string | null;
  evidenceStatus: "missing" | "not_applicable";
  attachmentReference: null;
  attachmentSha256: null;
  dispositionStatus: StaffToccDispositionStatus;
  dispositionNote: string | null;
};

export type StaffToccRecordInput =
  | (StaffToccContentInput & {
    action: "create" | "correct";
    toccKey: string;
    previousVersionId: string | null;
    expectedBaseVersion: number;
    staffMembershipId: string;
    correctionReason: string | null;
    idempotencyKey: string;
  })
  | {
    action: "void";
    toccKey: string;
    previousVersionId: string;
    expectedBaseVersion: number;
    staffMembershipId: string;
    assessedOn: null;
    validThrough: null;
    validitySource: null;
    resultText: null;
    manualAttentionFlag: null;
    attentionNote: null;
    evidenceStatus: null;
    attachmentReference: null;
    attachmentSha256: null;
    dispositionStatus: null;
    dispositionNote: null;
    correctionReason: string;
    idempotencyKey: string;
  };

export type StaffToccRecordReceipt = {
  organizationId: string;
  branchId: string;
  toccKey: string;
  recordVersionId: string;
  version: number;
  previousVersionId: string | null;
  recordStatus: "active" | "voided";
  staffMembershipId: string;
  contentHash: string;
  evaluatedOn: string;
  expiryWarning: boolean;
  manualAttentionWarning: boolean;
  warningBasis: "manual_valid_through_and_manual_attention_flag";
  recordedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
