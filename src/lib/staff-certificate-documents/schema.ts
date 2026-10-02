import { z } from "zod";

export const MAX_STAFF_CERTIFICATE_DOCUMENT_BYTES = 4 * 1024 * 1024;
export const STAFF_CERTIFICATE_DOCUMENT_BUCKET = "staff-certificate-documents";
export const DOCUMENT_BUCKET = STAFF_CERTIFICATE_DOCUMENT_BUCKET;

const uuid = z.uuid().transform(value => value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const mime = z.enum(["application/pdf", "image/jpeg", "image/png"]);
const byteSize = z.number().int().min(1).max(MAX_STAFF_CERTIFICATE_DOCUMENT_BYTES);
const timestamp = z.string().max(64).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u)
  .refine(value => z.iso.datetime({ offset: true }).safeParse(value).success && Number.isFinite(Date.parse(value)));
const reason = z.string().trim().min(3).max(300).regex(/^[^\u0000-\u001f\u007f]*$/u);
const scan = z.enum(["reserved", "clean", "infected", "failed"]);

const uploadFields = {
  staffMembershipId: uuid, certificateKey: uuid, recordVersionId: uuid,
  recordContentHash: hash, idempotency_key: uuid,
};
/** Browser fields do not accept a path, filename, actor, scan verdict or hash. */
export const uploadFormInputSchema = z.object(uploadFields).strict();
/** Computed bytes, MIME and hash are supplied by the trusted server pipeline. */
export const uploadMetadataSchema = z.object({ ...uploadFields,
  sha256: hash, mimeType: mime, fileSizeBytes: byteSize,
}).strict();

const documentFields = {
  documentId: uuid, organizationId: uuid, branchId: uuid,
  staffMembershipId: uuid, staffUserId: uuid, certificateKey: uuid,
  recordVersionId: uuid, recordContentHash: hash, sha256: hash,
  mimeType: mime, fileSizeBytes: byteSize, uploadedBy: uuid, uploadedAt: timestamp,
  scanStatus: scan, persisted: z.literal(true), serviceEligibility: z.literal("not_evaluated"),
  signable: z.literal(false), demo: z.literal(false),
};
export const documentReceiptSchema = z.object(documentFields).strict();
const terminalReceiptSchema = documentReceiptSchema.refine(value => value.scanStatus !== "reserved");

function objectPath(value: { organizationId: string; branchId: string; staffMembershipId: string; certificateKey: string; documentId: string }) {
  return `${value.organizationId}/${value.branchId}/${value.staffMembershipId}/${value.certificateKey}/${value.documentId}`;
}
function exactDocument(left: z.infer<typeof documentReceiptSchema>, right: z.infer<typeof documentReceiptSchema>) {
  return (Object.keys(documentFields) as (keyof typeof documentFields)[]).every(key => left[key] === right[key]);
}
/** Preserve microseconds when comparing immutable evidence timestamps. */
function instant(value: string): bigint | null {
  const match = /^(.*?)(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) return null;
  const millis = Date.parse(`${match[1]}${match[3]}`);
  return Number.isSafeInteger(millis) ? BigInt(millis) * BigInt(1000) + BigInt((match[2] ?? "").padEnd(6, "0")) : null;
}
function ordered(from: string, through: string) {
  const left = instant(from), right = instant(through);
  return left !== null && right !== null && left <= right;
}

export const reservationSchema = z.object({ ...documentFields,
  objectPath: z.string().max(184), replayed: z.boolean(), terminalReceipt: terminalReceiptSchema.nullable(),
}).strict().refine(value => value.objectPath === objectPath(value) &&
  (value.terminalReceipt === null ? value.scanStatus === "reserved" : value.replayed && exactDocument(value, value.terminalReceipt)));

export const reviewInputSchema = z.object({
  documentId: uuid, recordVersionId: uuid, recordContentHash: hash,
  decision: z.enum(["verified", "rejected"]), reason, idempotency_key: uuid,
}).strict();
export const reviewReceiptSchema = z.object({ ...documentFields,
  scanStatus: z.literal("clean"), reviewId: uuid, reviewedBy: uuid, reviewedAt: timestamp,
  decision: z.enum(["verified", "rejected"]), reason, replayed: z.boolean(),
}).strict().refine(value => value.reviewedBy !== value.uploadedBy && value.reviewedBy !== value.staffUserId &&
  ordered(value.uploadedAt, value.reviewedAt));

export const downloadInputSchema = z.object({
  documentId: uuid, recordVersionId: uuid, recordContentHash: hash, idempotency_key: uuid,
}).strict();
export const downloadReceiptSchema = z.object({ ...documentFields,
  scanStatus: z.literal("clean"), objectPath: z.string().max(184),
  expiresSeconds: z.literal(60), canDownload: z.literal(true),
}).strict().refine(value => value.objectPath === objectPath(value));

const snapshotDocumentSchema = z.object({ ...documentFields,
  review: reviewReceiptSchema.nullable(), canDownload: z.boolean(),
}).strict().refine(value => (!value.review || exactDocument(value, value.review)) &&
  (!value.canDownload || value.scanStatus === "clean" && value.review?.decision !== "rejected"));
export const documentsSnapshotSchema = z.object({
  organizationId: uuid, branchId: uuid, actorUserId: uuid, staffMembershipId: uuid, staffUserId: uuid,
  certificateKey: uuid, recordVersionId: uuid, recordContentHash: hash, generatedAt: timestamp,
  documents: z.array(snapshotDocumentSchema).max(50), total: z.number().int().min(0).max(1_000_000),
  truncated: z.boolean(), serviceEligibility: z.literal("not_evaluated"), signable: z.literal(false), demo: z.literal(false),
}).strict().refine(value => value.documents.length === Math.min(value.total, 50) && value.truncated === (value.total > 50) &&
  new Set(value.documents.map(document => document.documentId)).size === value.documents.length &&
  new Set(value.documents.flatMap(document => document.review ? [document.review.reviewId] : [])).size === value.documents.filter(document => document.review !== null).length &&
  value.documents.every(document => document.organizationId === value.organizationId && document.branchId === value.branchId &&
    document.staffMembershipId === value.staffMembershipId && document.staffUserId === value.staffUserId &&
    document.certificateKey === value.certificateKey && document.recordVersionId === value.recordVersionId &&
    document.recordContentHash === value.recordContentHash && ordered(document.uploadedAt, value.generatedAt) &&
    (!document.review || ordered(document.review.reviewedAt, value.generatedAt))));

export type StaffCertificateDocumentUploadInput = z.infer<typeof uploadFormInputSchema>;
export type UploadInput = StaffCertificateDocumentUploadInput;
export type StaffCertificateDocumentMetadata = z.infer<typeof uploadMetadataSchema>;
export type StaffCertificateDocumentReceipt = z.infer<typeof documentReceiptSchema>;
export type StaffCertificateDocumentReservation = z.infer<typeof reservationSchema>;
export type StaffCertificateDocumentReviewInput = z.infer<typeof reviewInputSchema>;
export type StaffCertificateDocumentReviewReceipt = z.infer<typeof reviewReceiptSchema>;
export type StaffCertificateDocumentDownloadInput = z.infer<typeof downloadInputSchema>;
export type StaffCertificateDocumentDownloadReceipt = z.infer<typeof downloadReceiptSchema>;
export type StaffCertificateDocumentsSnapshot = z.infer<typeof documentsSnapshotSchema>;
