import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import { isClientVaccinationDate } from "./date";
import { clientVaccinationPayloadMatchesInput, clientVaccinationPayloadSchema } from "./payload";
import type {
  ClientVaccinationBatchInput,
  ClientVaccinationBatchReceipt,
  ClientVaccinationRecordInput,
  ClientVaccinationRecordReceipt,
} from "./types";

export const CLIENT_VACCINATION_RECORD_MAX_BYTES = 48 * 1024;
export const CLIENT_VACCINATION_BATCH_MAX_BYTES = 256 * 1024;
export const CLIENT_VACCINATION_BATCH_MAX_ITEMS = 20;

const uuid = z.uuid().transform((value) => value.toLowerCase());
const date = z.string().refine(isClientVaccinationDate);
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const clean = (max: number, min = 1, multiline = false) =>
  z.string().trim().min(min).max(max).refine((value) => multiline
    ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    : !/[\u0000-\u001f\u007f]/u.test(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);

const contentSchema = {
  vaccination_key: uuid,
  client_id: uuid,
  vaccine_name: clean(160),
  dose_number: clean(80),
  vaccinated_on: date,
  lot_number: clean(160).nullable(),
  provider_name: clean(200),
  evidence_status: z.enum(["missing", "not_applicable"]),
  evidence_reference_id: z.null(),
  evidence_sha256: z.null(),
  evidence_file_name: z.null(),
  source_system: z.literal("manual_entry"),
  source_record_id: z.null(),
};

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), ...contentSchema,
    previous_version_id: z.null(), expected_base_version: z.literal(0),
    correction_reason: z.null(),
  }).strict(),
  z.object({ action: z.literal("correct"), ...contentSchema,
    previous_version_id: uuid,
    expected_base_version: z.number().int().positive().max(1_000_000),
    correction_reason: clean(1_000, 8, true),
  }).strict(),
  z.object({ action: z.literal("void"), vaccination_key: uuid,
    previous_version_id: uuid,
    expected_base_version: z.number().int().positive().max(1_000_000),
    client_id: uuid, correction_reason: clean(1_000, 8, true),
  }).strict(),
]);

const receiptShape = {
  record_payload: clientVaccinationPayloadSchema,
  organization_id: uuid,
  branch_id: uuid,
  vaccination_key: uuid,
  record_version_id: uuid,
  version: z.number().int().positive().max(1_000_000),
  previous_version_id: uuid.nullable(),
  record_status: z.enum(["active", "voided"]),
  client_id: uuid,
  content_hash: hash,
  duplicate_warning: z.boolean(),
  duplicate_count: z.number().int().nonnegative().safe(),
  duplicate_basis: z.literal("same_client_normalized_vaccine_and_dose"),
  recorded_at: timestamp,
  replayed: z.boolean(),
};
const recordReceiptSchema = z.object(receiptShape).strict();
const apiRecordReceiptSchema = z.object({
  recordPayload: clientVaccinationPayloadSchema,
  organizationId: uuid, branchId: uuid, vaccinationKey: uuid,
  recordVersionId: uuid, version: z.number().int().positive().max(1_000_000),
  previousVersionId: uuid.nullable(), recordStatus: z.enum(["active", "voided"]),
  clientId: uuid, contentHash: hash, duplicateWarning: z.boolean(),
  duplicateCount: z.number().int().nonnegative().safe(),
  duplicateBasis: z.literal("same_client_normalized_vaccine_and_dose"),
  recordedAt: timestamp, replayed: z.boolean(), persisted: z.literal(true),
  demo: z.literal(false),
}).strict();
const envelopeSchema = z.object({
  requestId: uuid, status: z.literal("ok"), data: z.unknown(),
  errors: z.array(z.never()).length(0),
}).strict();

function invalid(message: string): never {
  throw new IntegrationError("INVALID_CLIENT_VACCINATION_RECORD", message, 400);
}

function uncertain(message: string): never {
  throw new IntegrationError("CLIENT_VACCINATION_RECEIPT_INVALID", message, 409);
}

