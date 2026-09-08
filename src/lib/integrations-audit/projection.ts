import { createHash } from "node:crypto";

import { z } from "zod";

import {
  INTEGRATIONS_AUDIT_ACTIONS,
  INTEGRATIONS_AUDIT_ACTIVITY_STATES,
  INTEGRATIONS_AUDIT_ERROR_CATEGORIES,
  INTEGRATIONS_AUDIT_INTEGRATION_KEYS,
  INTEGRATIONS_AUDIT_PERSISTED_ACTIONS,
  INTEGRATIONS_AUDIT_PERSISTED_RESOURCE_CATEGORIES,
  INTEGRATIONS_AUDIT_RESOURCE_CATEGORIES,
  INTEGRATIONS_AUDIT_SIGNAL_STATES,
  INTEGRATIONS_AUDIT_SOURCE_KEYS,
  INTEGRATIONS_AUDIT_SOURCE_PATHS,
  type IntegrationsAuditFilters,
  type IntegrationsAuditInventoryItem,
  type IntegrationsAuditSnapshot,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
function isStrictOffsetDateTime(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offset] = match;
  const year = Number(yearText); const month = Number(monthText); const day = Number(dayText);
  const hour = Number(hourText); const minute = Number(minuteText); const second = Number(secondText);
  const maximumDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (year < 2000 || year > 2200 || month < 1 || month > 12 || day < 1 || day > maximumDay ||
    hour > 23 || minute > 59 || second > 59) return false;
  if (offset !== "Z") {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return false;
  }
  return Number.isFinite(Date.parse(value));
}
const timestamp = z.string().refine(isStrictOffsetDateTime)
  .transform((value) => new Date(value).toISOString());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const instant = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(instant.getTime()) && new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instant) === value;
});
const count = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().nonnegative().safe()),
]);
const sourceKey = z.enum(INTEGRATIONS_AUDIT_SOURCE_KEYS);
const persistedAction = z.enum(INTEGRATIONS_AUDIT_PERSISTED_ACTIONS);
const persistedResource = z.enum(INTEGRATIONS_AUDIT_PERSISTED_RESOURCE_CATEGORIES);

const filters = z.object({
  start_date: date,
  end_date: date,
  integration_key: z.enum(INTEGRATIONS_AUDIT_INTEGRATION_KEYS),
  activity_state: z.enum(INTEGRATIONS_AUDIT_ACTIVITY_STATES),
  audit_action: z.enum(INTEGRATIONS_AUDIT_ACTIONS),
  resource_category: z.enum(INTEGRATIONS_AUDIT_RESOURCE_CATEGORIES),
  actor_user_id: uuid.nullable(),
  correlation_id: uuid.nullable(),
}).strict();

const inventoryItem = z.object({
  integration_key: sourceKey,
  source_path: z.string().startsWith("/app/staff/").max(160).nullable(),
  activity_state: z.enum(["observed", "attention", "no_activity"]),
  record_total: count,
  attention_total: count,
  pending_total: count,
  latest_activity_at: timestamp.nullable(),
  governance_status: z.literal("unconfigured"),
  provider_region_status: z.literal("unconfigured"),
  owner_status: z.literal("unconfigured"),
  retry_command_status: z.literal("unconfigured"),
  deactivation_command_status: z.literal("unconfigured"),
  reconciliation_command_status: z.literal("unconfigured"),
}).strict();

const signal = z.object({
  signal_id: uuid,
  integration_key: sourceKey,
  occurred_at: timestamp,
  state: z.enum(INTEGRATIONS_AUDIT_SIGNAL_STATES),
  correlation_id: uuid.nullable(),
  error_category: z.enum(INTEGRATIONS_AUDIT_ERROR_CATEGORIES).nullable(),
  error_code_status: z.enum(["available", "redacted", "not_applicable"]),
  source_path: z.string().startsWith("/app/staff/").max(160).nullable(),
}).strict();

const recordId = z.object({
  kind: z.enum(["uuid", "number"]),
  value: z.string().min(1).max(36),
}).strict();

