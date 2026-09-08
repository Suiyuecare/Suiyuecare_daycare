import { z } from "zod";

import { IntegrationError } from "./errors";
import {
  assertIdempotencyKey,
  canonicalJson,
  parseIsoDateTime,
  payloadHash,
} from "./security";

export const notificationChannels = ["in_app", "pwa", "line", "sms"] as const;
export type NotificationChannel = (typeof notificationChannels)[number];

const notificationSchema = z
  .object({
    idempotency_key: z.string().optional(),
    mode: z.enum(["preview", "queue"]),
    category: z.string().trim().min(1).max(80),
    priority: z.number().int().min(0).max(3).default(1),
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(240),
    recipient_user_ids: z.array(z.uuid()).min(1).max(500),
    channels: z.array(z.enum(notificationChannels)).min(1).max(4),
    scheduled_for: z.string().nullable().optional(),
    source_type: z.string().trim().min(1).max(80).nullable().optional(),
    source_id: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .strict();

const directIdentifierPatterns = [
  /\b[A-Z][12]\d{8}\b/iu,
  /\b09\d{8}\b/u,
  /\b(?:\d[ -]?){10,16}\b/u,
  /(?:姓名|身分證|病歷號|電話|手機|地址|生日|出生日期)\s*[:：]/u,
];

const sensitiveCareTerms =
  /血壓|血糖|血氧|體溫|脈搏|胰島素|用藥|服藥|診斷|病歷|檢驗結果|感染|跌倒|憂鬱|失智|傷口|尿布|排泄|月經|疫苗|TOCC/iu;

export function containsSensitiveNotificationContent(value: string) {
  return (
    directIdentifierPatterns.some((pattern) => pattern.test(value)) ||
    sensitiveCareTerms.test(value)
  );
}

export function assertSafeNotificationCopy(title: string, body: string) {
  if (
    containsSensitiveNotificationContent(title) ||
    containsSensitiveNotificationContent(body)
  ) {
    throw new IntegrationError(
      "SENSITIVE_NOTIFICATION_CONTENT",
      "通知標題與內容不得包含個人識別或健康照顧資訊；請改為登入系統查看。",
      400,
      "body",
    );
  }
}

export interface NotificationRequest {
  idempotencyKey: string;
  mode: "preview" | "queue";
  category: string;
  priority: number;
  title: string;
  body: string;
  recipientUserIds: string[];
  channels: NotificationChannel[];
  scheduledFor: string | null;
  sourceType: string | null;
  sourceId: string | null;
  contentHash: string;
}

export function parseNotificationRequest(
  value: unknown,
  headerIdempotencyKey?: string | null,
  now = new Date(),
): NotificationRequest {
  const parsed = notificationSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new IntegrationError(
      "INVALID_NOTIFICATION",
      "通知設定格式錯誤。",
      400,
      issue?.path.join(".") || undefined,
    );
  }
  assertSafeNotificationCopy(parsed.data.title, parsed.data.body);

  const recipientUserIds = [...new Set(parsed.data.recipient_user_ids)].sort();
  const channels = [...new Set(parsed.data.channels)].sort() as NotificationChannel[];
  const scheduledFor = parsed.data.scheduled_for
    ? parseIsoDateTime(parsed.data.scheduled_for, "scheduled_for", {
        min: new Date(now.getTime() - 60_000),
      })
    : null;
  const normalized = {
    category: parsed.data.category,
    priority: parsed.data.priority,
    title: parsed.data.title,
    body: parsed.data.body,
    recipientUserIds,
    channels,
    scheduledFor,
    sourceType: parsed.data.source_type ?? null,
    sourceId: parsed.data.source_id ?? null,
  };

  return {
    idempotencyKey: assertIdempotencyKey(
      headerIdempotencyKey ?? parsed.data.idempotency_key,
    ),
    mode: parsed.data.mode,
    ...normalized,
    contentHash: payloadHash(normalized),
  };
}

export function notificationPreview(input: NotificationRequest) {
  return {
    recipientCount: input.recipientUserIds.length,
    channelCount: input.channels.length,
    deliveryCount: input.recipientUserIds.length * input.channels.length,
    bulk: input.recipientUserIds.length > 20,
    scheduled: input.scheduledFor !== null,
    containsSensitiveContent: false,
  };
}

export function notificationAudience(input: NotificationRequest) {
  return {
    schema_version: 1,
    recipient_user_ids: input.recipientUserIds,
    channels: input.channels,
    content_hash: input.contentHash,
  };
}

export function storedNotificationMatches(
  stored: {
    category?: unknown;
    priority?: unknown;
    title?: unknown;
    body?: unknown;
    audience?: unknown;
    scheduled_for?: unknown;
    source_type?: unknown;
    source_id?: unknown;
  },
  input: NotificationRequest,
) {
  const audience = stored.audience as { content_hash?: unknown } | null;
  return (
    stored.category === input.category &&
    Number(stored.priority) === input.priority &&
    stored.title === input.title &&
    stored.body === input.body &&
    audience?.content_hash === input.contentHash &&
    (input.scheduledFor === null ||
      (stored.scheduled_for
        ? new Date(String(stored.scheduled_for)).toISOString()
        : null) === input.scheduledFor) &&
    (stored.source_type ?? null) === input.sourceType &&
    (stored.source_id ?? null) === input.sourceId
  );
}

export function notificationCanonicalFingerprint(input: NotificationRequest) {
  return canonicalJson({
    category: input.category,
    priority: input.priority,
    title: input.title,
    body: input.body,
    audience: notificationAudience(input),
    scheduledFor: input.scheduledFor,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
  });
}
