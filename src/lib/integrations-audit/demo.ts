import { createHash } from "node:crypto";

import {
  INTEGRATIONS_AUDIT_ACTIONS,
  INTEGRATIONS_AUDIT_ACTIVITY_STATES,
  INTEGRATIONS_AUDIT_INTEGRATION_KEYS,
  INTEGRATIONS_AUDIT_RESOURCE_CATEGORIES,
  INTEGRATIONS_AUDIT_SOURCE_KEYS,
  INTEGRATIONS_AUDIT_SOURCE_PATHS,
  type IntegrationsAuditEvent,
  type IntegrationsAuditFilters,
  type IntegrationsAuditInventoryItem,
  type IntegrationsAuditSignal,
  type IntegrationsAuditSnapshot,
} from "./types";

const DEMO_ACTOR = "83000000-0000-4000-8000-000000000083";
const DEMO_CORRELATION = "83000000-0000-4000-8000-000000000084";

function taipeiDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
}

function isAttention(signal: IntegrationsAuditSignal) {
  return ["failed", "conflict", "rejected", "queued_unconfigured"].includes(signal.state) ||
    signal.errorCategory === "import_mapping_required";
}

function isPending(state: IntegrationsAuditSignal["state"]) {
  return state === "pending" || state === "queued_unconfigured";
}

