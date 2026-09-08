import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  CONSULTATION_ACTIONS,
  CONSULTATION_STATUSES,
  CONSULTATION_URGENCIES,
  type InterprofessionalConsultationMutationInput,
  type InterprofessionalConsultationOperationResult,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const narrative = (max: number) => z.string().trim().min(2).max(max)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const single = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const disciplineCode = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u);
const chain = z.object({
  consultationKey: uuid,
  previousEventId: uuid,
  expectedSequence: z.number().int().positive().max(10_000),
}).strict();
const createSchema = z.object({
  action: z.literal("create"), clientId: uuid, assigneeUserId: uuid.nullable().optional(),
  disciplineCode, disciplineLabel: single(100), urgency: z.enum(CONSULTATION_URGENCIES),
  requestedAt: timestamp, deadlineState: z.enum(["dated", "missing", "not_applicable"]),
  dueAt: timestamp.nullable(), problemSummary: narrative(2000),
}).strict();
const assignSchema = chain.extend({
  action: z.enum(["assign", "reassign"]), assigneeUserId: uuid,
  entryContent: narrative(4000).optional(),
}).strict();
const contentSchema = chain.extend({
  action: z.enum(["reply", "supplement", "close", "reopen"]),
  entryContent: narrative(4000),
}).strict();
const correctSchema = chain.extend({
  action: z.literal("correct"), correctsEventId: uuid, entryContent: narrative(4000),
}).strict();

const count = z.union([
  z.number().int().positive().safe(),
  z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().positive().safe()),
]);
const notificationCount = count.pipe(z.number().int().min(1).max(3));
const receiptSchema = z.object({
  organization_id: uuid, branch_id: uuid,
  operation_id: uuid, operation_kind: z.enum(CONSULTATION_ACTIONS),
  consultation_key: uuid, event_id: uuid, event_sequence: count,
  previous_event_id: uuid.nullable(),
  event_kind: z.enum(["created", "assigned", "reassigned", "reply", "supplement", "closed", "reopened", "corrected"]),
  consultation_status: z.enum(CONSULTATION_STATUSES),
  assignment_state: z.enum(["assigned", "unassigned"]),
  assignee_user_id: uuid.nullable(), deadline_state: z.enum(["dated", "missing", "not_applicable"]),
  notification_count: notificationCount, notification_queue_status: z.literal("queued"),
  notification_delivery_claim: z.literal("queued_not_delivered"),
  external_provider_status: z.literal("not_configured"), committed_at: timestamp,
  replayed: z.boolean(),
}).strict();
const successSchema = z.object({
  requestId: uuid, status: z.literal("ok"), errors: z.tuple([]),
  data: z.object({
    organizationId: uuid, branchId: uuid,
    operationId: uuid, operationKind: z.enum(CONSULTATION_ACTIONS), consultationKey: uuid,
    eventId: uuid, eventSequence: count, previousEventId: uuid.nullable(),
    eventKind: z.enum(["created", "assigned", "reassigned", "reply", "supplement", "closed", "reopened", "corrected"]),
    consultationStatus: z.enum(CONSULTATION_STATUSES), assignmentState: z.enum(["assigned", "unassigned"]),
    assigneeUserId: uuid.nullable(), deadlineState: z.enum(["dated", "missing", "not_applicable"]),
    notificationCount, notificationQueueStatus: z.literal("queued"),
    notificationDeliveryClaim: z.literal("queued_not_delivered"),
    externalProviderStatus: z.literal("not_configured"), committedAt: timestamp,
    replayed: z.boolean(), persisted: z.literal(true), demo: z.literal(false),
  }).strict(),
}).strict();
const errorSchema = z.object({
  requestId: uuid, status: z.literal("error"), data: z.null(),
  errors: z.array(z.object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,119}$/u),
    message: z.string().min(1).max(500)
      .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value)),
    field: z.string().regex(/^[a-z][A-Za-z0-9_.-]{0,119}$/u).optional(),
  }).strict()).min(1).max(10),
}).strict();

function invalid(message: string, field?: string): never {
  throw new IntegrationError("INVALID_INTERPROFESSIONAL_CONSULTATION", message, 400, field);
}

