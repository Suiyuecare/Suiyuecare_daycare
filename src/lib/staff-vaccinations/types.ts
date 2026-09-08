export const STAFF_VACCINATION_STATUS_FILTERS = [
  "all", "active", "voided", "missing_evidence", "duplicate_warning",
] as const;
export type StaffVaccinationStatusFilter =
  (typeof STAFF_VACCINATION_STATUS_FILTERS)[number];

export type StaffVaccinationFilters = {
  staffMembershipId: string | null;
  vaccineName: string | null;
  doseNumber: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  status: StaffVaccinationStatusFilter;
  query: string;
};

export type StaffVaccinationDuplicateMatch = {
  vaccinationKey: string;
  recordVersionId: string;
  vaccinatedOn: string;
};

export type StaffVaccinationRecord = {
  recordVersionId: string;
  vaccinationKey: string;
  version: number;
  previousVersionId: string | null;
  recordStatus: "active" | "voided";
  correctionReason: string | null;
  staffMembershipId: string;
  staffUserId: string;
  staffDisplayName: string;
  staffEmployeeCode: string | null;
  vaccineName: string;
  doseNumber: string;
  vaccinatedOn: string;
  lotNumber: string | null;
  providerName: string;
  evidenceStatus: "provided" | "missing" | "not_applicable";
  duplicateWarning: boolean;
  duplicateCount: number;
  duplicateBasis: "same_staff_normalized_vaccine_and_dose";
  duplicateMatches: readonly StaffVaccinationDuplicateMatch[];
  duplicateMatchesTruncated: boolean;
  medicalInterpretationStatus: "not_evaluated";
  recordedBy: string;
  recordedByDisplayName: string;
  recordedAt: string;
  contentHash: string;
};

export type StaffVaccinationHistory = Pick<StaffVaccinationRecord,
  "recordVersionId" | "vaccinationKey" | "version" | "previousVersionId" |
  "recordStatus" | "correctionReason" | "vaccineName" | "doseNumber" |
  "vaccinatedOn" | "lotNumber" | "providerName" | "evidenceStatus" |
  "recordedByDisplayName" | "recordedAt" | "contentHash">;

export type StaffVaccinationStaffOption = {
  staffMembershipId: string;
  staffUserId: string;
  displayName: string;
  employeeCode: string | null;
  isCurrent: boolean;
};

export type StaffVaccinationNamedOption = {
  value: string;
  recordCount: number;
};

export type StaffVaccinationSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  snapshotDate: string;
  staleAfter: string;
  filters: StaffVaccinationFilters;
  records: readonly StaffVaccinationRecord[];
  recordTotal: number;
  recordsTruncated: boolean;
  missingEvidenceTotal: number;
  duplicateWarningTotal: number;
  currentMonthTotal: number;
  history: readonly StaffVaccinationHistory[];
  historyTotal: number;
  historyTruncated: boolean;
  staffOptions: readonly StaffVaccinationStaffOption[];
  staffTotal: number;
  staffTruncated: boolean;
  vaccineOptions: readonly StaffVaccinationNamedOption[];
  vaccineTotal: number;
  vaccinesTruncated: boolean;
  doseOptions: readonly StaffVaccinationNamedOption[];
  doseTotal: number;
  dosesTruncated: boolean;
  duplicateRuleStatus: "configured";
  duplicateBasis: "same_staff_normalized_vaccine_and_dose";
  duplicateResolution: "warning_only_no_auto_merge";
  medicalInterpretationStatus: "not_evaluated";
  reminderScheduleStatus: "not_configured";
  reminderDays: null;
  reminderTotal: null;
  attachmentPipelineStatus: "not_configured";
  attachmentScanStatus: "not_configured";
  demo: boolean;
};

export type StaffVaccinationRecordInput =
  | {
    action: "create" | "correct";
    vaccinationKey: string;
    previousVersionId: string | null;
    expectedBaseVersion: number;
    staffMembershipId: string;
    vaccineName: string;
    doseNumber: string;
    vaccinatedOn: string;
    lotNumber: string | null;
    providerName: string;
    evidenceStatus: "missing" | "not_applicable";
    attachmentReference: null;
    attachmentSha256: null;
    correctionReason: string | null;
    idempotencyKey: string;
  }
  | {
    action: "void";
    vaccinationKey: string;
    previousVersionId: string;
    expectedBaseVersion: number;
    staffMembershipId: string;
    vaccineName: null;
    doseNumber: null;
    vaccinatedOn: null;
    lotNumber: null;
    providerName: null;
    evidenceStatus: null;
    attachmentReference: null;
    attachmentSha256: null;
    correctionReason: string;
    idempotencyKey: string;
  };

export type StaffVaccinationRecordReceipt = {
  organizationId: string;
  branchId: string;
  vaccinationKey: string;
  recordVersionId: string;
  version: number;
  previousVersionId: string | null;
  recordStatus: "active" | "voided";
  staffMembershipId: string;
  contentHash: string;
  duplicateWarning: boolean;
  duplicateCount: number;
  duplicateBasis: "same_staff_normalized_vaccine_and_dose";
  recordedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
