import type { ClientVaccinationPersistedPayload } from "./payload";

export const CLIENT_VACCINATION_STATUS_FILTERS = [
  "all", "active", "voided", "missing_evidence", "duplicate_warning",
] as const;

export type ClientVaccinationStatusFilter =
  (typeof CLIENT_VACCINATION_STATUS_FILTERS)[number];

export type ClientVaccinationFilters = {
  clientId: string | null;
  vaccineName: string | null;
  doseNumber: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  status: ClientVaccinationStatusFilter;
  query: string;
};

export type ClientVaccinationDuplicateMatch = {
  vaccinationKey: string;
  recordVersionId: string;
  vaccinatedOn: string;
};

export type ClientVaccinationRecord = {
  recordVersionId: string;
  vaccinationKey: string;
  version: number;
  previousVersionId: string | null;
  recordStatus: "active" | "voided";
  correctionReason: string | null;
  clientId: string;
  clientDisplayName: string;
  clientCode: string;
  vaccineName: string;
  doseNumber: string;
  vaccinatedOn: string;
  lotNumber: string | null;
  providerName: string;
  evidenceStatus: "provided" | "missing" | "not_applicable";
  evidenceReferenceId: string | null;
  evidenceSha256: string | null;
  evidenceFileName: string | null;
  sourceSystem: "manual_entry" | "central_html_import" | "legacy_migration";
  sourceRecordId: string | null;
  duplicateWarning: boolean;
  duplicateCount: number;
  duplicateBasis: "same_client_normalized_vaccine_and_dose";
  duplicateMatches: readonly ClientVaccinationDuplicateMatch[];
  duplicateMatchesTruncated: boolean;
  medicalInterpretationStatus: "not_evaluated";
  recordedBy: string;
  recordedByDisplayName: string;
  recordedAt: string;
  contentHash: string;
};

export type ClientVaccinationHistory = Pick<ClientVaccinationRecord,
  "recordVersionId" | "vaccinationKey" | "version" | "previousVersionId" |
  "recordStatus" | "correctionReason" | "vaccineName" | "doseNumber" |
  "vaccinatedOn" | "lotNumber" | "providerName" | "evidenceStatus" |
  "evidenceReferenceId" | "evidenceSha256" | "evidenceFileName" |
  "sourceSystem" | "sourceRecordId" | "recordedByDisplayName" | "recordedAt" |
  "contentHash">;

export type ClientVaccinationClientOption = {
  clientId: string;
  displayName: string;
  clientCode: string;
  serviceStatus: "active" | "suspended" | "transferred" | "closed" | "deceased";
  canRecord: boolean;
};

export type ClientVaccinationNamedOption = {
  value: string;
  recordCount: number;
};

export type ClientVaccinationSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  snapshotDate: string;
  staleAfter: string;
  filters: ClientVaccinationFilters;
  records: readonly ClientVaccinationRecord[];
  recordTotal: number;
  recordsTruncated: boolean;
  missingEvidenceTotal: number;
  duplicateWarningTotal: number;
  currentMonthTotal: number;
  history: readonly ClientVaccinationHistory[];
  historyTotal: number;
  historyTruncated: boolean;
  clientOptions: readonly ClientVaccinationClientOption[];
  clientTotal: number;
  clientsTruncated: boolean;
  vaccineOptions: readonly ClientVaccinationNamedOption[];
  vaccineTotal: number;
  vaccinesTruncated: boolean;
  doseOptions: readonly ClientVaccinationNamedOption[];
  doseTotal: number;
  dosesTruncated: boolean;
  duplicateRuleStatus: "configured";
  duplicateBasis: "same_client_normalized_vaccine_and_dose";
  duplicateResolution: "warning_only_no_auto_merge";
  medicalInterpretationStatus: "not_evaluated";
  reminderScheduleStatus: "not_configured";
  reminderDays: null;
  reminderTotal: null;
  attachmentPipelineStatus: "not_configured";
  attachmentScanStatus: "not_configured";
  batchMaximumItems: 20;
  offlineStatus: "not_configured";
  demo: boolean;
};

type ClientVaccinationContentInput = {
  clientId: string;
  vaccineName: string;
  doseNumber: string;
  vaccinatedOn: string;
  lotNumber: string | null;
  providerName: string;
  evidenceStatus: "missing" | "not_applicable";
  evidenceReferenceId: null;
  evidenceSha256: null;
  evidenceFileName: null;
  sourceSystem: "manual_entry";
  sourceRecordId: null;
};

export type ClientVaccinationRecordInput =
  | (ClientVaccinationContentInput & {
    action: "create" | "correct";
    vaccinationKey: string;
    previousVersionId: string | null;
    expectedBaseVersion: number;
    correctionReason: string | null;
    idempotencyKey: string;
  })
  | {
    action: "void";
    vaccinationKey: string;
    previousVersionId: string;
    expectedBaseVersion: number;
    clientId: string;
    vaccineName: null;
    doseNumber: null;
    vaccinatedOn: null;
    lotNumber: null;
    providerName: null;
    evidenceStatus: null;
    evidenceReferenceId: null;
    evidenceSha256: null;
    evidenceFileName: null;
    sourceSystem: null;
    sourceRecordId: null;
    correctionReason: string;
    idempotencyKey: string;
  };

export type ClientVaccinationRecordReceipt = {
  recordPayload: ClientVaccinationPersistedPayload;
  organizationId: string;
  branchId: string;
  vaccinationKey: string;
  recordVersionId: string;
  version: number;
  previousVersionId: string | null;
  recordStatus: "active" | "voided";
  clientId: string;
  contentHash: string;
  duplicateWarning: boolean;
  duplicateCount: number;
  duplicateBasis: "same_client_normalized_vaccine_and_dose";
  recordedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};

export type ClientVaccinationBatchInput = {
  batchIdempotencyKey: string;
  items: readonly ClientVaccinationRecordInput[];
};

export type ClientVaccinationBatchItemResult = {
  index: number;
  idempotencyKey: string;
  status: "created" | "replayed" | "rejected";
  receipt: ClientVaccinationRecordReceipt | null;
  error: { code: string; message: string } | null;
};

export type ClientVaccinationBatchReceipt = {
  batchId: string;
  batchIdempotencyKey: string;
  requestHash: string;
  replayed: boolean;
  itemTotal: number;
  succeededTotal: number;
  rejectedTotal: number;
  results: readonly ClientVaccinationBatchItemResult[];
  persisted: true;
  demo: false;
};
