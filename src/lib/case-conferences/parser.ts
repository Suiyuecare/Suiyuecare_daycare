import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  CASE_CONFERENCE_ACTIONS,
  CASE_CONFERENCE_ACTION_STATUSES,
  CASE_CONFERENCE_ATTENDANCE_STATUSES,
  CASE_CONFERENCE_DEADLINE_STATES,
  CASE_CONFERENCE_STATUSES,
  CASE_CONFERENCE_VERSION_KINDS,
  type CaseConferenceMutationInput,
  type CaseConferenceOperationResult,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const narrative = (max: number) => z.string().trim().min(2).max(max)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/u).transform(Number)
    .pipe(z.number().int().nonnegative().safe()),
]);
const positive = count.pipe(z.number().int().positive().max(10_000));

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function taipeiDate(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const calendarDate = z.string().refine(isCalendarDate);
const attendee = z.object({
  userId: uuid,
  attendanceStatus: z.enum(CASE_CONFERENCE_ATTENDANCE_STATUSES),
}).strict();
const actionItem = z.object({
  actionId: uuid,
  itemOrder: z.number().int().positive().max(50),
  actionText: narrative(2_000),
  responsibleUserId: uuid,
  deadlineState: z.enum(CASE_CONFERENCE_DEADLINE_STATES),
  dueDate: calendarDate.nullable(),
  actionStatus: z.enum(CASE_CONFERENCE_ACTION_STATUSES),
}).strict();
const content = z.object({
  meetingStartsAt: timestamp,
  meetingEndsAt: timestamp,
  problemStatement: narrative(4_000),
  decisionSummary: narrative(4_000),
  attendees: z.array(attendee).min(1).max(50),
  actionItems: z.array(actionItem).min(1).max(50),
}).strict();
const chain = z.object({
  meetingKey: uuid,
  previousVersionId: uuid,
  expectedVersion: z.number().int().positive().max(10_000),
}).strict();
const createSchema = content.extend({
  action: z.literal("create"),
  clientId: uuid,
}).strict();
const reviseSchema = chain.extend(content.shape).extend({
  action: z.literal("revise"),
}).strict();
const signSchema = chain.extend({ action: z.literal("sign") }).strict();
const correctSchema = chain.extend(content.shape).extend({
  action: z.literal("correct"),
  correctsVersionId: uuid,
  correctionReason: narrative(1_000),
}).strict();

const receiptSchema = z.object({
  organization_id: uuid,
  branch_id: uuid,
  operation_id: uuid,
  operation_kind: z.enum(CASE_CONFERENCE_ACTIONS),
  meeting_key: uuid,
  version_id: uuid,
  version: positive,
  previous_version_id: uuid.nullable(),
  corrects_version_id: uuid.nullable(),
  version_kind: z.enum(CASE_CONFERENCE_VERSION_KINDS),
  conference_status: z.enum(CASE_CONFERENCE_STATUSES),
  signed_at: timestamp.nullable(),
  content_hash: hash,
  attachment_status: z.literal("not_configured"),
  export_status: z.literal("not_configured"),
  notification_status: z.literal("not_configured"),
  external_delivery_status: z.literal("not_configured"),
  delivery_claim: z.literal("no_external_delivery_claim"),
  offline_status: z.literal("not_configured"),
  committed_at: timestamp,
  replayed: z.boolean(),
}).strict();
const successSchema = z.object({
  requestId: uuid,
  status: z.literal("ok"),
  errors: z.tuple([]),
  data: z.object({
    organizationId: uuid,
    branchId: uuid,
    operationId: uuid,
    operationKind: z.enum(CASE_CONFERENCE_ACTIONS),
    meetingKey: uuid,
    versionId: uuid,
    version: positive,
    previousVersionId: uuid.nullable(),
    correctsVersionId: uuid.nullable(),
    versionKind: z.enum(CASE_CONFERENCE_VERSION_KINDS),
    conferenceStatus: z.enum(CASE_CONFERENCE_STATUSES),
    signedAt: timestamp.nullable(),
    contentHash: hash,
    attachmentStatus: z.literal("not_configured"),
    exportStatus: z.literal("not_configured"),
    notificationStatus: z.literal("not_configured"),
    externalDeliveryStatus: z.literal("not_configured"),
    deliveryClaim: z.literal("no_external_delivery_claim"),
    offlineStatus: z.literal("not_configured"),
    committedAt: timestamp,
    replayed: z.boolean(),
    persisted: z.literal(true),
    demo: z.literal(false),
  }).strict(),
}).strict();
const errorSchema = z.object({
  requestId: uuid,
  status: z.literal("error"),
  data: z.null(),
  errors: z.array(z.object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,119}$/u),
    message: z.string().min(1).max(500)
      .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value)),
    field: z.string().regex(/^[a-z][A-Za-z0-9_.-]{0,119}$/u).optional(),
  }).strict()).min(1).max(10),
}).strict();

