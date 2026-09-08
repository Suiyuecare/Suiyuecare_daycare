import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  ABNORMAL_ACTIONS,
  ABNORMAL_AFFECTED_TARGET_KINDS,
  ABNORMAL_DUE_DATE_ACTIONS,
  ABNORMAL_HANDLING_STATUSES,
  ABNORMAL_MAJOR_STATES,
  type AbnormalAction,
  type AbnormalAffectedTargetKind,
  type AbnormalEventMutationInput,
  type AbnormalEventOperationResult,
  type ReportAbnormalEventInput,
} from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine(
  (value) => isStrictOffsetDateTime(value) && Number.isFinite(new Date(value).getTime()),
).transform((value) => new Date(value).toISOString());
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const safeText = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const narrativeText = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const nullableNarrative = (max: number) => z.union([narrativeText(max), z.null()]);
const nullableUuid = z.union([uuid, z.null()]);
const chainVersion = z.number().int().nonnegative().safe();

const targetScope = {
  affectedTargetKind: z.enum(ABNORMAL_AFFECTED_TARGET_KINDS),
  affectedClientId: nullableUuid,
};

const reportSchema = z.object({
  action: z.literal("report"),
  ...targetScope,
  affectedTargetLabel: z.union([safeText(240), z.null()]),
  occurredAt: timestamp,
  location: safeText(240),
  eventType: safeText(240),
  eventSummary: narrativeText(2000),
  immediateAction: narrativeText(2000),
  majorState: z.enum(ABNORMAL_MAJOR_STATES),
  responsibleMembershipId: uuid,
  improvementDueDate: calendarDate,
  lateEntryReason: nullableNarrative(1000),
}).strict().superRefine((value, context) => {
  const client = value.affectedTargetKind === "client";
  if (client !== (value.affectedClientId !== null) || client === (value.affectedTargetLabel !== null)) {
    context.addIssue({ code: "custom", path: ["affectedTargetKind"], message: "affected target mismatch" });
  }
});

const mutationBase = {
  ...targetScope,
  incidentId: uuid,
  occurredAt: timestamp,
  expectedChainVersion: chainVersion,
};

const manualNotificationSchema = z.object({
  action: z.literal("manual_notification"),
  ...mutationBase,
  notificationTarget: safeText(240),
  notificationMethod: safeText(120),
  notificationResult: narrativeText(1000),
}).strict();

const improvementSchema = z.object({
  action: z.enum(["improvement", "follow_up"]),
  ...mutationBase,
  entryText: narrativeText(2000),
  responsibleMembershipId: uuid,
  dueDateAction: z.enum(ABNORMAL_DUE_DATE_ACTIONS),
  dueDateValue: z.union([calendarDate, z.null()]),
}).strict().superRefine((value, context) => {
  if ((value.dueDateAction === "replace") !== (value.dueDateValue !== null)) {
    context.addIssue({ code: "custom", path: ["dueDateValue"], message: "due date action mismatch" });
  }
});

const closeSchema = z.object({
  action: z.literal("close"),
  ...mutationBase,
  closureOutcome: narrativeText(2000),
  closureReason: narrativeText(1000),
}).strict();

const resultSchema = z.object({
  operation_id: uuid,
  incident_id: uuid,
  entry_id: uuid.nullable(),
  operation_kind: z.enum(ABNORMAL_ACTIONS),
  affected_target_kind: z.enum(ABNORMAL_AFFECTED_TARGET_KINDS),
  affected_client_id: nullableUuid,
  chain_version: z.union([chainVersion, z.string().regex(/^\d+$/u).transform(Number).pipe(chainVersion)]),
  handling_status: z.enum(ABNORMAL_HANDLING_STATUSES),
  responsible_membership_id: uuid,
  effective_due_date: calendarDate,
  committed_at: timestamp,
  replayed: z.boolean(),
}).strict().superRefine((value, context) => {
  if ((value.affected_target_kind === "client") !== (value.affected_client_id !== null)) {
    context.addIssue({ code: "custom", path: ["affected_client_id"], message: "target receipt mismatch" });
  }
});

const dataSchema = z.object({
  operationId: uuid,
  incidentId: uuid,
  entryId: uuid.nullable(),
  operationKind: z.enum(ABNORMAL_ACTIONS),
  affectedTargetKind: z.enum(ABNORMAL_AFFECTED_TARGET_KINDS),
  affectedClientId: nullableUuid,
  chainVersion,
  handlingStatus: z.enum(ABNORMAL_HANDLING_STATUSES),
  responsibleMembershipId: uuid,
  effectiveDueDate: calendarDate,
  committedAt: timestamp,
  replayed: z.boolean(),
  persisted: z.literal(true),
  demo: z.literal(false),
}).strict();

