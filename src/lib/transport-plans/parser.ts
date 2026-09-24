import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import type {
  DecideTransportTripInput,
  SaveTransportTripInput,
  TransportPlanMutationInput,
  TransportPlanMutationReceipt,
} from "./types";
import { TRANSPORT_DIRECTIONS, TRANSPORT_PLAN_STATUSES } from "./types";

export const TRANSPORT_PLAN_MUTATION_MAX_BYTES = 96 * 1024;
const uuid = z.uuid().transform((value) => value.toLowerCase());
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const text = (maximum: number, minimum = 1) => z.string().trim().min(minimum).max(maximum)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const instant = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(instant.getTime()) && new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instant) === value;
});
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const code = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u);

const save = z.object({
  action: z.literal("save_trip"), mode: z.enum(["create", "revise"]),
  trip_key: uuid.nullable(), previous_version_id: uuid.nullable(),
  expected_version: z.number().int().min(0).max(1_000_000),
  expected_content_hash: sha256.nullable(), direction: z.enum(TRANSPORT_DIRECTIONS),
  service_date: calendarDate, starts_at: timestamp, ends_at: timestamp,
  vehicle_code: code, driver_membership_id: uuid,
  pickup_label: text(240), dropoff_label: text(240),
  passengers: z.array(z.object({
    client_id: uuid, pickup_label: text(240), dropoff_label: text(240),
  }).strict()).min(1).max(100),
  revision_reason: text(1_000),
}).strict();

const decide = z.object({
  action: z.literal("decide_trip"), decision: z.enum(["publish", "override", "reject"]),
  trip_version_id: uuid, expected_trip_key: uuid,
  expected_version: z.number().int().positive().max(1_000_000),
  expected_content_hash: sha256,
  expected_conflict_count: z.number().int().min(0).max(1_000),
  expected_rule_version_id: uuid, reason: text(1_000, 8),
}).strict();

const receipt = z.object({
  operation_id: uuid, action: z.enum(["save_trip", "decide_trip", "cancel_trip"]),
  decision: z.enum(["publish", "override", "reject"]).nullable(),
  trip_version_id: uuid, trip_key: uuid,
  version: z.number().int().positive().max(1_000_000),
  status: z.enum(TRANSPORT_PLAN_STATUSES), conflict_count: z.number().int().min(0).max(1_000),
  content_hash: sha256, rule_version_id: uuid, committed_at: timestamp,
  replayed: z.boolean(),
}).strict();

function invalid(message: string): never {
  throw new IntegrationError("INVALID_TRANSPORT_PLAN_OPERATION", message, 400);
}

export function parseTransportPlanMutation(
  value: unknown,
  idempotencyHeader: string | null,
): TransportPlanMutationInput {
  const key = uuid.safeParse(idempotencyHeader);
  if (!key.success) invalid("交通計畫冪等鍵無效。");
  const action = z.object({ action: z.string() }).passthrough().safeParse(value);
  if (!action.success) invalid("交通計畫操作內容無效。");
  if (action.data.action === "save_trip") {
    const parsed = save.safeParse(value);
    if (!parsed.success) invalid("趟次、車輛、駕駛、時間或乘員內容無效。");
    const row = parsed.data;
    if ((row.mode === "create" && (row.trip_key !== null ||
      row.previous_version_id !== null || row.expected_version !== 0 ||
      row.expected_content_hash !== null)) ||
      (row.mode === "revise" && (row.trip_key === null ||
        row.previous_version_id === null || row.expected_version < 1 ||
        row.expected_content_hash === null)) ||
      Date.parse(row.ends_at) <= Date.parse(row.starts_at) ||
      Date.parse(row.ends_at) - Date.parse(row.starts_at) > 8 * 60 * 60 * 1000 ||
      new Set(row.passengers.map(({ client_id }) => client_id)).size !== row.passengers.length) {
      invalid("趟次版本、時段或乘員集合不一致。");
    }
    return { action: row.action, mode: row.mode, tripKey: row.trip_key,
      previousVersionId: row.previous_version_id, expectedVersion: row.expected_version,
      expectedContentHash: row.expected_content_hash, direction: row.direction,
      serviceDate: row.service_date, startsAt: row.starts_at, endsAt: row.ends_at,
      vehicleCode: row.vehicle_code, driverMembershipId: row.driver_membership_id,
      pickupLabel: row.pickup_label, dropoffLabel: row.dropoff_label,
      passengers: row.passengers.map((item) => ({ clientId: item.client_id,
        pickupLabel: item.pickup_label, dropoffLabel: item.dropoff_label })),
      revisionReason: row.revision_reason, idempotencyKey: key.data } satisfies SaveTransportTripInput;
  }
  if (action.data.action === "decide_trip" || action.data.action === "cancel_trip") {
    const cancelling = action.data.action === "cancel_trip";
    const parsed = (cancelling ? decide.omit({ decision: true }).extend({ action: z.literal("cancel_trip") }) : decide).safeParse(value);
    if (!parsed.success) invalid("趟次審核內容無效。");
    const row = parsed.data;
    if (("decision" in row && row.decision === "publish" && row.expected_conflict_count !== 0) ||
      ("decision" in row && row.decision === "override" && row.expected_conflict_count === 0)) {
      invalid("發布方式與衝突數不一致。");
    }
    const common = {
      tripVersionId: row.trip_version_id, expectedTripKey: row.expected_trip_key,
      expectedVersion: row.expected_version, expectedContentHash: row.expected_content_hash,
      expectedConflictCount: row.expected_conflict_count,
      expectedRuleVersionId: row.expected_rule_version_id, reason: row.reason,
      idempotencyKey: key.data };
    if (row.action === "cancel_trip") return { ...common, action: "cancel_trip" };
    return { ...common, action: "decide_trip", decision: row.decision } satisfies DecideTransportTripInput;
  }
  invalid("不支援的交通計畫操作。");
}

