import { z } from "zod";
import { MAX_STAFF_CERTIFICATE_DOCUMENT_BYTES, documentReceiptSchema, reviewReceiptSchema } from "./schema";

const uuid = z.uuid().transform(value => value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const timestamp = z.string().max(64).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u)
  .refine(value => z.iso.datetime({ offset: true }).safeParse(value).success && Number.isFinite(Date.parse(value)));
const date = z.iso.date();
const scopeFields = { organizationId: uuid, branchId: uuid, actorUserId: uuid };
const noQualification = { serviceEligibility: z.literal("not_evaluated"), signable: z.literal(false), demo: z.literal(false) };
const cleanText = (max: number) => z.string().min(1).max(max).regex(/^[^\u0000-\u001f\u007f]*$/u);

export const reserveBindingSchema = z.object({
  staffMembershipId: uuid, certificateKey: uuid, recordVersionId: uuid, recordContentHash: hash,
  sha256: hash, mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  fileSizeBytes: z.number().int().min(1).max(MAX_STAFF_CERTIFICATE_DOCUMENT_BYTES),
}).strict();
export const reviewBindingSchema = z.object({
  documentId: uuid, recordVersionId: uuid, recordContentHash: hash,
  decision: z.enum(["verified", "rejected"]), reasonSha256: hash,
}).strict();
export const operationBindingSchema = z.union([reserveBindingSchema, reviewBindingSchema]);
export const operationReceiptInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reserve"), idempotencyKey: uuid, nonce: uuid, binding: reserveBindingSchema }).strict(),
  z.object({ action: z.literal("review"), idempotencyKey: uuid, nonce: uuid, binding: reviewBindingSchema }).strict(),
]);
export const closureInputSchema = z.object({
  originalIdempotencyKey: uuid, reconciliationKey: uuid, nonce: uuid, binding: reserveBindingSchema,
}).strict().refine(value => value.originalIdempotencyKey !== value.reconciliationKey);
export const sourceQuerySchema = z.object({
  staffMembershipId: uuid.nullable().default(null), page: z.coerce.number().int().min(1).max(10000).default(1),
}).strict();

const sourceRowSchema = z.object({
  staffMembershipId: uuid, staffUserId: uuid, displayName: cleanText(160), certificateKey: uuid,
  recordVersionId: uuid, recordContentHash: hash, version: z.number().int().positive().safe(),
  recordStatus: z.enum(["active", "voided"]), certificateType: cleanText(120),
  effectiveOn: date, expiresOn: date.nullable(), canUpload: z.boolean(),
}).strict().refine(value => (value.expiresOn === null || value.expiresOn >= value.effectiveOn) && (!value.canUpload || value.recordStatus === "active"));
export const sourcesSnapshotSchema = z.object({
  ...scopeFields, staffMembershipId: uuid.nullable(), generatedAt: timestamp,
  page: z.number().int().min(1).max(10000), pageSize: z.literal(50), rows: z.array(sourceRowSchema).max(50),
  total: z.number().int().min(0).max(1_000_000), hasMore: z.boolean(), canManageDocuments: z.boolean(), ...noQualification,
}).strict().refine(value => value.rows.length === Math.min(50, Math.max(0, value.total - (value.page - 1) * 50)) &&
  value.hasMore === (value.page * 50 < value.total) && new Set(value.rows.map(row => row.recordVersionId)).size === value.rows.length &&
  new Set(value.rows.map(row => row.certificateKey)).size === value.rows.length && value.rows.every(row =>
    (value.staffMembershipId === null || row.staffMembershipId === value.staffMembershipId) &&
    (!row.canUpload || value.canManageDocuments) && (value.canManageDocuments || row.staffUserId === value.actorUserId)));

const closureSchema = z.object({
  terminationId: uuid, documentId: uuid, originalIdempotencyKey: uuid, reconciliationKey: uuid,
  closedBy: uuid, closedAt: timestamp, reason: z.literal("reservation_expired"),
}).strict().refine(value => value.originalIdempotencyKey !== value.reconciliationKey);
const commonFields = { schemaVersion: z.literal(1), ...scopeFields, idempotencyKey: uuid, nonce: uuid,
  checkedAt: timestamp, ...noQualification };
const absentFields = { reservationState: z.null(), closure: z.null() };
const reservedDocument = documentReceiptSchema.refine(value => value.scanStatus === "reserved");
const terminalDocument = documentReceiptSchema.refine(value => value.scanStatus !== "reserved");
const originalReview = reviewReceiptSchema.refine(value => value.replayed === false);
const notFoundReserve = z.object({ ...commonFields, action: z.literal("reserve"), binding: reserveBindingSchema,
  status: z.literal("not_found"), receipt: z.null(), persisted: z.literal(false), ...absentFields }).strict();
