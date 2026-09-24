import "server-only";
import { createHash, X509Certificate } from "node:crypto";
import { connect, createSecureContext, type ConnectionOptions } from "node:tls";
import { IntegrationError } from "@/lib/integrations/errors";
import { DOCUMENT_BUCKET, MAX_DOCUMENT_BYTES, documentReceiptSchema, reservationSchema, type DocumentCategory } from "./schema";
import { validateIntakePdf } from "./pdf-validation";

export type DocumentScanner = { name: string; scan: (bytes: Uint8Array) => Promise<"clean" | "infected" | "failed"> };
export type DocumentStorage = { upload: (path: string, bytes: Uint8Array, mimeType: string) => Promise<void>; read: (path: string) => Promise<Uint8Array | null> };
type Metadata = { clientId: string; category: DocumentCategory; expectedDocumentVersion: number; idempotency_key: string; sha256: string; mimeType: "application/pdf" | "image/png" | "image/jpeg"; fileSizeBytes: number; documentLabel?: string | null; provider?: string | null; documentDate?: string | null; validUntil?: string | null; periodFrom?: string | null; periodTo?: string | null };
export type DocumentPipeline = { scanner: DocumentScanner | null; storage: DocumentStorage; reserve: (input: Metadata) => Promise<unknown>; complete: (id: string, sha256: string, verdict: "clean" | "infected" | "failed", scanner: string) => Promise<unknown> };
export function inspectDocument(bytes: Uint8Array, claimedMime: string): Metadata["mimeType"] {
  if (!bytes.length || bytes.length > MAX_DOCUMENT_BYTES) throw new IntegrationError("INVALID_DOCUMENT_SIZE", "附件需介於 1 byte 至 4MB。", 400);
  const buffer = Buffer.from(bytes);
  const mime = buffer.subarray(0, 5).toString("ascii") === "%PDF-" ? "application/pdf" : buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png" : buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 ? "image/jpeg" : null;
  if (!mime || claimedMime !== mime) throw new IntegrationError("INVALID_DOCUMENT_TYPE", "只接受內容與格式一致的 PDF、JPEG、PNG。", 400);
  if (mime === "application/pdf" && /\/(?:JavaScript|JS|OpenAction|AA|Launch|EmbeddedFile|Encrypt)\b/i.test(buffer.toString("latin1"))) throw new IntegrationError("ACTIVE_DOCUMENT_BLOCKED", "PDF 含有主動內容、內嵌檔案或加密，請轉存為一般 PDF 後上傳。", 400);
  return mime;
}
export async function processDocumentUpload(deps: DocumentPipeline, input: Omit<Metadata, "sha256" | "mimeType" | "fileSizeBytes">, bytes: Uint8Array, claimedMime: string) {
  if (!deps.scanner) throw new IntegrationError("DOCUMENT_SCANNER_NOT_CONFIGURED", "附件安全檢查尚未完成設定，檔案不會上傳；請聯絡系統管理員。", 503);
  const mimeType = inspectDocument(bytes, claimedMime);
  if (mimeType === "application/pdf") await validateIntakePdf(bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const metadata = { ...input, sha256, mimeType, fileSizeBytes: bytes.length };
  const reservation = reservationSchema.parse(await deps.reserve(metadata));
  if (reservation.clientId !== input.clientId || reservation.category !== input.category || reservation.version !== input.expectedDocumentVersion + 1 || reservation.sha256 !== sha256 || !reservation.objectPath.endsWith(`/${reservation.id}`)) throw new IntegrationError("DOCUMENT_RESERVATION_UNCERTAIN", "附件預留回條不一致，操作已停止。", 409);
  // Only the server-derived reserved object key is used; never a browser path or original filename.
  const existing = reservation.replayed ? await deps.storage.read(reservation.objectPath) : null;
  if (existing) {
    if (createHash("sha256").update(existing).digest("hex") !== sha256) throw new IntegrationError("DOCUMENT_STORAGE_MISMATCH", "附件版本不一致，請聯絡管理員。", 409);
  } else { await deps.storage.upload(reservation.objectPath, bytes, mimeType); }
  if (reservation.terminalReceipt) {
    const terminal = reservation.terminalReceipt;
    if (!reservation.replayed || terminal.id !== reservation.id || terminal.clientId !== input.clientId || terminal.category !== input.category || terminal.version !== reservation.version) throw new IntegrationError("DOCUMENT_RESULT_UNCERTAIN", "既有掃描回條不一致，操作已停止。", 409);
    return terminal;
  }
  let verdict: "clean" | "infected" | "failed";
  try { verdict = await deps.scanner.scan(bytes); } catch { verdict = "failed"; }
  const receipt = documentReceiptSchema.parse(await deps.complete(reservation.id, sha256, verdict, deps.scanner.name));
  if (receipt.id !== reservation.id || receipt.clientId !== input.clientId || receipt.category !== input.category || receipt.version !== reservation.version || receipt.scanStatus !== verdict) throw new IntegrationError("DOCUMENT_RESULT_UNCERTAIN", "附件檢查回條尚未確認，請保留原操作並重試。", 409);
  return receipt;
}

/** No default scanner, fake-clean mode, or browser-controlled endpoint exists.
 * Enable only after the deployment owner approves the scanner and its data region. */
export function configuredDocumentScanner(): DocumentScanner | null {
  if (process.env.CLIENT_DOCUMENTS_SCANNER_APPROVED !== "true") return null;
  const host = process.env.CLIENT_DOCUMENTS_CLAMAV_HOST;
  const port = Number(process.env.CLIENT_DOCUMENTS_CLAMAV_PORT ?? "3310");
  if (!host || !/^[a-zA-Z0-9.-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  const mode = process.env.CLIENT_DOCUMENTS_SCANNER_ACCESS_MODE;
  const cert = process.env.CLIENT_DOCUMENTS_CLAMAV_CLIENT_CERT_PEM;
  const key = process.env.CLIENT_DOCUMENTS_CLAMAV_CLIENT_KEY_PEM;
  const ca = process.env.CLIENT_DOCUMENTS_CLAMAV_CA_PEM;
  // A public TLS socket alone authenticates the server, not this application.
  // The owner must choose mTLS or an independently controlled private network.
  if (mode !== "mtls" && mode !== "private_network") return null;
  const boundedPem = (value: string | undefined) => !value || value.length <= 32768;
  if (![cert, key, ca].every(boundedPem)) return null;
  if (mode === "mtls" && (!cert || !key)) return null;
  if (mode === "private_network" && (cert || key)) return null;
  const options: ConnectionOptions = { host, port, servername: host, rejectUnauthorized: true, minVersion: "TLSv1.2",
    ...(mode === "mtls" ? { cert, key } : {}), ...(ca ? { ca } : {}) };
  try {
    // Match the release preflight: TLS may silently ignore malformed CA text.
    // Parse every certificate and reject trailing/unparsed material first.
    if (ca) {
      const certificates = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
      if (!certificates.length || ca.replace(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g, "").trim()) return null;
      for (const certificate of certificates) new X509Certificate(certificate);
    }
    createSecureContext(options);
  } catch { return null; }
  return { name: "clamav-tls-instream-v1", scan: (bytes) => new Promise((resolve) => {
    let reply = ""; let done = false;
    // The deployment must provide a certificate-verified TLS gateway in front of
    // ClamAV. Do not transmit sensitive attachments over plaintext INSTREAM.
    const socket = connect(options);
    const finish = (status: "clean" | "infected" | "failed") => { if (done) return; done = true; clearTimeout(deadline); socket.destroy(); resolve(status); };
    // Socket timeout is inactivity-only; a trickling peer cannot extend this
    // independent deadline across DNS, handshake, upload and response.
    const deadline = setTimeout(() => finish("failed"), 12000);
    socket.setTimeout(12000); socket.on("timeout", () => finish("failed")); socket.on("error", () => finish("failed"));
    socket.on("secureConnect", () => {
      if (done) return;
      socket.write("zINSTREAM\0");
      for (let offset = 0; offset < bytes.length; offset += 65536) { const chunk = bytes.subarray(offset, offset + 65536); const length = Buffer.alloc(4); length.writeUInt32BE(chunk.length); socket.write(length); socket.write(chunk); }
      socket.write(Buffer.alloc(4));
    });
    socket.on("data", (chunk: Buffer) => { if (done) return; reply += chunk.toString("utf8"); if (reply.length > 4096) finish("failed"); else if (reply.includes("\0") || reply.includes("\n")) finish(/^stream: OK[\0\r\n]*$/.test(reply) ? "clean" : /^stream: .+ FOUND[\0\r\n]*$/.test(reply) ? "infected" : "failed"); });
    socket.on("end", () => finish("failed"));
    socket.on("close", () => finish("failed"));
  }) };
}
export { DOCUMENT_BUCKET };
