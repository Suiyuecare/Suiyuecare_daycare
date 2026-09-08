import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  REASSURANCE_CALENDAR_CATEGORIES,
  REASSURANCE_CALENDAR_STATUSES,
  type ReassuranceCalendarMutationInput,
  type ReassuranceCalendarOperationResult,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const single = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const narrative = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const chain = z.object({
  eventKey: uuid,
  previousVersionId: uuid,
  expectedVersion: z.number().int().positive().safe(),
});
const eventFields = z.object({
  category: z.enum(REASSURANCE_CALENDAR_CATEGORIES),
  title: single(200),
  summary: narrative(2000),
  startsAt: timestamp,
  endsAt: timestamp,
  location: single(200),
  audienceKind: z.enum(["all_branch_clients", "selected_clients"]),
  targetClientIds: z.array(uuid).max(200),
  responsibleUserId: uuid,
});
const createSchema = eventFields.extend({ action: z.literal("create") }).strict();
const reviseSchema = chain.extend(eventFields.shape).extend({
  action: z.literal("revise"), reason: narrative(500).min(2),
}).strict();
const cancelSchema = chain.extend({
  action: z.literal("cancel"), reason: narrative(500).min(2),
}).strict();

const count = z.union([
  z.number().int().positive().safe(),
  z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().positive().safe()),
]);
const receiptSchema = z.object({
  operation_id: uuid,
  operation_kind: z.enum(["create", "revise", "cancel"]),
  event_key: uuid,
  version_id: uuid,
  event_version: count,
  previous_version_id: uuid.nullable(),
  record_kind: z.enum(["original", "revision", "cancellation"]),
  event_status: z.enum(REASSURANCE_CALENDAR_STATUSES),
  event_category: z.enum(REASSURANCE_CALENDAR_CATEGORIES),
  audience_count: count,
  publication_state: z.literal("published"),
  signature_status: z.literal("not_configured"),
  notification_status: z.literal("not_configured"),
  notification_delivery: z.literal("none_not_sent"),
  committed_at: timestamp,
  replayed: z.boolean(),
}).strict();
const successSchema = z.object({
  requestId: uuid, status: z.literal("ok"), errors: z.tuple([]),
  data: z.object({
    operationId: uuid,
    operationKind: z.enum(["create", "revise", "cancel"]),
    eventKey: uuid, versionId: uuid, eventVersion: count,
    previousVersionId: uuid.nullable(),
    recordKind: z.enum(["original", "revision", "cancellation"]),
    eventStatus: z.enum(REASSURANCE_CALENDAR_STATUSES),
    eventCategory: z.enum(REASSURANCE_CALENDAR_CATEGORIES),
    audienceCount: count, publicationState: z.literal("published"),
    signatureStatus: z.literal("not_configured"),
    notificationStatus: z.literal("not_configured"),
    notificationDelivery: z.literal("none_not_sent"),
    committedAt: timestamp, replayed: z.boolean(),
    persisted: z.literal(true), demo: z.literal(false),
  }).strict(),
}).strict();
const errorSchema = z.object({
  requestId: uuid, status: z.literal("error"), data: z.null(),
  errors: z.array(z.object({
    code: z.string().min(1).max(120), message: z.string().min(1).max(500),
    field: z.string().min(1).max(120).optional(),
  }).strict()).min(1).max(10),
}).strict();

function invalid(message: string, field?: string): never {
  throw new IntegrationError("INVALID_REASSURANCE_CALENDAR_OPERATION", message, 400, field);
}

function parseKey(value: string | null) {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) invalid("請提供有效的 UUID 冪等鍵。", "idempotency-key");
  return parsed.data;
}