export function parseInterprofessionalConsultationMutation(
  body: Record<string, unknown>, key: string | null,
): InterprofessionalConsultationMutationInput {
  const parsedKey = uuid.safeParse(key);
  if (!parsedKey.success) invalid("請提供有效的 UUID 冪等鍵。", "idempotency-key");
  const schema = body.action === "create" ? createSchema
    : body.action === "assign" || body.action === "reassign" ? assignSchema
      : body.action === "correct" ? correctSchema
        : ["reply", "supplement", "close", "reopen"].includes(String(body.action))
          ? contentSchema : null;
  if (!schema) invalid("不支援的照會操作。", "action");
  const result = schema.safeParse(body);
  if (!result.success) invalid("照會內容、承辦人、期限或版本未通過驗證。");
  const data = result.data;
  if (data.action === "create" && (
    (data.deadlineState === "dated") !== (data.dueAt !== null) ||
    (data.dueAt !== null && data.dueAt < data.requestedAt)
  )) invalid("期限必須晚於提出時間；不適用與缺值不得混用。", "dueAt");
  if (data.action === "assign" && "entryContent" in data && data.entryContent !== undefined) {
    invalid("首次指派不接受改派理由。", "entryContent");
  }
  if (data.action === "reassign" && (!("entryContent" in data) || !data.entryContent)) {
    invalid("改派必須填寫理由。", "entryContent");
  }
  return {
    action: data.action,
    consultationKey: "consultationKey" in data ? data.consultationKey : null,
    previousEventId: "previousEventId" in data ? data.previousEventId : null,
    expectedSequence: "expectedSequence" in data ? data.expectedSequence : null,
    clientId: "clientId" in data ? data.clientId : null,
    assigneeUserId: "assigneeUserId" in data ? data.assigneeUserId ?? null : null,
    disciplineCode: "disciplineCode" in data ? data.disciplineCode : null,
    disciplineLabel: "disciplineLabel" in data ? data.disciplineLabel : null,
    urgency: "urgency" in data ? data.urgency : null,
    requestedAt: "requestedAt" in data ? data.requestedAt : null,
    deadlineState: "deadlineState" in data ? data.deadlineState : null,
    dueAt: "dueAt" in data ? data.dueAt : null,
    problemSummary: "problemSummary" in data ? data.problemSummary : null,
    entryContent: "entryContent" in data ? data.entryContent ?? null : null,
    correctsEventId: "correctsEventId" in data ? data.correctsEventId : null,
    idempotencyKey: parsedKey.data,
  };
}

export function parseInterprofessionalConsultationDatabaseReceipt(value: unknown) {
  const result = receiptSchema.safeParse(value);
  if (!result.success) throw new IntegrationError(
    "INTERPROFESSIONAL_CONSULTATION_RECEIPT_INVALID",
    "資料庫照會完成憑證不完整；畫面不會視為成功。", 502,
  );
  return result.data;
}

const eventForAction: Record<InterprofessionalConsultationMutationInput["action"], z.output<typeof receiptSchema>["event_kind"]> = {
  create: "created", assign: "assigned", reassign: "reassigned", reply: "reply",
  supplement: "supplement", close: "closed", reopen: "reopened", correct: "corrected",
};

export function correlateInterprofessionalConsultationReceipt(
  receipt: z.output<typeof receiptSchema>, input: InterprofessionalConsultationMutationInput,
  expectedOrganizationId: string, expectedBranchId: string,
) {
  const organization = uuid.safeParse(expectedOrganizationId);
  const branch = uuid.safeParse(expectedBranchId);
  if (!organization.success || !branch.success ||
      receipt.organization_id !== organization.data || receipt.branch_id !== branch.data ||
      receipt.operation_kind !== input.action || receipt.event_kind !== eventForAction[input.action] ||
      (input.consultationKey !== null && receipt.consultation_key !== input.consultationKey) ||
      (input.action === "create" && (receipt.event_sequence !== 1 || receipt.previous_event_id !== null)) ||
      (input.action !== "create" && (
        receipt.event_sequence !== input.expectedSequence! + 1 ||
        receipt.previous_event_id !== input.previousEventId
      )) ||
      (input.assigneeUserId !== null && receipt.assignee_user_id !== input.assigneeUserId) ||
      (input.deadlineState !== null && receipt.deadline_state !== input.deadlineState) ||
      (receipt.assignment_state === "unassigned") !== (receipt.assignee_user_id === null)) {
    throw new IntegrationError(
      "INTERPROFESSIONAL_CONSULTATION_RECEIPT_INVALID",
      "資料庫完成憑證與本次照會請求不一致；畫面不會視為成功。", 502,
    );
  }
  return receipt;
}

export function parseInterprofessionalConsultationApiSuccess(
  value: unknown, input: InterprofessionalConsultationMutationInput,
  expectedOrganizationId: string, expectedBranchId: string, httpStatus: number,
): { requestId: string; status: "ok"; errors: []; data: InterprofessionalConsultationOperationResult } {
  const result = successSchema.safeParse(value);
  if (!result.success || httpStatus !== (result.data.data.replayed ? 200 : 201)) {
    throw new Error("INVALID_INTERPROFESSIONAL_CONSULTATION_SUCCESS");
  }
  correlateInterprofessionalConsultationReceipt({
    organization_id: result.data.data.organizationId,
    branch_id: result.data.data.branchId,
    operation_id: result.data.data.operationId,
    operation_kind: result.data.data.operationKind,
    consultation_key: result.data.data.consultationKey,
    event_id: result.data.data.eventId,
    event_sequence: result.data.data.eventSequence,
    previous_event_id: result.data.data.previousEventId,
    event_kind: result.data.data.eventKind,
    consultation_status: result.data.data.consultationStatus,
    assignment_state: result.data.data.assignmentState,
    assignee_user_id: result.data.data.assigneeUserId,
    deadline_state: result.data.data.deadlineState,
    notification_count: result.data.data.notificationCount,
    notification_queue_status: result.data.data.notificationQueueStatus,
    notification_delivery_claim: result.data.data.notificationDeliveryClaim,
    external_provider_status: result.data.data.externalProviderStatus,
    committed_at: result.data.data.committedAt,
    replayed: result.data.data.replayed,
  }, input, expectedOrganizationId, expectedBranchId);
  return result.data;
}

export function parseInterprofessionalConsultationApiError(value: unknown) {
  const result = errorSchema.safeParse(value);
  return result.success ? result.data : null;
}
