import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import type { ApiEnvelope } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";

import {
  FEEDBACK_ACTIONS,
  FEEDBACK_RISKS,
  FEEDBACK_STATES,
  type FeedbackComplaintMutationInput,
  type FeedbackComplaintMutationReceipt,
} from "./types";

export const FEEDBACK_MUTATION_MAX_BYTES = 32 * 1024;
const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const clean = (maximum: number) => z.string().trim().min(1).max(maximum)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const narrative = (maximum: number) => z.string().trim().min(1).max(maximum)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const optionalClean = (maximum: number) => z.union([clean(maximum), z.null()]);
const expectedVersion = z.number().int().positive().max(1_000_000);

const createSchema = z.object({
  action: z.literal("create"),
  deadline_rule_id: uuid,
  received_at: timestamp,
  reporter_name: optionalClean(160),
  reporter_contact: optionalClean(240),
  subject: clean(240),
  description: narrative(4_000),
}).strict();
const assignSchema = z.object({
  action: z.literal("assign"), case_id: uuid, expected_version: expectedVersion,
  assignee_membership_id: uuid, note: z.union([narrative(1_000), z.null()]),
}).strict();
const progressSchema = z.object({
  action: z.literal("progress"), case_id: uuid,
  expected_version: expectedVersion, note: narrative(2_000),
}).strict();
const correctSchema = z.object({
  action: z.literal("correct"), case_id: uuid,
  expected_version: expectedVersion, corrected_event_id: uuid,
  correction_reason: narrative(1_000), reporter_name: optionalClean(160),
  reporter_contact: optionalClean(240), subject: clean(240),
  description: narrative(4_000),
}).strict();
const closeSchema = z.object({
  action: z.literal("close"), case_id: uuid,
  expected_version: expectedVersion, resolution: narrative(4_000),
}).strict();
const mutationSchema = z.discriminatedUnion("action", [
  createSchema, assignSchema, progressSchema, correctSchema, closeSchema,
]);

const receiptSchema = z.object({
  operation_id: uuid,
  action: z.enum(FEEDBACK_ACTIONS),
  case_id: uuid,
  case_number: z.string().regex(/^FC-\d{8}-[A-F0-9]{8}$/u),
  event_id: uuid,
  version: z.number().int().positive().safe(),
  status: z.enum(FEEDBACK_STATES),
  effective_risk: z.enum(FEEDBACK_RISKS),
  due_at: timestamp,
  committed_at: timestamp,
  replayed: z.boolean(),
}).strict();

function invalid(message: string): never {
  throw new IntegrationError("INVALID_FEEDBACK_OPERATION", message, 400);
}

export function parseFeedbackComplaintMutation(
  value: unknown,
  idempotencyHeader: string | null,
): FeedbackComplaintMutationInput {
  const parsed = mutationSchema.safeParse(value);
  const key = uuid.safeParse(idempotencyHeader);
  if (!parsed.success || !key.success) invalid(
    "意見與申訴操作內容或冪等鍵無效。",
  );
  const body = parsed.data;
  if (body.action === "create") return {
    action: body.action,
    deadlineRuleId: body.deadline_rule_id,
    receivedAt: body.received_at,
    reporterName: body.reporter_name,
    reporterContact: body.reporter_contact,
    subject: body.subject,
    description: body.description,
    idempotencyKey: key.data,
  };
  if (body.action === "assign") return {
    action: body.action, caseId: body.case_id,
    expectedVersion: body.expected_version,
    assigneeMembershipId: body.assignee_membership_id,
    note: body.note, idempotencyKey: key.data,
  };
  if (body.action === "progress") return {
    action: body.action, caseId: body.case_id,
    expectedVersion: body.expected_version,
    note: body.note, idempotencyKey: key.data,
  };
  if (body.action === "correct") return {
    action: body.action, caseId: body.case_id,
    expectedVersion: body.expected_version,
    correctedEventId: body.corrected_event_id,
    correctionReason: body.correction_reason,
    reporterName: body.reporter_name,
    reporterContact: body.reporter_contact,
    subject: body.subject,
    description: body.description,
    idempotencyKey: key.data,
  };
  return {
    action: body.action, caseId: body.case_id,
    expectedVersion: body.expected_version,
    resolution: body.resolution, idempotencyKey: key.data,
  };
}

export function parseFeedbackComplaintReceipt(
  value: unknown,
  input: FeedbackComplaintMutationInput,
): FeedbackComplaintMutationReceipt {
  const parsed = receiptSchema.safeParse(value);
  if (!parsed.success) throw new IntegrationError(
    "FEEDBACK_RECEIPT_INVALID",
    "意見與申訴操作回執不完整；請保留相同操作鍵核對。", 502,
  );
  const row = parsed.data;
  const expectedVersion = input.action === "create" ? 1 : input.expectedVersion + 1;
  if (row.action !== input.action || row.version !== expectedVersion ||
    (input.action !== "create" && row.case_id !== input.caseId) ||
    (input.action === "close" && row.status !== "closed") ||
    (input.action !== "close" && row.status === "closed")) {
    throw new IntegrationError(
      "FEEDBACK_RECEIPT_INVALID",
      "意見與申訴回執與送出案件、動作、版本或狀態不一致；請重新載入。", 502,
    );
  }
  return {
    operationId: row.operation_id,
    action: row.action,
    caseId: row.case_id,
    caseNumber: row.case_number,
    eventId: row.event_id,
    version: row.version,
    status: row.status,
    effectiveRisk: row.effective_risk,
    dueAt: row.due_at,
    committedAt: row.committed_at,
    replayed: row.replayed,
    persisted: true,
    demo: false,
  };
}

const apiErrorSchema = z.object({
  requestId: z.string().min(1), status: z.literal("error"), data: z.null(),
  errors: z.array(z.object({ code: z.string(), message: z.string(),
    field: z.string().optional() }).passthrough()).min(1),
}).passthrough();
const clientReceiptSchema = z.object({
  operationId: uuid,
  action: z.enum(FEEDBACK_ACTIONS),
  caseId: uuid,
  caseNumber: z.string().regex(/^FC-\d{8}-[A-F0-9]{8}$/u),
  eventId: uuid,
  version: z.number().int().positive().safe(),
  status: z.enum(FEEDBACK_STATES),
  effectiveRisk: z.enum(FEEDBACK_RISKS),
  dueAt: timestamp,
  committedAt: timestamp,
  replayed: z.boolean(),
  persisted: z.literal(true),
  demo: z.literal(false),
}).strict();
const apiSuccessSchema = z.object({
  requestId: z.string().min(1), status: z.literal("ok"),
  data: clientReceiptSchema,
  errors: z.array(z.never()).length(0),
}).passthrough();

export function parseFeedbackComplaintActionError(value: unknown) {
  const parsed = apiErrorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseFeedbackComplaintActionSuccess(
  value: unknown,
  input: FeedbackComplaintMutationInput,
): ApiEnvelope<FeedbackComplaintMutationReceipt> {
  const parsed = apiSuccessSchema.safeParse(value);
  if (!parsed.success) throw new Error("invalid feedback complaint success envelope");
  const data = parsed.data.data;
  const expectedVersion = input.action === "create" ? 1 : input.expectedVersion + 1;
  if (data.action !== input.action || data.version !== expectedVersion ||
    (input.action !== "create" && data.caseId !== input.caseId) ||
    (input.action === "close" && data.status !== "closed") ||
    (input.action !== "close" && data.status === "closed")) {
    throw new Error("feedback complaint success receipt does not correlate");
  }
  return {
    requestId: parsed.data.requestId,
    status: "ok",
    data,
    errors: [],
  };
}
