import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  PUSH_NOTIFICATION_STAFF_KINDS,
  type PushNotificationInput,
  type PushNotificationQueueReceipt,
  type PushNotificationRecipientPreview,
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

const idempotencyKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const directIdentifierPatterns = [
  /\b[A-Z][12]\d{8}\b/iu,
  /\b09\d{8}\b/u,
  /\b(?:\d[ -]?){10,16}\b/u,
  /(?:姓名|身分證|病歷號|電話|手機|地址|生日|出生日期)\s*[:：]/u,
];
const sensitiveCareTerms =
  /血壓|血糖|血氧|體溫|脈搏|胰島素|用藥|服藥|診斷|病歷|檢驗結果|感染|跌倒|憂鬱|失智|傷口|尿布|排泄|月經|疫苗|TOCC/iu;

function parseIdempotencyKey(value: unknown) {
  if (typeof value !== "string" || !idempotencyKeyPattern.test(value)) {
    throw new IntegrationError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "請提供 8 至 200 字元的有效冪等鍵。",
      400,
      "idempotency_key",
    );
  }
  return value;
}

function parseScheduledFor(value: string, now: Date) {
  const parsed = new Date(value);
  if (
    !Number.isFinite(parsed.getTime()) ||
    !isStrictOffsetDateTime(value)
  ) {
    throw new IntegrationError(
      "INVALID_DATETIME",
      "日期時間必須包含時區。",
      400,
      "scheduled_for",
    );
  }
  if (parsed < new Date(now.getTime() - 60_000)) {
    throw new IntegrationError(
      "DATETIME_TOO_OLD",
      "日期時間已超過允許範圍。",
      400,
      "scheduled_for",
    );
  }
  return parsed.toISOString();
}

function assertSafeCopy(title: string, body: string) {
  const value = `${title} ${body}`;
  if (
    directIdentifierPatterns.some((pattern) => pattern.test(value)) ||
    sensitiveCareTerms.test(value)
  ) {
    throw new IntegrationError(
      "SENSITIVE_NOTIFICATION_CONTENT",
      "通知標題與內容不得包含個人識別或健康照顧資訊；請改為登入系統查看。",
      400,
      "body",
    );
  }
}

const requestSchema = z
  .object({
    mode: z.enum(["preview", "queue"]),
    category: z.string().trim().min(1).max(80),
    priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(240),
    recipient_user_ids: z.array(uuid).min(1).max(500),
    channels: z.tuple([z.literal("in_app")]),
    scheduled_for: z.string().nullable(),
  })
  .strict();

const previewRecipientSchema = z
  .object({
    user_id: uuid,
    display_name: z.string().trim().min(1).max(120),
    profile_kind: z.enum(PUSH_NOTIFICATION_STAFF_KINDS),
  })
  .strict();

const previewRpcSchema = z
  .object({
    organization_id: uuid,
    branch_id: uuid,
    generated_at: timestamp,
    recipients: z.array(previewRecipientSchema).min(1).max(500),
    recipient_count: z.number().int().min(1).max(500),
    channel: z.literal("in_app"),
    persisted: z.literal(false),
  })
  .strict();

const queueRpcSchema = z
  .object({
    notification_id: uuid,
    delivery_count: z.number().int().min(1).max(500),
    notification_status: z.literal("scheduled"),
    scheduled_for: timestamp,
    replayed: z.boolean(),
  })
  .strict();

const previewDataSchema = z
  .object({
    mode: z.literal("preview"),
    preview: z
      .object({
        organizationId: uuid,
        branchId: uuid,
        generatedAt: timestamp,
        recipients: z
          .array(
            z
              .object({
                userId: uuid,
                displayName: z.string().trim().min(1).max(120),
                profileKind: z.enum(PUSH_NOTIFICATION_STAFF_KINDS),
              })
              .strict(),
          )
          .min(1)
          .max(500),
        recipientCount: z.number().int().min(1).max(500),
        channel: z.literal("in_app"),
        deliveryCount: z.number().int().min(1).max(500),
        scheduled: z.boolean(),
        persisted: z.literal(false),
        demo: z.boolean(),
      })
      .strict(),
    queued: z.literal(false),
    persisted: z.literal(false),
    demo: z.boolean(),
  })
  .strict();

const queueDataSchema = z
  .object({
    mode: z.literal("queue"),
    receipt: z
      .object({
        notificationId: uuid,
        deliveryCount: z.number().int().min(1).max(500),
        notificationStatus: z.literal("scheduled"),
        deliveryStatus: z.literal("queued"),
        channel: z.literal("in_app"),
        scheduledFor: timestamp,
        replayed: z.boolean(),
        persisted: z.literal(true),
        demo: z.literal(false),
      })
      .strict(),
    queued: z.literal(true),
    persisted: z.literal(true),
    demo: z.literal(false),
  })
  .strict();

