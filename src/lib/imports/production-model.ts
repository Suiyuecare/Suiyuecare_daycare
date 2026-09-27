import "server-only";

import { z } from "zod";
import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { CURRENT_MAPPING_VERSION, MAX_HTML_IMPORT_BYTES } from "./types";
import { MAX_IMPORT_FIELDS, MAX_IMPORT_SECTIONS, MAX_IMPORT_FIELD_CHARACTERS } from "./parser";

const date = z.string().max(64).refine(isStrictOffsetDateTime);
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const text = z.string().max(MAX_IMPORT_FIELD_CHARACTERS);
export const importOperationKeySchema = z.string().min(1).max(200).refine(value => Boolean(value.trim()) && !/[\u0000-\u001f\u007f]/u.test(value));
const name = z.string().min(1).max(255).refine(value => /\.html?$/iu.test(value) && !/[\u0000-\u001f\u007f/\\]/u.test(value));
const mime = z.enum(["text/html", "application/xhtml+xml"]);
const section = z.object({ id: z.string().regex(/^section_[a-f0-9]{20}$/u), index: z.number().int().nonnegative(), code: text, title: text,
  sourceHeadingId: text.nullable(), recognized: z.boolean() }).strict();
const field = z.object({ id: z.string().regex(/^field_[a-f0-9]{24}$/u), mappingKey: text, mappingVersion: z.literal(CURRENT_MAPPING_VERSION),
  mappingState: z.enum(["mapped", "unknown", "conflict"]), targetPath: text.nullable(),
  source: z.object({ sectionCode: text, sectionTitle: text, label: text, parentPath: text, controlName: text.nullable() }).strict(),
  rawValue: text, normalizedValue: text, sensitive: z.boolean(), warnings: z.array(text).max(MAX_IMPORT_FIELDS) }).strict();
const warning = z.object({ id: z.string().regex(/^warning_[a-f0-9]{20}$/u), code: text, severity: z.enum(["info", "warning", "error"]),
  message: text, sectionCode: text.optional(), fieldId: z.string().regex(/^field_[a-f0-9]{24}$/u).optional() }).strict();
const conflict = z.object({ id: z.string().regex(/^conflict_[a-f0-9]{24}$/u), mappingKey: text, sectionCode: text, label: text,
  candidates: z.array(z.object({ fieldId: z.string().regex(/^field_[a-f0-9]{24}$/u), value: text }).strict()).min(2).max(MAX_IMPORT_FIELDS),
  reason: z.enum(["multiple_source_values", "existing_value_differs"]) }).strict();
const count = z.number().int().nonnegative();
const security = z.object({ parser: z.literal("cheerio-static"), scriptElementsBlocked: count, formElementsNeutralized: count,
  redirectElementsBlocked: count, activeElementsBlocked: count, inlineEventHandlersBlocked: count, externalReferencesBlocked: count,
  externalRequestCount: z.literal(0) }).strict();

export const originalImportReferenceSchema = z.object({
  reservationId: z.uuid(),
  archive: z.object({ key: z.string().min(1).max(1024), versionId: z.string().min(1).max(1024).refine(value => value !== "null" && !/[\s\u0000-\u001f\u007f]/u.test(value)),
    retainUntil: date, sha256: sha, createdAt: date, byteLength: z.number().int().min(1).max(MAX_HTML_IMPORT_BYTES) }).strict(),
}).strict();

const approval = z.object({ approvedAt: date, approvedBy: z.uuid(), idempotencyKey: importOperationKeySchema,
  conflictResolutions: z.record(z.string().regex(/^conflict_[a-f0-9]{24}$/u), z.string().regex(/^field_[a-f0-9]{24}$/u)) }).strict();

