import { createHash } from "node:crypto";

import { z } from "zod";

import {
  AUTHORIZED_CARE_PLAN_CHANGED_FIELDS,
  AUTHORIZED_CARE_PLAN_EFFECTIVE_STATES,
  AUTHORIZED_CARE_PLAN_STATUSES,
  type AuthorizedCarePlanContentEnvelope,
  type AuthorizedCarePlanFilters,
  type AuthorizedCarePlanProvenanceEnvelope,
  type AuthorizedCarePlanStream,
  type AuthorizedCarePlanVersion,
  type AuthorizedCarePlanViewSnapshot,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from "./types";

const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const timestamp = z.string().datetime({ offset: true });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(`${value}T12:00:00+08:00`);
  if (!Number.isFinite(parsed.getTime())) return false;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(parsed) === value;
});
const boundedText = (maximum: number) => z.string().min(1).max(maximum)
  .refine((value) => value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value));
const nullableBoundedText = (maximum: number) => boundedText(maximum).nullable();
const count = z.number().int().nonnegative().max(1_000_000);
const status = z.enum(AUTHORIZED_CARE_PLAN_STATUSES);
const terminalStatus = z.enum(["signed", "voided"]);
const effectiveState = z.enum(AUTHORIZED_CARE_PLAN_EFFECTIVE_STATES.slice(1));

const contentEnvelope = z.object({
  value_state: z.enum(["missing", "unknown"]),
  mapping_status: z.enum(["missing", "needs_mapping"]),
  needs_mapping: z.boolean(),
  canonical_json: z.string().max(65_536),
  content_hash: sha256,
  byte_size: count.max(65_536),
  node_count: count.max(1_024),
  top_level_field_count: count.max(200),
}).strict();

const provenanceEnvelope = z.object({
  value_state: z.enum(["missing", "recorded"]),
  canonical_json: z.string().max(16_384),
  content_hash: sha256,
  byte_size: count.max(16_384),
  node_count: count.max(1_024),
  top_level_field_count: count.max(200),
}).strict();

const difference = z.object({
  changed_fields: z.array(z.enum(AUTHORIZED_CARE_PLAN_CHANGED_FIELDS)).max(
    AUTHORIZED_CARE_PLAN_CHANGED_FIELDS.length,
  ),
  previous_plan_data_hash: sha256.nullable(),
  previous_service_limits_hash: sha256.nullable(),
  previous_source_provenance_hash: sha256.nullable(),
}).strict();

const version = z.object({
  version_id: uuid,
  plan_key: uuid,
  version: z.number().int().min(1).max(50),
  previous_version_id: uuid.nullable(),
  next_version_id: uuid.nullable(),
  status,
  effective_from: date,
  effective_to: date,
  source_system: boundedText(80),
  source_record_id: nullableBoundedText(240),
  source_provenance: provenanceEnvelope,
  authorized_on: date.nullable(),
  authorization_reference: nullableBoundedText(240),
  service_limits: contentEnvelope,
  plan_data: contentEnvelope,
  correction_reason: nullableBoundedText(1_000),
  created_at: timestamp,
  approved_at: timestamp.nullable(),
  signed_at: timestamp.nullable(),
  content_hash: sha256.nullable(),
  is_workflow_head: z.boolean(),
  is_published_head: z.boolean(),
  is_current_published: z.boolean(),
  differences_from_previous: difference,
}).strict();

const head = z.object({
  version_id: uuid,
  version: z.number().int().min(1).max(50),
  status,
}).strict();

