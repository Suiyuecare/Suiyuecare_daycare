import "server-only";

import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { env, hasSupabaseAdminConfiguration } from "@/lib/env";
import type { ImportBatchStatus } from "@/lib/domain/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ImportError } from "./errors";
import type { ImportPermission } from "./http";
import { parseCentralCareHtml } from "./parser";
import { importBatchRecordSchema, importOperationKeySchema, importUploadOperationSchema, originalImportReferenceSchema } from "./production-model";
import { revalidateGeneralImportActor } from "./reauth";
import { stageTrustedHtmlImport, type StagingRpcClient } from "./trusted-staging";
import { CURRENT_MAPPING_VERSION, type ImportActor, type ImportApproval, type ImportBatchRecord, type ImportScope,
  type ImportUploadOperation, type ImportUploadRequestIdentity, type ParsedHtmlImport, type ProductionImportStorage } from "./types";
import { validateHtmlImportFile } from "./validation";
import { S3ComplianceArchive } from "./worm-archive";

const PIPELINE_TIMEOUT_MS = 20_000;

export interface ProductionImportRepositoryDependencies {
  userClient: StagingRpcClient;
  workerClient: StagingRpcClient;
  archive: Pick<S3ComplianceArchive, "archive" | "read">;
  actor: ImportActor;
  permission: ImportPermission;
  /** Must validate the live session, not a caller-provided timestamp or header. */
  reauthorize(permission: ImportPermission): Promise<ImportActor>;
}

function invalid(): never {
  throw new ImportError("IMPORT_REPOSITORY_INVALID_RESPONSE", "匯入回執無法可靠核對，請保留原操作識別碼並由管理員確認。", 502);
}
function unknown(): never {
  throw new ImportError("IMPORT_REPOSITORY_RESULT_UNKNOWN", "尚未取得可靠結果，請保留原操作識別碼以便核對；這不表示已回滾或正式入檔。", 503);
}
function denied(): never {
  throw new ImportError("IMPORT_PERMISSION_DENIED", "目前帳號、分支權限或重新驗證狀態已無法授權此操作。", 403);
}
function sameScope(a: ImportScope, b: ImportScope) {
  return a.organizationId === b.organizationId && a.branchId === b.branchId;
}
function sameActor(a: ImportActor, b: ImportActor) {
  return sameScope(a, b) && a.userId === b.userId && a.assuranceLevel === "aal2" && b.assuranceLevel === "aal2";
}
function parsedPart(record: ImportBatchRecord): ParsedHtmlImport {
  return { mappingVersion: record.mappingVersion, contentFingerprint: record.contentFingerprint,
    sections: record.sections, fields: record.fields, warnings: record.warnings, conflicts: record.conflicts, security: record.security };
}
function sourcePart(record: ImportBatchRecord) {
  const source = { ...record } as Partial<ImportBatchRecord>;
  delete source.version; delete source.updatedAt; delete source.operationKeys; delete source.approval;
  return source;
}
function assertKey(key: string) {
  if (!importOperationKeySchema.safeParse(key).success) {
    throw new ImportError("IDEMPOTENCY_KEY_REQUIRED", "請提供有效的原操作識別碼。", 400, "idempotency_key");
  }
}
function rpcError(error: unknown): never {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "42501") denied();
  if (["23505", "40001", "55000", "22023"].includes(String(code))) {
    throw new ImportError("IMPORT_OPERATION_CONFLICT", "來源、版本或操作識別碼已不一致，請保留原操作並重新核對。", 409);
  }
  unknown();
}

/** One authenticated request owns this repository and its clients. Never register
 * this instance globally. Completion/replay receipts remain staging-only. */
export class GeneralProductionImportRepository implements ProductionImportStorage {
  readonly kind = "production" as const;
  private readonly actor: ImportActor;
  private readonly startedAt = performance.now();
  private stopped = false;

  constructor(private readonly dependencies: ProductionImportRepositoryDependencies) {
    this.actor = Object.freeze({ ...dependencies.actor });
    if (!sameActor(this.actor, this.actor)) denied();
  }

  async verifyCurrent() { await this.check(); }

  private assertWithinDeadline() {
    if (this.stopped || performance.now() - this.startedAt >= PIPELINE_TIMEOUT_MS) { this.stopped = true; unknown(); }
  }

