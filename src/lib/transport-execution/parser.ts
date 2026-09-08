import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import type {
  TransportExecutionMutationInput,
  TransportExecutionMutationReceipt,
} from "./types";
import {
  TRANSPORT_EXECUTION_EVENT_TYPES,
  TRANSPORT_EXECUTION_STATUSES,
} from "./types";

export const TRANSPORT_EXECUTION_MUTATION_MAX_BYTES = 24 * 1024;
const uuid = z.uuid().transform((value) => value.toLowerCase());
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const note = z.string().trim().min(8).max(1_000)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));

const mutation = z.object({
  action: z.literal("append_event"), event_type: z.enum(TRANSPORT_EXECUTION_EVENT_TYPES),
  plan_version_id: uuid, expected_trip_key: uuid,
  expected_plan_content_hash: sha256,
  expected_sequence: z.number().int().min(0).max(1_000),
  occurred_at: timestamp, client_id: uuid.nullable(), note: note.nullable(),
  resolves_pairing: z.boolean(),
}).strict();

const receipt = z.object({
  operation_id: uuid, event_id: uuid,
  event_type: z.enum(TRANSPORT_EXECUTION_EVENT_TYPES), plan_version_id: uuid,
  trip_key: uuid, client_id: uuid.nullable(), sequence: z.number().int().positive().max(1_001),
  status: z.enum(TRANSPORT_EXECUTION_STATUSES), actual_started_at: timestamp,
  actual_completed_at: timestamp.nullable(), exception_count: z.number().int().nonnegative(),
  unmatched_passenger_count: z.number().int().nonnegative(),
  late_seconds: z.number().int().nonnegative(), resolves_pairing: z.boolean(),
  event_content_hash: sha256, plan_content_hash: sha256,
  committed_at: timestamp, replayed: z.boolean(),
}).strict();

function invalid(message: string): never {
  throw new IntegrationError("INVALID_TRANSPORT_EXECUTION_OPERATION", message, 400);
}

export function parseTransportExecutionMutation(
  value: unknown,
  idempotencyHeader: string | null,
): TransportExecutionMutationInput {
  const key = uuid.safeParse(idempotencyHeader);
  if (!key.success) invalid("接送執行冪等鍵無效。");
  const parsed = mutation.safeParse(value);
  if (!parsed.success) invalid("接送事件內容不完整或含有未支援欄位。");
  const row = parsed.data;
  const passengerEvent = row.event_type === "passenger_boarded" ||
    row.event_type === "passenger_alighted";
  if ((row.event_type === "trip_started" && (row.client_id !== null || row.note !== null ||
      row.resolves_pairing)) ||
    (passengerEvent && (row.client_id === null || row.note !== null || row.resolves_pairing)) ||
    (row.event_type === "exception_recorded" && (row.note === null ||
      (row.resolves_pairing && row.client_id === null))) ||
    (row.event_type === "trip_completed" && (row.client_id !== null || row.resolves_pairing))) {
    invalid("事件類型與個案、理由或配對處置欄位不一致。");
  }
  return { action: "append_event", eventType: row.event_type,
    planVersionId: row.plan_version_id, expectedTripKey: row.expected_trip_key,
    expectedPlanContentHash: row.expected_plan_content_hash,
    expectedSequence: row.expected_sequence, occurredAt: row.occurred_at,
    clientId: row.client_id, note: row.note, resolvesPairing: row.resolves_pairing,
    idempotencyKey: key.data } as TransportExecutionMutationInput;
}

export function transportExecutionMutationPayload(input: TransportExecutionMutationInput) {
  return { event_type: input.eventType, plan_version_id: input.planVersionId,
    expected_trip_key: input.expectedTripKey,
    expected_plan_content_hash: input.expectedPlanContentHash,
    expected_sequence: input.expectedSequence, occurred_at: input.occurredAt,
    client_id: input.clientId, note: input.note,
    resolves_pairing: input.resolvesPairing };
}

export function parseTransportExecutionReceipt(
  value: unknown,
  input: TransportExecutionMutationInput,
): TransportExecutionMutationReceipt {
  const parsed = receipt.safeParse(value);
  if (!parsed.success) throw new IntegrationError(
    "TRANSPORT_EXECUTION_RECEIPT_INVALID",
    "接送執行回執不完整；請保留相同操作鍵重新核對。", 502,
  );
  const row = parsed.data;
  if (row.event_type !== input.eventType || row.plan_version_id !== input.planVersionId ||
    row.trip_key !== input.expectedTripKey || row.client_id !== input.clientId ||
    row.sequence !== input.expectedSequence + 1 ||
    row.plan_content_hash !== input.expectedPlanContentHash ||
    row.resolves_pairing !== input.resolvesPairing ||
    (input.eventType === "trip_started" && row.status !== "in_progress") ||
    (input.eventType === "trip_completed" &&
      (row.status !== "completed" || row.actual_completed_at === null)) ||
    (input.eventType !== "trip_completed" && row.actual_completed_at !== null)) {
    throw new IntegrationError(
      "TRANSPORT_EXECUTION_RECEIPT_INVALID",
      "接送執行回執與送出事件不一致；請重新載入。", 502,
    );
  }
  return { operationId: row.operation_id, eventId: row.event_id,
    eventType: row.event_type, planVersionId: row.plan_version_id,
    tripKey: row.trip_key, clientId: row.client_id, sequence: row.sequence,
    status: row.status, actualStartedAt: row.actual_started_at,
    actualCompletedAt: row.actual_completed_at, exceptionCount: row.exception_count,
    unmatchedPassengerCount: row.unmatched_passenger_count,
    lateSeconds: row.late_seconds, resolvesPairing: row.resolves_pairing,
    eventContentHash: row.event_content_hash, planContentHash: row.plan_content_hash,
    committedAt: row.committed_at, replayed: row.replayed,
    persisted: true, demo: false };
}
