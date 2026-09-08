import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  REFERRAL_ACTIONS,
  REFERRAL_RECEIVING_UNIT_STATES,
  REFERRAL_STATUSES,
  type ReferralManagementMutationInput,
  type ReferralManagementOperationResult,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const narrative = (max: number) => z.string().trim().min(2).max(max)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const single = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const unitCode = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u);
const chain = z.object({
  referralKey: uuid,
  previousEventId: uuid,
  expectedSequence: z.number().int().positive().max(10_000),
}).strict();
const createSchema = z.object({
  action: z.literal("create"),
  clientId: uuid,
  receivingUnitState: z.enum(REFERRAL_RECEIVING_UNIT_STATES),
  receivingUnitCode: unitCode.nullable(),
  receivingUnitName: single(160).nullable(),
  referralDate: timestamp,
  referralReason: narrative(2000),
}).strict();
const submitSchema = chain.extend({
  action: z.literal("submit"),
  entryContent: narrative(4000).optional(),
}).strict();
const transitionSchema = chain.extend({
  action: z.enum(["register_received", "respond", "close"]),
  entryContent: narrative(4000),
}).strict();
const correctSchema = chain.extend({
  action: z.literal("correct"),
  correctsEventId: uuid,
  entryContent: narrative(4000),
  correctionReason: narrative(500),
}).strict();

