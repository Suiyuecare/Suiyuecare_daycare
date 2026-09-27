import "server-only";
import { createHash } from "node:crypto";
import { IntegrationError } from "@/lib/integrations/errors";
import { configuredDocumentScanner, inspectDocument, type DocumentScanner, type DocumentStorage } from "@/lib/client-documents/pipeline";
import { validateIntakePdf } from "@/lib/client-documents/pdf-validation";
import { documentReceiptSchema, reservationSchema, type StaffCertificateDocumentReceipt, type StaffCertificateDocumentUploadInput as UploadInput } from "./schema";
import { documentDeadline } from "./request";

export type StaffDocumentActor = { organizationId: string; branchId: string; userId: string };
export type StaffDocumentPipeline = {
  actor: StaffDocumentActor;
  scanner: DocumentScanner | null;
  storage: DocumentStorage;
  reserve: (metadata: UploadInput & { sha256: string; mimeType: string; fileSizeBytes: number }) => Promise<unknown>;
  complete: (documentId: string, sha256: string, verdict: "clean" | "infected" | "failed", scanner: string) => Promise<unknown>;
};

/** Staff evidence is a separately approved purpose. A client-document approval
 * alone does not grant permission to send employee certificates to the scanner. */
export function configuredStaffCertificateDocumentScanner(): DocumentScanner | null {
  return process.env.STAFF_CERTIFICATE_DOCUMENTS_SCANNER_APPROVED === "true" ? configuredDocumentScanner() : null;
}

export function staffDocumentPath(document: Pick<StaffCertificateDocumentReceipt,
  "organizationId" | "branchId" | "staffMembershipId" | "certificateKey" | "documentId">) {
  return `${document.organizationId}/${document.branchId}/${document.staffMembershipId}/${document.certificateKey}/${document.documentId}`;
}

function matchesUpload(receipt: StaffCertificateDocumentReceipt, actor: StaffDocumentActor,
  input: UploadInput, sha256: string, mimeType: string, size: number) {
  return receipt.organizationId === actor.organizationId && receipt.branchId === actor.branchId &&
    receipt.uploadedBy === actor.userId && receipt.staffMembershipId === input.staffMembershipId &&
    receipt.certificateKey === input.certificateKey && receipt.recordVersionId === input.recordVersionId &&
    receipt.recordContentHash === input.recordContentHash && receipt.sha256 === sha256 &&
    receipt.mimeType === mimeType && receipt.fileSizeBytes === size;
}

export async function processStaffCertificateDocumentUpload(deps: StaffDocumentPipeline, input: UploadInput,
  bytes: Uint8Array, claimedMime: string): Promise<StaffCertificateDocumentReceipt> {
  if (!deps.scanner) throw new IntegrationError("STAFF_DOCUMENT_SCANNER_NOT_CONFIGURED",
    "員工附件安全檢查尚未設定，檔案不會上傳。", 503);
  const mimeType = inspectDocument(bytes, claimedMime);
  if (mimeType === "application/pdf") await documentDeadline(validateIntakePdf(bytes));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const metadata = { ...input, sha256, mimeType, fileSizeBytes: bytes.length };
  const raw = await documentDeadline(deps.reserve(metadata));
  const parsed = reservationSchema.safeParse(raw);
  if (!parsed.success || !matchesUpload(parsed.data, deps.actor, input, sha256, mimeType, bytes.length) ||
    parsed.data.objectPath !== staffDocumentPath(parsed.data)) {
    throw new IntegrationError("STAFF_DOCUMENT_RESERVATION_UNCERTAIN", "附件預留結果不一致，請保留原操作交由管理員確認。", 502);
  }
  const reservation = parsed.data;
  let stored = reservation.replayed ? await documentDeadline(deps.storage.read(reservation.objectPath)) : null;
  // A completed object must already exist. Recreating it would recycle old clean
  // evidence without testing the bytes now present in storage.
  if (reservation.terminalReceipt && (!reservation.replayed || !stored)) {
    throw new IntegrationError("STAFF_DOCUMENT_STORAGE_MISMATCH", "原附件內容尚未確認，不會以新檔取代既有檢查證據。", 409);
  }
  if (!stored) {
    await documentDeadline(deps.storage.upload(reservation.objectPath, bytes, mimeType));
    stored = await documentDeadline(deps.storage.read(reservation.objectPath));
  }
  if (!stored || stored.length !== bytes.length || createHash("sha256").update(stored).digest("hex") !== sha256) {
    throw new IntegrationError("STAFF_DOCUMENT_STORAGE_MISMATCH", "附件儲存內容未通過核對，不會登記安全檢查通過。", 409);
  }
  if (reservation.terminalReceipt) {
    const terminal = reservation.terminalReceipt;
    if (terminal.documentId !== reservation.documentId || !matchesUpload(terminal, deps.actor, input, sha256, mimeType, bytes.length) ||
      terminal.staffUserId !== reservation.staffUserId || terminal.uploadedAt !== reservation.uploadedAt || terminal.scanStatus === "reserved") {
      throw new IntegrationError("STAFF_DOCUMENT_RESULT_UNCERTAIN", "既有附件檢查結果尚未完整確認，請保留原操作。", 502);
    }
    // Storage reads may wait behind a permission change. Reauthorize the exact
    // original reservation; a pre-wait terminal receipt is not current authority.
    const fresh = reservationSchema.safeParse(await documentDeadline(deps.reserve(metadata)));
    if (!fresh.success || fresh.data.objectPath !== reservation.objectPath || !fresh.data.replayed ||
      !fresh.data.terminalReceipt || JSON.stringify(fresh.data.terminalReceipt) !== JSON.stringify(terminal)) {
      throw new IntegrationError("STAFF_DOCUMENT_RESULT_UNCERTAIN", "原附件的最新授權與檢查結果未確認。", 502);
    }
    return fresh.data.terminalReceipt;
  }
  let verdict: "clean" | "infected" | "failed";
  try {
    const result = await documentDeadline(deps.scanner.scan(stored), 12000);
    verdict = result === "clean" || result === "infected" ? result : "failed";
  } catch { verdict = "failed"; }
  const complete = documentReceiptSchema.safeParse(await documentDeadline(deps.complete(reservation.documentId, sha256, verdict, deps.scanner.name)));
  if (!complete.success || complete.data.documentId !== reservation.documentId ||
    !matchesUpload(complete.data, deps.actor, input, sha256, mimeType, bytes.length) ||
    complete.data.staffUserId !== reservation.staffUserId || complete.data.uploadedAt !== reservation.uploadedAt || complete.data.scanStatus !== verdict) {
    throw new IntegrationError("STAFF_DOCUMENT_RESULT_UNCERTAIN", "附件檢查結果尚未完整確認，請保留原檔與操作識別碼重試。", 502);
  }
  return complete.data;
}