export function parseReassuranceCalendarMutation(
  body: Record<string, unknown>,
  key: string | null,
): ReassuranceCalendarMutationInput {
  const schema = body.action === "create" ? createSchema
    : body.action === "revise" ? reviseSchema
      : body.action === "cancel" ? cancelSchema : null;
  if (!schema) invalid("不支援的行事曆操作。", "action");
  const parsed = schema.safeParse(body);
  if (!parsed.success) invalid("行程欄位、版本、時間或理由未通過驗證。");
  const data = parsed.data;
  const targetClientIds = "targetClientIds" in data
    ? [...data.targetClientIds].sort() : [];
  if (new Set(targetClientIds).size !== targetClientIds.length ||
      ("startsAt" in data && data.endsAt <= data.startsAt) ||
      ("audienceKind" in data && data.audienceKind === "all_branch_clients" && targetClientIds.length !== 0) ||
      ("audienceKind" in data && data.audienceKind === "selected_clients" && targetClientIds.length === 0)) {
    invalid("行程時間或對象範圍無效。");
  }
  return {
    action: data.action,
    eventKey: "eventKey" in data ? data.eventKey : null,
    previousVersionId: "previousVersionId" in data ? data.previousVersionId : null,
    expectedVersion: "expectedVersion" in data ? data.expectedVersion : null,
    category: "category" in data ? data.category : null,
    title: "title" in data ? data.title : null,
    summary: "summary" in data ? data.summary : null,
    startsAt: "startsAt" in data ? data.startsAt : null,
    endsAt: "endsAt" in data ? data.endsAt : null,
    location: "location" in data ? data.location : null,
    audienceKind: "audienceKind" in data ? data.audienceKind : null,
    targetClientIds,
    responsibleUserId: "responsibleUserId" in data ? data.responsibleUserId : null,
    reason: "reason" in data ? data.reason : null,
    idempotencyKey: parseKey(key),
  };
}

export function parseReassuranceCalendarDatabaseReceipt(value: unknown) {
  const parsed = receiptSchema.safeParse(value);
  if (!parsed.success) throw new IntegrationError(
    "REASSURANCE_CALENDAR_RECEIPT_INVALID",
    "資料庫完成憑證不完整；畫面不會視為成功。", 502,
  );
  return parsed.data;
}

export function correlateReassuranceCalendarReceipt(
  receipt: z.output<typeof receiptSchema>, input: ReassuranceCalendarMutationInput,
) {
  const expectedKind = input.action === "create" ? "original"
    : input.action === "revise" ? "revision" : "cancellation";
  const expectedStatus = input.action === "cancel" ? "cancelled" : "scheduled";
  if (receipt.operation_kind !== input.action || receipt.record_kind !== expectedKind ||
      receipt.event_status !== expectedStatus ||
      (input.eventKey !== null && receipt.event_key !== input.eventKey) ||
      (input.action === "create" && (receipt.event_version !== 1 || receipt.previous_version_id !== null)) ||
      (input.action !== "create" && (
        receipt.event_version !== input.expectedVersion! + 1 ||
        receipt.previous_version_id !== input.previousVersionId
      )) ||
      (input.category !== null && receipt.event_category !== input.category) ||
      (input.audienceKind === "selected_clients" && receipt.audience_count !== input.targetClientIds.length) ||
      (input.audienceKind === "all_branch_clients" && receipt.audience_count !== 1)) {
    throw new IntegrationError(
      "REASSURANCE_CALENDAR_RECEIPT_INVALID",
      "資料庫完成憑證與本次行事曆請求不一致；畫面不會視為成功。", 502,
    );
  }
  return receipt;
}

export function parseReassuranceCalendarApiSuccess(
  value: unknown, input: ReassuranceCalendarMutationInput,
): { requestId: string; status: "ok"; errors: []; data: ReassuranceCalendarOperationResult } {
  const parsed = successSchema.safeParse(value);
  if (!parsed.success) throw new Error("INVALID_REASSURANCE_CALENDAR_SUCCESS");
  correlateReassuranceCalendarReceipt({
    operation_id: parsed.data.data.operationId,
    operation_kind: parsed.data.data.operationKind,
    event_key: parsed.data.data.eventKey,
    version_id: parsed.data.data.versionId,
    event_version: parsed.data.data.eventVersion,
    previous_version_id: parsed.data.data.previousVersionId,
    record_kind: parsed.data.data.recordKind,
    event_status: parsed.data.data.eventStatus,
    event_category: parsed.data.data.eventCategory,
    audience_count: parsed.data.data.audienceCount,
    publication_state: parsed.data.data.publicationState,
    signature_status: parsed.data.data.signatureStatus,
    notification_status: parsed.data.data.notificationStatus,
    notification_delivery: parsed.data.data.notificationDelivery,
    committed_at: parsed.data.data.committedAt,
    replayed: parsed.data.data.replayed,
  }, input);
  return parsed.data;
}

export function parseReassuranceCalendarApiError(value: unknown) {
  const parsed = errorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
