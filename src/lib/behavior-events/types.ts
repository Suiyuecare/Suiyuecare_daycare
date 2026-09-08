export const BEHAVIOR_EVENT_STATES = ["draft", "signed", "corrected", "voided"] as const;
export const BEHAVIOR_FIELD_STATES = ["recorded", "missing", "not_applicable"] as const;

export type BehaviorEventState = (typeof BEHAVIOR_EVENT_STATES)[number];
export type BehaviorFieldState = (typeof BEHAVIOR_FIELD_STATES)[number];
export type BehaviorNarrativeField = { state: BehaviorFieldState; text: string | null };

export type BehaviorEventFilters = {
  dateFrom: string | null;
  dateTo: string | null;
  clientId: string | null;
  eventType: string | null;
  state: BehaviorEventState | "all";
};

export type BehaviorClientOption = { clientId: string; displayName: string };

export type BehaviorEventVersion = {
  versionId: string;
  eventKey: string;
  version: number;
  previousVersionId: string | null;
  contentHash: string;
  eventState: BehaviorEventState;
  clientId: string;
  clientDisplayName: string;
  occurredAt: string;
  eventType: string;
  antecedent: BehaviorNarrativeField;
  behavior: BehaviorNarrativeField;
  intervention: BehaviorNarrativeField;
  outcome: BehaviorNarrativeField;
  authorUserId: string;
  authorDisplayName: string;
  correctionReason: string | null;
  voidReason: string | null;
  signedAt: string | null;
  signedByUserId: string | null;
  signerDisplayName: string | null;
  signerRoleKeys: readonly string[] | null;
  signaturePurpose: string | null;
  signatureReauthChallengeId: string | null;
  createdAt: string;
};

export type BehaviorEvent = BehaviorEventVersion & {
  history: readonly BehaviorEventVersion[];
  historyTotal: number;
  historyTruncated: boolean;
  hasMissingFields: boolean;
};

export type BehaviorEventSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  filters: BehaviorEventFilters;
  events: readonly BehaviorEvent[];
  matchingTotal: number;
  eventsTruncated: boolean;
  metrics: { eventTotal: number; missingFieldTotal: number; draftTotal: number; signedTotal: number; voidedTotal: number };
  clients: readonly BehaviorClientOption[];
  clientTotal: number;
  clientsTruncated: boolean;
  eventTypes: readonly string[];
  eventTypeTotal: number;
  eventTypesTruncated: boolean;
  attachmentStatus: "not_configured";
  notificationStatus: "not_configured";
  exportStatus: "not_configured";
  offlineStatus: "not_configured";
  demo: boolean;
};

export type BehaviorEventFields = {
  clientId: string;
  occurredAt: string;
  eventType: string;
  antecedent: BehaviorNarrativeField;
  behavior: BehaviorNarrativeField;
  intervention: BehaviorNarrativeField;
  outcome: BehaviorNarrativeField;
};

export type SaveBehaviorEventInput = BehaviorEventFields & {
  action: "save_event";
  mode: "create" | "revise";
  eventKey: string | null;
  previousVersionId: string | null;
  expectedVersion: number;
  expectedContentHash: string | null;
  revisionReason: string;
  idempotencyKey: string;
};

export type FinalizeBehaviorEventInput = {
  action: "finalize_event";
  decision: "sign" | "void";
  clientId: string;
  eventKey: string;
  previousVersionId: string;
  expectedVersion: number;
  expectedContentHash: string;
  reason: string | null;
  idempotencyKey: string;
};

export type CorrectBehaviorEventInput = BehaviorEventFields & {
  action: "correct_event";
  eventKey: string;
  previousVersionId: string;
  expectedVersion: number;
  expectedContentHash: string;
  reason: string;
  idempotencyKey: string;
};

export type BehaviorEventMutationInput = SaveBehaviorEventInput | FinalizeBehaviorEventInput | CorrectBehaviorEventInput;

export type BehaviorEventReceipt = {
  operationId: string;
  action: BehaviorEventMutationInput["action"];
  decision: "sign" | "void" | null;
  eventKey: string;
  versionId: string;
  version: number;
  eventState: BehaviorEventState;
  contentHash: string;
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