const notFoundReview = z.object({ ...commonFields, action: z.literal("review"), binding: reviewBindingSchema,
  status: z.literal("not_found"), receipt: z.null(), persisted: z.literal(false), ...absentFields }).strict();
const reserved = z.object({ ...commonFields, action: z.literal("reserve"), binding: reserveBindingSchema,
  status: z.literal("reserved"), receipt: reservedDocument, persisted: z.literal(true),
  reservationState: z.enum(["pending", "expired"]), closure: z.null() }).strict();
const completedReserve = z.object({ ...commonFields, action: z.literal("reserve"), binding: reserveBindingSchema,
  status: z.literal("completed"), receipt: terminalDocument, persisted: z.literal(true), ...absentFields }).strict();
const completedReview = z.object({ ...commonFields, action: z.literal("review"), binding: reviewBindingSchema,
  status: z.literal("completed"), receipt: originalReview, persisted: z.literal(true), ...absentFields }).strict();
const closed = z.object({ ...commonFields, action: z.literal("reserve"), binding: reserveBindingSchema,
  status: z.literal("expired_closed"), receipt: reservedDocument, persisted: z.literal(true),
  reservationState: z.null(), closure: closureSchema }).strict();

/** Compare evidence times without truncating PostgreSQL microseconds. */
function micros(value: string): bigint | null {
  const match = /^(.*?)(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) return null;
  const millis = Date.parse(`${match[1]}${match[3]}`);
  return Number.isSafeInteger(millis) ? BigInt(millis) * BigInt(1000) + BigInt((match[2] ?? "").padEnd(6, "0")) : null;
}
function ordered(from: string, through: string) {
  const left = micros(from), right = micros(through);
  return left !== null && right !== null && left <= right;
}
type Operation = z.infer<typeof notFoundReserve> | z.infer<typeof notFoundReview> | z.infer<typeof reserved> |
  z.infer<typeof completedReserve> | z.infer<typeof completedReview> | z.infer<typeof closed>;
function correlated(value: Operation) {
  const receipt = value.receipt;
  if (!receipt) return true;
  if (receipt.organizationId !== value.organizationId || receipt.branchId !== value.branchId ||
    !ordered(receipt.uploadedAt, value.checkedAt)) return false;
  if (value.action === "reserve") {
    if (receipt.uploadedBy !== value.actorUserId || !Object.entries(value.binding).every(([key, expected]) => receipt[key as keyof typeof receipt] === expected)) return false;
  } else {
    if (!("reviewedBy" in receipt) || receipt.reviewedBy !== value.actorUserId || receipt.documentId !== value.binding.documentId ||
      receipt.recordVersionId !== value.binding.recordVersionId || receipt.recordContentHash !== value.binding.recordContentHash ||
      receipt.decision !== value.binding.decision ||
      !ordered(receipt.reviewedAt, value.checkedAt)) return false;
  }
  return value.status !== "expired_closed" || value.closure.documentId === receipt.documentId &&
    value.closure.originalIdempotencyKey === value.idempotencyKey && value.closure.closedBy === value.actorUserId &&
    ordered(receipt.uploadedAt, value.closure.closedAt) && ordered(value.closure.closedAt, value.checkedAt);
}
export const operationReceiptSchema = z.union([notFoundReserve, notFoundReview, reserved, completedReserve, completedReview, closed]).refine(correlated);
export const closureReceiptSchema = z.union([
  completedReserve.extend({ reconciliationKey: uuid, replayed: z.literal(true) }).strict(),
  closed.extend({ reconciliationKey: uuid, replayed: z.boolean() }).strict(),
]).refine(value => correlated(value) && value.reconciliationKey !== value.idempotencyKey &&
  (value.status !== "expired_closed" || value.closure.reconciliationKey === value.reconciliationKey));

const expectedSchema = z.discriminatedUnion("action", [
  z.object({ ...scopeFields, action: z.literal("reserve"), idempotencyKey: uuid, nonce: uuid, binding: reserveBindingSchema }).strict(),
  z.object({ ...scopeFields, action: z.literal("review"), idempotencyKey: uuid, nonce: uuid, binding: reviewBindingSchema }).strict(),
]);
const expectedClosureSchema = z.object({ ...scopeFields, originalIdempotencyKey: uuid, reconciliationKey: uuid,
  nonce: uuid, binding: reserveBindingSchema }).strict().refine(value => value.originalIdempotencyKey !== value.reconciliationKey);