function mapInput(
  value: unknown,
  idempotencyKey: string,
): ClientVaccinationRecordInput {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) invalid(
    "請完整填寫個案、疫苗、劑次、日期、院所、證明狀態、版本與必要理由。",
  );
  const body = parsed.data;
  if (body.action === "void") return {
    action: "void", vaccinationKey: body.vaccination_key,
    previousVersionId: body.previous_version_id,
    expectedBaseVersion: body.expected_base_version,
    clientId: body.client_id, vaccineName: null, doseNumber: null,
    vaccinatedOn: null, lotNumber: null, providerName: null,
    evidenceStatus: null, evidenceReferenceId: null, evidenceSha256: null,
    evidenceFileName: null, sourceSystem: null, sourceRecordId: null,
    correctionReason: body.correction_reason, idempotencyKey,
  };
  return {
    action: body.action, vaccinationKey: body.vaccination_key,
    previousVersionId: body.previous_version_id,
    expectedBaseVersion: body.expected_base_version, clientId: body.client_id,
    vaccineName: body.vaccine_name, doseNumber: body.dose_number,
    vaccinatedOn: body.vaccinated_on, lotNumber: body.lot_number,
    providerName: body.provider_name, evidenceStatus: body.evidence_status,
    evidenceReferenceId: null, evidenceSha256: null, evidenceFileName: null,
    sourceSystem: "manual_entry", sourceRecordId: null,
    correctionReason: body.correction_reason, idempotencyKey,
  };
}

export function parseClientVaccinationRecordInput(
  value: unknown,
  idempotencyHeader: string | null,
): ClientVaccinationRecordInput {
  const key = uuid.safeParse(idempotencyHeader);
  if (!key.success) invalid("請提供有效且穩定的操作鍵。");
  return mapInput(value, key.data);
}

export function parseClientVaccinationBatchInput(
  value: unknown,
  idempotencyHeader: string | null,
): ClientVaccinationBatchInput {
  const key = uuid.safeParse(idempotencyHeader);
  const batch = z.object({ items: z.array(z.object({
    idempotency_key: uuid,
    record: z.unknown(),
  }).strict()).min(1).max(CLIENT_VACCINATION_BATCH_MAX_ITEMS) }).strict().safeParse(value);
  if (!key.success || !batch.success) invalid("批次須包含 1 至 20 筆資料與有效操作鍵。");
  const items = batch.data.items.map((item) =>
    mapInput(item.record, item.idempotency_key));
  if (items.some((item) => item.action !== "create") ||
    new Set(items.map((item) => item.idempotencyKey)).size !== items.length ||
    new Set(items.map((item) => item.vaccinationKey)).size !== items.length) {
    invalid("批次只接受新增，且每筆操作鍵與疫苗紀錄鍵不得重複。");
  }
  return { batchIdempotencyKey: key.data, items };
}

export function parseClientVaccinationRecordReceipt(
  value: unknown,
  input: ClientVaccinationRecordInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
): ClientVaccinationRecordReceipt {
  const parsed = recordReceiptSchema.safeParse(value);
  const expectedVersion = input.action === "create" ? 1 : input.expectedBaseVersion + 1;
  if (!parsed.success ||
    parsed.data.organization_id !== expectedOrganizationId.toLowerCase() ||
    parsed.data.branch_id !== expectedBranchId.toLowerCase() ||
    parsed.data.vaccination_key !== input.vaccinationKey ||
    parsed.data.version !== expectedVersion ||
    parsed.data.previous_version_id !== input.previousVersionId ||
    parsed.data.record_status !== (input.action === "void" ? "voided" : "active") ||
    parsed.data.client_id !== input.clientId ||
    !clientVaccinationPayloadMatchesInput(parsed.data.record_payload, input) ||
    parsed.data.duplicate_warning !== (parsed.data.duplicate_count > 0)) {
    uncertain("個案疫苗保存結果無法與送出內容核對；請保留相同操作鍵重試。");
  }
  return {
    recordPayload: parsed.data.record_payload,
    organizationId: parsed.data.organization_id,
    branchId: parsed.data.branch_id,
    vaccinationKey: parsed.data.vaccination_key,
    recordVersionId: parsed.data.record_version_id,
    version: parsed.data.version,
    previousVersionId: parsed.data.previous_version_id,
    recordStatus: parsed.data.record_status,
    clientId: parsed.data.client_id,
    contentHash: parsed.data.content_hash,
    duplicateWarning: parsed.data.duplicate_warning,
    duplicateCount: parsed.data.duplicate_count,
    duplicateBasis: parsed.data.duplicate_basis,
    recordedAt: parsed.data.recorded_at,
    replayed: parsed.data.replayed,
    persisted: true, demo: false,
  };
}