const successEnvelopeSchema = z
  .object({
    requestId: uuid,
    status: z.literal("ok"),
    data: z.unknown(),
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
            message: z.string().trim().min(1).max(500),
            field: z.string().trim().min(1).max(120).optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

function invalidRequest(result: z.ZodSafeParseError<unknown>): never {
  const issue = result.error.issues[0];
  throw new IntegrationError(
    "INVALID_PUSH_NOTIFICATION",
    "通知設定格式錯誤；目前只開放站內員工通知。",
    400,
    issue?.path.length ? issue.path.join(".") : undefined,
  );
}

function invalidResult(): never {
  throw new IntegrationError(
    "PUSH_NOTIFICATION_RESULT_INVALID",
    "通知結果未完整確認；請保留相同冪等鍵重試。",
    409,
  );
}

export function parsePushNotificationInput(
  value: unknown,
  headerIdempotencyKey: string | null,
  now = new Date(),
): PushNotificationInput {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) invalidRequest(parsed);
  assertSafeCopy(parsed.data.title, parsed.data.body);
  const recipients = [...new Set(parsed.data.recipient_user_ids)].sort();
  const scheduledFor = parsed.data.scheduled_for
    ? parseScheduledFor(parsed.data.scheduled_for, now)
    : null;
  return {
    mode: parsed.data.mode,
    category: parsed.data.category,
    priority: parsed.data.priority,
    title: parsed.data.title,
    body: parsed.data.body,
    recipientUserIds: recipients,
    scheduledFor,
    idempotencyKey: parseIdempotencyKey(headerIdempotencyKey),
  };
}

export function parsePushNotificationPreviewRpc(
  value: unknown,
  input: PushNotificationInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
  demo: boolean,
): PushNotificationRecipientPreview {
  const parsed = previewRpcSchema.safeParse(value);
  const organizationId = uuid.safeParse(expectedOrganizationId);
  const branchId = uuid.safeParse(expectedBranchId);
  if (!parsed.success || !organizationId.success || !branchId.success) {
    invalidResult();
  }
  const row = parsed.data;
  const returnedIds = row.recipients.map((recipient) => recipient.user_id).sort();
  if (
    row.organization_id !== organizationId.data ||
    row.branch_id !== branchId.data ||
    row.recipient_count !== input.recipientUserIds.length ||
    row.recipients.length !== row.recipient_count ||
    new Set(returnedIds).size !== returnedIds.length ||
    returnedIds.some((recipient, index) => recipient !== input.recipientUserIds[index])
  ) {
    invalidResult();
  }
  return {
    organizationId: row.organization_id,
    branchId: row.branch_id,
    generatedAt: row.generated_at,
    recipients: row.recipients.map((recipient) => ({
      userId: recipient.user_id,
      displayName: recipient.display_name,
      profileKind: recipient.profile_kind,
    })),
    recipientCount: row.recipient_count,
    channel: "in_app",
    deliveryCount: row.recipient_count,
    scheduled: input.scheduledFor !== null,
    persisted: false,
    demo,
  };
}

export function parsePushNotificationQueueRpc(
  value: unknown,
  input: PushNotificationInput,
): PushNotificationQueueReceipt {
  const parsed = queueRpcSchema.safeParse(value);
  if (!parsed.success || parsed.data.delivery_count !== input.recipientUserIds.length) {
    invalidResult();
  }
  if (
    input.scheduledFor !== null &&
    parsed.data.scheduled_for !== input.scheduledFor
  ) {
    invalidResult();
  }
  return {
    notificationId: parsed.data.notification_id,
    deliveryCount: parsed.data.delivery_count,
    notificationStatus: "scheduled",
    deliveryStatus: "queued",
    channel: "in_app",
    scheduledFor: parsed.data.scheduled_for,
    replayed: parsed.data.replayed,
    persisted: true,
    demo: false,
  };
}

export function parsePushNotificationActionSuccess(
  value: unknown,
  expectation: {
    mode: "preview" | "queue";
    recipientUserIds: readonly string[];
    httpStatus: number;
  },
) {
  const envelope = successEnvelopeSchema.safeParse(value);
  if (!envelope.success) invalidResult();
  if (expectation.mode === "preview") {
    const data = previewDataSchema.safeParse(envelope.data.data);
    if (
      !data.success ||
      expectation.httpStatus !== 200 ||
      data.data.preview.recipientCount !== expectation.recipientUserIds.length ||
      data.data.preview.recipients.some(
        (recipient) => !expectation.recipientUserIds.includes(recipient.userId),
      )
    ) {
      invalidResult();
    }
    return { requestId: envelope.data.requestId, data: data.data };
  }
  const data = queueDataSchema.safeParse(envelope.data.data);
  if (
    !data.success ||
    data.data.receipt.deliveryCount !== expectation.recipientUserIds.length ||
    (data.data.receipt.replayed
      ? expectation.httpStatus !== 200
      : expectation.httpStatus !== 201)
  ) {
    invalidResult();
  }
  return { requestId: envelope.data.requestId, data: data.data };
}

export function parsePushNotificationActionError(value: unknown) {
  const parsed = errorEnvelopeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