function invalid(message: string, field?: string): never {
  throw new IntegrationError("INVALID_CASE_CONFERENCE", message, 400, field);
}

function validateContent(value: z.output<typeof content>) {
  if (Date.parse(value.meetingEndsAt) <= Date.parse(value.meetingStartsAt)) {
    invalid("會議結束時間必須晚於開始時間。", "meetingEndsAt");
  }
  if (new Set(value.attendees.map((item) => item.userId)).size !== value.attendees.length) {
    invalid("同一出席者不可重複。", "attendees");
  }
  if (new Set(value.actionItems.map((item) => item.actionId)).size !== value.actionItems.length ||
      value.actionItems.some((item, index) => item.itemOrder !== index + 1)) {
    invalid("行動項目識別碼與順序必須唯一且連續。", "actionItems");
  }
  for (const item of value.actionItems) {
    if ((item.deadlineState === "dated") !== (item.dueDate !== null) ||
        (item.dueDate !== null && item.dueDate < taipeiDate(value.meetingStartsAt))) {
      invalid("人工期限日期、缺值與不適用必須分開保存。", "actionItems.deadlineState");
    }
  }
}

export function parseCaseConferenceMutation(
  body: Record<string, unknown>, key: string | null,
): CaseConferenceMutationInput {
  const parsedKey = uuid.safeParse(key);
  if (!parsedKey.success) invalid("請提供有效的 UUID 冪等鍵。", "idempotency-key");
  const schema = body.action === "create" ? createSchema
    : body.action === "revise" ? reviseSchema
      : body.action === "sign" ? signSchema
        : body.action === "correct" ? correctSchema : null;
  if (!schema) invalid("不支援的個案研討會議操作。", "action");
  const parsed = schema.safeParse(body);
  if (!parsed.success) invalid("會議內容、出席者、行動、期限或版本未通過驗證。");
  const data = parsed.data;
  if (data.action !== "sign") validateContent(data);
  return {
    action: data.action,
    meetingKey: "meetingKey" in data ? data.meetingKey : null,
    previousVersionId: "previousVersionId" in data ? data.previousVersionId : null,
    expectedVersion: "expectedVersion" in data ? data.expectedVersion : null,
    correctsVersionId: "correctsVersionId" in data ? data.correctsVersionId : null,
    clientId: "clientId" in data ? data.clientId : null,
    meetingStartsAt: "meetingStartsAt" in data ? data.meetingStartsAt : null,
    meetingEndsAt: "meetingEndsAt" in data ? data.meetingEndsAt : null,
    problemStatement: "problemStatement" in data ? data.problemStatement : null,
    decisionSummary: "decisionSummary" in data ? data.decisionSummary : null,
    attendees: "attendees" in data ? data.attendees : null,
    actionItems: "actionItems" in data ? data.actionItems : null,
    correctionReason: "correctionReason" in data ? data.correctionReason : null,
    idempotencyKey: parsedKey.data,
  };
}

