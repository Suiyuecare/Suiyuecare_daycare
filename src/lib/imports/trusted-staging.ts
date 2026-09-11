import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { ImportError } from "./errors";
import { parseCentralCareHtml } from "./parser";
import { CURRENT_MAPPING_VERSION, MAX_HTML_IMPORT_BYTES } from "./types";
import type { HtmlImportFile, ImportActor, ParsedHtmlImport } from "./types";
import { validateHtmlImportFile } from "./validation";
import type { S3ComplianceArchive } from "./worm-archive";

/** This is a staging-only worker, not a ProductionImportStorage implementation.
 * No runtime registration or credentials are created here. The caller must supply
 * a request-scoped user JWT client and a separate server-only worker client.
 * Never accept parsed payloads or archive attestations from an HTTP request.
 */
export interface StagingRpcClient {
  rpc(name: string, parameters: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: unknown | null;
  }>;
}

export interface TrustedStagingDependencies {
  userClient: StagingRpcClient;
  workerClient: StagingRpcClient;
  archive: Pick<S3ComplianceArchive, "archive">;
}

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const timestamp = z.string().datetime({ offset: true });
const mapping = z.literal(CURRENT_MAPPING_VERSION);
const MAX_STAGING_PAYLOAD_BYTES = 16 * 1024 * 1024;

const receiptSchema = z.object({
  reservation_id: uuid,
  status: z.literal("completed"),
  staging_only: z.literal(true),
  formally_imported: z.literal(false),
  file_sha256: sha256,
  content_fingerprint: sha256,
  mapping_version: mapping,
  payload_sha256: sha256,
  section_count: z.number().int().nonnegative(),
  field_count: z.number().int().nonnegative(),
  completed_at: timestamp,
  replayed: z.boolean(),
}).strict();

const reservationSchema = z.object({
  reservation_id: uuid,
  organization_id: uuid,
  branch_id: uuid,
  actor_user_id: uuid,
  file_sha256: sha256,
  file_name: z.string().min(1).max(255),
  mime_type: z.enum(["text/html", "application/xhtml+xml"]),
  file_size_bytes: z.number().int().min(1).max(MAX_HTML_IMPORT_BYTES),
  mapping_version: mapping,
  created_at: timestamp,
  status: z.enum(["queued", "completed"]),
  replayed: z.boolean(),
  receipt: receiptSchema.nullable(),
}).strict();

const archiveSchema = z.object({
  key: z.string().min(1),
  versionId: z.string().min(1).max(1024).refine((value) => value !== "null" && !/[\s\u0000-\u001f\u007f]/u.test(value)),
  retainUntil: timestamp,
  sha256,
  createdAt: timestamp,
  byteLength: z.number().int().min(1).max(MAX_HTML_IMPORT_BYTES),
}).strict();

export type TrustedStagingReceipt = z.infer<typeof receiptSchema>;
type Reservation = z.infer<typeof reservationSchema>;

function invalidResponse(): never {
  throw new ImportError("IMPORT_STAGING_INVALID_RESPONSE", "上傳回執未通過核對，請保留本次操作並聯絡管理員。", 502);
}

/** Namespaced UUID for SQL UUID columns; never cast arbitrary browser keys. */
export function trustedUploadOperationId(actor: ImportActor, key: string) {
  if (!uuid.safeParse(actor.organizationId).success || !uuid.safeParse(actor.branchId).success ||
      !uuid.safeParse(actor.userId).success || typeof key !== "string" || !key.trim() || key.length > 200) {
    throw new ImportError("IMPORT_STAGING_INVALID_REQUEST", "上傳的作業範圍或重試識別資料無效。", 400);
  }
  const bytes = createHash("sha256").update(JSON.stringify([
    "trusted-html-upload/v1", actor.organizationId, actor.branchId, actor.userId, key,
  ])).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assertRecentActor(actor: ImportActor) {
  const age = actor.recentAal2At ? Date.now() - Date.parse(actor.recentAal2At) : Number.NaN;
  if (actor.assuranceLevel !== "aal2" || !Number.isFinite(age) || age < -60_000 || age > 15 * 60_000) {
    throw new ImportError("RECENT_AAL2_REQUIRED", "這項匯入操作需要最近 15 分鐘內的重新驗證。", 403);
  }
  // This is only an early check. The database rechecks real current session,
  // permissions and immutable challenge evidence at both reservation and commit.
}

function rpcFailure(error: unknown): never {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "42501") {
    throw new ImportError("IMPORT_STAGING_DENIED", "目前無法授權這筆上傳，請確認帳號、分支權限及重新驗證狀態。", 403);
  }
  if (code === "23505") {
    throw new ImportError("IMPORT_STAGING_DUPLICATE", "此檔案或操作已有上傳預約，請沿用原操作；無法續傳時請由管理員核對。", 409);
  }
  if (code === "22023") {
    throw new ImportError("IMPORT_STAGING_INVALID_REQUEST", "上傳內容與預約不一致，請保留原操作並由管理員核對。", 409);
  }
  // Timeout can happen after COMMIT. Never report that persistence did not occur.
  throw new ImportError("IMPORT_STAGING_RESULT_UNKNOWN", "尚未取得可靠的上傳結果，請保留同一筆操作以便重試或核對；這不表示正式入檔。", 503);
}

async function rpc(client: StagingRpcClient, name: string, parameters: Record<string, unknown>) {
  let result: { data: unknown; error: unknown | null };
  try {
    result = await client.rpc(name, parameters);
  } catch {
    // Dependency errors, including an upstream ImportError, are untrusted.
    rpcFailure(null);
  }
  if (!result || typeof result !== "object" || !("data" in result) || !("error" in result)) invalidResponse();
  if (result.error !== null) rpcFailure(result.error);
  return result.data;
}

