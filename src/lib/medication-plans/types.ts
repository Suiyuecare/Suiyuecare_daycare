export const MEDICATION_PLAN_WORKFLOW_STATES = [
  "draft",
  "submitted",
  "approved",
] as const;

export type MedicationPlanWorkflowState =
  (typeof MEDICATION_PLAN_WORKFLOW_STATES)[number];

export const MEDICATION_PLAN_LIFECYCLE_STATES = [
  "draft",
  "submitted",
  "scheduled",
  "active",
  "expired",
  "stopped",
  "replaced",
] as const;

export type MedicationPlanLifecycleState =
  (typeof MEDICATION_PLAN_LIFECYCLE_STATES)[number];

export type MedicationPlanLifecycleFilter =
  | "all"
  | MedicationPlanLifecycleState;

export const MEDICATION_PLAN_CLIENT_STATUSES = [
  "active",
  "suspended",
  "transferred",
  "closed",
  "deceased",
] as const;

export type MedicationPlanClientStatus =
  (typeof MEDICATION_PLAN_CLIENT_STATUSES)[number];

export type MedicationPlanClientOption = {
  id: string;
  code: string;
  displayName: string;
  status: MedicationPlanClientStatus;
  admittedOn: string | null;
  endedOn: string | null;
  canCreatePlan: boolean;
};

export type MedicationPlanSchedule = {
  times: readonly string[];
};

export type MedicationPlanRecord = {
  id: string;
  recordKey: string;
  version: number;
  previousVersionId: string | null;
  clientId: string;
  medicationName: string;
  dose: number;
  doseUnit: string;
  route: string;
  schedule: MedicationPlanSchedule;
  highRisk: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  workflowState: MedicationPlanWorkflowState;
  submittedByCurrentActor: boolean;
  lifecycleState: MedicationPlanLifecycleState;
  submittedAt: string | null;
  approvedAt: string | null;
  terminatedAt: string | null;
  terminationKind: "stopped" | "replaced" | null;
  terminationReason: string | null;
  replacementPlanId: string | null;
  rowVersion: number;
};

export type MedicationPlanMetrics = {
  active: number;
  expiringSoon: number;
  recentChanges: number;
  pendingApproval: number;
};

export type MedicationPlanSnapshot = {
  generatedAt: string;
  staleAfter: string;
  selectedClient: MedicationPlanClientOption | null;
  clients: readonly MedicationPlanClientOption[];
  plans: readonly MedicationPlanRecord[];
  metrics: MedicationPlanMetrics;
  demo: boolean;
};

export type CreateMedicationPlanDraftInput = {
  clientId: string;
  previousPlanId: string | null;
  medicationName: string;
  dose: number;
  doseUnit: string;
  route: string;
  schedule: { times: string[] };
  highRisk: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  idempotencyKey: string;
};

export type MedicationPlanVersionActionInput = {
  medicationPlanId: string;
  expectedRowVersion: number;
  idempotencyKey: string;
};

export type StopMedicationPlanInput = MedicationPlanVersionActionInput & {
  reason: string;
};

export type MedicationPlanMutationResult = {
  planId: string;
  clientId: string;
  recordKey: string;
  version: number;
  rowVersion: number;
  replayed: boolean;
};

export type CreateMedicationPlanDraftResult = MedicationPlanMutationResult & {
  workflowState: "draft";
  effectiveFrom: string;
};

export type SubmitMedicationPlanResult = MedicationPlanMutationResult & {
  workflowState: "submitted";
  submittedAt: string;
};

export type ApproveMedicationPlanResult = MedicationPlanMutationResult & {
  workflowState: "approved";
  effectiveFrom: string;
  approvedAt: string;
  replacementEffectiveAt: string | null;
};

export type StopMedicationPlanResult = MedicationPlanMutationResult & {
  lifecycleState: "stopped";
  stoppedAt: string;
};
