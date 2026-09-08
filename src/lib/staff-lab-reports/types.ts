export const STAFF_LAB_REPORT_VALIDITY_FILTERS = [
  "all", "active", "expired", "voided",
] as const;
export type StaffLabReportValidityFilter =
  (typeof STAFF_LAB_REPORT_VALIDITY_FILTERS)[number];

export const STAFF_LAB_REPORT_DUPLICATE_FILTERS = [
  "all", "any", "exact", "key_fields", "none",
] as const;
export type StaffLabReportDuplicateFilter =
  (typeof STAFF_LAB_REPORT_DUPLICATE_FILTERS)[number];

export const STAFF_LAB_REPORT_EVIDENCE_FILTERS = [
  "all", "provided", "missing", "not_applicable",
] as const;
export type StaffLabReportEvidenceFilter =
  (typeof STAFF_LAB_REPORT_EVIDENCE_FILTERS)[number];

export type StaffLabReportFilters = {
  staffMembershipId: string | null;
  reportType: string | null;
  validityStatus: StaffLabReportValidityFilter;
  duplicateStatus: StaffLabReportDuplicateFilter;
  evidenceStatus: StaffLabReportEvidenceFilter;
  dateFrom: string | null;
  dateTo: string | null;
  query: string;
};

export type StaffLabReportDuplicateBasis =
  | "exact_content"
  | "same_staff_type_tested_on_provider";

export type StaffLabReportDuplicateMatch = {
  reportKey: string;
  recordVersionId: string;
  testedOn: string;
  matchKind: StaffLabReportDuplicateBasis;
};

export type StaffLabReportRecord = {
  recordVersionId: string;
  reportKey: string;
  version: number;
  previousVersionId: string | null;
  recordStatus: "active" | "voided";
  correctionReason: string | null;
  completionStatus: "completed";
  staffMembershipId: string;
  staffUserId: string;
  staffDisplayName: string;
  staffEmployeeCode: string | null;
  reportType: string;
  testedOn: string;
  providerName: string;
  resultText: string;
  validThrough: string;
  validityBasis: string;
  evidenceStatus: "provided" | "missing" | "not_applicable";
  attachmentReference: string | null;
  attachmentSha256: string | null;
  validityStatus: "active" | "expired" | "voided";
  exactDuplicateCount: number;
  keyFieldDuplicateCount: number;
  duplicateWarning: boolean;
  duplicateBases: readonly StaffLabReportDuplicateBasis[];
  duplicateMatches: readonly StaffLabReportDuplicateMatch[];
  duplicateMatchesTruncated: boolean;
  duplicateBasis: "exact_content_or_same_staff_type_tested_on_provider";
  medicalInterpretationStatus: "not_evaluated";
  recordedBy: string;
  recordedByDisplayName: string;
  recordedAt: string;
  contentHash: string;
};

export type StaffLabReportHistory = Pick<StaffLabReportRecord,
  "recordVersionId" | "reportKey" | "version" | "previousVersionId" |
  "recordStatus" | "correctionReason" | "completionStatus" | "reportType" |
  "testedOn" | "providerName" | "resultText" | "validThrough" |
  "validityBasis" | "evidenceStatus" | "attachmentReference" |
  "attachmentSha256" | "recordedByDisplayName" | "recordedAt" | "contentHash">;

export type StaffLabReportStaffOption = {
  staffMembershipId: string;
  staffUserId: string;
  displayName: string;
  employeeCode: string | null;
  isCurrent: boolean;
};

export type StaffLabReportTypeOption = {
  reportType: string;
  recordCount: number;
};

export type StaffLabReportSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  snapshotDate: string;
  staleAfter: string;
  filters: StaffLabReportFilters;
  records: readonly StaffLabReportRecord[];
  recordTotal: number;
  recordsTruncated: boolean;
  activeTotal: number;
  expiredTotal: number;
  missingEvidenceTotal: number;
  duplicateWarningTotal: number;
  history: readonly StaffLabReportHistory[];
  historyTotal: number;
  historyTruncated: boolean;
  staffOptions: readonly StaffLabReportStaffOption[];
  staffTotal: number;
  staffTruncated: boolean;
  typeOptions: readonly StaffLabReportTypeOption[];
  typeTotal: number;
  typesTruncated: boolean;
  validityRuleStatus: "not_configured";
  validThroughSourceMode: "manual_per_record";
  expiryReminderScheduleStatus: "not_configured";
  expiryNoticeDays: null;
  expiringTotal: null;
  duplicateRuleStatus: "configured";
  duplicateBasis: "exact_content_or_same_staff_type_tested_on_provider";
  duplicateResolution: "warning_only_no_auto_merge";
  medicalInterpretationStatus: "not_evaluated";
  attachmentPipelineStatus: "not_configured";
  attachmentScanStatus: "not_configured";
  recentAal2MaxAgeMinutes: 15;
  demo: boolean;
};

type StaffLabReportContentInput = {
  reportType: string;
  testedOn: string;
  providerName: string;
  resultText: string;
  validThrough: string;
  validityBasis: string;
  evidenceStatus: "missing" | "not_applicable";
  attachmentReference: null;
  attachmentSha256: null;
};

export type StaffLabReportRecordInput =
  | (StaffLabReportContentInput & {
    action: "create" | "correct";
    reportKey: string;
    previousVersionId: string | null;
    expectedBaseVersion: number;
    staffMembershipId: string;
    correctionReason: string | null;
    idempotencyKey: string;
  })
  | {
    action: "void";
    reportKey: string;
    previousVersionId: string;
    expectedBaseVersion: number;
    staffMembershipId: string;
    reportType: null;
    testedOn: null;
    providerName: null;
    resultText: null;
    validThrough: null;
    validityBasis: null;
    evidenceStatus: null;
    attachmentReference: null;
    attachmentSha256: null;
    correctionReason: string;
    idempotencyKey: string;
  };

export type StaffLabReportRecordReceipt = {
  organizationId: string;
  branchId: string;
  reportKey: string;
  recordVersionId: string;
  version: number;
  previousVersionId: string | null;
  recordStatus: "active" | "voided";
  completionStatus: "completed";
  staffMembershipId: string;
  contentHash: string;
  exactDuplicateCount: number;
  keyFieldDuplicateCount: number;
  duplicateWarning: boolean;
  duplicateBasis: "exact_content_or_same_staff_type_tested_on_provider";
  recordedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
