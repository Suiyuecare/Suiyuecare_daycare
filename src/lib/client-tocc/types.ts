import type { ClientLifecycleStatus } from "@/lib/clients/types";

export const CLIENT_TOCC_RESULT_STATUSES = [
  "clear",
  "monitor",
  "action_required",
] as const;
export const CLIENT_TOCC_EVIDENCE_STATUSES = [
  "not_required",
  "pending",
  "verified",
  "rejected",
] as const;
export const CLIENT_TOCC_ACTION_STATUSES = [
  "none_required",
  "pending",
  "in_progress",
  "completed",
  "referred",
] as const;
export const CLIENT_TOCC_VALIDITY_STATUSES = ["current", "expired"] as const;
export const CLIENT_TOCC_VALIDITY_RULE =
  "calendar-month-asia-taipei-v1" as const;

export type ClientToccResultStatus =
  (typeof CLIENT_TOCC_RESULT_STATUSES)[number];
export type ClientToccEvidenceStatus =
  (typeof CLIENT_TOCC_EVIDENCE_STATUSES)[number];
export type ClientToccActionStatus =
  (typeof CLIENT_TOCC_ACTION_STATUSES)[number];
export type ClientToccValidityStatus =
  (typeof CLIENT_TOCC_VALIDITY_STATUSES)[number];

export type ClientToccAssessmentFields = {
  clientId: string;
  assessmentDate: string;
  resultStatus: ClientToccResultStatus;
  symptomSummary: string | null;
  riskSummary: string | null;
  evidenceStatus: ClientToccEvidenceStatus;
  actionStatus: ClientToccActionStatus;
};

export type ClientToccAssessment = ClientToccAssessmentFields & {
  id: string;
  assessmentVersion: number;
  validThrough: string;
  validityRuleVersion: typeof CLIENT_TOCC_VALIDITY_RULE;
  validityStatus: ClientToccValidityStatus;
  source: "staff";
  signedAt: string;
};

export type ClientToccClientSummary = {
  clientId: string;
  clientCode: string;
  displayName: string;
  clientStatus: ClientLifecycleStatus;
  admittedOn: string | null;
  endedOn: string | null;
  canRecord: boolean;
  latestAssessment: ClientToccAssessment | null;
};

export type ClientToccOption = {
  id: string;
  code: string;
  name: string;
  clientStatus: ClientLifecycleStatus;
  admittedOn: string | null;
  endedOn: string | null;
  canRecord: boolean;
};

export type ClientToccSnapshot = {
  generatedAt: string;
  staleAfter: string;
  todayTaipei: string;
  clients: readonly ClientToccClientSummary[];
  counts: {
    accessibleClients: number;
    current: number;
    expiringSoon: number;
    expired: number;
    noRecord: number;
    actionRequired: number;
  };
  demo: boolean;
};

export type ClientToccValidityFilter =
  | "all"
  | "current"
  | "expired"
  | "no_record";
export type ClientToccResultFilter = "all" | ClientToccResultStatus;
export type ClientToccFilters = {
  query: string;
  validity: ClientToccValidityFilter;
  result: ClientToccResultFilter;
};

export type ClientToccSingleWriteResult = {
  assessmentId: string;
  clientId: string;
  assessmentVersion: number;
  assessmentDate: string;
  validThrough: string;
  resultStatus: ClientToccResultStatus;
  evidenceStatus: ClientToccEvidenceStatus;
  actionStatus: ClientToccActionStatus;
  source: "staff";
  replayed: boolean;
  persisted: true;
  demo: false;
};

export type ClientToccBatchItemError = {
  code:
    | "validation_failed"
    | "forbidden"
    | "idempotency_conflict"
    | "retryable_conflict"
    | "internal_error";
  sqlstate: string;
  retryable: boolean;
};

export type ClientToccBatchItemResult = {
  itemIndex: number;
  itemIdempotencyKey: string | null;
  status: "success" | "failed";
  assessmentId: string | null;
  assessmentVersion: number | null;
  validThrough: string | null;
  itemReplayed: boolean;
  batchReplayed: boolean;
  error: ClientToccBatchItemError | null;
};
