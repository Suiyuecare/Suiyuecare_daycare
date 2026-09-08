import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import type {
  NotificationAcknowledgementInput,
  NotificationAcknowledgementResult,
  NotificationAcknowledgementTarget,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z
  .string()
  .refine(
    (value) =>
      isStrictOffsetDateTime(value) &&
      Number.isFinite(new Date(value).getTime()),
    "timestamp",
  )
  .transform((value) => new Date(value).toISOString());
const inputSchema = z
  .object({
    delivery_id: uuid,
    target_status: z.enum(["read", "confirmed"]),
  })
  .strict();
const rpcResultSchema = z
  .object({
    acknowledgement_operation_id: uuid,
    notification_delivery_id: uuid,
    notification_id: uuid,
    status: z.enum(["read", "confirmed"]),
    read_at: timestamp,
    confirmed_at: timestamp.nullable(),
    acknowledged_at: timestamp,
    replayed: z.boolean(),
  })
  .strict();
const apiDataSchema = z
  .object({
    operationId: uuid,
    deliveryId: uuid,
    notificationId: uuid,
    status: z.enum(["read", "confirmed"]),
    readAt: timestamp,
    confirmedAt: timestamp.nullable(),
    acknowledgedAt: timestamp,
    replayed: z.boolean(),
    persisted: z.literal(true),
    demo: z.literal(false),
  })
  .strict();
const successEnvelopeSchema = z
  .object({
    requestId: uuid,
    status: z.literal("ok"),
    data: apiDataSchema,
    errors: z.tuple([]),
  })
  .strict();
const errorEnvelopeSchema = z
  .object({
    requestId: uuid,
    status: z.literal("error"),
    data: z.null(),
    errors: z
      .array(
        z
          .object({
            code: z.string().trim().min(1).max(120),
            message: z.string().trim().min(1).max(1_000),
            field: z.string().trim().min(1).max(200).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(16),
  })
  .strict();
const requestIdSchema = z.object({ requestId: uuid }).strip();

function invalidResult(): never {
  throw new IntegrationError(
    "NOTIFICATION_ACKNOWLEDGEMENT_RESULT_INVALID",
    "通知操作結果未完整確認；請保留相同冪等鍵重試。",
    409,
  );
}

function parseIdempotencyKey(value: string | null) {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) {
    throw new IntegrationError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "請在 Idempotency-Key 標頭提供有效的 UUID。",
      400,
      "idempotency_key",
    );
  }
  return parsed.data;
}

function assertTimestamps(
  targetStatus: NotificationAcknowledgementTarget,
  readAt: string,
  confirmedAt: string | null,
  acknowledgedAt: string,
) {
  if (
    (targetStatus === "read" && confirmedAt !== null) ||
    (targetStatus === "confirmed" && confirmedAt === null) ||
    (confirmedAt !== null && confirmedAt < readAt) ||
    acknowledgedAt < readAt ||
    (confirmedAt !== null && acknowledgedAt !== confirmedAt)
  ) {
    invalidResult();
  }
}

export function parseNotificationAcknowledgementInput(
  value: unknown,
  idempotencyHeader: string | null,
): NotificationAcknowledgementInput {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new IntegrationError(
      "INVALID_NOTIFICATION_ACKNOWLEDGEMENT",
      "通知已讀／確認欄位格式錯誤。",
      400,
      issue?.path.length ? issue.path.join(".") : undefined,
    );
  }
  return {
    deliveryId: parsed.data.delivery_id,
    targetStatus: parsed.data.target_status,
    idempotencyKey: parseIdempotencyKey(idempotencyHeader),
  };
}

export function parseNotificationAcknowledgementRpcResult(
  value: unknown,
  expected: Pick<NotificationAcknowledgementInput, "deliveryId" | "targetStatus">,
): NotificationAcknowledgementResult {
  const parsed = rpcResultSchema.safeParse(value);
  if (!parsed.success) invalidResult();
  const row = parsed.data;
  if (
    row.notification_delivery_id !== expected.deliveryId.toLowerCase() ||
    row.status !== expected.targetStatus
  ) {
    invalidResult();
  }
  assertTimestamps(
    expected.targetStatus,
    row.read_at,
    row.confirmed_at,
    row.acknowledged_at,
  );
  return {
    operationId: row.acknowledgement_operation_id,
    deliveryId: row.notification_delivery_id,
    notificationId: row.notification_id,
    status: row.status,
    readAt: row.read_at,
    confirmedAt: row.confirmed_at,
    acknowledgedAt: row.acknowledged_at,
    replayed: row.replayed,
    persisted: true,
    demo: false,
  };
}

export function parseNotificationAcknowledgementSuccess(
  value: unknown,
  expected: Pick<NotificationAcknowledgementInput, "deliveryId" | "targetStatus">,
  httpStatus: number,
) {
  const parsed = successEnvelopeSchema.safeParse(value);
  if (!parsed.success) invalidResult();
  const data = parsed.data.data;
  if (
    data.deliveryId !== expected.deliveryId.toLowerCase() ||
    data.status !== expected.targetStatus ||
    (data.replayed ? httpStatus !== 200 : httpStatus !== 201)
  ) {
    invalidResult();
  }
  assertTimestamps(
    expected.targetStatus,
    data.readAt,
    data.confirmedAt,
    data.acknowledgedAt,
  );
  return parsed.data;
}

export function parseNotificationAcknowledgementError(value: unknown) {
  const parsed = errorEnvelopeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseNotificationAcknowledgementRequestId(value: unknown) {
  const parsed = requestIdSchema.safeParse(value);
  return parsed.success ? parsed.data.requestId : null;
}