export function buildDemoIntegrationsAuditSnapshot(input: {
  organizationId: string;
  branchId: string;
  filters: IntegrationsAuditFilters;
  now?: Date;
}): IntegrationsAuditSnapshot {
  const now = input.now ?? new Date();
  const generatedAt = now.toISOString();
  const at = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
  const signalCandidates: IntegrationsAuditSignal[] = [
    { signalId: "83010000-0000-4000-8000-000000000001", integrationKey: "central_html_import",
      occurredAt: at(15), state: "pending", correlationId: null,
      errorCategory: "import_mapping_required", errorCodeStatus: "available",
      sourcePath: INTEGRATIONS_AUDIT_SOURCE_PATHS.central_html_import },
    { signalId: "83010000-0000-4000-8000-000000000002", integrationKey: "notification_delivery",
      occurredAt: at(30), state: "failed", correlationId: null,
      errorCategory: "notification_delivery_failed", errorCodeStatus: "redacted",
      sourcePath: INTEGRATIONS_AUDIT_SOURCE_PATHS.notification_delivery },
    { signalId: "83010000-0000-4000-8000-000000000003", integrationKey: "pwa_sync",
      occurredAt: at(45), state: "conflict", correlationId: null,
      errorCategory: "sync_conflict", errorCodeStatus: "available",
      sourcePath: INTEGRATIONS_AUDIT_SOURCE_PATHS.pwa_sync },
    { signalId: "83010000-0000-4000-8000-000000000004", integrationKey: "claims",
      occurredAt: at(60), state: "completed", correlationId: null,
      errorCategory: null, errorCodeStatus: "not_applicable",
      sourcePath: INTEGRATIONS_AUDIT_SOURCE_PATHS.claims },
    { signalId: "83010000-0000-4000-8000-000000000005",
      integrationKey: "consultation_notification_outbox", occurredAt: at(75),
      state: "queued_unconfigured", correlationId: DEMO_CORRELATION,
      errorCategory: "external_delivery_not_configured", errorCodeStatus: "available",
      sourcePath: INTEGRATIONS_AUDIT_SOURCE_PATHS.consultation_notification_outbox },
    { signalId: "83010000-0000-4000-8000-000000000006",
      integrationKey: "family_communication_delivery", occurredAt: at(90),
      state: "queued_unconfigured", correlationId: "83000000-0000-4000-8000-000000000085",
      errorCategory: "external_delivery_not_configured", errorCodeStatus: "available",
      sourcePath: INTEGRATIONS_AUDIT_SOURCE_PATHS.family_communication_delivery },
  ];
  const allSignals = signalCandidates.filter((signal) => {
    const date = taipeiDate(signal.occurredAt);
    return date >= input.filters.startDate && date <= input.filters.endDate;
  });

  const correlationSignals = allSignals.filter((signal) =>
    input.filters.correlationId === null || signal.correlationId === input.filters.correlationId);
  const allInventory = INTEGRATIONS_AUDIT_SOURCE_KEYS.map((integrationKey) => {
    const sourceSignals = correlationSignals.filter((signal) => signal.integrationKey === integrationKey);
    const attentionTotal = sourceSignals.filter(isAttention).length;
    const recordTotal = sourceSignals.length;
    return {
      integrationKey,
      sourcePath: INTEGRATIONS_AUDIT_SOURCE_PATHS[integrationKey],
      activityState: attentionTotal > 0 ? "attention" : recordTotal > 0 ? "observed" : "no_activity",
      recordTotal,
      attentionTotal,
      pendingTotal: sourceSignals.filter((signal) => isPending(signal.state)).length,
      latestActivityAt: sourceSignals[0]?.occurredAt ?? null,
      governanceStatus: "unconfigured",
      providerRegionStatus: "unconfigured",
      ownerStatus: "unconfigured",
      retryCommandStatus: "unconfigured",
      deactivationCommandStatus: "unconfigured",
      reconciliationCommandStatus: "unconfigured",
    } satisfies IntegrationsAuditInventoryItem;
  });
  const inventory = allInventory.filter((item) =>
    (input.filters.integrationKey === "all" || item.integrationKey === input.filters.integrationKey) &&
    (input.filters.activityState === "all" || item.activityState === input.filters.activityState));
  const visibleKeys = new Set(inventory.map((item) => item.integrationKey));
  const signals = correlationSignals.filter((signal) => visibleKeys.has(signal.integrationKey));

  const auditCandidates: IntegrationsAuditEvent[] = [
    { auditEventId: "8301", occurredAt: at(20), action: "integration",
      resourceCategory: "notification", actorUserId: DEMO_ACTOR,
      recordId: { kind: "uuid", value: "83020000-0000-4000-8000-000000000001" },
      requestId: DEMO_CORRELATION, idempotencyKey: null },
    { auditEventId: "8302", occurredAt: at(50), action: "select",
      resourceCategory: "governance", actorUserId: DEMO_ACTOR,
      recordId: { kind: "number", value: "8302" }, requestId: null,
      idempotencyKey: "83000000-0000-4000-8000-000000000086" },
    { auditEventId: "8303", occurredAt: at(80), action: "export",
      resourceCategory: "claim", actorUserId: DEMO_ACTOR,
      recordId: null, requestId: null, idempotencyKey: null },
  ];
  const allAuditEvents = auditCandidates.filter((event) => {
    const date = taipeiDate(event.occurredAt);
    return date >= input.filters.startDate && date <= input.filters.endDate &&
      (input.filters.auditAction === "all" || event.action === input.filters.auditAction) &&
      (input.filters.resourceCategory === "all" ||
        event.resourceCategory === input.filters.resourceCategory) &&
      (input.filters.actorUserId === null || event.actorUserId === input.filters.actorUserId) &&
      (input.filters.correlationId === null || event.requestId === input.filters.correlationId ||
        event.idempotencyKey === input.filters.correlationId);
  });

  const fingerprint = JSON.stringify({
    organizationId: input.organizationId,
    branchId: input.branchId,
    filters: input.filters,
    generatedAt,
    signals: signals.map((signal) => signal.signalId),
    auditEvents: allAuditEvents.map((event) => event.auditEventId),
  });
  return {
    snapshotId: "83000000-0000-4000-8000-000000000001",
    snapshotHash: createHash("sha256").update(fingerprint, "utf8").digest("hex"),
    organizationId: input.organizationId,
    branchId: input.branchId,
    generatedAt,
    staleAfter: new Date(now.getTime() + 60_000).toISOString(),
    window: { startDate: input.filters.startDate, endDate: input.filters.endDate,
      timeZone: "Asia/Taipei" },
    filters: input.filters,
    inventory,
    inventoryMatchingTotal: inventory.length,
    signals,
    signalMatchingTotal: signals.length,
    signalsTruncated: false,
    auditEvents: allAuditEvents,
    auditMatchingTotal: allAuditEvents.length,
    auditEventsTruncated: false,
    options: {
      integrationKeys: INTEGRATIONS_AUDIT_INTEGRATION_KEYS,
      activityStates: INTEGRATIONS_AUDIT_ACTIVITY_STATES,
      auditActions: INTEGRATIONS_AUDIT_ACTIONS,
      resourceCategories: INTEGRATIONS_AUDIT_RESOURCE_CATEGORIES,
    },
    bounds: { maxDateWindowDays: 90, maxSignalRows: 100, maxAuditRows: 200,
      maxSnapshotBytes: 1_048_576 },
    accessRequirements: { permission: "audit.view", employeeAal2Required: true,
      recentSameSessionAal2Required: true, recentMaximumAgeMinutes: 15 },
    capabilities: { integrationRegistryStatus: "unconfigured",
      providerRegionalComplianceStatus: "unconfigured", ownerAssignmentStatus: "unconfigured",
      retryCommandsStatus: "unconfigured", deactivationCommandsStatus: "unconfigured",
      reconciliationCommandsStatus: "unconfigured", payloadInspectionStatus: "prohibited",
      mutationStatus: "read_only" },
    consistencyStatus: "synthetic_demo_snapshot",
    demo: true,
  };
}