const plan = z.object({
  plan_key: uuid,
  client_id: uuid,
  client_code: boundedText(80),
  display_name: boundedText(160),
  effective_state: effectiveState,
  client_current_stream_count: count,
  effective_conflict: z.boolean(),
  workflow_head: head,
  published_head: head.nullable(),
  current_published_id: uuid.nullable(),
  date_terminal_id: uuid.nullable(),
  date_terminal_status: terminalStatus.nullable(),
  display_version_id: uuid,
  display_authorized_on: date.nullable(),
  display_source_system: boundedText(80),
  display_source_record_id: nullableBoundedText(240),
  display_effective_from: date,
  display_effective_to: date,
  display_authorization_reference: nullableBoundedText(240),
  display_needs_mapping: z.boolean(),
  history_count: z.number().int().min(1).max(50),
  history: z.array(version).min(1).max(50),
}).strict();

const filters = z.object({
  as_of: date,
  client_id: uuid.nullable(),
  authorized_from: date.nullable(),
  authorized_to: date.nullable(),
  effective_state: z.enum(AUTHORIZED_CARE_PLAN_EFFECTIVE_STATES),
  source_system: boundedText(80).nullable(),
  page: z.number().int().min(1).max(200),
  page_size: z.number().int().min(1).max(25),
}).strict();

const payload = z.object({
  schema_version: z.literal("page55-authorized-care-plan-view.v1"),
  organization_id: uuid,
  branch_id: uuid,
  generated_at: timestamp,
  expires_at: timestamp,
  filters,
  metrics: z.object({
    matching_stream_total: count,
    page_stream_count: count.max(25),
    history_version_count: count.max(1_250),
    current_total: count,
    future_total: count,
    expired_total: count,
    voided_total: count,
    not_published_total: count,
    needs_mapping_total: count,
    effective_conflict_total: count,
  }).strict(),
  plans: z.array(plan).max(25),
  client_options: z.array(z.object({
    client_id: uuid,
    client_code: boundedText(80),
    display_name: boundedText(160),
  }).strict()).max(500),
  client_option_total: count,
  client_options_truncated: z.boolean(),
  source_options: z.array(z.object({
    source_system: boundedText(80),
    record_count: count,
  }).strict()).max(100),
  source_option_total: count,
  source_options_truncated: z.boolean(),
  bounds: z.object({
    max_page_size: z.literal(25),
    max_history_versions_per_stream: z.literal(50),
    max_content_bytes: z.literal(65_536),
    max_provenance_bytes: z.literal(16_384),
    max_json_nodes: z.literal(1_024),
    max_snapshot_bytes: z.literal(2_097_152),
  }).strict(),
  mapping_registry_status: z.literal("not_configured"),
  central_promotion_status: z.literal("not_configured"),
  official_limit_rules_status: z.literal("not_configured"),
  claim_eligibility_status: z.literal("not_asserted"),
  mutation_status: z.literal("read_only"),
}).strict();

const sourceRow = z.object({
  snapshot_id: uuid,
  snapshot_hash: sha256,
  generated_at: timestamp,
  expires_at: timestamp,
  snapshot_json: z.string().min(2).max(2_097_152),
}).strict();

export type AuthorizedCarePlanViewSourceRow = z.input<typeof sourceRow>;

function invalid(): never {
  throw new Error("INVALID_AUTHORIZED_CARE_PLAN_VIEW_SNAPSHOT");
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

type JsonStats = { nodes: number; maximumDepth: number };

function validateJsonValue(value: unknown, depth: number, stats: JsonStats): CanonicalJsonValue {
  stats.nodes += 1;
  stats.maximumDepth = Math.max(stats.maximumDepth, depth);
  if (stats.nodes > 1_024 || depth > 8) invalid();
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid();
    return value;
  }
  if (typeof value === "string") {
    if (value.length > 4_000) invalid();
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 200) invalid();
    return value.map((entry) => validateJsonValue(entry, depth + 1, stats));
  }
  if (typeof value !== "object") invalid();
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 200) invalid();
  const result: Record<string, CanonicalJsonValue> = Object.create(null) as Record<
    string,
    CanonicalJsonValue
  >;
  for (const [key, entry] of entries) {
    if (key.length < 1 || key.length > 160 || /[\u0000-\u001f\u007f]/u.test(key)) invalid();
    result[key] = validateJsonValue(entry, depth + 1, stats);
  }
  return result;
}

