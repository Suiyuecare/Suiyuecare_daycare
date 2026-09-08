import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { WEIGHT_ALERT_STATUSES, type WeightManagementItem, type WeightManagementSnapshot } from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const timestamp = z.string().refine((value) => isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value))).transform((value) => new Date(value).toISOString());
const count = z.union([z.number().int().nonnegative().safe(), z.string().regex(/^\d+$/u).transform(Number)]).pipe(z.number().int().nonnegative().safe());
const integer = z.union([z.number().int().safe(), z.string().regex(/^-?\d+$/u).transform(Number)]).pipe(z.number().int().safe());
function normalizeDecimal(value: string | number, maxIntegerDigits: number) {
  const source = typeof value === "number" ? String(value) : value;
  if (!/^-?\d+(?:\.\d{1,2})?$/u.test(source) || !Number.isFinite(Number(source))) throw new Error("INVALID_DECIMAL");
  const negative = source.startsWith("-");
  const unsigned = negative ? source.slice(1) : source;
  const [whole, fraction = ""] = unsigned.split(".");
  if (whole.length > maxIntegerDigits) throw new Error("INVALID_DECIMAL");
  const normalized = `${whole}.${fraction.padEnd(2, "0")}`;
  return negative && normalized !== "0.00" ? `-${normalized}` : normalized;
}

const fixedDecimal = (maxIntegerDigits: number) => z.union([z.string(), z.number()]).transform((value) => normalizeDecimal(value, maxIntegerDigits));
const weightDecimal = fixedDecimal(6);
const deltaKgDecimal = fixedDecimal(7);
const deltaPercentDecimal = fixedDecimal(16);
const nullableTimestamp = timestamp.nullable();
const nullableUuid = uuid.nullable();

const itemSchema = z.object({
  client_id: uuid,
  client_display_name: z.string().trim().min(1).max(120),
  client_status: z.string().trim().min(1).max(40),
  current_state: z.enum(["provided", "missing"]),
  current_observation_id: nullableUuid,
  current_original_weight_kg: weightDecimal.nullable(),
  current_weight_kg: weightDecimal.nullable(),
  current_observed_at: nullableTimestamp,
  current_source: z.string().trim().min(1).max(120).nullable(),
  current_recorded_at: nullableTimestamp,
  recorder_display_name: z.string().trim().min(1).max(120).nullable(),
  current_correction_id: nullableUuid,
  current_correction_version: integer.pipe(z.number().int().nonnegative()),
  current_correction_kind: z.literal("replace").nullable(),
  current_correction_reason: z.string().trim().min(1).max(1000).nullable(),
  prior_state: z.enum(["provided", "missing", "not_applicable"]),
  prior_observation_id: nullableUuid,
  prior_weight_kg: weightDecimal.nullable(),
  prior_observed_at: nullableTimestamp,
  prior_correction_id: nullableUuid,
  prior_correction_version: integer.pipe(z.number().int().nonnegative()),
  delta_kg: deltaKgDecimal.nullable(),
  delta_percent: deltaPercentDecimal.nullable(),
  change_direction: z.enum(["gain", "loss", "no_change", "unavailable"]),
  alert_status: z.enum(WEIGHT_ALERT_STATUSES),
  rule_version_id: nullableUuid,
  rule_version_number: integer.pipe(z.number().int().positive()).nullable(),
  absolute_kg_threshold: weightDecimal.nullable(),
  percent_threshold: weightDecimal.nullable(),
  trigger_mode: z.enum(["either", "both"]).nullable(),
  acknowledgement_id: nullableUuid,
  acknowledgement_note: z.string().trim().min(1).max(1000).nullable(),
  acknowledged_at: nullableTimestamp,
  acknowledged_by: nullableUuid,
}).strict();

const clientOptionSchema = z.object({
  client_id: uuid,
  display_name: z.string().trim().min(1).max(120),
  client_status: z.string().trim().min(1).max(40),
  can_record: z.boolean(),
}).strict();

const sourceSchema = z.object({
  organization_id: uuid,
  branch_id: uuid,
  target_month: date,
  generated_at: timestamp,
  items: z.array(itemSchema).max(200),
  item_total: count,
  matching_total: count,
  measured_total: count,
  missing_total: count,
  alert_total: count,
  acknowledged_total: count,
  unacknowledged_total: count,
  items_truncated: z.boolean(),
  client_options: z.array(clientOptionSchema).max(200),
  client_option_total: count,
  client_options_truncated: z.boolean(),
  threshold_rule_status: z.enum(["published", "not_configured"]),
  threshold_rule_id: nullableUuid,
  threshold_version_number: integer.pipe(z.number().int().positive()).nullable(),
  absolute_kg_threshold: weightDecimal.nullable(),
  percent_threshold: weightDecimal.nullable(),
  trigger_mode: z.enum(["either", "both"]).nullable(),
}).strict();

