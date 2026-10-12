import "server-only";
import { createHash } from "node:crypto";
import type { z } from "zod";
import { inspectDocument, type DocumentScanner, type DocumentStorage } from "@/lib/client-documents/pipeline";
import { validateIntakePdf } from "@/lib/client-documents/pdf-validation";
import { IntegrationError } from "@/lib/integrations/errors";
import { clinicalReceiptSchema, clinicalReservationSchema, type clinicalUploadSchema } from "./schema";

type Input = z.infer<typeof clinicalUploadSchema>;
export async function processClinicalAttachment(deps: { scanner: DocumentScanner | null; storage: DocumentStorage; reserve: (input: Input & { sha256: string; mimeType: string; fileSizeBytes: number }) => Promise<unknown>; complete: (id: string, sha256: string, verdict: "clean" | "infected" | "failed", scanner: string) => Promise<unknown> }, input: Input, bytes: Uint8Array, claimedMime: string, organizationId: string) {
  if (!deps.scanner) throw new IntegrationError("DOCUMENT_SCANNER_NOT_CONFIGURED", "附件安全檢查尚未設定，請聯絡管理員。", 503);
  const mimeType = inspectDocument(bytes, claimedMime);
  if (mimeType === "application/pdf") await validateIntakePdf(bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const reserved = clinicalReservationSchema.parse(await deps.reserve({ ...input, sha256, mimeType, fileSizeBytes: bytes.length }));
  const sameSource = (value: { clientId: string; sourceKind: string; sourceId: string; sourceVersion: number }) => value.clientId === input.clientId && value.sourceKind === input.sourceKind && value.sourceId === input.sourceId && value.sourceVersion === input.sourceVersion;
  if (!sameSource(reserved) || reserved.sha256 !== sha256 || reserved.objectPath !== `${organizationId}/${input.clientId}/${reserved.id}`) throw new IntegrationError("ATTACHMENT_RESERVATION_UNCERTAIN", "附件與個案版本不一致，請重新核對。", 409);
  const existing = reserved.replayed ? await deps.storage.read(reserved.objectPath) : null;
  if (existing && createHash("sha256").update(existing).digest("hex") !== sha256) throw new IntegrationError("ATTACHMENT_HASH_MISMATCH", "附件內容不一致，請聯絡管理員。", 409);
  if (!existing) await deps.storage.upload(reserved.objectPath, bytes, mimeType);
  if (reserved.scanStatus) return clinicalReceiptSchema.parse({ clientId: reserved.clientId, sourceKind: reserved.sourceKind, sourceId: reserved.sourceId, sourceVersion: reserved.sourceVersion, id: reserved.id, scanStatus: reserved.scanStatus, persisted: true });
  let verdict: "clean" | "infected" | "failed";
  try { verdict = await deps.scanner.scan(bytes); } catch { verdict = "failed"; }
  const receipt = clinicalReceiptSchema.parse(await deps.complete(reserved.id, sha256, verdict, deps.scanner.name));
  if (!sameSource(receipt) || receipt.id !== reserved.id || receipt.scanStatus !== verdict) throw new IntegrationError("ATTACHMENT_RECEIPT_UNCERTAIN", "附件結果尚未確認，請重試原操作。", 409);
  return receipt;
}