// Parsing is structural validation only. The parsed value is deliberately not
// exposed: canonicalJson remains the sole exact representation so large legacy
// integers and decimal lexemes are never silently treated as JavaScript numbers.
function validateCanonicalObjectStructure(
  canonicalJson: string,
  expectedHash: string,
  expectedBytes: number,
  expectedNodes: number,
  expectedFields: number,
): CanonicalJsonObject {
  if (Buffer.byteLength(canonicalJson, "utf8") !== expectedBytes || digest(canonicalJson) !== expectedHash) {
    invalid();
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(canonicalJson) as unknown;
  } catch {
    invalid();
  }
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) invalid();
  const stats = { nodes: 0, maximumDepth: 0 };
  const parsed = validateJsonValue(candidate, 0, stats);
  if (
    parsed === null || Array.isArray(parsed) || typeof parsed !== "object" ||
    stats.nodes !== expectedNodes || Object.keys(parsed).length !== expectedFields
  ) invalid();
  return parsed as CanonicalJsonObject;
}

function normalizeContent(value: z.output<typeof contentEnvelope>): AuthorizedCarePlanContentEnvelope {
  const structuralValue = validateCanonicalObjectStructure(
    value.canonical_json,
    value.content_hash,
    value.byte_size,
    value.node_count,
    value.top_level_field_count,
  );
  const missing = Object.keys(structuralValue).length === 0;
  if (
    missing !== (value.value_state === "missing") ||
    missing !== (value.mapping_status === "missing") ||
    value.needs_mapping === missing
  ) invalid();
  return {
    valueState: value.value_state,
    mappingStatus: value.mapping_status,
    needsMapping: value.needs_mapping,
    canonicalJson: value.canonical_json,
    contentHash: value.content_hash,
    byteSize: value.byte_size,
    nodeCount: value.node_count,
    topLevelFieldCount: value.top_level_field_count,
  };
}

function normalizeProvenance(
  value: z.output<typeof provenanceEnvelope>,
): AuthorizedCarePlanProvenanceEnvelope {
  const structuralValue = validateCanonicalObjectStructure(
    value.canonical_json,
    value.content_hash,
    value.byte_size,
    value.node_count,
    value.top_level_field_count,
  );
  const missing = Object.keys(structuralValue).length === 0;
  if (missing !== (value.value_state === "missing")) invalid();
  return {
    valueState: value.value_state,
    canonicalJson: value.canonical_json,
    contentHash: value.content_hash,
    byteSize: value.byte_size,
    nodeCount: value.node_count,
    topLevelFieldCount: value.top_level_field_count,
  };
}

function normalizeVersion(value: z.output<typeof version>): AuthorizedCarePlanVersion {
  const changedFields = value.differences_from_previous.changed_fields;
  if (new Set(changedFields).size !== changedFields.length) invalid();
  if (value.effective_from > value.effective_to) invalid();
  if (value.authorized_on !== null && value.authorized_on > value.effective_to) invalid();
  if (
    value.status !== "draft" &&
    (value.authorized_on === null || value.authorization_reference === null)
  ) invalid();
  if (
    (value.status === "signed" || value.status === "voided") !== (value.content_hash !== null)
  ) invalid();
  return {
    versionId: value.version_id,
    planKey: value.plan_key,
    version: value.version,
    previousVersionId: value.previous_version_id,
    nextVersionId: value.next_version_id,
    status: value.status,
    effectiveFrom: value.effective_from,
    effectiveTo: value.effective_to,
    sourceSystem: value.source_system,
    sourceRecordId: value.source_record_id,
    sourceProvenance: normalizeProvenance(value.source_provenance),
    authorizedOn: value.authorized_on,
    authorizationReference: value.authorization_reference,
    serviceLimits: normalizeContent(value.service_limits),
    planData: normalizeContent(value.plan_data),
    correctionReason: value.correction_reason,
    createdAt: value.created_at,
    approvedAt: value.approved_at,
    signedAt: value.signed_at,
    contentHash: value.content_hash,
    isWorkflowHead: value.is_workflow_head,
    isPublishedHead: value.is_published_head,
    isCurrentPublished: value.is_current_published,
    differencesFromPrevious: {
      changedFields,
      previousPlanDataHash: value.differences_from_previous.previous_plan_data_hash,
      previousServiceLimitsHash: value.differences_from_previous.previous_service_limits_hash,
      previousSourceProvenanceHash:
        value.differences_from_previous.previous_source_provenance_hash,
    },
  };
}

