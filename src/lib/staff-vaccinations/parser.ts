import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import { isStaffVaccinationDate } from "./date";
import type {
  StaffVaccinationRecordInput,
  StaffVaccinationRecordReceipt,
} from "./types";

export const STAFF_VACCINATION_RECORD_MAX_BYTES = 48 * 1024;

const uuid = z.uuid().transform((value) => value.toLowerCase());
const date = z.string().refine(isStaffVaccinationDate);
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const clean = (max: number, multiline = false) => z.string().trim().min(1).max(max)
  .refine((value) => multiline
    ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    : !/[\u0000-\u001f\u007f]/u.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);

const contentSchema = {
  vaccination_key: uuid,
  staff_membership_id: uuid,
  vaccine_name: clean(160),
  dose_number: clean(80),
  vaccinated_on: date,
  lot_number: clean(160).nullable(),
  provider_name: clean(200),
  evidence_status: z.enum(["missing", "not_applicable"]),
  attachment_reference: z.null(),
  attachment_sha256: z.null(),
};

const recordInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), ...contentSchema,
    previous_version_id: z.null(), expected_base_version: z.literal(0),
    correction_reason: z.null(),
  }).strict(),
  z.object({ action: z.literal("correct"), ...contentSchema,
    previous_version_id: uuid,
    expected_base_version: z.number().int().positive().safe(),
    correction_reason: clean(1_000, true),
  }).strict(),
  z.object({ action: z.literal("void"), vaccination_key: uuid,
    previous_version_id: uuid,
    expected_base_version: z.number().int().positive().safe(),
    staff_membership_id: uuid, correction_reason: clean(1_000, true),
  }).strict(),
]);

const receiptShape = {
  organization_id: uuid,
  branch_id: uuid,
  vaccination_key: uuid,
  record_version_id: uuid,
  version: z.number().int().positive().safe(),
  previous_version_id: uuid.nullable(),
  record_status: z.enum(["active", "voided"]),
  staff_membership_id: uuid,
  content_hash: hash,
  duplicate_warning: z.boolean(),
  duplicate_count: z.number().int().nonnegative().safe(),
  duplicate_basis: z.literal("same_staff_normalized_vaccine_and_dose"),
  recorded_at: timestamp,
  replayed: z.boolean(),
};
const recordReceiptSchema = z.object(receiptShape).strict();
const recordApiReceiptSchema = z.object({
  organizationId: uuid,
  branchId: uuid,
  vaccinationKey: uuid,
  recordVersionId: uuid,
  version: z.number().int().positive().safe(),
  previousVersionId: uuid.nullable(),
  recordStatus: z.enum(["active", "voided"]),
  staffMembershipId: uuid,
  contentHash: hash,
  duplicateWarning: z.boolean(),
  duplicateCount: z.number().int().nonnegative().safe(),
  duplicateBasis: z.literal("same_staff_normalized_vaccine_and_dose"),
  recordedAt: timestamp,
  replayed: z.boolean(),
  persisted: z.literal(true),
  demo: z.literal(false),
}).strict();
const envelopeSchema = z.object({
  requestId: uuid,
  status: z.literal("ok"),
  data: z.unknown(),
  errors: z.array(z.never()).length(0),
}).strict();

function invalid(message: string): never {
  throw new IntegrationError("INVALID_STAFF_VACCINATION_RECORD", message, 400);
}

function uncertain(message: string): never {
  throw new IntegrationError("STAFF_VACCINATION_RECEIPT_INVALID", message, 409);
}