  private async bounded<T>(work: () => PromiseLike<T>): Promise<T> {
    const remaining = PIPELINE_TIMEOUT_MS - (performance.now() - this.startedAt);
    if (this.stopped || remaining <= 0) { this.stopped = true; unknown(); }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          this.stopped = true;
          reject(new ImportError("IMPORT_REPOSITORY_RESULT_UNKNOWN", "尚未取得可靠結果，請保留原操作識別碼以便核對；這不表示已回滾或正式入檔。", 503));
        }, remaining);
      });
      const value = await Promise.race([Promise.resolve().then(work), deadline]);
      if (this.stopped || performance.now() - this.startedAt >= PIPELINE_TIMEOUT_MS) { this.stopped = true; unknown(); }
      return value;
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }

  private assertScope(scope: ImportScope) { if (!sameScope(scope, this.actor)) denied(); }
  private assertActor(actor: ImportActor) { if (!sameActor(actor, this.actor)) denied(); }
  private async check(permission = this.dependencies.permission) {
    const current = await this.bounded(() => this.dependencies.reauthorize(permission));
    if (!current || !sameActor(current, this.actor)) denied();
    if (permission !== "preview") {
      const age = current.recentAal2At ? Date.now() - Date.parse(current.recentAal2At) : Number.NaN;
      if (!Number.isFinite(age) || age < 0 || age > 15 * 60_000) denied();
    }
  }
  private async call(name: string, args: Record<string, unknown>, permission = this.dependencies.permission) {
    await this.check(permission);
    let result: Awaited<ReturnType<StagingRpcClient["rpc"]>>;
    try {
      result = await this.bounded(() => this.dependencies.userClient.rpc(name, {
        p_org: this.actor.organizationId, p_branch: this.actor.branchId, ...args,
      }));
    } catch { unknown(); }
    if (!result || typeof result !== "object" || !("data" in result) || !("error" in result)) invalid();
    if (result.error !== null) rpcError(result.error);
    // A successful RPC is not permission to disclose data after remote waits.
    await this.check(permission);
    return result.data;
  }
  private record(raw: unknown, id?: string): ImportBatchRecord {
    const parsed = importBatchRecordSchema.safeParse(raw);
    if (!parsed.success) invalid();
    const record: ImportBatchRecord = parsed.data;
    if (!sameScope(record, this.actor) || (id !== undefined && record.id !== id)) invalid();
    this.assertWithinDeadline();
    return record;
  }
  private upload(raw: unknown, key: string, request?: ImportUploadRequestIdentity): ImportUploadOperation {
    const parsed = importUploadOperationSchema.safeParse(raw);
    if (!parsed.success) invalid();
    const operation: ImportUploadOperation = parsed.data;
    if (!sameScope(operation.batch, this.actor) || (request && !isDeepStrictEqual(operation.request, request)) ||
      (!operation.duplicate && (operation.batch.createdBy !== this.actor.userId || operation.batch.operationKeys.upload !== key))) invalid();
    this.assertWithinDeadline();
    // Duplicate receipts retain the original batch creator/key. The narrow RPC
    // binds their separate immutable operation ledger to actual auth.uid()+key.
    return operation;
  }
  private reparseReceipt(raw: unknown, id: string, parsed: ParsedHtmlImport, status: ImportBatchStatus, key: string) {
    const record = this.record(raw, id);
    if (record.version < 2 || record.approval || record.status !== status || record.operationKeys[`reparse:${parsed.mappingVersion}`] !== key ||
      !isDeepStrictEqual(parsedPart(record), parsed)) invalid();
    this.assertWithinDeadline();
    return record;
  }

  async findById(scope: ImportScope, id: string) {
    this.assertScope(scope);
    const data = await this.call("general_import_repository_read", { p_batch: id });
    return data === null ? null : this.record(data, id);
  }
  async findByFileHash(scope: ImportScope, sha256: string) {
    this.assertScope(scope);
    const data = await this.call("general_import_repository_find_hash", { p_sha: sha256 });
    if (data === null) return null;
    const record = this.record(data);
    if (record.fileSha256 !== sha256) invalid();
    return record;
  }
  async findByOperationKey(actor: ImportActor, key: string) {
    this.assertActor(actor); assertKey(key);
    const data = await this.call("general_import_repository_find_upload", { p_key: key }, "upload");
    if (data === null) return null;
    const operation = this.upload(data, key);
    if (!operation.replayed) invalid();
    return operation;
  }
  async registerDuplicateUpload(actor: ImportActor, id: string, request: ImportUploadRequestIdentity, key: string) {
    this.assertActor(actor); assertKey(key);
    const captured = structuredClone(request);
    const data = await this.call("general_import_repository_duplicate", { p_batch: id, p_file_sha256: captured.fileSha256,
      p_file_name: captured.fileName, p_mime_type: captured.mimeType, p_key: key }, "upload");
    const operation = this.upload(data, key, captured);
    if (!operation.duplicate || operation.batch.id !== id) invalid();
    return operation;
  }
  async readOriginal(scope: ImportScope, id: string) {
    this.assertScope(scope);
    await this.check("reparse");
    const before = await this.findById(scope, id);
    if (!before) throw new ImportError("IMPORT_ORIGINAL_UNAVAILABLE", "找不到可重新解析的原始 HTML。", 409);
    let reference: unknown;
    try { reference = JSON.parse(before.originalObjectReference!); } catch { invalid(); }
    const decoded = originalImportReferenceSchema.safeParse(reference);
    if (!decoded.success) invalid();
    let bytes: Uint8Array;
    try {
      bytes = await this.bounded(() => this.dependencies.archive.read({ organizationId: this.actor.organizationId,
        branchId: this.actor.branchId }, decoded.data.reservationId, decoded.data.archive));
    } catch { unknown(); }
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== before.byteLength ||
      createHash("sha256").update(bytes).digest("hex") !== before.fileSha256) invalid();
    const ownedBytes = Uint8Array.from(bytes);
    await this.check("reparse");
    const after = await this.findById(scope, id);
    if (!after || after.version !== before.version || !isDeepStrictEqual(sourcePart(after), sourcePart(before)) ||
      !isDeepStrictEqual(after.approval, before.approval)) {
      throw new ImportError("IMPORT_VERSION_CONFLICT", "原始檔讀取期間來源已變更，請重新載入後再操作。", 409);
    }
    this.assertWithinDeadline();
    return ownedBytes;
  }
  async create(record: ImportBatchRecord, key: string) {
    assertKey(key); this.assertScope(record);
    const captured = structuredClone(record);
    if (captured.createdBy !== this.actor.userId || captured.version !== 1 || captured.approval !== null ||
      !captured.originalBytes || Object.keys(captured.operationKeys).length !== 0 || captured.originalObjectReference !== undefined) invalid();
    const file = validateHtmlImportFile({ fileName: captured.fileName, mimeType: captured.mimeType, bytes: captured.originalBytes });
    const parsed = parseCentralCareHtml(file, CURRENT_MAPPING_VERSION);
    if (file.sha256 !== captured.fileSha256 || file.bytes.byteLength !== captured.byteLength ||
      !isDeepStrictEqual(parsedPart(captured), parsed)) invalid();
    await this.check("upload");
    let stagingDenied = false;
    const stageCheck = async () => {
      try { await this.check("upload"); }
      catch (error) {
        if (!this.stopped && error instanceof ImportError && error.httpStatus === 403) stagingDenied = true;
        throw error;
      }
    };
    const stageRpc = (client: StagingRpcClient): StagingRpcClient => ({ rpc: async (name, args) => {
        try {
          await stageCheck();
          const result = await this.bounded(() => client.rpc(name, args));
          await stageCheck();
          return result;
        }
        catch (error) {
          // The staging helper sanitizes thrown dependency errors as unknown.
          // Preserve an actual denied fence without forwarding provider text.
          if (stagingDenied && !this.stopped) return { data: null, error: { code: "42501" } };
          throw error;
        }
      } });
    let receipt: Awaited<ReturnType<typeof stageTrustedHtmlImport>>;
    try {
      receipt = await this.bounded(() => stageTrustedHtmlImport({
        userClient: stageRpc(this.dependencies.userClient), workerClient: stageRpc(this.dependencies.workerClient),
        archive: { archive: async (...args) => {
          await stageCheck();
          const result = await this.bounded(() => this.dependencies.archive.archive(...args));
          await stageCheck();
          return result;
        } },
      }, this.actor, file, key));
    } catch (error) {
      // Archive failures are intentionally sanitized by the existing helper.
      // An owned live denial remains denial; a deadline can never be revived.
      if (stagingDenied && !this.stopped) denied();
      throw error;
    }
    if (receipt.status !== "completed" || receipt.staging_only !== true || receipt.formally_imported !== false ||
      receipt.file_sha256 !== captured.fileSha256 || receipt.content_fingerprint !== captured.contentFingerprint) invalid();
    const data = await this.call("general_import_repository_attach", { p_batch: captured.id,
      p_reservation: receipt.reservation_id, p_key: key }, "upload");
    const operation = this.upload(data, key, { fileSha256: file.sha256, fileName: file.fileName, mimeType: file.mimeType });
    if (!operation.duplicate && (operation.batch.id !== captured.id || operation.batch.version !== 1 ||
      !isDeepStrictEqual(parsedPart(operation.batch), parsed) || operation.batch.byteLength !== file.bytes.byteLength)) invalid();
    this.assertWithinDeadline();
    return operation;
  }
  async findReparseOperation(actor: ImportActor, id: string, parsed: ParsedHtmlImport, nextStatus: ImportBatchStatus, key: string) {
    this.assertActor(actor); assertKey(key);
    const captured = structuredClone(parsed);
    const data = await this.call("general_import_repository_find_reparse", { p_batch: id, p_parsed: captured, p_status: nextStatus, p_key: key }, "reparse");
    return data === null ? null : this.reparseReceipt(data, id, captured, nextStatus, key);
  }
  async replaceParsedResult(actor: ImportActor, id: string, expectedVersion: number, parsed: ParsedHtmlImport, nextStatus: ImportBatchStatus, key: string) {
    this.assertActor(actor); assertKey(key);
    const captured = structuredClone(parsed);
    const data = await this.call("general_import_repository_reparse", { p_batch: id, p_expected_version: expectedVersion,
      p_parsed: captured, p_status: nextStatus, p_key: key }, "reparse");
    // SQL owns version conflict/replay arbitration. A direct replay may be an
    // older snapshot; never substitute the current head for its original result.
    return this.reparseReceipt(data, id, captured, nextStatus, key);
  }
  async approveAtomically(actor: ImportActor, id: string, expectedVersion: number, approval: ImportApproval) {
    this.assertActor(actor); assertKey(approval.idempotencyKey);
    const captured = structuredClone(approval);
    if (captured.approvedBy !== this.actor.userId) denied();
    const data = await this.call("general_import_repository_approve", { p_batch: id, p_expected_version: expectedVersion,
      p_resolutions: captured.conflictResolutions, p_key: captured.idempotencyKey }, "approve");
    const record = this.record(data, id);
    if (!record.approval || record.approval.approvedBy !== this.actor.userId ||
      record.approval.idempotencyKey !== captured.idempotencyKey ||
      !isDeepStrictEqual(record.approval.conflictResolutions, captured.conflictResolutions)) invalid();
    this.assertWithinDeadline();
    return record;
  }
}