export function parseClientVaccinationBatchDatabaseReceipt(
  value: unknown,
  expected: ClientVaccinationBatchInput,
  scopedItemKeys: readonly string[],
  scopedBatchKey: string,
  expectedOrganizationId: string,
  expectedBranchId: string,
): ClientVaccinationBatchReceipt {
  const databaseResult = z.object({
    batch_id: uuid, batch_idempotency_key: uuid, request_hash: hash,
    item_total: z.number().int().min(1).max(CLIENT_VACCINATION_BATCH_MAX_ITEMS),
    succeeded_total: z.number().int().nonnegative().safe(),
    rejected_total: z.number().int().nonnegative().safe(),
    results: z.array(z.object({
      index: z.number().int().nonnegative().safe(), idempotency_key: uuid,
      status: z.enum(["created", "replayed", "rejected"]),
      receipt: recordReceiptSchema.nullable(),
      error: z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/u),
        message: clean(500) }).strict().nullable(),
    }).strict()).max(CLIENT_VACCINATION_BATCH_MAX_ITEMS),
    replayed: z.boolean(),
  }).strict().safeParse(value);
  if (!databaseResult.success ||
    databaseResult.data.batch_idempotency_key !== scopedBatchKey.toLowerCase() ||
    scopedItemKeys.length !== expected.items.length ||
    databaseResult.data.item_total !== expected.items.length ||
    databaseResult.data.results.length !== expected.items.length ||
    databaseResult.data.succeeded_total + databaseResult.data.rejected_total !==
      expected.items.length ||
    databaseResult.data.rejected_total !== databaseResult.data.results.filter(
      (item) => item.status === "rejected",
    ).length ||
    new Set(databaseResult.data.results.map((item) => item.index)).size !==
      expected.items.length) {
    uncertain("疫苗批次資料庫完成憑證不完整；請保留原資料與操作鍵重試。");
  }
  const results = databaseResult.data.results.map((item, index) => {
    const expectedInput = expected.items[index];
    if (!expectedInput || item.index !== index ||
      item.idempotency_key !== scopedItemKeys[index]?.toLowerCase() ||
      (item.status === "rejected") !== (item.receipt === null) ||
      (item.status === "rejected") !== (item.error !== null) ||
      (item.status === "created" && item.receipt?.replayed !== false) ||
      (item.status === "replayed" && item.receipt?.replayed !== true)) {
      uncertain("疫苗批次資料庫逐筆憑證無法核對；請保留原資料與操作鍵重試。");
    }
    if (item.receipt === null) return {
      index, idempotencyKey: expectedInput.idempotencyKey,
      status: "rejected" as const, receipt: null, error: item.error,
    };
    const receipt = parseClientVaccinationRecordReceipt(item.receipt, expectedInput,
      expectedOrganizationId, expectedBranchId);
    return { index, idempotencyKey: expectedInput.idempotencyKey,
      status: item.status, receipt, error: null };
  });
  return {
    batchId: databaseResult.data.batch_id,
    batchIdempotencyKey: expected.batchIdempotencyKey,
    requestHash: databaseResult.data.request_hash,
    replayed: databaseResult.data.replayed,
    itemTotal: databaseResult.data.item_total,
    succeededTotal: databaseResult.data.succeeded_total,
    rejectedTotal: databaseResult.data.rejected_total,
    results, persisted: true, demo: false,
  };
}

