import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import type {
  ClientInspectionReportInput,
  ClientInspectionReportReceipt,
} from "./types";

export const CLIENT_INSPECTION_REPORT_MAX_BYTES = 64 * 1024;

const uuid = z.uuid().transform((value) => value.toLowerCase());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(parsed.getTime()) && new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(parsed) === value;
});
const timestamp = z.string().refine((value) =>
  isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const clean = (maximum: number, minimum = 1, multiline = false) =>
  z.string().trim().min(minimum).max(maximum).refine((value) => multiline
    ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    : !/[\u0000-\u001f\u007f]/u.test(value));
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const valueState = z.enum(["present", "missing", "not_applicable"]);

const content = {
  report_key: uuid,
  client_id: uuid,
  report_type: clean(160),
  examined_on: date,
  result_status: valueState,
  result_text: clean(4_000, 1, true).nullable(),
  result_reason: clean(1_000, 8, true).nullable(),
  source_status: valueState,
  source_text: clean(1_000, 1, true).nullable(),
  source_reason: clean(1_000, 8, true).nullable(),
  attachment_status: z.enum(["provided", "missing", "not_applicable"]),
  attachment_id: uuid.nullable(),
  attachment_sha256: sha256.nullable(),
  attachment_source_filename: clean(255).nullable(),
};

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), ...content,
    previous_version_id: z.null(), expected_base_version: z.literal(0),
    correction_reason: z.null(),
  }).strict(),
  z.object({ action: z.literal("correct"), ...content,
    previous_version_id: uuid,
    expected_base_version: z.number().int().positive().safe(),
    correction_reason: clean(1_000, 8, true),
  }).strict(),
  z.object({ action: z.literal("void"), report_key: uuid, client_id: uuid,
    previous_version_id: uuid,
    expected_base_version: z.number().int().positive().safe(),
    correction_reason: clean(1_000, 8, true),
  }).strict(),
]);

const count = z.number().int().nonnegative().safe();
const receiptSchema = z.object({
  organization_id: uuid, branch_id: uuid, report_key: uuid,
  record_version_id: uuid, version: z.number().int().positive().safe(),
  previous_version_id: uuid.nullable(), record_status: z.enum(["active", "voided"]),
  client_id: uuid, content_hash: sha256, payload_hash: sha256,
  exact_duplicate_count: count, key_field_duplicate_count: count,
  attachment_duplicate_count: count, duplicate_warning: z.boolean(),
  duplicate_resolution: z.literal("warning_only_no_auto_merge"),
  recorded_at: timestamp, replayed: z.boolean(),
}).strict();

const apiReceipt = z.object({
  organizationId: uuid, branchId: uuid, reportKey: uuid,
  recordVersionId: uuid, version: z.number().int().positive().safe(),
  previousVersionId: uuid.nullable(), recordStatus: z.enum(["active", "voided"]),
  clientId: uuid, contentHash: sha256, payloadHash: sha256,
  exactDuplicateCount: count, keyFieldDuplicateCount: count,
  attachmentDuplicateCount: count, duplicateWarning: z.boolean(),
  duplicateResolution: z.literal("warning_only_no_auto_merge"),
  recordedAt: timestamp, replayed: z.boolean(), persisted: z.literal(true),
  demo: z.literal(false),
}).strict();
const envelope = z.object({ requestId: uuid, status: z.literal("ok"),
  data: z.object({ receipt: apiReceipt, persisted: z.literal(true),
    demo: z.literal(false) }).strict(), errors: z.array(z.never()).length(0),
}).strict();

function invalid(message: string): never {
  throw new IntegrationError("INVALID_CLIENT_INSPECTION_REPORT", message, 400);
}
function uncertain(message: string): never {
  throw new IntegrationError("CLIENT_INSPECTION_REPORT_RECEIPT_INVALID", message, 409);
}
function stateValid(status: "present" | "missing" | "not_applicable",
  value: string | null, reason: string | null) {
  return status === "present" ? value !== null && reason === null :
    value === null && reason !== null;
}

export function parseClientInspectionReportInput(
  value: unknown,
  idempotencyHeader: string | null,
): ClientInspectionReportInput {
  const key = uuid.safeParse(idempotencyHeader);
  const parsed = schema.safeParse(value);
  if (!key.success || !parsed.success) invalid(
    "請完整填寫個案、檢查日期、結果與來源三態、附件狀態及版本操作鍵。",
  );
  const row = parsed.data;
  if (row.action === "void") return {
    action: "void", reportKey: row.report_key, clientId: row.client_id,
    previousVersionId: row.previous_version_id,
    expectedBaseVersion: row.expected_base_version,
    correctionReason: row.correction_reason, idempotencyKey: key.data,
  };
  if (!stateValid(row.result_status, row.result_text, row.result_reason) ||
    !stateValid(row.source_status, row.source_text, row.source_reason)) {
    invalid("結果與來源必須明確區分已提供、缺值或不適用；缺值理由不得留空。");
  }
  const attachmentProvided = row.attachment_id !== null &&
    row.attachment_sha256 !== null && row.attachment_source_filename !== null;
  if ((row.attachment_status === "provided" &&
      (!attachmentProvided || row.action === "create")) ||
    (row.attachment_status !== "provided" &&
      (row.attachment_id !== null || row.attachment_sha256 !== null ||
        row.attachment_source_filename !== null))) {
    invalid("附件服務尚未配置；新增不得宣稱已有附件，更正僅能沿用既有可信附件證據。");
  }
  return {
    action: row.action, reportKey: row.report_key,
    previousVersionId: row.previous_version_id,
    expectedBaseVersion: row.expected_base_version, clientId: row.client_id,
    reportType: row.report_type, examinedOn: row.examined_on,
    resultStatus: row.result_status, resultText: row.result_text,
    resultReason: row.result_reason, sourceStatus: row.source_status,
    sourceText: row.source_text, sourceReason: row.source_reason,
    attachmentStatus: row.attachment_status, attachmentId: row.attachment_id,
    attachmentSha256: row.attachment_sha256,
    attachmentSourceFilename: row.attachment_source_filename,
    correctionReason: row.correction_reason, idempotencyKey: key.data,
  };
}