export type WeightManagementSnapshotSourceRow = z.input<typeof sourceSchema>;

function cents(value: string) {
  const negative = value.startsWith("-");
  const [whole, fraction] = (negative ? value.slice(1) : value).split(".");
  const result = BigInt(whole) * BigInt(100) + BigInt(fraction);
  return negative ? -result : result;
}

function decimalFromCents(value: bigint) {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  const formatted = `${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, "0")}`;
  return negative ? `-${formatted}` : formatted;
}

function roundedPercent(deltaCents: bigint, priorCents: bigint) {
  const numerator = deltaCents * BigInt(10_000);
  const negative = numerator < BigInt(0);
  const absolute = negative ? -numerator : numerator;
  let quotient = absolute / priorCents;
  const remainder = absolute % priorCents;
  if (remainder * BigInt(2) >= priorCents) quotient += BigInt(1);
  return decimalFromCents(negative ? -quotient : quotient);
}

function invalid(): never {
  throw new Error("INVALID_WEIGHT_MANAGEMENT_PROJECTION");
}

function normalizeItem(row: z.output<typeof itemSchema>): WeightManagementItem {
  const currentProvided = row.current_state === "provided";
  const priorProvided = row.prior_state === "provided";
  if (currentProvided !== (row.current_observation_id !== null && row.current_original_weight_kg !== null && row.current_weight_kg !== null && row.current_observed_at !== null && row.current_source !== null && row.current_recorded_at !== null && row.recorder_display_name !== null)) invalid();
  if (priorProvided !== (row.prior_observation_id !== null && row.prior_weight_kg !== null && row.prior_observed_at !== null)) invalid();
  if ((row.current_correction_version === 0) !== (row.current_correction_id === null) || (row.current_correction_id !== null) !== (row.current_correction_kind === "replace" && row.current_correction_reason !== null)) invalid();
  if ((row.prior_correction_version === 0) !== (row.prior_correction_id === null)) invalid();

  const comparable = currentProvided && priorProvided && cents(row.prior_weight_kg!) > BigInt(0);
  if (comparable) {
    const expectedDelta = decimalFromCents(cents(row.current_weight_kg!) - cents(row.prior_weight_kg!));
    const expectedPercent = roundedPercent(cents(expectedDelta), cents(row.prior_weight_kg!));
    if (row.delta_kg !== expectedDelta || row.delta_percent !== expectedPercent) invalid();
    const expectedDirection = cents(expectedDelta) > BigInt(0) ? "gain" : cents(expectedDelta) < BigInt(0) ? "loss" : "no_change";
    if (row.change_direction !== expectedDirection) invalid();
  } else if (row.delta_kg !== null || row.delta_percent !== null || row.change_direction !== "unavailable") invalid();

  const ruleFields = [
    row.rule_version_id,
    row.rule_version_number,
    row.absolute_kg_threshold,
    row.percent_threshold,
    row.trigger_mode,
  ];
  const configured = ruleFields.every((value) => value !== null);
  const unconfigured = ruleFields.every((value) => value === null);
  if ((!configured && !unconfigured) || (row.alert_status === "not_configured") !== unconfigured) invalid();
  if (!configured && row.alert_status !== "not_configured") invalid();
  if (configured && !comparable && row.alert_status !== "not_comparable") invalid();
  if (configured && comparable) {
    const absoluteTriggered = cents(row.delta_kg!.replace("-", "")) >= cents(row.absolute_kg_threshold!);
    const percentTriggered = cents(row.delta_percent!.replace("-", "")) >= cents(row.percent_threshold!);
    const triggered = row.trigger_mode === "either" ? absoluteTriggered || percentTriggered : absoluteTriggered && percentTriggered;
    if (triggered !== ["acknowledged", "unacknowledged"].includes(row.alert_status)) invalid();
    if (!triggered && row.alert_status !== "within_threshold") invalid();
  }
  if ((row.alert_status === "acknowledged") !== (row.acknowledgement_id !== null && row.acknowledgement_note !== null && row.acknowledged_at !== null && row.acknowledged_by !== null)) invalid();
  if (row.alert_status !== "acknowledged" && (row.acknowledgement_id !== null || row.acknowledgement_note !== null || row.acknowledged_at !== null || row.acknowledged_by !== null)) invalid();

  return {
    clientId: row.client_id, clientDisplayName: row.client_display_name, clientStatus: row.client_status,
    currentState: row.current_state, currentObservationId: row.current_observation_id,
    currentOriginalWeightKg: row.current_original_weight_kg,
    currentWeightKg: row.current_weight_kg, currentObservedAt: row.current_observed_at,
    currentSource: row.current_source, currentRecordedAt: row.current_recorded_at,
    recorderDisplayName: row.recorder_display_name, currentCorrectionId: row.current_correction_id,
    currentCorrectionVersion: row.current_correction_version,
    currentCorrectionKind: row.current_correction_kind, currentCorrectionReason: row.current_correction_reason,
    priorState: row.prior_state, priorObservationId: row.prior_observation_id,
    priorWeightKg: row.prior_weight_kg, priorObservedAt: row.prior_observed_at,
    priorCorrectionId: row.prior_correction_id, priorCorrectionVersion: row.prior_correction_version,
    deltaKg: row.delta_kg, deltaPercent: row.delta_percent,
    changeDirection: row.change_direction, alertStatus: row.alert_status,
    ruleVersionId: row.rule_version_id, ruleVersionNumber: row.rule_version_number,
    absoluteKgThreshold: row.absolute_kg_threshold, percentThreshold: row.percent_threshold,
    triggerMode: row.trigger_mode, acknowledgementId: row.acknowledgement_id,
    acknowledgementNote: row.acknowledgement_note, acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: row.acknowledged_by,
  };
}

