import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import type {
  StaffAnnouncementMutationInput,
  StaffAnnouncementMutationResult,
} from "@/lib/staff-announcements/types";

import { IntegrationError } from "./errors";

export const STAFF_ANNOUNCEMENT_MAX_BYTES = 128 * 1024;
export const STAFF_ANNOUNCEMENT_ACTIONS = [
  "draft", "publish", "withdraw", "read",
] as const;
export type StaffAnnouncementAction =
  (typeof STAFF_ANNOUNCEMENT_ACTIONS)[number];

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine(
  (value) => isStrictOffsetDateTime(value) && Number.isFinite(new Date(value).getTime()),
).transform((value) => new Date(value).toISOString());
const cleanText = (max: number, multiline = false) => z.string().trim().min(1).max(max)
  .refine((value) => multiline
    ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    : !/[\u0000-\u001f\u007f]/u.test(value));
const idList = z.array(uuid).max(500).refine(
  (values) => new Set(values).size === values.length,
  "duplicate",
).transform((values) => [...values].sort());

const draftSchema = z.object({
  previous_version_id: uuid.nullable(),
  title: cleanText(200),
  body: cleanText(10_000, true),
  publish_at: timestamp,
  expires_at: timestamp.nullable(),
  audience_user_ids: idList,
  audience_role_ids: idList,
  change_reason: cleanText(1_000).nullable(),
}).strict();
const publishSchema = z.object({ draft_version_id: uuid }).strict();
const withdrawSchema = z.object({
  expected_latest_version_id: uuid,
  release_version_id: uuid,
  reason: cleanText(1_000),
}).strict();
const readSchema = z.object({ release_version_id: uuid }).strict();

const commonResult = {
  version_id: uuid,
  announcement_key: uuid,
  version: z.number().int().positive().safe(),
};
const draftResult = z.object({
  ...commonResult,
  previous_version_id: uuid.nullable(),
  version_state: z.literal("draft"),
  publish_at: timestamp,
  expires_at: timestamp.nullable(),
  replayed: z.boolean(),
}).strict();
const publishResult = z.object({
  ...commonResult,
  draft_version_id: uuid,
  lifecycle: z.enum(["scheduled", "published"]),
  publish_at: timestamp,
  expires_at: timestamp.nullable(),
  recipient_count: z.number().int().min(1).max(500).safe(),
  replayed: z.boolean(),
}).strict();
const withdrawResult = z.object({
  ...commonResult,
  previous_version_id: uuid,
  lifecycle: z.literal("withdrawn"),
  withdrawn_release_version_id: uuid,
  withdrawal_reason: cleanText(1_000),
  withdrawn_at: timestamp,
  replayed: z.boolean(),
}).strict();
const readResult = z.object({
  release_version_id: uuid,
  announcement_key: uuid,
  read_at: timestamp,
  replayed: z.boolean(),
}).strict();

const apiEnvelope = z.object({
  requestId: uuid,
  status: z.literal("ok"),
  data: z.unknown(),
  errors: z.array(z.never()).length(0),
}).strict();

function invalid(message: string): never {
  throw new IntegrationError("INVALID_STAFF_ANNOUNCEMENT", message, 400);
}

function invalidResult(): never {
  throw new IntegrationError(
    "STAFF_ANNOUNCEMENT_RESULT_INVALID",
    "公告操作回應無法與本次送出內容核對；請保留相同操作鍵重試。",
    409,
  );
}

export function parseStaffAnnouncementAction(value: string | null) {
  const parsed = z.enum(STAFF_ANNOUNCEMENT_ACTIONS).safeParse(value);
  if (!parsed.success) throw new IntegrationError(
    "INVALID_STAFF_ANNOUNCEMENT_ACTION",
    "請指定有效的公告操作。",
    400,
  );
  return parsed.data;
}