function calculateEffectiveState(history: readonly AuthorizedCarePlanVersion[], asOf: string) {
  const terminal = history.filter((entry) =>
    (entry.status === "signed" || entry.status === "voided") &&
    entry.effectiveFrom <= asOf && entry.effectiveTo >= asOf,
  ).sort((left, right) => right.version - left.version)[0] ?? null;
  if (terminal?.status === "signed") return { state: "current" as const, terminal };
  if (terminal?.status === "voided") return { state: "voided" as const, terminal };
  if (history.some((entry) => entry.status === "signed" && entry.effectiveFrom > asOf)) {
    return { state: "future" as const, terminal: null };
  }
  if (history.some((entry) => entry.status === "signed" && entry.effectiveTo < asOf)) {
    return { state: "expired" as const, terminal: null };
  }
  if (history.some((entry) => entry.status === "signed" || entry.status === "voided")) {
    return { state: "voided" as const, terminal: null };
  }
  return { state: "not_published" as const, terminal: null };
}

function normalizePlan(
  value: z.output<typeof plan>,
  snapshotFilters: AuthorizedCarePlanFilters,
): AuthorizedCarePlanStream {
  const history = value.history.map(normalizeVersion);
  if (
    history.length !== value.history_count ||
    history.some((entry, index) => index > 0 && history[index - 1]!.version <= entry.version)
  ) invalid();
  const ascending = [...history].sort((left, right) => left.version - right.version);
  for (let index = 0; index < ascending.length; index += 1) {
    const current = ascending[index];
    const previous = ascending[index - 1] ?? null;
    const next = ascending[index + 1] ?? null;
    const expectedPreviousVersionId = previous?.versionId ?? null;
    const expectedNextVersionId = next?.versionId ?? null;
    if (
      current.planKey !== value.plan_key || current.version !== index + 1 ||
      current.previousVersionId !== expectedPreviousVersionId ||
      current.nextVersionId !== expectedNextVersionId
    ) invalid();
    if (index === 0) {
      if (
        current.differencesFromPrevious.changedFields.length !== 0 ||
        current.differencesFromPrevious.previousPlanDataHash !== null ||
        current.differencesFromPrevious.previousServiceLimitsHash !== null ||
        current.differencesFromPrevious.previousSourceProvenanceHash !== null
      ) invalid();
    } else {
      const expectedChangedFields = [
        current.status !== previous?.status ? "status" : null,
        current.effectiveFrom !== previous?.effectiveFrom ? "effective_from" : null,
        current.effectiveTo !== previous?.effectiveTo ? "effective_to" : null,
        current.sourceSystem !== previous?.sourceSystem ? "source_system" : null,
        current.sourceRecordId !== previous?.sourceRecordId ? "source_record_id" : null,
        current.sourceProvenance.contentHash !== previous?.sourceProvenance.contentHash
          ? "source_provenance" : null,
        current.authorizedOn !== previous?.authorizedOn ? "authorized_on" : null,
        current.authorizationReference !== previous?.authorizationReference
          ? "authorization_reference" : null,
        current.serviceLimits.contentHash !== previous?.serviceLimits.contentHash
          ? "service_limits" : null,
        current.planData.contentHash !== previous?.planData.contentHash ? "plan_data" : null,
        current.correctionReason !== previous?.correctionReason ? "correction_reason" : null,
        current.approvedAt !== previous?.approvedAt ? "approved_at" : null,
        current.signedAt !== previous?.signedAt ? "signed_at" : null,
        current.contentHash !== previous?.contentHash ? "content_hash" : null,
      ].filter((field): field is (typeof AUTHORIZED_CARE_PLAN_CHANGED_FIELDS)[number] =>
        field !== null);
      if (
        current.differencesFromPrevious.previousPlanDataHash !== previous?.planData.contentHash ||
        current.differencesFromPrevious.previousServiceLimitsHash !==
          previous?.serviceLimits.contentHash ||
        current.differencesFromPrevious.previousSourceProvenanceHash !==
          previous?.sourceProvenance.contentHash ||
        expectedChangedFields.length !== current.differencesFromPrevious.changedFields.length ||
        expectedChangedFields.some((field, fieldIndex) =>
          current.differencesFromPrevious.changedFields[fieldIndex] !== field)
      ) invalid();
    }
  }
  const workflowHead = ascending.at(-1)!;
  const publishedHead = [...history].filter((entry) =>
    entry.status === "signed" || entry.status === "voided",
  ).sort((left, right) => right.version - left.version)[0] ?? null;
  const calculated = calculateEffectiveState(history, snapshotFilters.asOf);
  const display = publishedHead ?? workflowHead;
  const expectedDateTerminalId = calculated.terminal?.versionId ?? null;
  const expectedDateTerminalStatus = calculated.terminal?.status ?? null;
  if (
    value.workflow_head.version_id !== workflowHead.versionId ||
    value.workflow_head.version !== workflowHead.version ||
    value.workflow_head.status !== workflowHead.status ||
    (publishedHead === null) !== (value.published_head === null) ||
    (publishedHead !== null && (
      value.published_head?.version_id !== publishedHead.versionId ||
      value.published_head.version !== publishedHead.version ||
      value.published_head.status !== publishedHead.status
    )) ||
    value.effective_state !== calculated.state ||
    value.date_terminal_id !== expectedDateTerminalId ||
    value.date_terminal_status !== expectedDateTerminalStatus ||
    value.current_published_id !== (
      calculated.terminal?.status === "signed" ? calculated.terminal.versionId : null
    ) ||
    value.display_version_id !== display.versionId ||
    value.display_authorized_on !== display.authorizedOn ||
    value.display_source_system !== display.sourceSystem ||
    value.display_source_record_id !== display.sourceRecordId ||
    value.display_effective_from !== display.effectiveFrom ||
    value.display_effective_to !== display.effectiveTo ||
    value.display_authorization_reference !== display.authorizationReference ||
    value.display_needs_mapping !== (display.planData.needsMapping || display.serviceLimits.needsMapping) ||
    value.effective_conflict !== (value.client_current_stream_count > 1) ||
    history.filter((entry) => entry.isWorkflowHead).length !== 1 ||
    history.find((entry) => entry.isWorkflowHead)?.versionId !== workflowHead.versionId ||
    history.filter((entry) => entry.isPublishedHead).length !== (publishedHead ? 1 : 0) ||
    history.find((entry) => entry.isPublishedHead)?.versionId !== publishedHead?.versionId ||
    history.filter((entry) => entry.isCurrentPublished).length !==
      (calculated.terminal?.status === "signed" ? 1 : 0) ||
    history.find((entry) => entry.isCurrentPublished)?.versionId !==
      (calculated.terminal?.status === "signed" ? calculated.terminal.versionId : undefined)
  ) invalid();

  return {
    planKey: value.plan_key,
    clientId: value.client_id,
    clientCode: value.client_code,
    displayName: value.display_name,
    effectiveState: value.effective_state,
    clientCurrentStreamCount: value.client_current_stream_count,
    effectiveConflict: value.effective_conflict,
    workflowHead: {
      versionId: value.workflow_head.version_id,
      version: value.workflow_head.version,
      status: value.workflow_head.status,
    },
    publishedHead: value.published_head ? {
      versionId: value.published_head.version_id,
      version: value.published_head.version,
      status: value.published_head.status,
    } : null,
    currentPublishedId: value.current_published_id,
    dateTerminalId: value.date_terminal_id,
    dateTerminalStatus: value.date_terminal_status,
    displayVersionId: value.display_version_id,
    displayAuthorizedOn: value.display_authorized_on,
    displaySourceSystem: value.display_source_system,
    displaySourceRecordId: value.display_source_record_id,
    displayEffectiveFrom: value.display_effective_from,
    displayEffectiveTo: value.display_effective_to,
    displayAuthorizationReference: value.display_authorization_reference,
    displayNeedsMapping: value.display_needs_mapping,
    historyCount: value.history_count,
    history,
  };
}

