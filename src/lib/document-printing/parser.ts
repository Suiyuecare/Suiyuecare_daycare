import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  DOCUMENT_VALUE_STATES,
  type CreateDocumentPrintJobInput,
  type DocumentPrintJobOperationResult,
  type DocumentRenderModel,
} from "./types";

export const DOCUMENT_PRINT_JOB_MAX_BYTES = 8 * 1024;

const uuid = z.uuid().transform((value) => value.toLowerCase());
const positiveInteger = z.number().int().positive().safe();
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(parsed.getTime()) &&
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(parsed) === value;
});
const timestamp = z.string().refine(
  (value) => isStrictOffsetDateTime(value) &&
    Number.isFinite(new Date(value).getTime()),
).transform((value) => new Date(value).toISOString());
const narrative = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) =>
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));

const renderRowSchema = z.object({
  label: narrative(160),
  value: z.string().trim().max(5000).nullable(),
  state: z.enum(DOCUMENT_VALUE_STATES),
}).strict().superRefine((row, context) => {
  if (row.state === "recorded" && !row.value) {
    context.addIssue({ code: "custom", path: ["value"],
      message: "已記錄欄位必須保留顯示值。" });
  }
  if (row.state !== "recorded" && row.value !== null) {
    context.addIssue({ code: "custom", path: ["value"],
      message: "缺值或不適用欄位不得夾帶顯示值。" });
  }
});

export const documentRenderModelSchema = z.object({
  schemaVersion: z.literal(1),
  locale: z.literal("zh-TW"),
  timezone: z.literal("Asia/Taipei"),
  template: z.object({
    versionId: uuid,
    templateKey: z.string().trim().regex(/^[a-z][a-z0-9_-]{2,79}$/u),
    version: positiveInteger,
    title: narrative(160),
    contentHash: hash,
  }).strict(),
  organization: z.object({
    organizationId: uuid,
    organizationName: narrative(160),
    branchId: uuid,
    branchName: narrative(160),
  }).strict(),
  client: z.object({
    clientId: uuid,
    displayName: narrative(160),
    clientCode: z.string().trim().min(1).max(80).nullable(),
  }).strict(),
  documentDate: date,
  generatedAt: timestamp,
  title: narrative(160),
  watermark: narrative(80),
  sections: z.array(z.object({
    heading: narrative(160),
    rows: z.array(renderRowSchema).min(1).max(80),
  }).strict()).min(1).max(30),
  footerNote: narrative(500),
}).strict();

const createSchema = z.object({
  action: z.literal("create_job"),
  templateVersionId: uuid,
  clientId: uuid,
  documentDate: date,
}).strict();

const operationRowSchema = z.object({
  operation_id: uuid,
  job_id: uuid,
  template_version_id: uuid,
  client_id: uuid,
  document_date: date,
  render_model_hash: hash,
  committed_at: timestamp,
  replayed: z.boolean(),
}).strict();

const fontBucket = z.string().trim().min(3).max(63)
  .regex(/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/u);
const fontPath = z.string().trim().min(1).max(500)
  .refine((value) => !/(^|\/)\.\.(\/|$)/u.test(value) &&
    !/[\u0000-\u001f\u007f]/u.test(value));
const accessRowSchema = z.object({
  job_id: uuid,
  template_version_id: uuid,
  client_id: uuid,
  render_model: z.unknown(),
  render_model_hash: hash,
  font_bucket: fontBucket,
  font_object_path: fontPath,
  font_sha256: hash,
  accessed_at: timestamp,
}).strict();

const apiReceiptSchema = z.object({
  action: z.literal("create_job"),
  operationId: uuid,
  jobId: uuid,
  templateVersionId: uuid,
  clientId: uuid,
  documentDate: date,
  renderModelHash: hash,
  committedAt: timestamp,
  replayed: z.boolean(),
  persisted: z.literal(true),
  demo: z.literal(false),
}).strict();

const apiEnvelopeSchema = z.object({
  requestId: uuid,
  status: z.literal("ok"),
  data: z.object({
    receipt: apiReceiptSchema,
    persisted: z.literal(true),
    demo: z.literal(false),
  }).strict(),
  errors: z.array(z.never()).length(0),
}).strict();

