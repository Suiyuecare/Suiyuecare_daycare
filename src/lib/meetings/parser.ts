import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import { isMeetingCalendarDate } from "./date";

import {
  MEETING_ACTION_STATUSES,
  type MeetingActionUpdateInput,
  type MeetingActionUpdateReceipt,
  type MeetingMinuteInput,
  type MeetingMinuteReceipt,
} from "./types";

export const MEETING_MINUTE_MAX_BYTES = 192 * 1024;
export const MEETING_ACTION_MAX_BYTES = 32 * 1024;

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine(
  (value) => isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const date = z.string().refine(isMeetingCalendarDate, "date");
const cleanText = (max: number, multiline = false) => z.string().trim().min(1).max(max)
  .refine((value) => multiline
    ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    : !/[\u0000-\u001f\u007f]/u.test(value));
const ordered = <T extends z.ZodTypeAny>(schema: T, max: number) => z.array(schema).max(max)
  .refine((items) => items.every((item, index) =>
    typeof item === "object" && item !== null && "item_order" in item &&
    item.item_order === index + 1), "order");
const uniqueUuids = (max: number, minimum = 0) => z.array(uuid).min(minimum).max(max)
  .refine((values) => new Set(values).size === values.length, "duplicate")
  .transform((values) => [...values].sort());

const minuteSchema = z.object({
  meeting_key: uuid.nullable(),
  previous_version_id: uuid.nullable(),
  correction_reason: cleanText(1_000).nullable(),
  meeting_type: cleanText(120),
  title: cleanText(200),
  starts_at: timestamp,
  ends_at: timestamp,
  staff_attendee_user_ids: uniqueUuids(100, 1),
  external_attendee_names: z.array(cleanText(120)).max(50)
    .refine((values) => new Set(values.map((item) => item.toLocaleLowerCase("zh-TW"))).size === values.length, "duplicate"),
  agenda_items: ordered(z.object({
    item_id: uuid, item_order: z.number().int().positive(), topic: cleanText(1_000, true),
  }).strict(), 50).refine((items) => items.length > 0, "required")
    .refine((items) => new Set(items.map((item) => item.item_id)).size === items.length, "duplicate"),
  decisions: ordered(z.object({
    decision_id: uuid, item_order: z.number().int().positive(), decision: cleanText(2_000, true),
  }).strict(), 50).refine((items) => new Set(items.map((item) => item.decision_id)).size === items.length, "duplicate"),
  action_items: ordered(z.object({
    action_id: uuid, item_order: z.number().int().positive(), action: cleanText(2_000, true),
    responsible_user_id: uuid, due_date: date,
  }).strict(), 50).refine((items) => new Set(items.map((item) => item.action_id)).size === items.length, "duplicate"),
}).strict();

const actionSchema = z.object({
  meeting_key: uuid,
  minute_version_id: uuid,
  action_id: uuid,
  expected_previous_update_id: uuid.nullable(),
  progress_status: z.enum(MEETING_ACTION_STATUSES),
  progress_note: cleanText(1_000, true).nullable(),
}).strict();

const minuteReceiptSchema = z.object({
  minute_version_id: uuid,
  meeting_key: uuid,
  minute_version: z.number().int().positive().safe(),
  previous_version_id: uuid.nullable(),
  signed_at: timestamp,
  replayed: z.boolean(),
}).strict();
const actionReceiptSchema = z.object({
  action_update_id: uuid,
  meeting_key: uuid,
  minute_version_id: uuid,
  action_id: uuid,
  previous_update_id: uuid.nullable(),
  update_sequence: z.number().int().positive().safe(),
  progress_status: z.enum(MEETING_ACTION_STATUSES),
  recorded_at: timestamp,
  replayed: z.boolean(),
}).strict();

const minuteApiReceiptSchema = z.object({
  minuteVersionId: uuid,
  meetingKey: uuid,
  minuteVersion: z.number().int().positive().safe(),
  previousVersionId: uuid.nullable(),
  signedAt: timestamp,
  replayed: z.boolean(),
  persisted: z.literal(true),
  demo: z.literal(false),
}).strict();
const actionApiReceiptSchema = z.object({
  actionUpdateId: uuid,
  meetingKey: uuid,
  minuteVersionId: uuid,
  actionId: uuid,
  previousUpdateId: uuid.nullable(),
  updateSequence: z.number().int().positive().safe(),
  progressStatus: z.enum(MEETING_ACTION_STATUSES),
  recordedAt: timestamp,
  replayed: z.boolean(),
  persisted: z.literal(true),
  demo: z.literal(false),
}).strict();

const envelope = z.object({
  requestId: uuid,
  status: z.literal("ok"),
  data: z.unknown(),
  errors: z.array(z.never()).length(0),
}).strict();

function invalid(code: string, message: string): never {
  throw new IntegrationError(code, message, 400);
}

function uncertain(message: string): never {
  throw new IntegrationError("MEETING_RECEIPT_INVALID", message, 409);
}

export function parseMeetingMinuteInput(
  value: unknown,
  idempotencyHeader: string | null,
): MeetingMinuteInput {
  const key = uuid.safeParse(idempotencyHeader);
  const parsed = minuteSchema.safeParse(value);
  if (!key.success || !parsed.success) invalid(
    "INVALID_MEETING_MINUTES",
    "請完整填寫會議時間、出席者、議程、決議與行動，並使用有效操作鍵。",
  );
  const body = parsed.data;
  const correction = body.meeting_key !== null;
  if (
    Date.parse(body.ends_at) <= Date.parse(body.starts_at) ||
    correction !== (body.previous_version_id !== null) ||
    correction !== (body.correction_reason !== null)
  ) invalid("INVALID_MEETING_MINUTES", "會議時間或更正版本關係不符合規則。");
  return {
    meetingKey: body.meeting_key, previousVersionId: body.previous_version_id,
    correctionReason: body.correction_reason, meetingType: body.meeting_type,
    title: body.title, startsAt: body.starts_at, endsAt: body.ends_at,
    staffAttendeeUserIds: body.staff_attendee_user_ids,
    externalAttendeeNames: body.external_attendee_names,
    agendaItems: body.agenda_items.map((item) => ({
      itemId: item.item_id, itemOrder: item.item_order, topic: item.topic,
    })),
    decisions: body.decisions.map((item) => ({
      decisionId: item.decision_id, itemOrder: item.item_order, decision: item.decision,
    })),
    actionItems: body.action_items.map((item) => ({
      actionId: item.action_id, itemOrder: item.item_order, action: item.action,
      responsibleUserId: item.responsible_user_id, dueDate: item.due_date,
    })),
    idempotencyKey: key.data,
  };
}

export function parseMeetingActionUpdateInput(
  value: unknown,
  idempotencyHeader: string | null,
): MeetingActionUpdateInput {
  const key = uuid.safeParse(idempotencyHeader);
  const parsed = actionSchema.safeParse(value);
  if (!key.success || !parsed.success) invalid(
    "INVALID_MEETING_ACTION_UPDATE",
    "請指定目前會議版本、行動、進度與有效操作鍵。",
  );
  return {
    meetingKey: parsed.data.meeting_key,
    minuteVersionId: parsed.data.minute_version_id,
    actionId: parsed.data.action_id,
    expectedPreviousUpdateId: parsed.data.expected_previous_update_id,
    progressStatus: parsed.data.progress_status,
    progressNote: parsed.data.progress_note,
    idempotencyKey: key.data,
  };
}

export function parseMeetingMinuteReceipt(
  value: unknown,
  input: MeetingMinuteInput,
): MeetingMinuteReceipt {
  const parsed = minuteReceiptSchema.safeParse(value);
  if (!parsed.success ||
    Date.parse(parsed.data.signed_at) < Date.parse(input.endsAt) ||
    (input.meetingKey === null
      ? parsed.data.minute_version !== 1 || parsed.data.previous_version_id !== null
      : parsed.data.meeting_key !== input.meetingKey ||
        parsed.data.previous_version_id !== input.previousVersionId ||
        parsed.data.minute_version < 2)
  ) uncertain("會議簽署結果無法與送出內容核對；請保留相同操作鍵重試。");
  return {
    minuteVersionId: parsed.data.minute_version_id,
    meetingKey: parsed.data.meeting_key,
    minuteVersion: parsed.data.minute_version,
    previousVersionId: parsed.data.previous_version_id,
    signedAt: parsed.data.signed_at,
    replayed: parsed.data.replayed,
    persisted: true, demo: false,
  };
}

export function parseMeetingActionUpdateReceipt(
  value: unknown,
  input: MeetingActionUpdateInput,
): MeetingActionUpdateReceipt {
  const parsed = actionReceiptSchema.safeParse(value);
  if (!parsed.success || parsed.data.action_id !== input.actionId ||
    parsed.data.meeting_key !== input.meetingKey ||
    parsed.data.minute_version_id !== input.minuteVersionId ||
    parsed.data.previous_update_id !== input.expectedPreviousUpdateId ||
    parsed.data.progress_status !== input.progressStatus
  ) uncertain("行動進度結果無法與送出內容核對；請保留相同操作鍵重試。");
  return {
    actionUpdateId: parsed.data.action_update_id,
    meetingKey: parsed.data.meeting_key,
    minuteVersionId: parsed.data.minute_version_id,
    actionId: parsed.data.action_id,
    previousUpdateId: parsed.data.previous_update_id,
    updateSequence: parsed.data.update_sequence,
    progressStatus: parsed.data.progress_status,
    recordedAt: parsed.data.recorded_at,
    replayed: parsed.data.replayed,
    persisted: true, demo: false,
  };
}

export function parseMeetingMinuteApiEnvelope(
  value: unknown,
  input: MeetingMinuteInput,
  httpStatus: number,
) {
  const parsed = envelope.safeParse(value);
  if (!parsed.success) uncertain("會議簽署回應格式不完整。");
  const data = z.object({ receipt: minuteApiReceiptSchema, persisted: z.literal(true), demo: z.literal(false) })
    .strict().safeParse(parsed.data.data);
  if (!data.success) uncertain("會議簽署回應未確認保存。");
  const receipt = parseMeetingMinuteReceipt({
    minute_version_id: data.data.receipt.minuteVersionId,
    meeting_key: data.data.receipt.meetingKey,
    minute_version: data.data.receipt.minuteVersion,
    previous_version_id: data.data.receipt.previousVersionId,
    signed_at: data.data.receipt.signedAt,
    replayed: data.data.receipt.replayed,
  }, input);
  if (httpStatus !== (receipt.replayed ? 200 : 201)) {
    uncertain("會議簽署 HTTP 狀態與建立／重送結果不一致。");
  }
  return { requestId: parsed.data.requestId, receipt };
}

export function parseMeetingActionApiEnvelope(
  value: unknown,
  input: MeetingActionUpdateInput,
  httpStatus: number,
) {
  const parsed = envelope.safeParse(value);
  if (!parsed.success) uncertain("行動進度回應格式不完整。");
  const data = z.object({ receipt: actionApiReceiptSchema, persisted: z.literal(true), demo: z.literal(false) })
    .strict().safeParse(parsed.data.data);
  if (!data.success) uncertain("行動進度回應未確認保存。");
  const receipt = parseMeetingActionUpdateReceipt({
    action_update_id: data.data.receipt.actionUpdateId,
    meeting_key: data.data.receipt.meetingKey,
    minute_version_id: data.data.receipt.minuteVersionId,
    action_id: data.data.receipt.actionId,
    previous_update_id: data.data.receipt.previousUpdateId,
    update_sequence: data.data.receipt.updateSequence,
    progress_status: data.data.receipt.progressStatus,
    recorded_at: data.data.receipt.recordedAt,
    replayed: data.data.receipt.replayed,
  }, input);
  if (httpStatus !== (receipt.replayed ? 200 : 201)) {
    uncertain("行動進度 HTTP 狀態與建立／重送結果不一致。");
  }
  return { requestId: parsed.data.requestId, receipt };
}