export function transportPlanMutationPayload(input: TransportPlanMutationInput) {
  if (input.action === "save_trip") return {
    mode: input.mode, trip_key: input.tripKey,
    previous_version_id: input.previousVersionId, expected_version: input.expectedVersion,
    expected_content_hash: input.expectedContentHash, direction: input.direction,
    service_date: input.serviceDate, starts_at: input.startsAt, ends_at: input.endsAt,
    vehicle_code: input.vehicleCode, driver_membership_id: input.driverMembershipId,
    pickup_label: input.pickupLabel, dropoff_label: input.dropoffLabel,
    passengers: input.passengers.map((item) => ({ client_id: item.clientId,
      pickup_label: item.pickupLabel, dropoff_label: item.dropoffLabel })),
    revision_reason: input.revisionReason,
  };
  return { ...(input.action === "decide_trip" ? { decision: input.decision } : {}), trip_version_id: input.tripVersionId,
    expected_trip_key: input.expectedTripKey, expected_version: input.expectedVersion,
    expected_content_hash: input.expectedContentHash,
    expected_conflict_count: input.expectedConflictCount,
    expected_rule_version_id: input.expectedRuleVersionId, reason: input.reason };
}

export function parseTransportPlanReceipt(
  value: unknown,
  input: TransportPlanMutationInput,
): TransportPlanMutationReceipt {
  const parsed = receipt.safeParse(value);
  if (!parsed.success) throw new IntegrationError(
    "TRANSPORT_PLAN_RECEIPT_INVALID",
    "交通計畫回執不完整；請保留相同操作鍵重新核對。", 502,
  );
  const row = parsed.data;
  const saveMatches = input.action === "save_trip" && row.action === "save_trip" &&
    row.decision === null && row.version === input.expectedVersion + 1 &&
    (input.tripKey === null || row.trip_key === input.tripKey) &&
    (row.status === "draft_ready" || row.status === "draft_conflicted");
  const decisionMatches = input.action === "decide_trip" && row.action === "decide_trip" &&
    row.decision === input.decision && row.trip_version_id === input.tripVersionId &&
    row.trip_key === input.expectedTripKey && row.version === input.expectedVersion &&
    row.content_hash === input.expectedContentHash &&
    row.rule_version_id === input.expectedRuleVersionId &&
    row.conflict_count === input.expectedConflictCount &&
    row.status === (input.decision === "reject" ? "rejected" : "published");
  const cancelMatches = input.action === "cancel_trip" && row.action === "cancel_trip" &&
    row.decision === null && row.status === "cancelled" && row.trip_version_id === input.tripVersionId &&
    row.trip_key === input.expectedTripKey && row.version === input.expectedVersion &&
    row.content_hash === input.expectedContentHash && row.rule_version_id === input.expectedRuleVersionId &&
    row.conflict_count === input.expectedConflictCount;
  if (!saveMatches && !decisionMatches && !cancelMatches) throw new IntegrationError(
    "TRANSPORT_PLAN_RECEIPT_INVALID",
    "交通計畫回執與送出內容不一致；請重新載入。", 502,
  );
  return { operationId: row.operation_id, action: row.action, decision: row.decision,
    tripVersionId: row.trip_version_id, tripKey: row.trip_key,
    version: row.version, status: row.status, conflictCount: row.conflict_count,
    contentHash: row.content_hash, ruleVersionId: row.rule_version_id,
    committedAt: row.committed_at, replayed: row.replayed,
    persisted: true, demo: false };
}