/** Unconfigured production fails closed; neither an in-memory fallback nor a
 * service-role-only repository is ever created. */
export async function createProductionImportRepository(actor: ImportActor, permission: ImportPermission = "preview") {
  if (!hasSupabaseAdminConfiguration() || env.AWS_REGION !== "ap-northeast-1" || !env.HTML_ARCHIVE_BUCKET || !env.AWS_KMS_KEY_ID) {
    throw new ImportError("IMPORT_STORAGE_NOT_CONFIGURED", "正式匯入儲存尚未設定，系統已停止操作以避免資料遺失。", 503);
  }
  const userClient = await createServerSupabaseClient();
  const workerClient = createSupabaseAdminClient();
  if (!userClient || !workerClient) throw new ImportError("IMPORT_STORAGE_NOT_CONFIGURED", "正式匯入儲存尚未設定，操作已停止。", 503);
  const archive = new S3ComplianceArchive({ region: "ap-northeast-1", bucket: env.HTML_ARCHIVE_BUCKET, kmsKeyId: env.AWS_KMS_KEY_ID });
  const expected = Object.freeze({ ...actor });
  const reauthorize = (required: ImportPermission) => revalidateGeneralImportActor(expected,
    required === "preview" ? "read" : required === "approve" ? "approve" : "write", userClient);
  const repository = new GeneralProductionImportRepository({ userClient, workerClient, archive, actor: expected, permission, reauthorize });
  await repository.verifyCurrent();
  return repository;
}
