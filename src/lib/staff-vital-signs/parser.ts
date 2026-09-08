import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import type {
  StaffVitalSignRecordInput,
  StaffVitalSignRecordReceipt,
} from "./types";

export const STAFF_VITAL_SIGN_RECORD_MAX_BYTES = 32 * 1024;

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const clean = (max: number, multiline = false) => z.string().trim().min(1).max(max)
  .refine((value) => multiline
    ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    : !/[\u0000-\u001f\u007f]/u.test(value));
const decimalText = z.string().trim().regex(
  /^[+-]?(?:[0-9]{1,18}(?:\.[0-9]{1,12})?|\.[0-9]{1,12})$/u,
);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);

const contentSchema = {
  vital_sign_key: uuid,
  staff_membership_id: uuid,
  measurement_type: clean(120),
  value_status: z.enum(["measured", "missing", "not_applicable"]),
  value_decimal_text: decimalText.nullable(),
  unit: clean(40).nullable(),
  status_reason: clean(500, true).nullable(),
  occurred_at: timestamp,
  source: clean(160),
  note: clean(1_000, true).nullable(),
};

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), ...contentSchema,
    previous_version_id: z.null(), expected_base_version: z.literal(0),
    correction_reason: z.null(),
  }).strict(),
  z.object({ action: z.literal("correct"), ...contentSchema,
    previous_version_id: uuid,
    expected_base_version: z.number().int().positive().safe(),
    correction_reason: clean(1_000, true),
  }).strict(),
  z.object({ action: z.literal("void"), vital_sign_key: uuid,
    previous_version_id: uuid,
    expected_base_version: z.number().int().positive().safe(),
    staff_membership_id: uuid, correction_reason: clean(1_000, true),
  }).strict(),
]);

const receiptSchema = z.object({
  organization_id: uuid, branch_id: uuid, vital_sign_key: uuid,
  record_version_id: uuid, version: z.number().int().positive().safe(),
  previous_version_id: uuid.nullable(), record_status: z.enum(["active", "voided"]),
  completion_status: z.literal("completed"), staff_membership_id: uuid,
  content_hash: hash, threshold_evaluation_status: z.literal("not_configured"),
  recorded_at: timestamp, replayed: z.boolean(),
}).strict();

const apiReceiptSchema = z.object({
  organizationId: uuid, branchId: uuid, vitalSignKey: uuid,
  recordVersionId: uuid, version: z.number().int().positive().safe(),
  previousVersionId: uuid.nullable(), recordStatus: z.enum(["active", "voided"]),
  completionStatus: z.literal("completed"), staffMembershipId: uuid,
  contentHash: hash, thresholdEvaluationStatus: z.literal("not_configured"),
  recordedAt: timestamp, replayed: z.boolean(), persisted: z.literal(true),
  demo: z.literal(false),
}).strict();

const envelopeSchema = z.object({
  requestId: uuid, status: z.literal("ok"), data: z.unknown(),
  errors: z.array(z.never()).length(0),
}).strict();

function invalid(message: string): never {
  throw new IntegrationError("INVALID_STAFF_VITAL_SIGN_RECORD", message, 400);
}

function uncertain(message: string): never {
  throw new IntegrationError("STAFF_VITAL_SIGN_RECEIPT_INVALID", message, 409);
}

function hasValidValueContract(value: {
  value_status: "measured" | "missing" | "not_applicable";
  value_decimal_text: string | null;
  unit: string | null;
  status_reason: string | null;
}) {
  return value.value_status === "measured"
    ? value.value_decimal_text !== null && value.unit !== null &&
      value.status_reason === null
    : value.value_decimal_text === null && value.unit === null &&
      value.status_reason !== null;
}