export const importBatchRecordSchema = z.object({
  id: z.uuid(), organizationId: z.uuid(), branchId: z.uuid(), version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  status: z.enum(["mapping_required", "ready_for_approval"]), fileName: name, mimeType: mime, charset: z.literal("utf-8"),
  byteLength: z.number().int().min(1).max(MAX_HTML_IMPORT_BYTES), fileSha256: sha, contentFingerprint: sha,
  mappingVersion: z.literal(CURRENT_MAPPING_VERSION), createdAt: date, createdBy: z.uuid(), updatedAt: date,
  sections: z.array(section).max(MAX_IMPORT_SECTIONS), fields: z.array(field).max(MAX_IMPORT_FIELDS),
  warnings: z.array(warning).max(MAX_IMPORT_FIELDS + MAX_IMPORT_SECTIONS), conflicts: z.array(conflict).max(MAX_IMPORT_FIELDS),
  security, approval: approval.nullable(), originalObjectReference: z.string().min(1).max(16 * 1024),
  operationKeys: z.partialRecord(z.enum(["upload", `reparse:${CURRENT_MAPPING_VERSION}`, "approve"]), importOperationKeySchema),
}).strict().superRefine((value, context) => {
  const invalid = () => context.addIssue({ code: "custom", message: "Import snapshot failed internal consistency checks" });
  const reference = (() => { try { return originalImportReferenceSchema.safeParse(JSON.parse(value.originalObjectReference)); } catch { return null; } })();
  if (!reference?.success) { invalid(); return; }
  const source = reference.data;
  if (source.archive.key !== `organizations/${value.organizationId}/branches/${value.branchId}/central-html/${value.fileSha256}/${source.reservationId}.html` ||
      source.archive.sha256 !== value.fileSha256 || source.archive.byteLength !== value.byteLength ||
      Date.parse(source.archive.createdAt) !== Date.parse(value.createdAt) || Date.parse(value.updatedAt) < Date.parse(value.createdAt)) invalid();
  const retention = new Date(source.archive.createdAt); retention.setUTCFullYear(retention.getUTCFullYear() + 7);
  if (Date.parse(source.archive.retainUntil) < retention.getTime() || Date.parse(value.createdAt) > Date.now() + 60_000 || Date.parse(value.updatedAt) > Date.now() + 60_000) invalid();
  const fields = new Map(value.fields.map(item => [item.id, item]));
  if (fields.size !== value.fields.length || new Set(value.sections.map(item => item.id)).size !== value.sections.length ||
      new Set(value.conflicts.map(item => item.id)).size !== value.conflicts.length || !value.operationKeys.upload ||
      value.sections.some((item, index) => item.index !== index)) invalid();
  if (value.fields.some(item => !value.sections.some(part => part.code === item.source.sectionCode && part.title === item.source.sectionTitle)) ||
      value.warnings.some(item => item.fieldId !== undefined && !fields.has(item.fieldId))) invalid();
  for (const item of value.conflicts) {
    if (new Set(item.candidates.map(candidate => candidate.fieldId)).size !== item.candidates.length ||
        item.candidates.some(candidate => fields.get(candidate.fieldId)?.mappingKey !== item.mappingKey || fields.get(candidate.fieldId)?.normalizedValue !== candidate.value)) invalid();
  }
  const unknown = value.sections.some(item => !item.recognized) || value.fields.some(item => item.mappingState === "unknown");
  if (value.status !== (unknown ? "mapping_required" : "ready_for_approval")) invalid();
  if (value.approval) {
    const signed = value.approval;
    if (value.version < 2 || unknown || value.fields.length === 0 || value.warnings.some(item => item.severity === "error") ||
        signed.approvedAt !== value.updatedAt || Date.parse(signed.approvedAt) < Date.parse(value.createdAt) ||
        value.operationKeys.approve !== signed.idempotencyKey || Object.keys(signed.conflictResolutions).length !== value.conflicts.length ||
        value.conflicts.some(item => !item.candidates.some(candidate => candidate.fieldId === signed.conflictResolutions[item.id]))) invalid();
  } else if (value.operationKeys.approve) invalid();
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 16 * 1024 * 1024 + 128 * 1024) invalid();
});

export const importUploadOperationSchema = z.object({ batch: importBatchRecordSchema,
  request: z.object({ fileSha256: sha, fileName: name, mimeType: mime }).strict(), duplicate: z.boolean(), replayed: z.boolean() }).strict()
  .superRefine((value, context) => {
    if (value.request.fileSha256 !== value.batch.fileSha256 || (!value.duplicate &&
      (value.request.fileName !== value.batch.fileName || value.request.mimeType !== value.batch.mimeType))) {
      context.addIssue({ code: "custom", message: "Import upload receipt failed internal consistency checks" });
    }
  });