function sameFilters(
  actual: z.output<typeof filters>,
  expected: AuthorizedCarePlanFilters,
) {
  return actual.as_of === expected.asOf && actual.client_id === expected.clientId &&
    actual.authorized_from === expected.authorizedFrom &&
    actual.authorized_to === expected.authorizedTo &&
    actual.effective_state === expected.effectiveState &&
    actual.source_system === expected.sourceSystem && actual.page === expected.page &&
    actual.page_size === expected.pageSize;
}

export function projectAuthorizedCarePlanViewSnapshot(input: {
  row: unknown;
  expectedOrganizationId: string;
  expectedBranchId: string;
  filters: AuthorizedCarePlanFilters;
  demo: boolean;
}): AuthorizedCarePlanViewSnapshot {
  const row = sourceRow.parse(input.row);
  if (
    Buffer.byteLength(row.snapshot_json, "utf8") > 2_097_152 ||
    digest(row.snapshot_json) !== row.snapshot_hash
  ) invalid();
  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(row.snapshot_json) as unknown;
  } catch {
    invalid();
  }
  const parsed = payload.parse(rawPayload);
  const generatedAt = new Date(row.generated_at).getTime();
  const expiresAt = new Date(row.expires_at).getTime();
  if (
    parsed.organization_id !== input.expectedOrganizationId ||
    parsed.branch_id !== input.expectedBranchId ||
    new Date(parsed.generated_at).getTime() !== generatedAt ||
    new Date(parsed.expires_at).getTime() !== expiresAt ||
    expiresAt - generatedAt !== 60_000 ||
    !sameFilters(parsed.filters, input.filters)
  ) invalid();

  const normalizedFilters: AuthorizedCarePlanFilters = {
    asOf: parsed.filters.as_of,
    clientId: parsed.filters.client_id,
    authorizedFrom: parsed.filters.authorized_from,
    authorizedTo: parsed.filters.authorized_to,
    effectiveState: parsed.filters.effective_state,
    sourceSystem: parsed.filters.source_system,
    page: parsed.filters.page,
    pageSize: parsed.filters.page_size,
  };
  const plans = parsed.plans.map((entry) => normalizePlan(entry, normalizedFilters));
  const allVersionIds = plans.flatMap((entry) => entry.history.map((version) => version.versionId));
  if (
    new Set(plans.map((entry) => entry.planKey)).size !== plans.length ||
    new Set(allVersionIds).size !== allVersionIds.length ||
    plans.some((entry, index) => index > 0 && (
      parsed.plans[index - 1]!.client_code > parsed.plans[index]!.client_code ||
      (
        parsed.plans[index - 1]!.client_code === parsed.plans[index]!.client_code &&
        `${parsed.plans[index - 1]!.client_id}:${parsed.plans[index - 1]!.plan_key}` >
          `${parsed.plans[index]!.client_id}:${parsed.plans[index]!.plan_key}`
      )
    )) ||
    parsed.metrics.page_stream_count !== plans.length ||
    parsed.metrics.history_version_count !== plans.reduce(
      (total, entry) => total + entry.historyCount,
      0,
    ) ||
    parsed.metrics.matching_stream_total < plans.length ||
    parsed.metrics.current_total + parsed.metrics.future_total +
      parsed.metrics.expired_total + parsed.metrics.voided_total +
      parsed.metrics.not_published_total !== parsed.metrics.matching_stream_total ||
    parsed.metrics.needs_mapping_total > parsed.metrics.matching_stream_total ||
    parsed.metrics.effective_conflict_total > parsed.metrics.matching_stream_total ||
    plans.length > normalizedFilters.pageSize
  ) invalid();

  const clientOptions = parsed.client_options.map((option) => ({
    clientId: option.client_id,
    clientCode: option.client_code,
    displayName: option.display_name,
  }));
  const sourceOptions = parsed.source_options.map((option) => ({
    sourceSystem: option.source_system,
    recordCount: option.record_count,
  }));
  if (
    new Set(clientOptions.map((entry) => entry.clientId)).size !== clientOptions.length ||
    new Set(sourceOptions.map((entry) => entry.sourceSystem)).size !== sourceOptions.length ||
    clientOptions.some((entry, index) => index > 0 && (
      clientOptions[index - 1]!.clientCode > entry.clientCode ||
      (
        clientOptions[index - 1]!.clientCode === entry.clientCode &&
        clientOptions[index - 1]!.clientId > entry.clientId
      )
    )) ||
    sourceOptions.some((entry, index) =>
      index > 0 && sourceOptions[index - 1]!.sourceSystem > entry.sourceSystem) ||
    parsed.client_option_total < clientOptions.length ||
    parsed.source_option_total < sourceOptions.length ||
    parsed.client_options_truncated !== (parsed.client_option_total > 500) ||
    parsed.source_options_truncated !== (parsed.source_option_total > 100)
  ) invalid();

  return {
    snapshotId: row.snapshot_id,
    snapshotHash: row.snapshot_hash,
    generatedAt: row.generated_at,
    expiresAt: row.expires_at,
    organizationId: parsed.organization_id,
    branchId: parsed.branch_id,
    filters: normalizedFilters,
    metrics: {
      matchingStreamTotal: parsed.metrics.matching_stream_total,
      pageStreamCount: parsed.metrics.page_stream_count,
      historyVersionCount: parsed.metrics.history_version_count,
      currentTotal: parsed.metrics.current_total,
      futureTotal: parsed.metrics.future_total,
      expiredTotal: parsed.metrics.expired_total,
      voidedTotal: parsed.metrics.voided_total,
      notPublishedTotal: parsed.metrics.not_published_total,
      needsMappingTotal: parsed.metrics.needs_mapping_total,
      effectiveConflictTotal: parsed.metrics.effective_conflict_total,
    },
    plans,
    clientOptions,
    clientOptionTotal: parsed.client_option_total,
    clientOptionsTruncated: parsed.client_options_truncated,
    sourceOptions,
    sourceOptionTotal: parsed.source_option_total,
    sourceOptionsTruncated: parsed.source_options_truncated,
    bounds: {
      maxPageSize: parsed.bounds.max_page_size,
      maxHistoryVersionsPerStream: parsed.bounds.max_history_versions_per_stream,
      maxContentBytes: parsed.bounds.max_content_bytes,
      maxProvenanceBytes: parsed.bounds.max_provenance_bytes,
      maxJsonNodes: parsed.bounds.max_json_nodes,
      maxSnapshotBytes: parsed.bounds.max_snapshot_bytes,
    },
    mappingRegistryStatus: parsed.mapping_registry_status,
    centralPromotionStatus: parsed.central_promotion_status,
    officialLimitRulesStatus: parsed.official_limit_rules_status,
    claimEligibilityStatus: parsed.claim_eligibility_status,
    mutationStatus: parsed.mutation_status,
    consistencyStatus: "single_database_statement_snapshot",
    demo: input.demo,
  };
}