export function parseCaseConferenceDatabaseReceipt(value: unknown) {
  const parsed = receiptSchema.safeParse(value);
  if (!parsed.success) throw new IntegrationError(
    "CASE_CONFERENCE_RECEIPT_INVALID",
    "資料庫個案研討會議完成憑證不完整；畫面不會視為成功。", 502,
  );
  return parsed.data;
}

const kindForAction = {
  create: "created", revise: "revised", sign: "signed", correct: "corrected",
} as const;
const statusForAction = {
  create: "draft", revise: "draft", sign: "signed", correct: "signed",
} as const;

export function correlateCaseConferenceReceipt(
  receipt: z.output<typeof receiptSchema>,
  input: CaseConferenceMutationInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
) {
  const organization = uuid.safeParse(expectedOrganizationId);
  const branch = uuid.safeParse(expectedBranchId);
  const signed = input.action === "sign" || input.action === "correct";
  if (!organization.success || !branch.success ||
      receipt.organization_id !== organization.data || receipt.branch_id !== branch.data ||
      receipt.operation_kind !== input.action || receipt.version_kind !== kindForAction[input.action] ||
      receipt.conference_status !== statusForAction[input.action] ||
      (input.meetingKey !== null && receipt.meeting_key !== input.meetingKey) ||
      (input.action === "create" && (
        receipt.version !== 1 || receipt.previous_version_id !== null ||
        receipt.corrects_version_id !== null
      )) ||
      (input.action !== "create" && (
        receipt.version !== input.expectedVersion! + 1 ||
        receipt.previous_version_id !== input.previousVersionId
      )) ||
      receipt.corrects_version_id !== input.correctsVersionId ||
      signed !== (receipt.signed_at !== null)) {
    throw new IntegrationError(
      "CASE_CONFERENCE_RECEIPT_INVALID",
      "資料庫完成憑證與本次個案研討會議請求不一致；畫面不會視為成功。", 502,
    );
  }
  return receipt;
}

export function parseCaseConferenceApiSuccess(
  value: unknown,
  input: CaseConferenceMutationInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
  httpStatus: number,
): { requestId: string; status: "ok"; errors: []; data: CaseConferenceOperationResult } {
  const parsed = successSchema.safeParse(value);
  if (!parsed.success || httpStatus !== (parsed.data.data.replayed ? 200 : 201)) {
    throw new Error("INVALID_CASE_CONFERENCE_SUCCESS");
  }
  correlateCaseConferenceReceipt({
    organization_id: parsed.data.data.organizationId,
    branch_id: parsed.data.data.branchId,
    operation_id: parsed.data.data.operationId,
    operation_kind: parsed.data.data.operationKind,
    meeting_key: parsed.data.data.meetingKey,
    version_id: parsed.data.data.versionId,
    version: parsed.data.data.version,
    previous_version_id: parsed.data.data.previousVersionId,
    corrects_version_id: parsed.data.data.correctsVersionId,
    version_kind: parsed.data.data.versionKind,
    conference_status: parsed.data.data.conferenceStatus,
    signed_at: parsed.data.data.signedAt,
    content_hash: parsed.data.data.contentHash,
    attachment_status: parsed.data.data.attachmentStatus,
    export_status: parsed.data.data.exportStatus,
    notification_status: parsed.data.data.notificationStatus,
    external_delivery_status: parsed.data.data.externalDeliveryStatus,
    delivery_claim: parsed.data.data.deliveryClaim,
    offline_status: parsed.data.data.offlineStatus,
    committed_at: parsed.data.data.committedAt,
    replayed: parsed.data.data.replayed,
  }, input, expectedOrganizationId, expectedBranchId);
  return parsed.data;
}

export function parseCaseConferenceApiError(value: unknown) {
  const parsed = errorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
