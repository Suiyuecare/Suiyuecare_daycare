import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import { ACTIVITY_STATUSES, type ActivityMutationInput, type ActivityOperationResult } from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const single = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u001F\u007F]/u.test(value));
const narrative = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value));
const chain = z.object({
  activityId: uuid, expectedScheduleVersionId: uuid,
  expectedScheduleVersion: z.number().int().positive().safe(),
  expectedStatusEventId: uuid, expectedStatusSequence: z.number().int().positive().safe(),
});
const schedule = z.object({
  activityType: single(120), title: single(200), searchSummary: narrative(1000),
  location: single(200), startsAt: timestamp, endsAt: timestamp,
  responsibleUserId: uuid, participantClientIds: z.array(uuid).max(200),
  capacity: z.number().int().min(1).max(500),
});
const createSchema = schedule.extend({ action: z.literal("create") }).strict();
const reviseSchema = chain.extend(schedule.shape).extend({
  action: z.literal("revise"), reason: narrative(1000),
}).strict();
const startSchema = chain.extend({ action: z.literal("start") }).strict();
const completeSchema = chain.extend({ action: z.literal("complete") }).strict();
const cancelSchema = chain.extend({ action: z.literal("cancel"), reason: narrative(1000) }).strict();

const count = z.union([z.number().int().safe(), z.string().regex(/^\d+$/u).transform(Number)])
  .pipe(z.number().int().positive().safe());