export function clientInspectionReportRpcPayload(input: ClientInspectionReportInput) {
  if (input.action === "void") return {
    action: input.action, report_key: input.reportKey,
    previous_version_id: input.previousVersionId,
    expected_base_version: input.expectedBaseVersion,
    client_id: input.clientId, correction_reason: input.correctionReason,
  };
  return {
    action: input.action, report_key: input.reportKey,
    previous_version_id: input.previousVersionId,
    expected_base_version: input.expectedBaseVersion, client_id: input.clientId,
    report_type: input.reportType, examined_on: input.examinedOn,
    result_status: input.resultStatus, result_text: input.resultText,
    result_reason: input.resultReason, source_status: input.sourceStatus,
    source_text: input.sourceText, source_reason: input.sourceReason,
    attachment_status: input.attachmentStatus, attachment_id: input.attachmentId,
    attachment_sha256: input.attachmentSha256,
    attachment_source_filename: input.attachmentSourceFilename,
    correction_reason: input.correctionReason,
  };
}

export function parseClientInspectionReportReceipt(
  value: unknown,
  input: ClientInspectionReportInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
): ClientInspectionReportReceipt {
  const parsed = receiptSchema.safeParse(value);
  const expectedVersion = input.action === "create" ? 1 : input.expectedBaseVersion + 1;
  if (!parsed.success ||
    parsed.data.organization_id !== expectedOrganizationId.toLowerCase() ||
    parsed.data.branch_id !== expectedBranchId.toLowerCase() ||
    parsed.data.report_key !== input.reportKey ||
    parsed.data.previous_version_id !== input.previousVersionId ||
    parsed.data.version !== expectedVersion || parsed.data.client_id !== input.clientId ||
    parsed.data.record_status !== (input.action === "void" ? "voided" : "active") ||
    parsed.data.key_field_duplicate_count < parsed.data.exact_duplicate_count ||
    parsed.data.duplicate_warning !== (parsed.data.exact_duplicate_count > 0 ||
      parsed.data.key_field_duplicate_count > 0 ||
      parsed.data.attachment_duplicate_count > 0) ||
    (input.action === "void" && (parsed.data.exact_duplicate_count !== 0 ||
      parsed.data.key_field_duplicate_count !== 0 ||
      parsed.data.attachment_duplicate_count !== 0))) {
    uncertain("檢查報告保存結果無法與送出版本核對；請保留相同操作鍵重試。");
  }
  const row = parsed.data;
  return { organizationId: row.organization_id, branchId: row.branch_id,
    reportKey: row.report_key, recordVersionId: row.record_version_id,
    version: row.version, previousVersionId: row.previous_version_id,
    recordStatus: row.record_status, clientId: row.client_id,
    contentHash: row.content_hash, payloadHash: row.payload_hash,
    exactDuplicateCount: row.exact_duplicate_count,
    keyFieldDuplicateCount: row.key_field_duplicate_count,
    attachmentDuplicateCount: row.attachment_duplicate_count,
    duplicateWarning: row.duplicate_warning,
    duplicateResolution: row.duplicate_resolution, recordedAt: row.recorded_at,
    replayed: row.replayed, persisted: true, demo: false };
}

export function parseClientInspectionReportApiEnvelope(
  value: unknown,
  input: ClientInspectionReportInput,
  expectedOrganizationId: string,
  expectedBranchId: string,
  httpStatus: number,
) {
  const parsed = envelope.safeParse(value);
  if (!parsed.success) uncertain("檢查報告保存回應格式不完整。");
  const receipt = parsed.data.data.receipt;
  parseClientInspectionReportReceipt({
    organization_id: receipt.organizationId, branch_id: receipt.branchId,
    report_key: receipt.reportKey, record_version_id: receipt.recordVersionId,
    version: receipt.version, previous_version_id: receipt.previousVersionId,
    record_status: receipt.recordStatus, client_id: receipt.clientId,
    content_hash: receipt.contentHash, payload_hash: receipt.payloadHash,
    exact_duplicate_count: receipt.exactDuplicateCount,
    key_field_duplicate_count: receipt.keyFieldDuplicateCount,
    attachment_duplicate_count: receipt.attachmentDuplicateCount,
    duplicate_warning: receipt.duplicateWarning,
    duplicate_resolution: receipt.duplicateResolution,
    recorded_at: receipt.recordedAt, replayed: receipt.replayed,
  }, input, expectedOrganizationId, expectedBranchId);
  if (httpStatus !== (receipt.replayed ? 200 : 201)) uncertain(
    "檢查報告 HTTP 狀態與不可變回執不一致。",
  );
  return receipt;
}