export function parseStaffAnnouncementInput(
  action: StaffAnnouncementAction,
  value: unknown,
  idempotencyHeader: string | null,
): StaffAnnouncementMutationInput {
  const key = uuid.safeParse(idempotencyHeader);
  if (!key.success) invalid("公告操作鍵格式不正確。");
  if (action === "draft") {
    const parsed = draftSchema.safeParse(value);
    if (!parsed.success) invalid("請完整填寫公告內容、明確發布／到期設定與員工對象。");
    const body = parsed.data;
    if (
      body.audience_user_ids.length + body.audience_role_ids.length < 1 ||
      body.audience_user_ids.length + body.audience_role_ids.length > 500 ||
      (body.previous_version_id === null) !== (body.change_reason === null) ||
      (body.expires_at !== null && body.expires_at <= body.publish_at)
    ) invalid("公告版本、受眾或到期時間不符合規則。");
    return {
      action, previousVersionId: body.previous_version_id, title: body.title,
      body: body.body, publishAt: body.publish_at, expiresAt: body.expires_at,
      audienceUserIds: body.audience_user_ids, audienceRoleIds: body.audience_role_ids,
      changeReason: body.change_reason, idempotencyKey: key.data,
    };
  }
  if (action === "publish") {
    const parsed = publishSchema.safeParse(value);
    if (!parsed.success) invalid("請指定要發布的目前草稿版本。");
    return { action, draftVersionId: parsed.data.draft_version_id, idempotencyKey: key.data };
  }
  if (action === "withdraw") {
    const parsed = withdrawSchema.safeParse(value);
    if (!parsed.success) invalid("撤回必須指定目前版本、發布版本及理由。");
    return {
      action, expectedLatestVersionId: parsed.data.expected_latest_version_id,
      releaseVersionId: parsed.data.release_version_id, reason: parsed.data.reason,
      idempotencyKey: key.data,
    };
  }
  const parsed = readSchema.safeParse(value);
  if (!parsed.success) invalid("請指定實際閱讀的發布版本。");
  return { action, releaseVersionId: parsed.data.release_version_id, idempotencyKey: key.data };
}

export function staffAnnouncementRpc(input: StaffAnnouncementMutationInput) {
  if (input.action === "draft") return {
    name: "create_staff_announcement_draft",
    args: {
      p_previous_version_id: input.previousVersionId, p_title: input.title,
      p_body: input.body, p_publish_at: input.publishAt, p_expires_at: input.expiresAt,
      p_audience_user_ids: input.audienceUserIds,
      p_audience_role_ids: input.audienceRoleIds,
      p_change_reason: input.changeReason, p_idempotency_key: input.idempotencyKey,
    },
  } as const;
  if (input.action === "publish") return {
    name: "publish_staff_announcement",
    args: { p_draft_version_id: input.draftVersionId, p_idempotency_key: input.idempotencyKey },
  } as const;
  if (input.action === "withdraw") return {
    name: "withdraw_staff_announcement",
    args: {
      p_expected_latest_version_id: input.expectedLatestVersionId,
      p_release_version_id: input.releaseVersionId, p_reason: input.reason,
      p_idempotency_key: input.idempotencyKey,
    },
  } as const;
  return {
    name: "mark_staff_announcement_read",
    args: { p_release_version_id: input.releaseVersionId, p_idempotency_key: input.idempotencyKey },
  } as const;
}

export function parseStaffAnnouncementResult(
  value: unknown,
  input: StaffAnnouncementMutationInput,
): StaffAnnouncementMutationResult {
  if (!Array.isArray(value) || value.length !== 1) invalidResult();
  const row = value[0];
  if (input.action === "draft") {
    const parsed = draftResult.safeParse(row);
    if (!parsed.success || parsed.data.previous_version_id !== input.previousVersionId ||
      parsed.data.publish_at !== input.publishAt || parsed.data.expires_at !== input.expiresAt ||
      (input.previousVersionId === null ? parsed.data.version !== 1 : parsed.data.version < 2)) invalidResult();
    return {
      action: "draft", versionId: parsed.data.version_id,
      announcementKey: parsed.data.announcement_key, version: parsed.data.version,
      previousVersionId: parsed.data.previous_version_id, versionState: "draft",
      publishAt: parsed.data.publish_at, expiresAt: parsed.data.expires_at,
      replayed: parsed.data.replayed, persisted: true, demo: false,
    };
  }
  if (input.action === "publish") {
    const parsed = publishResult.safeParse(row);
    if (!parsed.success || parsed.data.draft_version_id !== input.draftVersionId) invalidResult();
    return {
      action: "publish", versionId: parsed.data.version_id,
      announcementKey: parsed.data.announcement_key, version: parsed.data.version,
      draftVersionId: parsed.data.draft_version_id, lifecycle: parsed.data.lifecycle,
      publishAt: parsed.data.publish_at, expiresAt: parsed.data.expires_at,
      recipientCount: parsed.data.recipient_count, replayed: parsed.data.replayed,
      persisted: true, demo: false,
    };
  }
  if (input.action === "withdraw") {
    const parsed = withdrawResult.safeParse(row);
    if (!parsed.success || parsed.data.previous_version_id !== input.expectedLatestVersionId ||
      parsed.data.withdrawn_release_version_id !== input.releaseVersionId ||
      parsed.data.withdrawal_reason !== input.reason) invalidResult();
    return {
      action: "withdraw", versionId: parsed.data.version_id,
      announcementKey: parsed.data.announcement_key, version: parsed.data.version,
      previousVersionId: parsed.data.previous_version_id, lifecycle: "withdrawn",
      releaseVersionId: parsed.data.withdrawn_release_version_id,
      reason: parsed.data.withdrawal_reason, withdrawnAt: parsed.data.withdrawn_at,
      replayed: parsed.data.replayed, persisted: true, demo: false,
    };
  }
  const parsed = readResult.safeParse(row);
  if (!parsed.success || parsed.data.release_version_id !== input.releaseVersionId) invalidResult();
  return {
    action: "read", releaseVersionId: parsed.data.release_version_id,
    announcementKey: parsed.data.announcement_key, readAt: parsed.data.read_at,
    replayed: parsed.data.replayed, persisted: true, demo: false,
  };
}