const auditEvent = z.object({
  audit_event_id: z.string().regex(/^[1-9]\d{0,18}$/u),
  occurred_at: timestamp,
  action: persistedAction,
  resource_category: persistedResource,
  actor_user_id: uuid.nullable(),
  record_id: recordId.nullable(),
  request_id: uuid.nullable(),
  idempotency_key: uuid.nullable(),
}).strict();

const payload = z.object({
  schema_version: z.literal("page83-integrations-audit.v1"),
  organization_id: uuid,
  branch_id: uuid,
  generated_at: timestamp,
  stale_after: timestamp,
  window: z.object({
    start_date: date,
    end_date: date,
    time_zone: z.literal("Asia/Taipei"),
  }).strict(),
  filters,
  inventory: z.array(inventoryItem).max(7),
  inventory_matching_total: count.pipe(z.number().max(7)),
  signals: z.array(signal).max(100),
  signal_matching_total: count,
  signals_truncated: z.boolean(),
  audit_events: z.array(auditEvent).max(200),
  audit_matching_total: count,
  audit_events_truncated: z.boolean(),
  options: z.object({
    integration_keys: z.array(z.enum(INTEGRATIONS_AUDIT_INTEGRATION_KEYS)).length(8),
    activity_states: z.array(z.enum(INTEGRATIONS_AUDIT_ACTIVITY_STATES)).length(4),
    audit_actions: z.array(z.enum(INTEGRATIONS_AUDIT_ACTIONS)).length(12),
    resource_categories: z.array(z.enum(INTEGRATIONS_AUDIT_RESOURCE_CATEGORIES)).length(14),
  }).strict(),
  bounds: z.object({
    max_date_window_days: z.literal(90),
    max_signal_rows: z.literal(100),
    max_audit_rows: z.literal(200),
    max_snapshot_bytes: z.literal(1_048_576),
  }).strict(),
  access_requirements: z.object({
    permission: z.literal("audit.view"),
    employee_aal2_required: z.literal(true),
    recent_same_session_aal2_required: z.literal(true),
    recent_maximum_age_minutes: z.literal(15),
  }).strict(),
  capabilities: z.object({
    integration_registry_status: z.literal("unconfigured"),
    provider_regional_compliance_status: z.literal("unconfigured"),
    owner_assignment_status: z.literal("unconfigured"),
    retry_commands_status: z.literal("unconfigured"),
    deactivation_commands_status: z.literal("unconfigured"),
    reconciliation_commands_status: z.literal("unconfigured"),
    payload_inspection_status: z.literal("prohibited"),
    mutation_status: z.literal("read_only"),
  }).strict(),
  consistency_status: z.literal("single_database_statement_snapshot"),
  demo: z.literal(false),
}).strict();

const sourceRow = z.object({
  snapshot_id: uuid,
  snapshot_hash: sha256,
  generated_at: timestamp,
  stale_after: timestamp,
  snapshot_json: z.string().min(2).max(1_048_576),
}).strict();

export type IntegrationsAuditSnapshotSourceRow = z.input<typeof sourceRow>;

