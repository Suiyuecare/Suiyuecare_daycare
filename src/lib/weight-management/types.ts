export const WEIGHT_CHANGE_DIRECTIONS = ["all", "gain", "loss", "no_change", "unavailable"] as const;
export const WEIGHT_ALERT_FILTERS = ["all", "alert", "acknowledged", "unacknowledged", "within_threshold", "not_comparable", "not_configured"] as const;
export const WEIGHT_ALERT_STATUSES = ["acknowledged", "unacknowledged", "within_threshold", "not_comparable", "not_configured"] as const;

export type WeightChangeDirectionFilter = (typeof WEIGHT_CHANGE_DIRECTIONS)[number];
export type WeightAlertFilter = (typeof WEIGHT_ALERT_FILTERS)[number];
export type WeightAlertStatus = (typeof WEIGHT_ALERT_STATUSES)[number];

export type WeightManagementFilters = {
  targetMonth: string;
  clientId: string | null;
  changeDirection: WeightChangeDirectionFilter;
  alertStatus: WeightAlertFilter;
};

export type WeightClientOption = {
  clientId: string;
  displayName: string;
  clientStatus: string;
  canRecord: boolean;
};

export type WeightManagementItem = {
  clientId: string;
  clientDisplayName: string;
  clientStatus: string;
  currentState: "provided" | "missing";
  currentObservationId: string | null;
  currentOriginalWeightKg: string | null;
  currentWeightKg: string | null;
  currentObservedAt: string | null;
  currentSource: string | null;
  currentRecordedAt: string | null;
  recorderDisplayName: string | null;
  currentCorrectionId: string | null;
  currentCorrectionVersion: number;
  currentCorrectionKind: "replace" | null;
  currentCorrectionReason: string | null;
  priorState: "provided" | "missing" | "not_applicable";
  priorObservationId: string | null;
  priorWeightKg: string | null;
  priorObservedAt: string | null;
  priorCorrectionId: string | null;
  priorCorrectionVersion: number;
  deltaKg: string | null;
  deltaPercent: string | null;
  changeDirection: Exclude<WeightChangeDirectionFilter, "all">;
  alertStatus: WeightAlertStatus;
  ruleVersionId: string | null;
  ruleVersionNumber: number | null;
  absoluteKgThreshold: string | null;
  percentThreshold: string | null;
  triggerMode: "either" | "both" | null;
  acknowledgementId: string | null;
  acknowledgementNote: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
};

export type WeightManagementSnapshot = {
  organizationId: string;
  branchId: string;
  targetMonth: string;
  generatedAt: string;
  staleAfter: string;
  items: readonly WeightManagementItem[];
  itemTotal: number;
  matchingTotal: number;
  metrics: { measured: number; missing: number; alerts: number; acknowledged: number; unacknowledged: number };
  itemsTruncated: boolean;
  clientOptions: readonly WeightClientOption[];
  clientOptionTotal: number;
  clientOptionsTruncated: boolean;
  thresholdRuleStatus: "published" | "not_configured";
  thresholdRuleId: string | null;
  thresholdVersionNumber: number | null;
  absoluteKgThreshold: string | null;
  percentThreshold: string | null;
  triggerMode: "either" | "both" | null;
  demo: boolean;
};

export type RecordWeightInput = { action: "record"; clientId: string; observedAt: string; weightKg: string; source: string; idempotencyKey: string };
export type CorrectWeightInput = { action: "correct" | "void"; clientId: string; observationId: string; expectedCorrectionVersion: number; replacementWeightKg: string | null; correctionReason: string; idempotencyKey: string };
export type AcknowledgeWeightInput = { action: "acknowledge"; clientId: string; currentObservationId: string; currentCorrectionVersion: number; priorObservationId: string; priorCorrectionVersion: number; ruleVersionId: string; acknowledgementNote: string; idempotencyKey: string };
export type WeightMutationInput = CorrectWeightInput | AcknowledgeWeightInput;

export type WeightOperationResult = {
  operationId: string;
  operationKind: "record" | "correct" | "void" | "acknowledge";
  clientId: string;
  observationId: string;
  correctionId: string | null;
  correctionVersion: number | null;
  priorObservationId: string | null;
  ruleVersionId: string | null;
  currentEvidenceCorrectionVersion: number | null;
  priorEvidenceCorrectionVersion: number | null;
  acknowledgementId: string | null;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