export function parseStaffVitalSignRecordInput(
  value: unknown,
  idempotencyHeader: string | null,
): StaffVitalSignRecordInput {
  const key = uuid.safeParse(idempotencyHeader);
  const parsed = inputSchema.safeParse(value);
  if (!key.success || !parsed.success) invalid(
    "請完整填寫員工、量測種類、值狀態、發生時間、來源、版本與操作鍵。",
  );
  const body = parsed.data;
  if (body.action === "void") return {
    action: "void", vitalSignKey: body.vital_sign_key,
    previousVersionId: body.previous_version_id,
    expectedBaseVersion: body.expected_base_version,
    staffMembershipId: body.staff_membership_id,
    measurementType: null, valueStatus: null, valueDecimalText: null,
    unit: null, statusReason: null, occurredAt: null, source: null, note: null,
    correctionReason: body.correction_reason, idempotencyKey: key.data,
  };
  if (!hasValidValueContract(body)) invalid(
    "已量必須填精確 decimal 文字與單位；缺值或不適用必須清空值與單位並填寫原因。",
  );
  return {
    action: body.action, vitalSignKey: body.vital_sign_key,
    previousVersionId: body.previous_version_id,
    expectedBaseVersion: body.expected_base_version,
    staffMembershipId: body.staff_membership_id,
    measurementType: body.measurement_type, valueStatus: body.value_status,
    valueDecimalText: body.value_decimal_text, unit: body.unit,
    statusReason: body.status_reason, occurredAt: body.occurred_at,
    source: body.source, note: body.note,
    correctionReason: body.correction_reason, idempotencyKey: key.data,
  };
}

export function parseStaffVitalSignRecordReceipt(
  value: unknown,
  input: StaffVitalSignRecordInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
): StaffVitalSignRecordReceipt {
  const parsed = receiptSchema.safeParse(value);
  const expectedVersion = input.action === "create" ? 1 : input.expectedBaseVersion + 1;
  if (!parsed.success || parsed.data.organization_id !== expectedOrganizationId ||
    parsed.data.branch_id !== expectedBranchId ||
    parsed.data.vital_sign_key !== input.vitalSignKey ||
    parsed.data.version !== expectedVersion ||
    parsed.data.previous_version_id !== input.previousVersionId ||
    parsed.data.record_status !== (input.action === "void" ? "voided" : "active") ||
    parsed.data.staff_membership_id !== input.staffMembershipId) {
    uncertain("員工生命徵象保存結果無法與送出內容核對；請保留相同操作鍵重試。");
  }
  return {
    organizationId: parsed.data.organization_id,
    branchId: parsed.data.branch_id,
    vitalSignKey: parsed.data.vital_sign_key,
    recordVersionId: parsed.data.record_version_id,
    version: parsed.data.version,
    previousVersionId: parsed.data.previous_version_id,
    recordStatus: parsed.data.record_status,
    completionStatus: parsed.data.completion_status,
    staffMembershipId: parsed.data.staff_membership_id,
    contentHash: parsed.data.content_hash,
    thresholdEvaluationStatus: parsed.data.threshold_evaluation_status,
    recordedAt: parsed.data.recorded_at,
    replayed: parsed.data.replayed,
    persisted: true, demo: false,
  };
}

export function parseStaffVitalSignRecordApiEnvelope(
  value: unknown,
  input: StaffVitalSignRecordInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
  httpStatus: number,
) {
  const envelope = envelopeSchema.safeParse(value);
  if (!envelope.success) uncertain("員工生命徵象保存回應格式不完整。");
  const data = z.object({ receipt: apiReceiptSchema,
    persisted: z.literal(true), demo: z.literal(false),
  }).strict().safeParse(envelope.data.data);
  if (!data.success) uncertain("員工生命徵象保存回應內容不完整。");
  parseStaffVitalSignRecordReceipt({
    organization_id: data.data.receipt.organizationId,
    branch_id: data.data.receipt.branchId,
    vital_sign_key: data.data.receipt.vitalSignKey,
    record_version_id: data.data.receipt.recordVersionId,
    version: data.data.receipt.version,
    previous_version_id: data.data.receipt.previousVersionId,
    record_status: data.data.receipt.recordStatus,
    completion_status: data.data.receipt.completionStatus,
    staff_membership_id: data.data.receipt.staffMembershipId,
    content_hash: data.data.receipt.contentHash,
    threshold_evaluation_status: data.data.receipt.thresholdEvaluationStatus,
    recorded_at: data.data.receipt.recordedAt,
    replayed: data.data.receipt.replayed,
  }, input, expectedOrganizationId, expectedBranchId);
  if (httpStatus !== (data.data.receipt.replayed ? 200 : 201)) uncertain(
    "員工生命徵象保存回應狀態與完成憑證不一致；請保留相同操作鍵重試。",
  );
  return data.data.receipt;
}