export function parseStaffVaccinationRecordInput(
  value: unknown,
  idempotencyHeader: string | null,
): StaffVaccinationRecordInput {
  const key = uuid.safeParse(idempotencyHeader);
  const parsed = recordInputSchema.safeParse(value);
  if (!key.success || !parsed.success) invalid(
    "請完整填寫員工、疫苗名稱、劑次、接種日期、院所、版本與有效操作鍵。",
  );
  const body = parsed.data;
  if (body.action === "void") return {
    action: "void",
    vaccinationKey: body.vaccination_key,
    previousVersionId: body.previous_version_id,
    expectedBaseVersion: body.expected_base_version,
    staffMembershipId: body.staff_membership_id,
    vaccineName: null,
    doseNumber: null,
    vaccinatedOn: null,
    lotNumber: null,
    providerName: null,
    evidenceStatus: null,
    attachmentReference: null,
    attachmentSha256: null,
    correctionReason: body.correction_reason,
    idempotencyKey: key.data,
  };
  return {
    action: body.action,
    vaccinationKey: body.vaccination_key,
    previousVersionId: body.previous_version_id,
    expectedBaseVersion: body.expected_base_version,
    staffMembershipId: body.staff_membership_id,
    vaccineName: body.vaccine_name,
    doseNumber: body.dose_number,
    vaccinatedOn: body.vaccinated_on,
    lotNumber: body.lot_number,
    providerName: body.provider_name,
    evidenceStatus: body.evidence_status,
    attachmentReference: null,
    attachmentSha256: null,
    correctionReason: body.correction_reason,
    idempotencyKey: key.data,
  };
}

export function parseStaffVaccinationRecordReceipt(
  value: unknown,
  input: StaffVaccinationRecordInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
): StaffVaccinationRecordReceipt {
  const parsed = recordReceiptSchema.safeParse(value);
  const expectedVersion = input.action === "create" ? 1 : input.expectedBaseVersion + 1;
  if (!parsed.success ||
    parsed.data.organization_id !== expectedOrganizationId ||
    parsed.data.branch_id !== expectedBranchId ||
    parsed.data.vaccination_key !== input.vaccinationKey ||
    parsed.data.version !== expectedVersion ||
    parsed.data.previous_version_id !== input.previousVersionId ||
    parsed.data.record_status !== (input.action === "void" ? "voided" : "active") ||
    parsed.data.staff_membership_id !== input.staffMembershipId ||
    parsed.data.duplicate_warning !== (parsed.data.duplicate_count > 0)) {
    uncertain("員工疫苗保存結果無法與送出內容核對；請保留相同操作鍵重試。");
  }
  return {
    organizationId: parsed.data.organization_id,
    branchId: parsed.data.branch_id,
    vaccinationKey: parsed.data.vaccination_key,
    recordVersionId: parsed.data.record_version_id,
    version: parsed.data.version,
    previousVersionId: parsed.data.previous_version_id,
    recordStatus: parsed.data.record_status,
    staffMembershipId: parsed.data.staff_membership_id,
    contentHash: parsed.data.content_hash,
    duplicateWarning: parsed.data.duplicate_warning,
    duplicateCount: parsed.data.duplicate_count,
    duplicateBasis: parsed.data.duplicate_basis,
    recordedAt: parsed.data.recorded_at,
    replayed: parsed.data.replayed,
    persisted: true,
    demo: false,
  };
}

export function parseStaffVaccinationRecordApiEnvelope(
  value: unknown,
  input: StaffVaccinationRecordInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
  httpStatus: number,
) {
  const envelope = envelopeSchema.safeParse(value);
  if (!envelope.success) uncertain("員工疫苗保存回應格式不完整。");
  const data = z.object({
    receipt: recordApiReceiptSchema,
    persisted: z.literal(true),
    demo: z.literal(false),
  }).strict().safeParse(envelope.data.data);
  if (!data.success) uncertain("員工疫苗保存回應內容不完整。");
  parseStaffVaccinationRecordReceipt({
    organization_id: data.data.receipt.organizationId,
    branch_id: data.data.receipt.branchId,
    vaccination_key: data.data.receipt.vaccinationKey,
    record_version_id: data.data.receipt.recordVersionId,
    version: data.data.receipt.version,
    previous_version_id: data.data.receipt.previousVersionId,
    record_status: data.data.receipt.recordStatus,
    staff_membership_id: data.data.receipt.staffMembershipId,
    content_hash: data.data.receipt.contentHash,
    duplicate_warning: data.data.receipt.duplicateWarning,
    duplicate_count: data.data.receipt.duplicateCount,
    duplicate_basis: data.data.receipt.duplicateBasis,
    recorded_at: data.data.receipt.recordedAt,
    replayed: data.data.receipt.replayed,
  }, input, expectedOrganizationId, expectedBranchId);
  if (httpStatus !== (data.data.receipt.replayed ? 200 : 201)) {
    uncertain("員工疫苗保存回應狀態與完成憑證不一致；請保留相同操作鍵重試。");
  }
  return data.data.receipt;
}