/** Admit bounded plain JSON before Zod can access hostile descriptors. */
function plainJson(value: unknown): boolean {
  const visited = new Set<object>(); let count = 0, size = 0;
  function visit(input: unknown, depth: number): boolean {
    if (++count > 10000 || depth > 12) return false;
    if (input === null || typeof input === "boolean") return true;
    if (typeof input === "number") return Number.isFinite(input);
    if (typeof input === "string") { size += input.length; return size <= 128 * 1024; }
    if (typeof input !== "object" || visited.has(input)) return false;
    const array = Array.isArray(input), prototype = Object.getPrototypeOf(input);
    if (prototype !== (array ? Array.prototype : Object.prototype) && !(prototype === null && !array)) return false;
    visited.add(input);
    const keys = Reflect.ownKeys(input), descriptors = Object.getOwnPropertyDescriptors(input);
    if (keys.some(key => typeof key !== "string")) return false;
    if (array && (keys.length !== input.length + 1 || keys.some(key => key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(String(key))))) return false;
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (array && key === "length") continue;
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value") || !visit(descriptor.value, depth + 1)) return false;
      size += key.length; if (size > 128 * 1024) return false;
    }
    return true;
  }
  try { return visit(value, 0); } catch { return false; }
}
export class StaffCertificateDocumentRecoveryError extends Error {
  constructor() { super("員工附件查證結果尚未完整確認。"); this.name = "StaffCertificateDocumentRecoveryError"; }
}
function fail(): never { throw new StaffCertificateDocumentRecoveryError(); }
function fresh(checkedAt: string, now: number) {
  if (!Number.isSafeInteger(now)) return false;
  const time = micros(checkedAt), clock = BigInt(now) * BigInt(1000);
  return time !== null && time >= clock - BigInt(60000000) && time <= clock + BigInt(1000000);
}
function sameBinding(left: object, right: object) {
  return Object.keys(left).length === Object.keys(right).length && Object.entries(left).every(([key, value]) => right[key as keyof typeof right] === value);
}
/** Shape validation alone is not proof of the original qualitative reason.
 * Callers must await this parser, including its WebCrypto evidence check. */
export async function parseStaffCertificateDocumentOperationReceipt(value: unknown, expected: unknown, now?: number) {
  if (!plainJson(value) || !plainJson(expected)) fail();
  const proof = operationReceiptSchema.safeParse(value), target = expectedSchema.safeParse(expected);
  if (!proof.success || !target.success || !fresh(proof.data.checkedAt, now ?? Date.now()) ||
    Object.keys(scopeFields).some(key => proof.data[key as keyof typeof scopeFields] !== target.data[key as keyof typeof scopeFields]) ||
    proof.data.action !== target.data.action || proof.data.idempotencyKey !== target.data.idempotencyKey ||
    proof.data.nonce !== target.data.nonce || !sameBinding(proof.data.binding, target.data.binding)) fail();
  if (proof.data.action === "review" && proof.data.status === "completed") {
    try {
      if (!globalThis.crypto?.subtle) fail();
      const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(proof.data.receipt.reason));
      const actual = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
      if (actual !== proof.data.binding.reasonSha256) fail();
    } catch { fail(); }
  }
  if (!fresh(proof.data.checkedAt, now ?? Date.now())) fail();
  return proof.data;
}
export async function parseStaffCertificateDocumentClosureReceipt(value: unknown, expected: unknown, now?: number) {
  if (!plainJson(value) || !plainJson(expected)) fail();
  const proof = closureReceiptSchema.safeParse(value), target = expectedClosureSchema.safeParse(expected);
  if (!proof.success || !target.success || !fresh(proof.data.checkedAt, now ?? Date.now()) ||
    Object.keys(scopeFields).some(key => proof.data[key as keyof typeof scopeFields] !== target.data[key as keyof typeof scopeFields]) ||
    proof.data.idempotencyKey !== target.data.originalIdempotencyKey || proof.data.reconciliationKey !== target.data.reconciliationKey ||
    proof.data.nonce !== target.data.nonce || !sameBinding(proof.data.binding, target.data.binding)) fail();
  return proof.data;
}

export type StaffCertificateDocumentReserveBinding = z.infer<typeof reserveBindingSchema>;
export type StaffCertificateDocumentReviewBinding = z.infer<typeof reviewBindingSchema>;
export type StaffCertificateDocumentOperationInput = z.infer<typeof operationReceiptInputSchema>;
export type StaffCertificateDocumentOperationReceipt = z.infer<typeof operationReceiptSchema>;
export type StaffCertificateDocumentClosureInput = z.infer<typeof closureInputSchema>;
export type StaffCertificateDocumentClosureReceipt = z.infer<typeof closureReceiptSchema>;
export type StaffCertificateDocumentSourcesSnapshot = z.infer<typeof sourcesSnapshotSchema>;