function invalid(message: string, field?: string): never {
  throw new IntegrationError("INVALID_DOCUMENT_PRINT_JOB", message, 400, field);
}

export function parseDocumentRenderModel(value: unknown): DocumentRenderModel {
  const parsed = documentRenderModelSchema.safeParse(value);
  if (!parsed.success) throw new Error("INVALID_DOCUMENT_RENDER_MODEL");
  return parsed.data;
}

export function parseCreateDocumentPrintJob(
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): CreateDocumentPrintJobInput {
  const parsed = createSchema.safeParse(body);
  const key = uuid.safeParse(idempotencyKey);
  if (!parsed.success) invalid("核准範本、個案或文件日期未通過驗證。");
  if (!key.success) invalid("請提供有效的 UUID 冪等鍵。", "idempotency-key");
  return { ...parsed.data, idempotencyKey: key.data };
}

export function parseDocumentPrintJobOperationResult(
  value: unknown,
  expected?: CreateDocumentPrintJobInput,
): Omit<DocumentPrintJobOperationResult, "action" | "persisted" | "demo"> {
  const parsed = operationRowSchema.safeParse(value);
  if (!parsed.success || (expected && (
    parsed.data.template_version_id !== expected.templateVersionId ||
    parsed.data.client_id !== expected.clientId ||
    parsed.data.document_date !== expected.documentDate
  ))) {
    throw new IntegrationError(
      "DOCUMENT_PRINT_RECEIPT_INVALID",
      "資料庫完成憑證不完整；畫面不會把文件工作當作成功。",
      502,
    );
  }
  return {
    operationId: parsed.data.operation_id,
    jobId: parsed.data.job_id,
    templateVersionId: parsed.data.template_version_id,
    clientId: parsed.data.client_id,
    documentDate: parsed.data.document_date,
    renderModelHash: parsed.data.render_model_hash,
    committedAt: parsed.data.committed_at,
    replayed: parsed.data.replayed,
  };
}

export function parseDocumentPrintJobApiEnvelope(
  value: unknown,
  expected: CreateDocumentPrintJobInput,
  httpStatus: number,
): DocumentPrintJobOperationResult {
  const parsed = apiEnvelopeSchema.safeParse(value);
  if (!parsed.success ||
    parsed.data.data.receipt.templateVersionId !== expected.templateVersionId ||
    parsed.data.data.receipt.clientId !== expected.clientId ||
    parsed.data.data.receipt.documentDate !== expected.documentDate ||
    httpStatus !== (parsed.data.data.receipt.replayed ? 200 : 201)) {
    throw new IntegrationError(
      "DOCUMENT_PRINT_RECEIPT_INVALID",
      "文件工作完成憑證與送出內容不一致；請重新載入核對。",
      502,
    );
  }
  return parsed.data.data.receipt;
}

export function parseDocumentPrintAccessResult(
  value: unknown,
  expected: {
    jobId: string;
    organizationId: string;
    branchId: string;
  },
) {
  const parsed = accessRowSchema.safeParse(value);
  if (!parsed.success) throw new IntegrationError(
    "DOCUMENT_ACCESS_RECEIPT_INVALID",
    "文件存取憑證不完整；系統不會產生或傳送 PDF。",
    502,
  );
  const row = parsed.data;
  const model = parseDocumentRenderModel(row.render_model);
  if (row.job_id !== expected.jobId.toLowerCase() ||
    model.organization.organizationId !== expected.organizationId.toLowerCase() ||
    model.organization.branchId !== expected.branchId.toLowerCase() ||
    model.client.clientId !== row.client_id ||
    model.template.versionId !== row.template_version_id) {
    throw new IntegrationError(
      "DOCUMENT_ACCESS_RECEIPT_INVALID",
      "文件存取憑證與目前資料範圍不一致；系統不會產生或傳送 PDF。",
      502,
    );
  }
  return {
    jobId: row.job_id,
    templateVersionId: row.template_version_id,
    clientId: row.client_id,
    renderModel: model,
    renderModelHash: row.render_model_hash,
    fontBucket: row.font_bucket,
    fontObjectPath: row.font_object_path,
    fontSha256: row.font_sha256,
    accessedAt: row.accessed_at,
  };
}