function verifyReceipt(raw: unknown, reservation: Reservation, parsed: ParsedHtmlImport, payloadSha256: string) {
  const result = receiptSchema.safeParse(raw);
  if (!result.success) invalidResponse();
  const receipt = result.data;
  const completedAt = Date.parse(receipt.completed_at);
  if (receipt.reservation_id !== reservation.reservation_id ||
      receipt.file_sha256 !== reservation.file_sha256 ||
      receipt.mapping_version !== parsed.mappingVersion ||
      receipt.content_fingerprint !== parsed.contentFingerprint ||
      receipt.payload_sha256 !== payloadSha256 ||
      receipt.section_count !== parsed.sections.length || receipt.field_count !== parsed.fields.length ||
      completedAt < Date.parse(reservation.created_at) || completedAt > Date.now() + 60_000) invalidResponse();
  return Object.freeze(receipt);
}

export async function stageTrustedHtmlImport(
  dependencies: TrustedStagingDependencies,
  actor: ImportActor,
  file: HtmlImportFile,
  idempotencyKey: string,
): Promise<TrustedStagingReceipt> {
  // Capture every caller-controlled value before the first await.
  const context = { ...actor };
  const operationId = trustedUploadOperationId(context, idempotencyKey);
  assertRecentActor(context);
  let validated: ReturnType<typeof validateHtmlImportFile>;
  let parsed: ParsedHtmlImport;
  let serializedPayload: string;
  try {
    if (!(file.bytes instanceof Uint8Array) || file.bytes.byteLength > MAX_HTML_IMPORT_BYTES) throw new Error();
    validated = validateHtmlImportFile({ fileName: file.fileName, mimeType: file.mimeType, bytes: Uint8Array.from(file.bytes) });
    parsed = parseCentralCareHtml(validated, CURRENT_MAPPING_VERSION);
    serializedPayload = JSON.stringify(parsed);
    if (Buffer.byteLength(serializedPayload, "utf8") > MAX_STAGING_PAYLOAD_BYTES) throw new Error();
  } catch {
    // No parser/encoding/source values in public errors; no reservation for invalid input.
    throw new ImportError("IMPORT_STAGING_INVALID_FILE", "檔案格式、大小或解析內容未通過上傳檢查。", 422, "file");
  }
  const payloadSha256 = createHash("sha256").update(serializedPayload, "utf8").digest("hex");
  const rawReservation = await rpc(dependencies.userClient, "reserve_import_upload", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_idempotency_key: operationId,
    p_file_sha256: validated.sha256,
    p_file_name: validated.fileName,
    p_mime_type: validated.mimeType,
    p_file_size_bytes: validated.bytes.byteLength,
    p_mapping_version: parsed.mappingVersion,
  });
  const result = reservationSchema.safeParse(rawReservation);
  if (!result.success) invalidResponse();
  const reservation = result.data;
  if (reservation.organization_id !== context.organizationId || reservation.branch_id !== context.branchId ||
      reservation.actor_user_id !== context.userId || reservation.file_sha256 !== validated.sha256 ||
      reservation.file_name !== validated.fileName || reservation.mime_type !== validated.mimeType ||
      reservation.file_size_bytes !== validated.bytes.byteLength || reservation.mapping_version !== parsed.mappingVersion ||
      Date.parse(reservation.created_at) > Date.now() + 60_000) invalidResponse();
  if (reservation.status === "completed") {
    const receipt = verifyReceipt(reservation.receipt, reservation, parsed, payloadSha256);
    if (!reservation.replayed || !receipt.replayed) invalidResponse();
    return receipt;
  }
  if (reservation.receipt !== null) invalidResponse();
  const createdAt = new Date(reservation.created_at);
  const minRetention = new Date(createdAt);
  minRetention.setUTCFullYear(minRetention.getUTCFullYear() + 7);
  if (minRetention.getTime() <= Date.now()) invalidResponse();
  let archived: unknown;
  try {
    archived = await dependencies.archive.archive(
      { organizationId: context.organizationId, branchId: context.branchId },
      reservation.reservation_id, validated.bytes, validated.sha256, createdAt,
    );
  } catch {
    throw new ImportError("IMPORT_STAGING_ARCHIVE_UNCONFIRMED", "原始檔封存尚未確認，請保留同一筆操作以便核對；尚未完成暫存。", 503);
  }
  const archive = archiveSchema.safeParse(archived);
  if (!archive.success) invalidResponse();
  const expectedKey = `organizations/${context.organizationId}/branches/${context.branchId}/central-html/${validated.sha256}/${reservation.reservation_id}.html`;
  if (archive.data.key !== expectedKey || archive.data.sha256 !== validated.sha256 ||
      archive.data.byteLength !== validated.bytes.byteLength || archive.data.createdAt !== createdAt.toISOString() ||
      Date.parse(archive.data.retainUntil) < minRetention.getTime()) invalidResponse();

  // S3 is outside this transaction. A DB failure can leave a WORM object: never
  // delete it, shorten retention, or invent a successful receipt to compensate.
  const completed = await rpc(dependencies.workerClient, "complete_import_upload", {
    p_reservation_id: reservation.reservation_id,
    // Send exact UTF-8 JSON text. SQL validates and stores JSONB, but hashes this
    // original text so the receipt covers raw values, warnings and source paths,
    // not only the normalized content fingerprint or JSONB's different spacing.
    p_parsed_payload: serializedPayload,
    p_archive_reference: archive.data,
  });
  return verifyReceipt(completed, reservation, parsed, payloadSha256);
}
