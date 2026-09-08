import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import { BEHAVIOR_EVENT_STATES, BEHAVIOR_FIELD_STATES,
  type BehaviorEventFields, type BehaviorEventMutationInput, type BehaviorEventReceipt } from "./types";

export const BEHAVIOR_EVENT_MUTATION_MAX_BYTES = 48 * 1024;
const uuid = z.uuid().transform((value) => value.toLowerCase());
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const timestamp = z.string().refine((value) => isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)))
  .transform((value) => new Date(value).toISOString());
const text = (maximum: number, minimum = 1) => z.string().trim().min(minimum).max(maximum)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const triState = z.object({ state: z.enum(BEHAVIOR_FIELD_STATES), text: text(4_000).nullable() }).strict()
  .refine((value) => value.state === "recorded" ? value.text !== null : value.text === null);
const fields = { client_id: uuid, occurred_at: timestamp, event_type: text(120),
  antecedent: triState, behavior: triState, intervention: triState, outcome: triState };

const save = z.object({ action: z.literal("save_event"), mode: z.enum(["create", "revise"]),
  event_key: uuid.nullable(), previous_version_id: uuid.nullable(),
  expected_version: z.number().int().min(0).max(1_000_000), expected_content_hash: sha256.nullable(),
  revision_reason: text(1_000), ...fields }).strict();
const finalize = z.object({ action: z.literal("finalize_event"), decision: z.enum(["sign", "void"]),
  client_id: uuid, event_key: uuid, previous_version_id: uuid,
  expected_version: z.number().int().positive().max(1_000_000), expected_content_hash: sha256,
  reason: text(1_000, 8).nullable() }).strict();
const correct = z.object({ action: z.literal("correct_event"), event_key: uuid,
  previous_version_id: uuid, expected_version: z.number().int().positive().max(1_000_000),
  expected_content_hash: sha256, reason: text(1_000, 8), ...fields }).strict();
const receipt = z.object({ operation_id: uuid,
  action: z.enum(["save_event", "finalize_event", "correct_event"]),
  decision: z.enum(["sign", "void"]).nullable(), event_key: uuid, version_id: uuid,
  version: z.number().int().positive().max(1_000_000), event_state: z.enum(BEHAVIOR_EVENT_STATES),
  content_hash: sha256, committed_at: timestamp, replayed: z.boolean() }).strict();

function invalid(message: string): never {
  throw new IntegrationError("INVALID_BEHAVIOR_EVENT_OPERATION", message, 400);
}

function field(value: z.output<typeof triState>) {
  return { state: value.state, text: value.text };
}

function mappedFields(value: z.output<typeof save> | z.output<typeof correct>): BehaviorEventFields {
  return { clientId: value.client_id, occurredAt: value.occurred_at, eventType: value.event_type,
    antecedent: field(value.antecedent), behavior: field(value.behavior),
    intervention: field(value.intervention), outcome: field(value.outcome) };
}

export function parseBehaviorEventMutation(value: unknown, idempotencyHeader: string | null): BehaviorEventMutationInput {
  const key = uuid.safeParse(idempotencyHeader);
  if (!key.success) invalid("行為事件冪等鍵無效。");
  const action = z.object({ action: z.string() }).passthrough().safeParse(value);
  if (!action.success) invalid("行為事件操作內容無效。");
  if (action.data.action === "save_event") {
    const parsed = save.safeParse(value);
    if (!parsed.success) invalid("個案、發生時間、事件類型或四個人工紀錄欄位無效。");
    const row = parsed.data;
    if ((row.mode === "create" && (row.event_key !== null || row.previous_version_id !== null ||
      row.expected_version !== 0 || row.expected_content_hash !== null)) ||
      (row.mode === "revise" && (row.event_key === null || row.previous_version_id === null ||
        row.expected_version < 1 || row.expected_content_hash === null))) invalid("事件版本基準不一致。");
    return { ...mappedFields(row), action: row.action, mode: row.mode, eventKey: row.event_key,
      previousVersionId: row.previous_version_id, expectedVersion: row.expected_version,
      expectedContentHash: row.expected_content_hash, revisionReason: row.revision_reason,
      idempotencyKey: key.data };
  }
  if (action.data.action === "finalize_event") {
    const parsed = finalize.safeParse(value);
    if (!parsed.success || (parsed.data.decision === "sign" && parsed.data.reason !== null) ||
      (parsed.data.decision === "void" && parsed.data.reason === null)) invalid("簽署或作廢內容無效。");
    return { action: parsed.data.action, decision: parsed.data.decision, clientId: parsed.data.client_id,
      eventKey: parsed.data.event_key, previousVersionId: parsed.data.previous_version_id,
      expectedVersion: parsed.data.expected_version, expectedContentHash: parsed.data.expected_content_hash,
      reason: parsed.data.reason, idempotencyKey: key.data };
  }
  if (action.data.action === "correct_event") {
    const parsed = correct.safeParse(value);
    if (!parsed.success) invalid("更正版欄位、理由或版本基準無效。");
    return { ...mappedFields(parsed.data), action: parsed.data.action, eventKey: parsed.data.event_key,
      previousVersionId: parsed.data.previous_version_id, expectedVersion: parsed.data.expected_version,
      expectedContentHash: parsed.data.expected_content_hash, reason: parsed.data.reason,
      idempotencyKey: key.data };
  }
  invalid("不支援的行為事件操作。");
}

export function behaviorEventPayload(input: BehaviorEventMutationInput) {
  const base = input.action === "finalize_event" ? { decision: input.decision, client_id: input.clientId,
    event_key: input.eventKey, previous_version_id: input.previousVersionId,
    expected_version: input.expectedVersion, expected_content_hash: input.expectedContentHash,
    reason: input.reason } : { client_id: input.clientId, event_key: input.action === "save_event" ? input.eventKey : input.eventKey,
    previous_version_id: input.previousVersionId, expected_version: input.expectedVersion,
    expected_content_hash: input.expectedContentHash, occurred_at: input.occurredAt,
    event_type: input.eventType, antecedent: input.antecedent, behavior: input.behavior,
    intervention: input.intervention, outcome: input.outcome,
    reason: input.action === "correct_event" ? input.reason : input.revisionReason };
  return input.action === "save_event" ? { ...base, mode: input.mode } : base;
}

export function parseBehaviorEventReceipt(value: unknown, input: BehaviorEventMutationInput): BehaviorEventReceipt {
  const parsed = receipt.safeParse(value);
  if (!parsed.success) throw new IntegrationError("BEHAVIOR_EVENT_RECEIPT_INVALID",
    "行為事件回執不完整；請保留相同操作鍵重新核對。", 502);
  const row = parsed.data;
  const expectedState = input.action === "save_event" ? "draft" :
    input.action === "correct_event" ? "corrected" : input.decision === "void" ? "voided" : "signed";
  const expectedDecision = input.action === "finalize_event" ? input.decision : null;
  if (row.action !== input.action || row.decision !== expectedDecision || row.event_state !== expectedState ||
    row.version !== input.expectedVersion + 1 || ("eventKey" in input && input.eventKey !== null && row.event_key !== input.eventKey)) {
    throw new IntegrationError("BEHAVIOR_EVENT_RECEIPT_INVALID",
      "行為事件回執與送出內容不一致；請重新載入。", 502);
  }
  return { operationId: row.operation_id, action: row.action, decision: row.decision,
    eventKey: row.event_key, versionId: row.version_id, version: row.version,
    eventState: row.event_state, contentHash: row.content_hash, committedAt: row.committed_at,
    replayed: row.replayed, persisted: true, demo: false };
}
