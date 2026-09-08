export const CLIENT_REPORT_RECORD_FILTERS = ["all", "active", "voided"] as const;
export type ClientReportRecordFilter = typeof CLIENT_REPORT_RECORD_FILTERS[number];

export const CLIENT_REPORT_VALUE_FILTERS = [
  "all", "present", "missing", "not_applicable",
] as const;
export type ClientReportValueFilter = typeof CLIENT_REPORT_VALUE_FILTERS[number];

export const CLIENT_REPORT_ATTACHMENT_FILTERS = [
  "all", "provided", "missing", "not_applicable",
] as const;
export type ClientReportAttachmentFilter = typeof CLIENT_REPORT_ATTACHMENT_FILTERS[number];

export const CLIENT_REPORT_DUPLICATE_FILTERS = [
  "all", "any", "exact", "key_fields", "attachment", "none",
] as const;
export type ClientReportDuplicateFilter = typeof CLIENT_REPORT_DUPLICATE_FILTERS[number];

export type ClientInspectionReportFilters = {
  clientId: string | null;
  reportType: string | null;
  examinedFrom: string | null;
  examinedTo: string | null;
  recordStatus: ClientReportRecordFilter;
  resultStatus: ClientReportValueFilter;
  sourceStatus: ClientReportValueFilter;
  attachmentStatus: ClientReportAttachmentFilter;
  duplicateStatus: ClientReportDuplicateFilter;
  query: string;
};

export type ClientReportDuplicateBasis =
  | "exact_content"
  | "same_client_type_date_source"
  | "same_attachment_sha256";

export type ClientReportDuplicateMatch = {
  reportKey: string;
  recordVersionId: string;
  examinedOn: string;
  matchKind: ClientReportDuplicateBasis;
};

export type ClientInspectionReportRecord = {
  recordVersionId: string;
  reportKey: string;
  version: number;
  previousVersionId: string | null;
  recordStatus: "active" | "voided";
  correctionReason: string | null;
  clientId: string;
  clientCode: string;
  clientDisplayName: string;
  reportType: string;
  examinedOn: string;
  resultStatus: "present" | "missing" | "not_applicable";
  resultText: string | null;
  resultReason: string | null;
  sourceStatus: "present" | "missing" | "not_applicable";
  sourceText: string | null;
  sourceReason: string | null;
  attachmentStatus: "provided" | "missing" | "not_applicable";
  attachmentId: string | null;
  attachmentSha256: string | null;
  attachmentSourceFilename: string | null;
  payloadHash: string;
  contentHash: string;
  exactDuplicateCount: number;
  keyFieldDuplicateCount: number;
  attachmentDuplicateCount: number;
  duplicateWarning: boolean;
  duplicateBases: readonly ClientReportDuplicateBasis[];
  duplicateMatches: readonly ClientReportDuplicateMatch[];
  duplicateMatchesTruncated: boolean;
  recordedBy: string;
  recordedByDisplayName: string;
  recordedAt: string;
};

export type ClientInspectionReportHistory = Pick<ClientInspectionReportRecord,
  "recordVersionId" | "reportKey" | "version" | "previousVersionId" |
  "recordStatus" | "correctionReason" | "reportType" | "examinedOn" |
  "resultStatus" | "resultText" | "resultReason" | "sourceStatus" |
  "sourceText" | "sourceReason" | "attachmentStatus" | "attachmentId" |
  "attachmentSha256" | "attachmentSourceFilename" | "payloadHash" |
  "contentHash" | "recordedByDisplayName" | "recordedAt">;

export type ClientInspectionReportClientOption = {
  clientId: string;
  clientCode: string;
  displayName: string;
};

export type ClientInspectionReportTypeOption = {
  reportType: string;
  recordCount: number;
};

export type ClientInspectionReportSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  snapshotDate: string;
  staleAfter: string;
  filters: ClientInspectionReportFilters;
  records: readonly ClientInspectionReportRecord[];
  recordTotal: number;
  recordsTruncated: boolean;
  activeTotal: number;
  voidedTotal: number;
  missingResultTotal: number;
  missingAttachmentTotal: number;
  duplicateWarningTotal: number;
  history: readonly ClientInspectionReportHistory[];
  historyTotal: number;
  historyTruncated: boolean;
  clientOptions: readonly ClientInspectionReportClientOption[];
  clientTotal: number;
  clientsTruncated: boolean;
  typeOptions: readonly ClientInspectionReportTypeOption[];
  typeTotal: number;
  typesTruncated: boolean;
  duplicateRuleStatus: "configured";
  duplicateResolution: "warning_only_no_auto_merge";
  reportTypeTaxonomyStatus: "manual_unstandardized";
  medicalInterpretationStatus: "not_configured";
  diagnosisStatus: "not_configured";
  ocrStatus: "not_configured";
  attachmentPipelineStatus: "not_configured";
  attachmentScanStatus: "not_configured";
  attachmentDownloadStatus: "not_configured";
  exportStatus: "not_configured";
  offlineStatus: "not_configured";
  recentAal2MaxAgeMinutes: 15;
  demo: boolean;
};

type ClientReportContentInput = {
  clientId: string;
  reportType: string;
  examinedOn: string;
  resultStatus: "present" | "missing" | "not_applicable";
  resultText: string | null;
  resultReason: string | null;
  sourceStatus: "present" | "missing" | "not_applicable";
  sourceText: string | null;
  sourceReason: string | null;
  attachmentStatus: "provided" | "missing" | "not_applicable";
  attachmentId: string | null;
  attachmentSha256: string | null;
  attachmentSourceFilename: string | null;
};

export type ClientInspectionReportInput =
  | (ClientReportContentInput & {
    action: "create" | "correct";
    reportKey: string;
    previousVersionId: string | null;
    expectedBaseVersion: number;
    correctionReason: string | null;
    idempotencyKey: string;
  })
  | {
    action: "void";
    reportKey: string;
    previousVersionId: string;
    expectedBaseVersion: number;
    clientId: string;
    correctionReason: string;
    idempotencyKey: string;
  };

export type ClientInspectionReportReceipt = {
  organizationId: string;
  branchId: string;
  reportKey: string;
  recordVersionId: string;
  version: number;
  previousVersionId: string | null;
  recordStatus: "active" | "voided";
  clientId: string;
  contentHash: string;
  payloadHash: string;
  exactDuplicateCount: number;
  keyFieldDuplicateCount: number;
  attachmentDuplicateCount: number;
  duplicateWarning: boolean;
  duplicateResolution: "warning_only_no_auto_merge";
  recordedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
