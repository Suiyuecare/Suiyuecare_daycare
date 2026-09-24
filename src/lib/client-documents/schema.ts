import { z } from "zod";

export const DOCUMENT_CATEGORIES = ["identity_front", "identity_back", "medication_bag", "medication_plan", "medication_history", "health_exam"] as const;
export const DOCUMENT_LABELS: Record<typeof DOCUMENT_CATEGORIES[number], string> = { identity_front: "身分證正面", identity_back: "身分證反面", medication_bag: "藥袋", medication_plan: "用藥計畫", medication_history: "歷史給藥紀錄", health_exam: "體檢資料" };
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
export const DOCUMENT_BUCKET = "client-intake-documents";
export const categorySchema = z.enum(DOCUMENT_CATEGORIES);
export type DocumentCategory = z.infer<typeof categorySchema>;
export const attachmentDetailsSchema = z.object({
  documentLabel: z.string().trim().min(1).max(120).regex(/^[^\u0000-\u001f]*$/).nullable().default(null),
  provider: z.string().trim().min(1).max(120).regex(/^[^\u0000-\u001f]*$/).nullable().default(null),
  documentDate: z.iso.date().nullable().default(null), validUntil: z.iso.date().nullable().default(null),
  periodFrom: z.iso.date().nullable().default(null), periodTo: z.iso.date().nullable().default(null),
});
export const documentMetaSchema = z.object({
  ...attachmentDetailsSchema.shape,
  clientId: z.uuid(), category: categorySchema, expectedDocumentVersion: z.number().int().min(0).max(1000000),
  idempotency_key: z.uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]), fileSizeBytes: z.number().int().min(1).max(MAX_DOCUMENT_BYTES),
}).strict().refine((v) => (!v.validUntil || !v.documentDate || v.validUntil >= v.documentDate) && ((v.periodFrom === null) === (v.periodTo === null)) && (!v.periodFrom || !v.periodTo || v.periodFrom <= v.periodTo), "文件或用藥期間先後不正確");
export const reviewInputSchema = z.object({
  clientId: z.uuid(), category: categorySchema, expectedDocumentVersion: z.number().int().min(0), expectedReviewVersion: z.number().int().min(0),
  decision: z.enum(["reviewed", "needs_replacement", "not_applicable"]),
  reason: z.string().trim().min(3).max(300).regex(/^[^\u0000-\u001f]*$/), idempotency_key: z.uuid(),
}).strict();
export const documentReceiptSchema = z.object({ id: z.uuid(), clientId: z.uuid(), category: categorySchema, version: z.number().int().positive(), scanStatus: z.enum(["clean", "infected", "failed"]), persisted: z.literal(true) });
export const reservationSchema = z.object({ id: z.uuid(), clientId: z.uuid(), category: categorySchema, version: z.number().int().positive(), objectPath: z.string().regex(/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/), sha256: z.string().regex(/^[a-f0-9]{64}$/), replayed: z.boolean(), terminalReceipt: documentReceiptSchema.nullable().default(null) });
export const reviewReceiptSchema = z.object({ clientId: z.uuid(), category: categorySchema, reviewVersion: z.number().int().positive(), decision: z.enum(["reviewed", "needs_replacement", "not_applicable"]), replayed: z.boolean(), persisted: z.literal(true) });
export const documentRowSchema = z.object({
  category: categorySchema, accessible: z.boolean(), canManage: z.boolean(), documentId: z.uuid().nullable(), documentVersion: z.number().int().min(0), reviewVersion: z.number().int().min(0),
  status: z.enum(["missing", "scanning", "needs_review", "reviewed", "needs_replacement", "not_applicable", "restricted"]),
  scanStatus: z.enum(["reserved", "clean", "infected", "failed"]).nullable(), canDownload: z.boolean(),
  mimeType: z.string().nullable(), fileSizeBytes: z.number().nullable(), reservedAt: z.string().nullable(), reviewReason: z.string().nullable(),
  categoryReviewDecision: z.enum(["reviewed", "needs_replacement", "not_applicable"]).nullable().optional(),
  documentDisposition: z.enum(["unreviewed", "reviewed", "needs_replacement", "inactive"]).optional(),
  documentReviewRevision: z.number().int().min(0).optional(), documentReviewReason: z.string().nullable().optional(),
  documentHistoricalOnly: z.boolean().optional(),
});
export const documentHistorySchema = z.object({ id: z.uuid(), category: categorySchema, version: z.number().int().positive(), scanStatus: z.enum(["reserved", "clean", "infected", "failed"]), ...attachmentDetailsSchema.shape });
export const documentsSnapshotSchema = z.object({ clientId: z.uuid(), generatedAt: z.iso.datetime({ offset: true }), rows: z.array(documentRowSchema).length(6), history: z.array(documentHistorySchema).max(200), historyTruncated: z.boolean() }).refine((v) => new Set(v.rows.map((r) => r.category)).size === 6);
export type DocumentsSnapshot = z.infer<typeof documentsSnapshotSchema>;
export type DocumentRow = z.infer<typeof documentRowSchema>;
export function documentPermission(category: DocumentCategory, write = false) { return category.startsWith("identity_") ? "clients.manage" : category === "health_exam" ? write ? "health.write" : "health.read" : write ? "medications.manage" : "medications.read"; }
export function hasDocumentCategoryPermission(scopes: readonly string[], category: DocumentCategory, write = false) {
  return scopes.includes(documentPermission(category, write)) &&
    (!category.startsWith("identity_") || scopes.includes("clients.demographics.read"));
}
