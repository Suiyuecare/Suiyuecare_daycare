export const HAND_HYGIENE_MATCH_STATUSES = [
  "all", "matched", "unmatched", "excluded",
] as const;
export type HandHygieneMatchStatus =
  (typeof HAND_HYGIENE_MATCH_STATUSES)[number];

export const HAND_HYGIENE_EVENT_KINDS = [
  "all", "hygiene_performed", "opportunity",
] as const;
export type HandHygieneEventKind =
  (typeof HAND_HYGIENE_EVENT_KINDS)[number];

export type HandHygieneFilters = {
  dateFrom: string | null;
  dateTo: string | null;
  staffMembershipId: string | null;
  deviceCode: string | null;
  matchStatus: HandHygieneMatchStatus;
  eventKind: HandHygieneEventKind;
};

export type HandHygieneEvent = {
  eventId: string;
  sourceProvider: string;
  sourceEventId: string;
  deviceCode: string;
  eventKind: Exclude<HandHygieneEventKind, "all">;
  occurredAt: string;
  receivedAt: string;
  matchStatus: Exclude<HandHygieneMatchStatus, "all">;
  staffMembershipId: string | null;
  staffDisplayName: string | null;
  staffEmployeeCode: string | null;
  correctionSequence: number;
  correctionReason: string | null;
  correctedByDisplayName: string | null;
  correctedAt: string | null;
};

export type HandHygieneStaffOption = {
  staffMembershipId: string;
  displayName: string;
  employeeCode: string | null;
  isCurrent: boolean;
};

export type HandHygieneDeviceOption = {
  deviceCode: string;
  eventCount: number;
};

export type HandHygieneSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  filters: HandHygieneFilters;
  events: readonly HandHygieneEvent[];
  eventTotal: number;
  eventsTruncated: boolean;
  metrics: {
    performedEventTotal: number;
    matchedPerformedTotal: number;
    observedOpportunityEventTotal: number;
    unmatchedTotal: number;
    excludedTotal: number;
    denominatorTotal: null;
    attainmentRate: null;
  };
  staffOptions: readonly HandHygieneStaffOption[];
  staffTotal: number;
  staffTruncated: boolean;
  deviceOptions: readonly HandHygieneDeviceOption[];
  deviceTotal: number;
  devicesTruncated: boolean;
  numeratorDefinition: "matched_distinct_hygiene_performed_events";
  denominatorPolicyStatus: "not_configured";
  denominatorDefinition: null;
  sourceIntegrationStatus: "database_contract_only";
  exportStatus: "not_configured";
  demo: boolean;
};

export type HandHygieneCorrectionInput = {
  action: "correct_match";
  eventId: string;
  expectedCorrectionSequence: number;
  matchStatus: Exclude<HandHygieneMatchStatus, "all">;
  staffMembershipId: string | null;
  reason: string;
  idempotencyKey: string;
};

export type HandHygieneCorrectionReceipt = {
  action: "correct_match";
  operationId: string;
  eventId: string;
  correctionId: string;
  correctionSequence: number;
  matchStatus: Exclude<HandHygieneMatchStatus, "all">;
  staffMembershipId: string | null;
  correctedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