export function parseClientVaccinationRecordApiEnvelope(
  value: unknown,
  input: ClientVaccinationRecordInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
  httpStatus: number,
) {
  const envelope = envelopeSchema.safeParse(value);
  if (!envelope.success) uncertain("個案疫苗保存回應格式不完整。");
  const data = z.object({ receipt: apiRecordReceiptSchema,
    persisted: z.literal(true), demo: z.literal(false) }).strict()
    .safeParse(envelope.data.data);
  if (!data.success) uncertain("個案疫苗保存回應內容不完整。");
  parseClientVaccinationRecordReceipt({
    record_payload: data.data.receipt.recordPayload,
    organization_id: data.data.receipt.organizationId,
    branch_id: data.data.receipt.branchId,
    vaccination_key: data.data.receipt.vaccinationKey,
    record_version_id: data.data.receipt.recordVersionId,
    version: data.data.receipt.version,
    previous_version_id: data.data.receipt.previousVersionId,
    record_status: data.data.receipt.recordStatus,
    client_id: data.data.receipt.clientId,
    content_hash: data.data.receipt.contentHash,
    duplicate_warning: data.data.receipt.duplicateWarning,
    duplicate_count: data.data.receipt.duplicateCount,
    duplicate_basis: data.data.receipt.duplicateBasis,
    recorded_at: data.data.receipt.recordedAt,
    replayed: data.data.receipt.replayed,
  }, input, expectedOrganizationId, expectedBranchId);
  if (httpStatus !== (data.data.receipt.replayed ? 200 : 201)) {
    uncertain("個案疫苗保存狀態與完成憑證不一致；請保留相同操作鍵重試。");
  }
  return data.data.receipt;
}

export function parseClientVaccinationBatchApiEnvelope(
  value: unknown,
  expected: ClientVaccinationBatchInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
  httpStatus: number,
): ClientVaccinationBatchReceipt {
  const result = z.object({ batchId: uuid, batchIdempotencyKey: uuid,
    requestHash: hash,
    replayed: z.boolean(),
    itemTotal: z.number().int().min(1).max(CLIENT_VACCINATION_BATCH_MAX_ITEMS),
    succeededTotal: z.number().int().nonnegative().safe(),
    rejectedTotal: z.number().int().nonnegative().safe(),
    results: z.array(z.object({
      index: z.number().int().nonnegative().safe(), idempotencyKey: uuid,
      status: z.enum(["created", "replayed", "rejected"]),
      receipt: apiRecordReceiptSchema.nullable(),
      error: z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/u),
        message: clean(500) }).strict().nullable(),
    }).strict()).max(CLIENT_VACCINATION_BATCH_MAX_ITEMS),
    persisted: z.literal(true), demo: z.literal(false),
  }).strict();
  const envelope = envelopeSchema.safeParse(value);
  const parsed = envelope.success ? result.safeParse(envelope.data.data) : null;
  if (!parsed?.success || httpStatus !== 200 ||
    parsed.data.batchIdempotencyKey !== expected.batchIdempotencyKey ||
    parsed.data.itemTotal !== expected.items.length ||
    parsed.data.results.length !== expected.items.length ||
    parsed.data.succeededTotal + parsed.data.rejectedTotal !== expected.items.length ||
    parsed.data.rejectedTotal !== parsed.data.results.filter(
      (item) => item.status === "rejected",
    ).length ||
    parsed.data.succeededTotal !== parsed.data.results.filter(
      (item) => item.status !== "rejected",
    ).length ||
    new Set(parsed.data.results.map((item) => item.index)).size !== expected.items.length ||
    parsed.data.results.some((item, index) => item.index !== index ||
      item.idempotencyKey !== expected.items[index]?.idempotencyKey ||
      (item.status === "rejected") !== (item.receipt === null) ||
      (item.status === "rejected") !== (item.error !== null) ||
      (item.status === "created" && item.receipt?.replayed !== false) ||
      (item.status === "replayed" && item.receipt?.replayed !== true) ||
      (item.receipt !== null && (() => {
        try {
          parseClientVaccinationRecordReceipt({
            record_payload: item.receipt.recordPayload,
            organization_id: item.receipt.organizationId,
            branch_id: item.receipt.branchId,
            vaccination_key: item.receipt.vaccinationKey,
            record_version_id: item.receipt.recordVersionId,
            version: item.receipt.version,
            previous_version_id: item.receipt.previousVersionId,
            record_status: item.receipt.recordStatus,
            client_id: item.receipt.clientId,
            content_hash: item.receipt.contentHash,
            duplicate_warning: item.receipt.duplicateWarning,
            duplicate_count: item.receipt.duplicateCount,
            duplicate_basis: item.receipt.duplicateBasis,
            recorded_at: item.receipt.recordedAt,
            replayed: item.receipt.replayed,
          }, expected.items[index]!, expectedOrganizationId, expectedBranchId);
          return false;
        } catch { return true; }
      })()))) {
    uncertain("疫苗批次回應無法逐筆核對；請保留原資料與操作鍵重試。");
  }
  return parsed.data;
}