const resultSchema = z.object({
  operation_id: uuid, operation_kind: z.enum(["create", "revise", "transition", "cancel"]),
  activity_id: uuid, schedule_version_id: uuid, schedule_version: count,
  previous_schedule_version_id: uuid.nullable(), status_event_id: uuid,
  status_sequence: count, previous_status_event_id: uuid.nullable(),
  status: z.enum(ACTIVITY_STATUSES), responsible_user_id: uuid,
  participant_client_ids: z.array(uuid).max(200), committed_at: timestamp,
  replayed: z.boolean(),
}).strict();
const successSchema = z.object({
  requestId: uuid, status: z.literal("ok"), errors: z.tuple([]),
  data: z.object({
    operationId: uuid, operationKind: z.enum(["create", "revise", "transition", "cancel"]),
    activityId: uuid, scheduleVersionId: uuid, scheduleVersion: z.number().int().positive(),
    previousScheduleVersionId: uuid.nullable(), statusEventId: uuid,
    statusSequence: z.number().int().positive(), previousStatusEventId: uuid.nullable(),
    status: z.enum(ACTIVITY_STATUSES), responsibleUserId: uuid,
    participantClientIds: z.array(uuid).max(200), committedAt: timestamp,
    replayed: z.boolean(), persisted: z.literal(true), demo: z.literal(false),
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
  throw new IntegrationError("INVALID_ACTIVITY_OPERATION", message, 400, field);
}

function idempotency(value: string | null) {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) invalid("請提供有效的 UUID 冪等鍵。", "idempotency-key");
  return parsed.data;
}

export function parseActivityMutation(body: Record<string, unknown>, key: string | null): ActivityMutationInput {
  const schema = body.action === "create" ? createSchema : body.action === "revise" ? reviseSchema
    : body.action === "start" ? startSchema : body.action === "complete" ? completeSchema
      : body.action === "cancel" ? cancelSchema : null;
  if (!schema) invalid("不支援的活動操作。", "action");
  const parsed = schema.safeParse(body);
  if (!parsed.success) invalid("活動欄位、版本、時間或理由未通過驗證。");
  const data = parsed.data;
  const participantClientIds = "participantClientIds" in data
    ? [...data.participantClientIds].sort() : [];
  if (new Set(participantClientIds).size !== participantClientIds.length ||
      ("capacity" in data && participantClientIds.length > data.capacity) ||
      ("startsAt" in data && data.endsAt <= data.startsAt)) {
    invalid("參與者不可重複或超過容量，結束時間必須晚於開始時間。");
  }
  return {
    action: data.action,
    activityId: "activityId" in data ? data.activityId : null,
    expectedScheduleVersionId: "expectedScheduleVersionId" in data ? data.expectedScheduleVersionId : null,
    expectedScheduleVersion: "expectedScheduleVersion" in data ? data.expectedScheduleVersion : null,
    expectedStatusEventId: "expectedStatusEventId" in data ? data.expectedStatusEventId : null,
    expectedStatusSequence: "expectedStatusSequence" in data ? data.expectedStatusSequence : null,
    activityType: "activityType" in data ? data.activityType : null,
    title: "title" in data ? data.title : null,
    searchSummary: "searchSummary" in data ? data.searchSummary : null,
    location: "location" in data ? data.location : null,
    startsAt: "startsAt" in data ? data.startsAt : null,
    endsAt: "endsAt" in data ? data.endsAt : null,
    responsibleUserId: "responsibleUserId" in data ? data.responsibleUserId : null,
    participantClientIds, capacity: "capacity" in data ? data.capacity : null,
    reason: "reason" in data ? data.reason : null,
    idempotencyKey: idempotency(key),
  };
}

export function parseActivityOperationResult(value: unknown): Omit<ActivityOperationResult, "persisted" | "demo"> {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) throw new IntegrationError(
    "ACTIVITY_RECEIPT_INVALID", "資料庫活動完成憑證不完整；畫面不會視為成功。", 502,
  );
  const row = parsed.data;
  return {
    operationId: row.operation_id, operationKind: row.operation_kind,
    activityId: row.activity_id, scheduleVersionId: row.schedule_version_id,
    scheduleVersion: row.schedule_version,
    previousScheduleVersionId: row.previous_schedule_version_id,
    statusEventId: row.status_event_id, statusSequence: row.status_sequence,
    previousStatusEventId: row.previous_status_event_id, status: row.status,
    responsibleUserId: row.responsible_user_id,
    participantClientIds: row.participant_client_ids,
    committedAt: row.committed_at, replayed: row.replayed,
  };
}

export function correlateActivityResult(
  result: Omit<ActivityOperationResult, "persisted" | "demo">,
  input: ActivityMutationInput,
) {
  const expectedKind = input.action === "start" || input.action === "complete" ? "transition" : input.action;
  const expectedStatus = input.action === "start" ? "in_progress"
    : input.action === "complete" ? "completed" : input.action === "cancel" ? "cancelled" : null;
  if (result.operationKind !== expectedKind ||
      (input.activityId !== null && result.activityId !== input.activityId) ||
      (input.action === "create" && (result.scheduleVersion !== 1 || result.previousScheduleVersionId !== null || result.status !== "scheduled" || result.statusSequence !== 1)) ||
      (input.action === "revise" && (result.scheduleVersion !== input.expectedScheduleVersion! + 1 || result.previousScheduleVersionId !== input.expectedScheduleVersionId || result.statusEventId !== input.expectedStatusEventId || result.statusSequence !== input.expectedStatusSequence || result.responsibleUserId !== input.responsibleUserId)) ||
      (expectedStatus !== null && (result.status !== expectedStatus || result.scheduleVersionId !== input.expectedScheduleVersionId || result.scheduleVersion !== input.expectedScheduleVersion || result.previousStatusEventId !== input.expectedStatusEventId || result.statusSequence !== input.expectedStatusSequence! + 1)) ||
      ((input.action === "create" || input.action === "revise") && (
        result.responsibleUserId !== input.responsibleUserId ||
        result.participantClientIds.join(",") !== input.participantClientIds.join(",")
      ))) {
    throw new IntegrationError("ACTIVITY_RECEIPT_INVALID", "資料庫完成憑證與本次活動請求不一致；畫面不會視為成功。", 502);
  }
  return result;
}

export function parseActivityActionSuccess(value: unknown, input: ActivityMutationInput) {
  const parsed = successSchema.safeParse(value);
  if (!parsed.success) throw new Error("INVALID_ACTIVITY_SUCCESS");
  correlateActivityResult(parsed.data.data, input);
  return parsed.data;
}

export function parseActivityActionError(value: unknown) {
  const parsed = errorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