export function projectWeightManagementSnapshot(input: { row: unknown; expectedOrganizationId: string; expectedBranchId: string; expectedTargetMonth: string; demo: boolean }): WeightManagementSnapshot {
  const parsed = sourceSchema.safeParse(input.row);
  const organization = uuid.safeParse(input.expectedOrganizationId);
  const branch = uuid.safeParse(input.expectedBranchId);
  if (!parsed.success || !organization.success || !branch.success) invalid();
  const row = parsed.data;
  if (row.organization_id !== organization.data || row.branch_id !== branch.data || row.target_month !== input.expectedTargetMonth) invalid();
  const items = row.items.map(normalizeItem);
  if (new Set(items.map((item) => item.clientId)).size !== items.length || new Set(row.client_options.map((item) => item.client_id)).size !== row.client_options.length) invalid();
  if (row.item_total !== items.length || row.matching_total < row.item_total || row.items_truncated !== (row.matching_total > row.item_total) || row.measured_total + row.missing_total !== row.matching_total || row.alert_total !== row.acknowledged_total + row.unacknowledged_total || row.alert_total > row.measured_total || row.client_option_total < row.client_options.length || row.client_options_truncated !== (row.client_option_total > row.client_options.length)) invalid();
  if (!row.items_truncated && (items.filter((item) => item.currentState === "provided").length !== row.measured_total || items.filter((item) => item.currentState === "missing").length !== row.missing_total || items.filter((item) => item.alertStatus === "acknowledged").length !== row.acknowledged_total || items.filter((item) => item.alertStatus === "unacknowledged").length !== row.unacknowledged_total)) invalid();
  const headerRuleFields = [row.threshold_rule_id, row.threshold_version_number, row.absolute_kg_threshold, row.percent_threshold, row.trigger_mode];
  const headerConfigured = headerRuleFields.every((value) => value !== null);
  const headerUnconfigured = headerRuleFields.every((value) => value === null);
  if ((!headerConfigured && !headerUnconfigured) || (row.threshold_rule_status === "published") !== headerConfigured) invalid();
  for (const item of items) {
    const exactHeaderRule = item.ruleVersionId === row.threshold_rule_id &&
      item.ruleVersionNumber === row.threshold_version_number &&
      item.absoluteKgThreshold === row.absolute_kg_threshold &&
      item.percentThreshold === row.percent_threshold &&
      item.triggerMode === row.trigger_mode;
    if (!exactHeaderRule) invalid();
  }
  return {
    organizationId: row.organization_id, branchId: row.branch_id, targetMonth: row.target_month,
    generatedAt: row.generated_at, staleAfter: new Date(Date.parse(row.generated_at) + 60_000).toISOString(),
    items, itemTotal: row.item_total, matchingTotal: row.matching_total,
    metrics: { measured: row.measured_total, missing: row.missing_total, alerts: row.alert_total, acknowledged: row.acknowledged_total, unacknowledged: row.unacknowledged_total },
    itemsTruncated: row.items_truncated,
    clientOptions: row.client_options.map((item) => ({ clientId: item.client_id, displayName: item.display_name, clientStatus: item.client_status, canRecord: item.can_record })),
    clientOptionTotal: row.client_option_total, clientOptionsTruncated: row.client_options_truncated,
    thresholdRuleStatus: row.threshold_rule_status, thresholdRuleId: row.threshold_rule_id,
    thresholdVersionNumber: row.threshold_version_number, absoluteKgThreshold: row.absolute_kg_threshold,
    percentThreshold: row.percent_threshold, triggerMode: row.trigger_mode, demo: input.demo,
  };
}