const apiSuccessSchema = z.object({
  requestId: uuid,
  status: z.literal("ok"),
  data: dataSchema,
  errors: z.tuple([]),
}).strict();
const apiErrorSchema = z.object({
  requestId: uuid,
  status: z.literal("error"),
  data: z.null(),
  errors: z.array(z.object({
    code: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(500),
    field: z.string().trim().min(1).max(120).optional(),
  }).strict()).min(1).max(10),
}).strict();

function invalid(message: string, field?: string): never {
  throw new IntegrationError("INVALID_ABNORMAL_EVENT", message, 400, field);
}
function parseKey(value: string | null) {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) invalid("請提供有效的 UUID 冪等鍵。", "idempotency-key");
  return parsed.data;
}

export function parseAbnormalEventReport(
  body: Record<string, unknown>, key: string | null,
): ReportAbnormalEventInput {
  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) invalid("事件、影響對象、重大性、責任人、改善期限或補登理由未通過驗證。");
  return { ...parsed.data, idempotencyKey: parseKey(key) };
}

export function parseAbnormalEventMutation(
  body: Record<string, unknown>, key: string | null,
): AbnormalEventMutationInput {
  const schema = body.action === "manual_notification" ? manualNotificationSchema
    : body.action === "improvement" || body.action === "follow_up" ? improvementSchema
      : body.action === "close" ? closeSchema : null;
  if (!schema) invalid("不支援的異常事件操作。", "action");
  const parsed = schema.safeParse(body);
  if (!parsed.success) invalid("時間軸內容、人工通知證據、責任人、期限或結案內容未通過驗證。");
  return { ...parsed.data, idempotencyKey: parseKey(key) } as AbnormalEventMutationInput;
}

export function parseAbnormalEventOperationResult(
  value: unknown,
): Omit<AbnormalEventOperationResult, "persisted" | "demo"> {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) throw new IntegrationError(
    "ABNORMAL_EVENT_RECEIPT_INVALID",
    "資料庫完成憑證格式不完整；畫面不會把操作當作成功。",
    502,
  );
  return {
    operationId: parsed.data.operation_id,
    incidentId: parsed.data.incident_id,
    entryId: parsed.data.entry_id,
    operationKind: parsed.data.operation_kind,
    affectedTargetKind: parsed.data.affected_target_kind,
    affectedClientId: parsed.data.affected_client_id,
    chainVersion: parsed.data.chain_version,
    handlingStatus: parsed.data.handling_status,
    responsibleMembershipId: parsed.data.responsible_membership_id,
    effectiveDueDate: parsed.data.effective_due_date,
    committedAt: parsed.data.committed_at,
    replayed: parsed.data.replayed,
  };
}

export type AbnormalEventActionExpectation = {
  action: AbnormalAction;
  incidentId?: string;
  affectedTargetKind: AbnormalAffectedTargetKind;
  affectedClientId: string | null;
  expectedChainVersion?: number;
  responsibleMembershipId: string;
  effectiveDueDate: string;
};

export function parseAbnormalEventActionSuccess(
  value: unknown, expected: AbnormalEventActionExpectation,
) {
  const parsed = apiSuccessSchema.safeParse(value);
  if (!parsed.success) throw new Error("INVALID_ABNORMAL_EVENT_SUCCESS");
  const data = parsed.data.data;
  const expectedStatus = expected.action === "report" ? "reported"
    : expected.action === "close" ? "closed" : "in_progress";
  if (
    data.operationKind !== expected.action ||
    data.affectedTargetKind !== expected.affectedTargetKind ||
    data.affectedClientId !== expected.affectedClientId ||
    (expected.incidentId !== undefined && data.incidentId !== expected.incidentId) ||
    (expected.expectedChainVersion !== undefined && data.chainVersion !== expected.expectedChainVersion + 1) ||
    data.handlingStatus !== expectedStatus ||
    data.responsibleMembershipId !== expected.responsibleMembershipId ||
    data.effectiveDueDate !== expected.effectiveDueDate ||
    (expected.action === "report" ? data.entryId !== null || data.chainVersion !== 0 : data.entryId === null)
  ) throw new Error("MISMATCHED_ABNORMAL_EVENT_SUCCESS");
  return parsed.data;
}

export function parseAbnormalEventActionError(value: unknown) {
  const parsed = apiErrorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
