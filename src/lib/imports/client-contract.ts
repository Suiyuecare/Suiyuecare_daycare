import { z } from "zod";

import type { ImportBatchSummary, ImportPreview, ImportUploadReceipt } from "./types";

const clean = (max: number) => z.string().trim().min(1).max(max);
const nullableClean = (max: number) => z.string().trim().min(1).max(max).nullable();
const timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u);
const hash = z.string().regex(/^[0-9a-f]{64}$/u);
const status = z.enum([
  "queued", "parsed", "mapping_required", "validation_failed",
  "ready_for_approval", "imported", "duplicate", "superseded",
]);

const security = z.object({
  parser: z.literal("cheerio-static"),
  scriptElementsBlocked: z.number().int().min(0),
  formElementsNeutralized: z.number().int().min(0),
  redirectElementsBlocked: z.number().int().min(0),
  activeElementsBlocked: z.number().int().min(0),
  inlineEventHandlersBlocked: z.number().int().min(0),
  externalReferencesBlocked: z.number().int().min(0),
  externalRequestCount: z.literal(0),
}).strict();

const batchSummary = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  status,
  fileName: clean(255),
  byteLength: z.number().int().min(1).max(25 * 1024 * 1024),
  fileSha256: hash,
  contentFingerprint: hash,
  mappingVersion: z.literal("central-care-plan-html@1"),
  createdAt: timestamp,
  updatedAt: timestamp,
  sectionCount: z.number().int().min(0).max(500),
  fieldCount: z.number().int().min(0).max(50_000),
  warningCount: z.number().int().min(0).max(100_000),
  conflictCount: z.number().int().min(0).max(50_000),
  security,
}).strict();

const section = z.object({
  id: clean(80),
  index: z.number().int().min(0).max(499),
  code: clean(120),
  title: clean(500),
  sourceHeadingId: nullableClean(500),
  recognized: z.boolean(),
}).strict();

const fieldSource = z.object({
  sectionCode: clean(120),
  sectionTitle: clean(500),
  label: clean(2_000),
  parentPath: z.string().max(8_000),
  controlName: nullableClean(2_000),
}).strict();

const previewField = z.object({
  id: clean(80),
  mappingKey: clean(8_000),
  mappingState: z.enum(["mapped", "unknown", "conflict"]),
  targetPath: nullableClean(8_000),
  source: fieldSource,
  displayValue: z.string().max(250_000),
  isMasked: z.boolean(),
  warnings: z.array(z.string().max(2_000)).max(1_000),
}).strict();

const warning = z.object({
  id: clean(80),
  code: clean(120),
  severity: z.enum(["info", "warning", "error"]),
  message: clean(4_000),
  sectionCode: clean(120).optional(),
  fieldId: clean(80).optional(),
}).strict();

const conflictCandidate = z.object({
  fieldId: clean(80),
  value: z.string().max(250_000),
}).strict();

const conflict = z.object({
  id: clean(80),
  mappingKey: clean(8_000),
  sectionCode: clean(120),
  label: clean(2_000),
  candidates: z.array(conflictCandidate).min(2).max(100),
  reason: z.enum(["multiple_source_values", "existing_value_differs"]),
}).strict();

const uploadReceipt = z.object({
  status,
  duplicate: z.boolean(),
  replayed: z.boolean(),
  batch: batchSummary,
}).strict();

const preview = z.object({
  batch: batchSummary,
  sections: z.array(section).max(500),
  fields: z.array(previewField).max(50_000),
  warnings: z.array(warning).max(100_000),
  conflicts: z.array(conflict).max(50_000),
}).strict();

const successEnvelope = <T extends z.ZodType>(data: T) => z.object({
  requestId: z.string().uuid(),
  status: z.literal("ok"),
  data,
  errors: z.array(z.never()).length(0),
}).strict();

const errorEnvelope = z.object({
  requestId: z.string().uuid(),
  status: z.enum(["error", "partial"]),
  data: z.unknown().nullable(),
  errors: z.array(z.object({
    code: clean(120),
    message: clean(2_000),
    field: clean(500).optional(),
  }).strict()).min(1).max(100),
}).strict();

export class ImportClientContractError extends Error {
  constructor() {
    super("伺服器回覆不完整或與本次操作不符；請勿視為完成。");
    this.name = "ImportClientContractError";
  }
}

function invalid(): never {
  throw new ImportClientContractError();
}

export function parseImportUploadEnvelope(
  raw: unknown,
  expected: { fileName: string; byteLength: number; httpStatus: number },
): { requestId: string; data: ImportUploadReceipt } {
  const parsed = successEnvelope(uploadReceipt).safeParse(raw);
  if (!parsed.success) invalid();
  const receipt = parsed.data.data;
  const expectedStatus = receipt.duplicate || receipt.replayed ? 200 : 201;
  if (expected.httpStatus !== expectedStatus ||
      receipt.status !== receipt.batch.status ||
      (receipt.duplicate && receipt.replayed) ||
      receipt.batch.fileName !== expected.fileName ||
      receipt.batch.byteLength !== expected.byteLength) invalid();
  return parsed.data;
}

export function parseImportPreviewEnvelope(
  raw: unknown,
  expected: { batchId: string; httpStatus: number },
): { requestId: string; data: ImportPreview } {
  const parsed = successEnvelope(preview).safeParse(raw);
  if (!parsed.success) invalid();
  const value = parsed.data.data;
  if (expected.httpStatus !== 200 || value.batch.id !== expected.batchId ||
      value.batch.sectionCount !== value.sections.length ||
      value.batch.fieldCount !== value.fields.length ||
      value.batch.warningCount !== value.warnings.length ||
      value.batch.conflictCount !== value.conflicts.length) invalid();
  return parsed.data;
}

export function parseImportReparseEnvelope(
  raw: unknown,
  expected: { batchId: string; mappingVersion: string; httpStatus: number },
): { requestId: string; data: ImportBatchSummary } {
  const parsed = successEnvelope(batchSummary).safeParse(raw);
  if (!parsed.success) invalid();
  if (expected.httpStatus !== 200 || parsed.data.data.id !== expected.batchId ||
      parsed.data.data.mappingVersion !== expected.mappingVersion) invalid();
  return parsed.data;
}

export function importErrorMessage(raw: unknown, fallback: string) {
  const parsed = errorEnvelope.safeParse(raw);
  return parsed.success ? parsed.data.errors[0]!.message : fallback;
}
