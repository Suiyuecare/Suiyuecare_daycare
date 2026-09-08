export const PROFESSIONAL_SUMMARY_SOURCE_KINDS = [
  "occupational_therapy_assessment",
  "physical_therapy_assessment",
  "chewing_assessment",
  "mna_assessment",
  "consultation",
  "case_conference",
  "referral",
  "physical_therapy_service",
  "occupational_therapy_service",
] as const;

export const PROFESSIONAL_SUMMARY_KINDS = [
  "all",
  "occupational_therapy",
  "physical_therapy",
  "chewing",
  "nutrition",
  "consultation",
  "case_conference",
  "referral",
] as const;

export const PROFESSIONAL_SUMMARY_STATUSES = [
  "all", "completed", "pending", "overdue", "not_configured",
] as const;

export type ProfessionalSummarySourceKind =
  (typeof PROFESSIONAL_SUMMARY_SOURCE_KINDS)[number];
export type ProfessionalSummaryKind =
  (typeof PROFESSIONAL_SUMMARY_KINDS)[number];
export type ProfessionalSummaryStatus =
  Exclude<(typeof PROFESSIONAL_SUMMARY_STATUSES)[number], "all">;
export type ProfessionalSummaryStatusFilter =
  (typeof PROFESSIONAL_SUMMARY_STATUSES)[number];

export type ProfessionalServiceSummaryFilters = {
  month: string;
  clientId: string | null;
  professionalKind: ProfessionalSummaryKind;
  status: ProfessionalSummaryStatusFilter;
};

export type ProfessionalSummaryClientOption = {
  clientId: string;
  displayName: string;
  serviceStatus: "active" | "suspended" | "transferred" | "closed" | "deceased";
};

export type ProfessionalSummarySourceConfiguration = {
  sourceKind: ProfessionalSummarySourceKind;
  sourcePage: number;
  dataStatus:
    | "configured"
    | "candidate_only"
    | "license_required_not_configured";
  expectationStatus:
    | "manual_due_date_only"
    | "not_configured"
    | "manual_deadline_or_explicit_missing_state"
    | "action_deadline_only"
    | "due_rule_not_configured"
    | "existing_records_only_frequency_not_configured";
};

export type ProfessionalServiceSummaryItem = {
  itemId: string;
  sourceKind: ProfessionalSummarySourceKind;
  professionalKind: Exclude<ProfessionalSummaryKind, "all">;
  professionalLabel: string;
  sourcePage: number;
  sourcePageTitle: string;
  sourceHref: string;
  clientId: string;
  clientDisplayName: string;
  serviceStatus: ProfessionalSummaryClientOption["serviceStatus"];
  sourceRecordId: string;
  sourceRecordKey: string;
  sourceVersion: number;
  rawStatus: string;
  summaryStatus: ProfessionalSummaryStatus;
  expectationStatus: string;
  expectedCount: number;
  completedCount: number;
  pendingCount: number;
  overdueCount: number;
  serviceCount: number;
  latestOn: string;
  nextDueOn: string | null;
  statusReason: string;
  sourceHash: string;
};

export type ProfessionalServiceSummarySnapshot = {
  snapshotId: string;
  snapshotHash: string;
  expiresAt: string;
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  month: string;
  monthStart: string;
  monthEnd: string;
  cutoffOn: string;
  items: readonly ProfessionalServiceSummaryItem[];
  matchingTotal: number;
  itemsTruncated: boolean;
  metrics: {
    expected: number;
    completed: number;
    pending: number;
    overdue: number;
    serviceRecords: number;
    notConfiguredItems: number;
  };
  clientOptions: readonly ProfessionalSummaryClientOption[];
  clientOptionsTruncated: boolean;
  sourceConfiguration: readonly ProfessionalSummarySourceConfiguration[];
  configuredSourceCount: number;
  notConfiguredSourceCount: number;
  expectationCoverageStatus: "partial_authoritative_rows_only";
  missingScheduleClaim: "not_made";
  exportStatus: "immutable_snapshot_available";
  offlineStatus: "not_configured";
  demo: boolean;
};