function invalid(): never {
  throw new Error("INVALID_INTEGRATIONS_AUDIT_SNAPSHOT");
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sameArray(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validInventorySelection(
  inventory: readonly IntegrationsAuditInventoryItem[],
  expected: IntegrationsAuditFilters,
) {
  const keys = inventory.map((item) => item.integrationKey);
  const catalogIndexes = keys.map((key) => INTEGRATIONS_AUDIT_SOURCE_KEYS.indexOf(key));
  if (catalogIndexes.some((index, position) =>
    position > 0 && index <= catalogIndexes[position - 1]!,
  )) return false;
  if (expected.activityState !== "all") return true;
  return sameArray(
    keys,
    expected.integrationKey === "all"
      ? INTEGRATIONS_AUDIT_SOURCE_KEYS
      : [expected.integrationKey],
  );
}

function sameFilters(actual: z.output<typeof filters>, expected: IntegrationsAuditFilters) {
  return actual.start_date === expected.startDate && actual.end_date === expected.endDate &&
    actual.integration_key === expected.integrationKey &&
    actual.activity_state === expected.activityState && actual.audit_action === expected.auditAction &&
    actual.resource_category === expected.resourceCategory &&
    actual.actor_user_id === expected.actorUserId && actual.correlation_id === expected.correlationId;
}

function withinWindow(value: string, startDate: string, endDate: string, generatedAt: string) {
  const instant = Date.parse(value);
  const start = Date.parse(`${startDate}T00:00:00+08:00`);
  const end = Date.parse(`${endDate}T23:59:59.999+08:00`);
  return instant >= start && instant <= end && instant <= Date.parse(generatedAt);
}

function normalizeInventory(value: z.output<typeof inventoryItem>): IntegrationsAuditInventoryItem {
  const expectedPath = INTEGRATIONS_AUDIT_SOURCE_PATHS[value.integration_key];
  const expectedState = value.attention_total > 0
    ? "attention"
    : value.record_total > 0 ? "observed" : "no_activity";
  if (
    value.source_path !== expectedPath || value.activity_state !== expectedState ||
    value.attention_total > value.record_total || value.pending_total > value.record_total ||
    (value.record_total === 0) !== (value.latest_activity_at === null)
  ) invalid();
  return {
    integrationKey: value.integration_key,
    sourcePath: value.source_path,
    activityState: value.activity_state,
    recordTotal: value.record_total,
    attentionTotal: value.attention_total,
    pendingTotal: value.pending_total,
    latestActivityAt: value.latest_activity_at,
    governanceStatus: value.governance_status,
    providerRegionStatus: value.provider_region_status,
    ownerStatus: value.owner_status,
    retryCommandStatus: value.retry_command_status,
    deactivationCommandStatus: value.deactivation_command_status,
    reconciliationCommandStatus: value.reconciliation_command_status,
  };
}

function validSignalSemantics(signal: {
  integrationKey: (typeof INTEGRATIONS_AUDIT_SOURCE_KEYS)[number];
  state: (typeof INTEGRATIONS_AUDIT_SIGNAL_STATES)[number];
  errorCategory: (typeof INTEGRATIONS_AUDIT_ERROR_CATEGORIES)[number] | null;
  errorCodeStatus: "available" | "redacted" | "not_applicable";
}) {
  const noError = signal.errorCategory === null && signal.errorCodeStatus === "not_applicable";
  switch (signal.integrationKey) {
    case "central_html_import":
      return (signal.state === "failed" && signal.errorCategory === "import_validation_failed" &&
        (signal.errorCodeStatus === "available" || signal.errorCodeStatus === "redacted")) ||
        (signal.state === "pending" && signal.errorCategory === "import_mapping_required" &&
          signal.errorCodeStatus === "available") ||
        ((signal.state === "pending" || signal.state === "completed") && noError);
    case "notification_delivery":
      return (signal.state === "failed" && signal.errorCategory === "notification_delivery_failed" &&
        (signal.errorCodeStatus === "available" || signal.errorCodeStatus === "redacted")) ||
        (["pending", "completed", "suppressed"] as const).includes(signal.state as never) && noError;
    case "pwa_sync":
      return (signal.state === "conflict" && signal.errorCategory === "sync_conflict" &&
        (signal.errorCodeStatus === "available" || signal.errorCodeStatus === "redacted")) ||
        (signal.state === "rejected" && signal.errorCategory === "sync_rejected" &&
          signal.errorCodeStatus === "available") ||
        (signal.state === "pending" || signal.state === "completed") && noError;
    case "claims":
      return (signal.state === "rejected" && signal.errorCategory === "claim_rejected" &&
        signal.errorCodeStatus === "available") ||
        (["pending", "completed", "suppressed"] as const).includes(signal.state as never) && noError;
    case "consultation_notification_outbox":
    case "referral_notification_outbox":
    case "family_communication_delivery":
      return signal.state === "queued_unconfigured" &&
        signal.errorCategory === "external_delivery_not_configured" &&
        signal.errorCodeStatus === "available";
  }
}

export function projectIntegrationsAuditSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  filters: IntegrationsAuditFilters;
}): IntegrationsAuditSnapshot {
  const row = sourceRow.safeParse(input.row);
  if (!row.success || Buffer.byteLength(row.data.snapshot_json, "utf8") > 1_048_576 ||
    digest(row.data.snapshot_json) !== row.data.snapshot_hash) invalid();

  let rawPayload: unknown;
  try { rawPayload = JSON.parse(row.data.snapshot_json) as unknown; } catch { invalid(); }
  const parsed = payload.safeParse(rawPayload);
  if (!parsed.success) invalid();
  const value = parsed.data;
  const expectedOrganization = uuid.safeParse(input.expectedOrganizationId);
  const expectedBranch = uuid.safeParse(input.expectedBranchId);
  const generatedAt = Date.parse(row.data.generated_at);
  const staleAfter = Date.parse(row.data.stale_after);
  if (
    !expectedOrganization.success || !expectedBranch.success ||
    value.organization_id !== expectedOrganization.data || value.branch_id !== expectedBranch.data ||
    Date.parse(value.generated_at) !== generatedAt || Date.parse(value.stale_after) !== staleAfter ||
    staleAfter - generatedAt !== 60_000 || value.window.start_date !== value.filters.start_date ||
    value.window.end_date !== value.filters.end_date || !sameFilters(value.filters, input.filters) ||
    !sameArray(value.options.integration_keys, INTEGRATIONS_AUDIT_INTEGRATION_KEYS) ||
    !sameArray(value.options.activity_states, INTEGRATIONS_AUDIT_ACTIVITY_STATES) ||
    !sameArray(value.options.audit_actions, INTEGRATIONS_AUDIT_ACTIONS) ||
    !sameArray(value.options.resource_categories, INTEGRATIONS_AUDIT_RESOURCE_CATEGORIES)
  ) invalid();

  const inventory = value.inventory.map(normalizeInventory);
  const signals = value.signals.map((item) => ({
    signalId: item.signal_id,
    integrationKey: item.integration_key,
    occurredAt: item.occurred_at,
    state: item.state,
    correlationId: item.correlation_id,
    errorCategory: item.error_category,
    errorCodeStatus: item.error_code_status,
    sourcePath: item.source_path,
  }));
  const auditEvents = value.audit_events.map((event) => ({
    auditEventId: event.audit_event_id,
    occurredAt: event.occurred_at,
    action: event.action,
    resourceCategory: event.resource_category,
    actorUserId: event.actor_user_id,
    recordId: event.record_id,
    requestId: event.request_id,
    idempotencyKey: event.idempotency_key,
  }));
  const chronological = <T extends { occurredAt: string }>(items: readonly T[]) => items.every(
    (item, index) => index === 0 || items[index - 1]!.occurredAt >= item.occurredAt,
  );
  const visibleIntegrationKeys = new Set(inventory.map((item) => item.integrationKey));
  if (
    inventory.length !== value.inventory_matching_total ||
    new Set(inventory.map((item) => item.integrationKey)).size !== inventory.length ||
    !validInventorySelection(inventory, input.filters) ||
    inventory.some((item) =>
      (input.filters.integrationKey !== "all" && item.integrationKey !== input.filters.integrationKey) ||
      (input.filters.activityState !== "all" && item.activityState !== input.filters.activityState) ||
      (item.latestActivityAt !== null && !withinWindow(
        item.latestActivityAt, value.window.start_date, value.window.end_date, value.generated_at,
      ))) ||
    value.signal_matching_total < signals.length ||
    value.signal_matching_total !== inventory.reduce((total, item) => total + item.recordTotal, 0) ||
    value.signals_truncated !== (value.signal_matching_total > signals.length) ||
    new Set(signals.map((item) => `${item.integrationKey}:${item.signalId}`)).size !== signals.length ||
    !chronological(signals) || signals.some((item) =>
      item.sourcePath !== INTEGRATIONS_AUDIT_SOURCE_PATHS[item.integrationKey] ||
      !visibleIntegrationKeys.has(item.integrationKey) ||
      !validSignalSemantics(item) ||
      !withinWindow(item.occurredAt, value.window.start_date, value.window.end_date, value.generated_at) ||
      (item.errorCategory === null) !== (item.errorCodeStatus === "not_applicable") ||
      (input.filters.integrationKey !== "all" && item.integrationKey !== input.filters.integrationKey) ||
      (input.filters.correlationId !== null && item.correlationId !== input.filters.correlationId)
    ) ||
    value.audit_matching_total < auditEvents.length ||
    value.audit_events_truncated !== (value.audit_matching_total > auditEvents.length) ||
    new Set(auditEvents.map((item) => item.auditEventId)).size !== auditEvents.length ||
    !chronological(auditEvents) || auditEvents.some((event) =>
      !withinWindow(event.occurredAt, value.window.start_date, value.window.end_date, value.generated_at) ||
      (event.recordId?.kind === "uuid" && !uuid.safeParse(event.recordId.value).success) ||
      (event.recordId?.kind === "number" && !/^(0|[1-9]\d{0,18})$/u.test(event.recordId.value)) ||
      (input.filters.auditAction !== "all" && event.action !== input.filters.auditAction) ||
      (input.filters.resourceCategory !== "all" &&
        event.resourceCategory !== input.filters.resourceCategory) ||
      (input.filters.actorUserId !== null && event.actorUserId !== input.filters.actorUserId) ||
      (input.filters.correlationId !== null && event.requestId !== input.filters.correlationId &&
        event.idempotencyKey !== input.filters.correlationId)
    )
  ) invalid();

  return {
    snapshotId: row.data.snapshot_id,
    snapshotHash: row.data.snapshot_hash,
    organizationId: value.organization_id,
    branchId: value.branch_id,
    generatedAt: value.generated_at,
    staleAfter: value.stale_after,
    window: { startDate: value.window.start_date, endDate: value.window.end_date,
      timeZone: value.window.time_zone },
    filters: {
      startDate: value.filters.start_date, endDate: value.filters.end_date,
      integrationKey: value.filters.integration_key, activityState: value.filters.activity_state,
      auditAction: value.filters.audit_action, resourceCategory: value.filters.resource_category,
      actorUserId: value.filters.actor_user_id, correlationId: value.filters.correlation_id,
    },
    inventory,
    inventoryMatchingTotal: value.inventory_matching_total,
    signals,
    signalMatchingTotal: value.signal_matching_total,
    signalsTruncated: value.signals_truncated,
    auditEvents,
    auditMatchingTotal: value.audit_matching_total,
    auditEventsTruncated: value.audit_events_truncated,
    options: {
      integrationKeys: value.options.integration_keys,
      activityStates: value.options.activity_states,
      auditActions: value.options.audit_actions,
      resourceCategories: value.options.resource_categories,
    },
    bounds: {
      maxDateWindowDays: value.bounds.max_date_window_days,
      maxSignalRows: value.bounds.max_signal_rows,
      maxAuditRows: value.bounds.max_audit_rows,
      maxSnapshotBytes: value.bounds.max_snapshot_bytes,
    },
    accessRequirements: {
      permission: value.access_requirements.permission,
      employeeAal2Required: value.access_requirements.employee_aal2_required,
      recentSameSessionAal2Required: value.access_requirements.recent_same_session_aal2_required,
      recentMaximumAgeMinutes: value.access_requirements.recent_maximum_age_minutes,
    },
    capabilities: {
      integrationRegistryStatus: value.capabilities.integration_registry_status,
      providerRegionalComplianceStatus: value.capabilities.provider_regional_compliance_status,
      ownerAssignmentStatus: value.capabilities.owner_assignment_status,
      retryCommandsStatus: value.capabilities.retry_commands_status,
      deactivationCommandsStatus: value.capabilities.deactivation_commands_status,
      reconciliationCommandsStatus: value.capabilities.reconciliation_commands_status,
      payloadInspectionStatus: value.capabilities.payload_inspection_status,
      mutationStatus: value.capabilities.mutation_status,
    },
    consistencyStatus: value.consistency_status,
    demo: false,
  };
}
