export const INTEGRATIONS_AUDIT_SOURCE_KEYS = [
  "central_html_import",
  "notification_delivery",
  "pwa_sync",
  "claims",
  "consultation_notification_outbox",
  "referral_notification_outbox",
  "family_communication_delivery",
] as const;

export const INTEGRATIONS_AUDIT_INTEGRATION_KEYS = [
  "all",
  ...INTEGRATIONS_AUDIT_SOURCE_KEYS,
] as const;

export const INTEGRATIONS_AUDIT_ACTIVITY_STATES = [
  "all",
  "observed",
  "attention",
  "no_activity",
] as const;

export const INTEGRATIONS_AUDIT_PERSISTED_ACTIONS = [
  "select",
  "insert",
  "update",
  "delete",
  "export",
  "print",
  "sign",
  "correct",
  "permission_change",
  "rule_change",
  "integration",
] as const;

export const INTEGRATIONS_AUDIT_ACTIONS = [
  "all",
  ...INTEGRATIONS_AUDIT_PERSISTED_ACTIONS,
] as const;

export const INTEGRATIONS_AUDIT_PERSISTED_RESOURCE_CATEGORIES = [
  "governance",
  "import",
  "notification",
  "sync",
  "claim",
  "communication",
  "professional_service",
  "client",
  "staff",
  "care",
  "billing",
  "operations",
  "other",
] as const;

export const INTEGRATIONS_AUDIT_RESOURCE_CATEGORIES = [
  "all",
  ...INTEGRATIONS_AUDIT_PERSISTED_RESOURCE_CATEGORIES,
] as const;

export const INTEGRATIONS_AUDIT_SIGNAL_STATES = [
  "completed",
  "pending",
  "failed",
  "conflict",
  "rejected",
  "suppressed",
  "queued_unconfigured",
] as const;

export const INTEGRATIONS_AUDIT_ERROR_CATEGORIES = [
  "import_mapping_required",
  "import_validation_failed",
  "notification_delivery_failed",
  "sync_conflict",
  "sync_rejected",
  "claim_rejected",
  "external_delivery_not_configured",
] as const;

export const INTEGRATIONS_AUDIT_SOURCE_PATHS = Object.freeze({
  central_html_import: "/app/staff/governance/central-html-import",
  notification_delivery: "/app/staff/communication/push-notifications",
  pwa_sync: null,
  claims: "/app/staff/service-management/claims",
  consultation_notification_outbox: "/app/staff/professional-care/consultations",
  referral_notification_outbox: "/app/staff/professional-care/referrals",
  family_communication_delivery: "/app/staff/communication/care-communication",
} satisfies Readonly<Record<IntegrationsAuditSourceKey, string | null>>);

export type IntegrationsAuditIntegrationKey =
  (typeof INTEGRATIONS_AUDIT_INTEGRATION_KEYS)[number];
export type IntegrationsAuditSourceKey = (typeof INTEGRATIONS_AUDIT_SOURCE_KEYS)[number];
export type IntegrationsAuditActivityState =
  (typeof INTEGRATIONS_AUDIT_ACTIVITY_STATES)[number];
export type IntegrationsAuditInventoryState = Exclude<IntegrationsAuditActivityState, "all">;
export type IntegrationsAuditAction = (typeof INTEGRATIONS_AUDIT_ACTIONS)[number];
export type IntegrationsAuditPersistedAction =
  (typeof INTEGRATIONS_AUDIT_PERSISTED_ACTIONS)[number];
export type IntegrationsAuditResourceCategory =
  (typeof INTEGRATIONS_AUDIT_RESOURCE_CATEGORIES)[number];
export type IntegrationsAuditPersistedResourceCategory =
  (typeof INTEGRATIONS_AUDIT_PERSISTED_RESOURCE_CATEGORIES)[number];
export type IntegrationsAuditSignalState =
  (typeof INTEGRATIONS_AUDIT_SIGNAL_STATES)[number];
export type IntegrationsAuditErrorCategory =
  (typeof INTEGRATIONS_AUDIT_ERROR_CATEGORIES)[number];

export type IntegrationsAuditFilters = {
  startDate: string;
  endDate: string;
  integrationKey: IntegrationsAuditIntegrationKey;
  activityState: IntegrationsAuditActivityState;
  auditAction: IntegrationsAuditAction;
  resourceCategory: IntegrationsAuditResourceCategory;
  actorUserId: string | null;
  correlationId: string | null;
};

export type IntegrationsAuditInventoryItem = {
  integrationKey: IntegrationsAuditSourceKey;
  sourcePath: string | null;
  activityState: IntegrationsAuditInventoryState;
  recordTotal: number;
  attentionTotal: number;
  pendingTotal: number;
  latestActivityAt: string | null;
  governanceStatus: "unconfigured";
  providerRegionStatus: "unconfigured";
  ownerStatus: "unconfigured";
  retryCommandStatus: "unconfigured";
  deactivationCommandStatus: "unconfigured";
  reconciliationCommandStatus: "unconfigured";
};

export type IntegrationsAuditSignal = {
  signalId: string;
  integrationKey: IntegrationsAuditSourceKey;
  occurredAt: string;
  state: IntegrationsAuditSignalState;
  correlationId: string | null;
  errorCategory: IntegrationsAuditErrorCategory | null;
  errorCodeStatus: "available" | "redacted" | "not_applicable";
  sourcePath: string | null;
};

export type IntegrationsAuditRecordId = {
  kind: "uuid" | "number";
  value: string;
};

export type IntegrationsAuditEvent = {
  auditEventId: string;
  occurredAt: string;
  action: IntegrationsAuditPersistedAction;
  resourceCategory: IntegrationsAuditPersistedResourceCategory;
  actorUserId: string | null;
  recordId: IntegrationsAuditRecordId | null;
  requestId: string | null;
  idempotencyKey: string | null;
};

export type IntegrationsAuditSnapshot = {
  snapshotId: string;
  snapshotHash: string;
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  window: {
    startDate: string;
    endDate: string;
    timeZone: "Asia/Taipei";
  };
  filters: IntegrationsAuditFilters;
  inventory: readonly IntegrationsAuditInventoryItem[];
  inventoryMatchingTotal: number;
  signals: readonly IntegrationsAuditSignal[];
  signalMatchingTotal: number;
  signalsTruncated: boolean;
  auditEvents: readonly IntegrationsAuditEvent[];
  auditMatchingTotal: number;
  auditEventsTruncated: boolean;
  options: {
    integrationKeys: readonly IntegrationsAuditIntegrationKey[];
    activityStates: readonly IntegrationsAuditActivityState[];
    auditActions: readonly IntegrationsAuditAction[];
    resourceCategories: readonly IntegrationsAuditResourceCategory[];
  };
  bounds: {
    maxDateWindowDays: 90;
    maxSignalRows: 100;
    maxAuditRows: 200;
    maxSnapshotBytes: 1_048_576;
  };
  accessRequirements: {
    permission: "audit.view";
    employeeAal2Required: true;
    recentSameSessionAal2Required: true;
    recentMaximumAgeMinutes: 15;
  };
  capabilities: {
    integrationRegistryStatus: "unconfigured";
    providerRegionalComplianceStatus: "unconfigured";
    ownerAssignmentStatus: "unconfigured";
    retryCommandsStatus: "unconfigured";
    deactivationCommandsStatus: "unconfigured";
    reconciliationCommandsStatus: "unconfigured";
    payloadInspectionStatus: "prohibited";
    mutationStatus: "read_only";
  };
  consistencyStatus: "single_database_statement_snapshot" | "synthetic_demo_snapshot";
  demo: boolean;
};