const count = z.union([
  z.number().int().positive().safe(),
  z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().positive().safe()),
]);
const notificationCount = count.pipe(z.number().int().min(1).max(2));
const eventKind = z.enum([
  "created", "submitted", "receipt_registered", "response_recorded", "closed", "corrected",
]);
const receiptSchema = z.object({
  organization_id: uuid,
  branch_id: uuid,
  operation_id: uuid,
  operation_kind: z.enum(REFERRAL_ACTIONS),
  referral_key: uuid,
  event_id: uuid,
  event_sequence: count,
  previous_event_id: uuid.nullable(),
  event_kind: eventKind,
  referral_status: z.enum(REFERRAL_STATUSES),
  receiving_unit_state: z.enum(REFERRAL_RECEIVING_UNIT_STATES),
  notification_count: notificationCount,
  notification_queue_status: z.literal("queued"),
  notification_provider_status: z.literal("not_configured"),
  external_delivery_status: z.literal("not_configured"),
  delivery_claim: z.literal("no_external_delivery_claim"),
  attachment_status: z.literal("not_configured"),
  export_status: z.literal("not_configured"),
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
    operationKind: z.enum(REFERRAL_ACTIONS),
    referralKey: uuid,
    eventId: uuid,
    eventSequence: count,
    previousEventId: uuid.nullable(),
    eventKind,
    referralStatus: z.enum(REFERRAL_STATUSES),
    receivingUnitState: z.enum(REFERRAL_RECEIVING_UNIT_STATES),
    notificationCount,
    notificationQueueStatus: z.literal("queued"),
    notificationProviderStatus: z.literal("not_configured"),
    externalDeliveryStatus: z.literal("not_configured"),
    deliveryClaim: z.literal("no_external_delivery_claim"),
    attachmentStatus: z.literal("not_configured"),
    exportStatus: z.literal("not_configured"),
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
  throw new IntegrationError("INVALID_REFERRAL_MANAGEMENT", message, 400, field);
}

export function parseReferralManagementMutation(
  body: Record<string, unknown>, key: string | null,
): ReferralManagementMutationInput {
  const parsedKey = uuid.safeParse(key);
  if (!parsedKey.success) invalid("請提供有效的 UUID 冪等鍵。", "idempotency-key");
  const schema = body.action === "create" ? createSchema
    : body.action === "submit" ? submitSchema
      : body.action === "correct" ? correctSchema
        : ["register_received", "respond", "close"].includes(String(body.action))
          ? transitionSchema : null;
  if (!schema) invalid("不支援的轉介操作。", "action");
  const parsed = schema.safeParse(body);
  if (!parsed.success) invalid("轉介內容、接收單位、狀態或版本未通過驗證。");
  const data = parsed.data;
  if (data.action === "create") {
    const hasUnit = data.receivingUnitCode !== null && data.receivingUnitName !== null;
    if ((data.receivingUnitState === "manual_unstandardized") !== hasUnit ||
        (data.receivingUnitCode === null) !== (data.receivingUnitName === null)) {
      invalid("人工接收單位必須同時提供代碼與名稱；缺值與不適用不得混用。", "receivingUnitState");
    }
  }
  return {
    action: data.action,
    referralKey: "referralKey" in data ? data.referralKey : null,
    previousEventId: "previousEventId" in data ? data.previousEventId : null,
    expectedSequence: "expectedSequence" in data ? data.expectedSequence : null,
    clientId: "clientId" in data ? data.clientId : null,
    receivingUnitState: "receivingUnitState" in data ? data.receivingUnitState : null,
    receivingUnitCode: "receivingUnitCode" in data ? data.receivingUnitCode : null,
    receivingUnitName: "receivingUnitName" in data ? data.receivingUnitName : null,
    referralDate: "referralDate" in data ? data.referralDate : null,
    referralReason: "referralReason" in data ? data.referralReason : null,
    entryContent: "entryContent" in data ? data.entryContent ?? null : null,
    correctionReason: "correctionReason" in data ? data.correctionReason : null,
    correctsEventId: "correctsEventId" in data ? data.correctsEventId : null,
    idempotencyKey: parsedKey.data,
  };
}

export function parseReferralManagementDatabaseReceipt(value: unknown) {
  const parsed = receiptSchema.safeParse(value);
  if (!parsed.success) throw new IntegrationError(
    "REFERRAL_MANAGEMENT_RECEIPT_INVALID",
    "資料庫轉介完成憑證不完整；畫面不會視為成功。", 502,
  );
  return parsed.data;
}

const eventForAction: Record<ReferralManagementMutationInput["action"], z.output<typeof eventKind>> = {
  create: "created",
  submit: "submitted",
  register_received: "receipt_registered",
  respond: "response_recorded",
  close: "closed",
  correct: "corrected",
};
const statusForAction: Partial<Record<ReferralManagementMutationInput["action"], z.output<typeof receiptSchema>["referral_status"]>> = {
  create: "draft",
  submit: "submitted",
  register_received: "received",
  respond: "responded",
  close: "closed",
};

export function correlateReferralManagementReceipt(
  receipt: z.output<typeof receiptSchema>,
  input: ReferralManagementMutationInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
) {
  const organization = uuid.safeParse(expectedOrganizationId);
  const branch = uuid.safeParse(expectedBranchId);
  const expectedStatus = statusForAction[input.action];
  if (!organization.success || !branch.success ||
      receipt.organization_id !== organization.data || receipt.branch_id !== branch.data ||
      receipt.operation_kind !== input.action || receipt.event_kind !== eventForAction[input.action] ||
      (expectedStatus !== undefined && receipt.referral_status !== expectedStatus) ||
      (input.referralKey !== null && receipt.referral_key !== input.referralKey) ||
      (input.action === "create" && (receipt.event_sequence !== 1 || receipt.previous_event_id !== null)) ||
      (input.action !== "create" && (
        receipt.event_sequence !== input.expectedSequence! + 1 ||
        receipt.previous_event_id !== input.previousEventId
      )) ||
      (input.receivingUnitState !== null && receipt.receiving_unit_state !== input.receivingUnitState)) {
    throw new IntegrationError(
      "REFERRAL_MANAGEMENT_RECEIPT_INVALID",
      "資料庫完成憑證與本次轉介請求不一致；畫面不會視為成功。", 502,
    );
  }
  return receipt;
}

export function parseReferralManagementApiSuccess(
  value: unknown,
  input: ReferralManagementMutationInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
  httpStatus: number,
): { requestId: string; status: "ok"; errors: []; data: ReferralManagementOperationResult } {
  const parsed = successSchema.safeParse(value);
  if (!parsed.success || httpStatus !== (parsed.data.data.replayed ? 200 : 201)) {
    throw new Error("INVALID_REFERRAL_MANAGEMENT_SUCCESS");
  }
  correlateReferralManagementReceipt({
    organization_id: parsed.data.data.organizationId,
    branch_id: parsed.data.data.branchId,
    operation_id: parsed.data.data.operationId,
    operation_kind: parsed.data.data.operationKind,
    referral_key: parsed.data.data.referralKey,
    event_id: parsed.data.data.eventId,
    event_sequence: parsed.data.data.eventSequence,
    previous_event_id: parsed.data.data.previousEventId,
    event_kind: parsed.data.data.eventKind,
    referral_status: parsed.data.data.referralStatus,
    receiving_unit_state: parsed.data.data.receivingUnitState,
    notification_count: parsed.data.data.notificationCount,
    notification_queue_status: parsed.data.data.notificationQueueStatus,
    notification_provider_status: parsed.data.data.notificationProviderStatus,
    external_delivery_status: parsed.data.data.externalDeliveryStatus,
    delivery_claim: parsed.data.data.deliveryClaim,
    attachment_status: parsed.data.data.attachmentStatus,
    export_status: parsed.data.data.exportStatus,
    committed_at: parsed.data.data.committedAt,
    replayed: parsed.data.data.replayed,
  }, input, expectedOrganizationId, expectedBranchId);
  return parsed.data;
}

export function parseReferralManagementApiError(value: unknown) {
  const parsed = errorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
