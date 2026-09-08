export const DAILY_SUMMARY_SOURCE_KINDS = [
  "attendance",
  "vital_signs",
  "care_diary",
  "service_events",
  "activities",
  "meals",
  "transport",
  "abnormal_events",
] as const;

export const DAILY_SUMMARY_COMPLETENESS_FILTERS = [
  "all", "complete", "incomplete", "limited_access",
] as const;

export type DailySummarySourceKind =
  (typeof DAILY_SUMMARY_SOURCE_KINDS)[number];
export type DailySummaryCompletenessFilter =
  (typeof DAILY_SUMMARY_COMPLETENESS_FILTERS)[number];
export type DailySummaryAccessStatus =
  "authorized" | "not_authorized" | "not_configured";
export type DailySummaryEvidenceStatus =
  "recorded" | "no_record" | "unknown";

export type DailyServiceSummaryFilters = {
  serviceDate: string;
  clientId: string | null;
  completeness: DailySummaryCompletenessFilter;
};

export type DailySummaryClientOption = {
  clientId: string;
  displayName: string;
  clientCode: string;
  serviceStatus: "active" | "suspended" | "transferred" | "closed" | "deceased";
};

export type DailySummarySourceConfiguration = {
  sourceKind: DailySummarySourceKind;
  sourcePage: number;
  sourceLabel: string;
  permission: string;
  configurationStatus: "configured" | "not_configured";
};

export type DailySummaryCell = {
  sourceKind: DailySummarySourceKind;
  sourcePage: number;
  sourceLabel: string;
  sourceHref: string;
  accessStatus: DailySummaryAccessStatus;
  evidenceStatus: DailySummaryEvidenceStatus;
  recordCount: number | null;
  completedCount: number | null;
  pendingCount: number | null;
  exceptionCount: number | null;
  sourceRecordIds: readonly string[];
  sourceRecordsTruncated: boolean;
  sourceHash: string | null;
  statusText: string;
};

export type DailyServiceSummaryRow = DailySummaryClientOption & {
  cells: readonly DailySummaryCell[];
  authorizedSourceCount: number;
  coveredSourceCount: number;
  notAuthorizedSourceCount: number;
  completenessPercent: number | null;
};

export type DailyServiceSummarySnapshot = {
  snapshotId: string;
  snapshotHash: string;
  expiresAt: string;
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  filters: DailyServiceSummaryFilters;
  rows: readonly DailyServiceSummaryRow[];
  matchingRowTotal: number;
  rowsTruncated: boolean;
  metrics: {
    clientTotal: number;
    authorizedCellTotal: number;
    coveredCellTotal: number;
    notAuthorizedCellTotal: number;
    recordedAttendanceClients: number | null;
    recordedVitalClients: number | null;
    activityParticipantClients: number | null;
    mealAssignedClients: number | null;
    transportPassengerClients: number | null;
    abnormalEventTotal: number | null;
  };
  clientOptions: readonly DailySummaryClientOption[];
  clientOptionsTruncated: boolean;
  sourceConfiguration: readonly DailySummarySourceConfiguration[];
  consistencyStatus: "single_database_statement_snapshot";
  exportStatus: "immutable_snapshot_available";
  offlineStatus: "not_configured";
  demo: boolean;
};