const resultData = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("draft"), versionId: uuid, announcementKey: uuid,
    version: z.number().int().positive(), previousVersionId: uuid.nullable(),
    versionState: z.literal("draft"), publishAt: timestamp, expiresAt: timestamp.nullable(),
    replayed: z.boolean(), persisted: z.literal(true), demo: z.literal(false),
  }).strict(),
  z.object({
    action: z.literal("publish"), versionId: uuid, announcementKey: uuid,
    version: z.number().int().positive(), draftVersionId: uuid,
    lifecycle: z.enum(["scheduled", "published"]), publishAt: timestamp,
    expiresAt: timestamp.nullable(), recipientCount: z.number().int().min(1).max(500),
    replayed: z.boolean(), persisted: z.literal(true), demo: z.literal(false),
  }).strict(),
  z.object({
    action: z.literal("withdraw"), versionId: uuid, announcementKey: uuid,
    version: z.number().int().positive(), previousVersionId: uuid,
    lifecycle: z.literal("withdrawn"), releaseVersionId: uuid, reason: cleanText(1_000),
    withdrawnAt: timestamp, replayed: z.boolean(), persisted: z.literal(true), demo: z.literal(false),
  }).strict(),
  z.object({
    action: z.literal("read"), releaseVersionId: uuid, announcementKey: uuid,
    readAt: timestamp, replayed: z.boolean(), persisted: z.literal(true), demo: z.literal(false),
  }).strict(),
]);

export function parseStaffAnnouncementApiEnvelope(
  value: unknown,
  input: StaffAnnouncementMutationInput,
) {
  const envelope = apiEnvelope.safeParse(value);
  if (!envelope.success) invalidResult();
  const data = resultData.safeParse(envelope.data.data);
  if (!data.success || data.data.action !== input.action) invalidResult();
  const syntheticRow = data.data.action === "draft" ? {
    version_id: data.data.versionId, announcement_key: data.data.announcementKey,
    version: data.data.version, previous_version_id: data.data.previousVersionId,
    version_state: data.data.versionState, publish_at: data.data.publishAt,
    expires_at: data.data.expiresAt, replayed: data.data.replayed,
  } : data.data.action === "publish" ? {
    version_id: data.data.versionId, announcement_key: data.data.announcementKey,
    version: data.data.version, draft_version_id: data.data.draftVersionId,
    lifecycle: data.data.lifecycle, publish_at: data.data.publishAt,
    expires_at: data.data.expiresAt, recipient_count: data.data.recipientCount,
    replayed: data.data.replayed,
  } : data.data.action === "withdraw" ? {
    version_id: data.data.versionId, announcement_key: data.data.announcementKey,
    version: data.data.version, previous_version_id: data.data.previousVersionId,
    lifecycle: data.data.lifecycle, withdrawn_release_version_id: data.data.releaseVersionId,
    withdrawal_reason: data.data.reason, withdrawn_at: data.data.withdrawnAt,
    replayed: data.data.replayed,
  } : {
    release_version_id: data.data.releaseVersionId,
    announcement_key: data.data.announcementKey, read_at: data.data.readAt,
    replayed: data.data.replayed,
  };
  parseStaffAnnouncementResult([syntheticRow], input);
  return { requestId: envelope.data.requestId, data: data.data };
}
