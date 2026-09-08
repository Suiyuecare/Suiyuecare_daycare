export const MEDICATION_RECORD_STATUSES = [
  "scheduled",
  "administered",
  "refused",
  "held",
  "missed",
] as const;

export type MedicationRecordStatus =
  (typeof MEDICATION_RECORD_STATUSES)[number];

export type MedicationFinalizationState =
  | "scheduled"
  | "pending_verification"
  | "signed";

export const MEDICATION_STATUS_FILTERS = [
  "all",
  "scheduled",
  "pending_verification",
  "administered",
  "refused",
  "held",
  "missed",
] as const;

export type MedicationStatusFilter =
  (typeof MEDICATION_STATUS_FILTERS)[number];

export type MedicationActor = {
  id: string;
  displayName: string;
};

export type MedicationAdministrationRecord = {
  id: string;
  clientId: string;
  clientCode: string;
  clientDisplayName: string;
  medicationPlanId: string;
  medicationName: string;
  plannedDose: number;
  doseUnit: string;
  route: string;
  highRisk: boolean;
  scheduledFor: string;
  occurredAt: string | null;
  executionSignedAt: string | null;
  status: MedicationRecordStatus;
  actualDose: number | null;
  actualDoseUnit: string | null;
  reason: string | null;
  executionSource: string | null;
  lateEntry: boolean;
  requiresSecondVerification: boolean;
  executor: MedicationActor | null;
  verifier: MedicationActor | null;
  secondVerifiedAt: string | null;
  signedAt: string | null;
  finalizationState: MedicationFinalizationState;
};

export type MedicationAdministrationCounts = {
  due: number;
  completed: number;
  pending: number;
  exceptions: number;
};

export type MedicationAdministrationSnapshot = {
  serviceDate: string;
  generatedAt: string;
  staleAfter: string;
  rows: readonly MedicationAdministrationRecord[];
  counts: MedicationAdministrationCounts;
  demo: boolean;
};

export type MedicationClientOption = {
  id: string;
  code: string;
  displayName: string;
};

export type MedicationFilters = {
  clientId?: string;
  status: MedicationStatusFilter;
};
