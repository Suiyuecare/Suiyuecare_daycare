import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { ImportError } from "./errors";
import { parseCentralCareHtml } from "./parser";
import { importRecoveryModeSchema, isRecoveryTimeOrdered, trustedRecoveryEnvelopeSchema, trustedRecoveryInputSchema, trustedRecoveryReceiptSchema,
  type ImportRecoveryMode, type TrustedRecoveryEnvelope, type TrustedRecoveryInput } from "./recovery-model";
import { trustedUploadOperationId, type StagingRpcClient, type TrustedStagingReceipt } from "./trusted-staging";
import { CURRENT_MAPPING_VERSION, MAX_HTML_IMPORT_BYTES, type HtmlImportFile, type ImportActor, type ParsedHtmlImport } from "./types";
import { validateHtmlImportFile } from "./validation";
import type { S3ComplianceArchive } from "./worm-archive";

export interface TrustedRecoveryDependencies {
  userClient: StagingRpcClient;
  workerClient: StagingRpcClient;
  archive: Pick<S3ComplianceArchive, "archive">;
  /** Actual current request-JWT authority, not a cached TenantContext. */
  reauthorize(mode: ImportRecoveryMode): Promise<ImportActor>;
  signal?: AbortSignal;
}
const actorSchema = z.object({ organizationId: z.uuid(), branchId: z.uuid(), userId: z.uuid(),
  assuranceLevel: z.enum(["aal1", "aal2"]), recentAal2At: z.string().nullable() }).strict();
const archiveSchema = z.object({ key: z.string().min(1).max(1024),
  versionId: z.string().min(1).max(1024).refine(value => value !== "null" && !/[\s\u0000-\u001f\u007f]/u.test(value)),
  retainUntil: z.string().refine(isStrictOffsetDateTime), sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  createdAt: z.string().refine(isStrictOffsetDateTime), byteLength: z.number().int().min(1).max(MAX_HTML_IMPORT_BYTES),
}).strict();
const DEADLINE_MS = 20_000;

function unknownResult(): never { throw new ImportError("IMPORT_RECOVERY_RESULT_UNKNOWN", "尚未取得可靠的恢復結果，請保留原預約與本次恢復識別碼再核對；這不表示正式入檔。", 503); }
function denied(): never { throw new ImportError("IMPORT_RECOVERY_DENIED", "目前無法授權原預約恢復，請確認帳號、分支與驗證狀態。", 403); }
function invalidResponse(): never { throw new ImportError("IMPORT_RECOVERY_INVALID_RESPONSE", "恢復回執未通過核對，請保留原操作並聯絡管理員。", 502); }
function invalidRequest(): never { throw new ImportError("IMPORT_RECOVERY_INVALID_REQUEST", "原預約與恢復識別資料無效，請保留原操作後重新核對。", 400); }
function rpcFailure(error: unknown): never {
  let code: unknown;
  try { code = typeof error === "object" && error !== null && "code" in error ? error.code : null; } catch { unknownResult(); }
  if (code === "42501") denied();
  if (["22023", "23505", "55000"].includes(String(code))) throw new ImportError("IMPORT_RECOVERY_CONFLICT", "原預約或恢復操作與目前狀態不一致，請保留原操作後核對。", 409);
  unknownResult();
}

type Deadline = { check(): void; await<T>(work: () => PromiseLike<T>): Promise<T> };
async function withDeadline<T>(work: (deadline: Deadline) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const started = performance.now();
  let stopped = false;
  let rejectStop!: (error: ImportError) => void;
  const stop = () => { stopped = true; try { unknownResult(); } catch (error) { rejectStop(error as ImportError); } };
  const cancelled = new Promise<never>((_, reject) => { rejectStop = reject; });
  const check = () => { if (stopped || signal?.aborted || performance.now() - started >= DEADLINE_MS) { stopped = true; unknownResult(); } };
  const timer = setTimeout(stop, DEADLINE_MS);
  signal?.addEventListener("abort", stop, { once: true });
  const deadline: Deadline = { check, async await(callback) { check(); const result = await Promise.race([Promise.resolve().then(() => { check(); return callback(); }), cancelled]); check(); return result; } };
  try { check(); return await Promise.race([work(deadline), cancelled]); }
  finally { stopped = true; clearTimeout(timer); signal?.removeEventListener("abort", stop); }
}

function captureActor(actor: ImportActor, mode: ImportRecoveryMode): ImportActor {
  let parsed: ReturnType<typeof actorSchema.safeParse>;
  try { parsed = actorSchema.safeParse(actor); } catch { invalidRequest(); }
  if (!parsed.success || !importRecoveryModeSchema.safeParse(mode).success) invalidRequest();
  if (mode === "general" && parsed.data.assuranceLevel !== "aal2") denied();
  return Object.freeze(parsed.data);
}
function readEnvelope(raw: unknown, actor: ImportActor, key: string, mode: ImportRecoveryMode): TrustedRecoveryEnvelope {
  let parsed: ReturnType<typeof trustedRecoveryEnvelopeSchema.safeParse>;
  try { parsed = trustedRecoveryEnvelopeSchema.safeParse(raw); } catch { invalidResponse(); }
  if (!parsed.success) invalidResponse();
  const result = parsed.data;
  if (result.organization_id !== actor.organizationId || result.branch_id !== actor.branchId || result.actor_user_id !== actor.userId ||
      result.recovery_operation_id !== key || result.mode !== mode || Date.parse(result.created_at) > Date.now() + 60_000 ||
      Date.parse(result.recovery_created_at) > Date.now() + 60_000 ||
      result.receipt && Date.parse(result.receipt.completed_at) > Date.now() + 60_000) invalidResponse();
  return result;
}
async function rpc(deadline: Deadline, client: StagingRpcClient, name: string, parameters: Record<string, unknown>): Promise<unknown> {
  let result: Awaited<ReturnType<StagingRpcClient["rpc"]>>;
  try { result = await deadline.await(() => client.rpc(name, parameters)); } catch { deadline.check(); unknownResult(); }
  deadline.check();
  try {
    if (!result || typeof result !== "object" || !("data" in result) || !("error" in result)) invalidResponse();
    if (result.error !== null) rpcFailure(result.error);
    return result.data;
  } catch (error) { if (error instanceof ImportError) throw error; invalidResponse(); }
}

/** A single observational lookup. Null is not proof that the upload failed. */
export async function readTrustedUploadRecovery(userClient: StagingRpcClient, actor: ImportActor, recoveryOperationKey: string,
  mode: ImportRecoveryMode): Promise<TrustedRecoveryEnvelope | null> {
  const context = captureActor(actor, mode);
  if (!trustedRecoveryInputSchema.shape.recoveryOperationKey.safeParse(recoveryOperationKey).success) invalidRequest();
  return withDeadline(async deadline => {
    const raw = await rpc(deadline, userClient, "import_upload_recovery_receipt", {
      p_org: context.organizationId, p_branch: context.branchId, p_recovery_operation: recoveryOperationKey, p_mode: mode,
    });
    const result = raw === null ? null : readEnvelope(raw, context, recoveryOperationKey, mode);
    if (result && (result.replayed || result.receipt?.replayed)) invalidResponse();
    deadline.check(); return result;
  });
}

/** Re-authorize the exact original reservation through a NEW immutable attempt;
 * never rewrite the old captured evidence, source key, time or WORM retention. */
export async function recoverTrustedHtmlImport(dependencies: TrustedRecoveryDependencies, actor: ImportActor, file: HtmlImportFile,
  input: TrustedRecoveryInput, mode: ImportRecoveryMode): Promise<TrustedStagingReceipt> {
  return withDeadline(async deadline => {
    const context = captureActor(actor, mode);
    let request: ReturnType<typeof trustedRecoveryInputSchema.safeParse>;
    try { request = trustedRecoveryInputSchema.safeParse(input); } catch { invalidRequest(); }
    if (!request.success) invalidRequest();
    const intent = Object.freeze(request.data);
    const originalOperation = trustedUploadOperationId(context, intent.originalOperationKey);
    if (originalOperation === intent.recoveryOperationKey) invalidRequest();
    let validated: ReturnType<typeof validateHtmlImportFile>, parsed: ParsedHtmlImport, serialized: string;
    try {
      if (!(file.bytes instanceof Uint8Array) || file.bytes.byteLength > (mode === "routine-intake" ? 4 * 1024 * 1024 : MAX_HTML_IMPORT_BYTES)) throw new Error();
      validated = validateHtmlImportFile({ fileName: file.fileName, mimeType: file.mimeType, bytes: Uint8Array.from(file.bytes) });
      parsed = parseCentralCareHtml(validated, CURRENT_MAPPING_VERSION); serialized = JSON.stringify(parsed);
      if (Buffer.byteLength(serialized, "utf8") > 16 * 1024 * 1024) throw new Error();
    } catch { throw new ImportError("IMPORT_RECOVERY_INVALID_FILE", "檔案格式、大小或解析內容未通過恢復檢查。", 422, "file"); }
    deadline.check();
    const payloadSha256 = createHash("sha256").update(serialized, "utf8").digest("hex");
    async function authorize() {
      let proof: ImportActor;
      try { proof = await deadline.await(() => dependencies.reauthorize(mode)); }
      catch (error) { deadline.check(); if (error instanceof ImportError && error.httpStatus === 403) denied(); unknownResult(); }
      deadline.check();
      let parsedActor: ReturnType<typeof actorSchema.safeParse>;
      try { parsedActor = actorSchema.safeParse(proof); } catch { invalidResponse(); }
      if (!parsedActor.success) invalidResponse();
      const live = parsedActor.data;
      if (live.organizationId !== context.organizationId || live.branchId !== context.branchId || live.userId !== context.userId) denied();
      if (mode === "general") {
        const age = live.recentAal2At && isStrictOffsetDateTime(live.recentAal2At) ? Date.now() - Date.parse(live.recentAal2At) : Number.NaN;
        if (live.assuranceLevel !== "aal2" || !Number.isFinite(age) || age < 0 || age > 15 * 60_000 ||
            !isRecoveryTimeOrdered(live.recentAal2At!, new Date().toISOString())) denied();
      }
    }
    await authorize();
    const raw = await rpc(deadline, dependencies.userClient, "reserve_import_upload_recovery", {
      p_org: context.organizationId, p_branch: context.branchId, p_reservation: intent.reservationId,
      p_original_operation: originalOperation, p_recovery_operation: intent.recoveryOperationKey,
      p_file_sha256: validated.sha256, p_file_name: validated.fileName, p_mime_type: validated.mimeType,
      p_file_size_bytes: validated.bytes.byteLength, p_mapping_version: parsed.mappingVersion, p_mode: mode,
    });
    await authorize();
    const reservation = readEnvelope(raw, context, intent.recoveryOperationKey, mode);
    if (reservation.reservation_id !== intent.reservationId || reservation.original_operation_id !== originalOperation ||
        reservation.file_sha256 !== validated.sha256 || reservation.file_name !== validated.fileName || reservation.mime_type !== validated.mimeType ||
        reservation.file_size_bytes !== validated.bytes.byteLength || reservation.mapping_version !== parsed.mappingVersion) invalidResponse();
    function receipt(rawReceipt: unknown): TrustedStagingReceipt {
      let result: ReturnType<typeof trustedRecoveryReceiptSchema.safeParse>;
      try { result = trustedRecoveryReceiptSchema.safeParse(rawReceipt); } catch { invalidResponse(); }
      if (!result.success) invalidResponse();
      const value = result.data;
      if (value.reservation_id !== reservation.reservation_id || value.file_sha256 !== validated.sha256 || value.mapping_version !== parsed.mappingVersion ||
          value.content_fingerprint !== parsed.contentFingerprint || value.payload_sha256 !== payloadSha256 ||
          value.section_count !== parsed.sections.length || value.field_count !== parsed.fields.length ||
          !isRecoveryTimeOrdered(reservation.created_at, value.completed_at) || Date.parse(value.completed_at) > Date.now() + 60_000) invalidResponse();
      deadline.check(); return Object.freeze(value);
    }
    if (reservation.status === "completed") return receipt(reservation.receipt);
    const expires = Date.parse(reservation.expires_at);
    const assertUnexpired = () => { deadline.check(); if (Date.now() >= expires) denied(); };
    const createdAt = new Date(reservation.created_at);
    const minRetention = new Date(createdAt); minRetention.setUTCFullYear(minRetention.getUTCFullYear() + 7);
    if (minRetention.getTime() <= Date.now()) invalidResponse();
    await authorize(); assertUnexpired();
    let archived: unknown;
    try { archived = await deadline.await(() => dependencies.archive.archive(
      { organizationId: context.organizationId, branchId: context.branchId }, reservation.reservation_id,
      Uint8Array.from(validated.bytes), validated.sha256, createdAt,
    )); } catch { deadline.check(); unknownResult(); }
    await authorize(); assertUnexpired();
    let archive: ReturnType<typeof archiveSchema.safeParse>;
    try { archive = archiveSchema.safeParse(archived); } catch { invalidResponse(); }
    if (!archive.success || archive.data.key !== `organizations/${context.organizationId}/branches/${context.branchId}/central-html/${validated.sha256}/${reservation.reservation_id}.html` ||
        archive.data.sha256 !== validated.sha256 || archive.data.byteLength !== validated.bytes.byteLength ||
        archive.data.createdAt !== createdAt.toISOString() || Date.parse(archive.data.retainUntil) < minRetention.getTime()) invalidResponse();
    await authorize(); assertUnexpired();
    const completed = await rpc(deadline, dependencies.workerClient, "complete_recovered_import_upload", {
      p_recovery: reservation.recovery_id, p_parsed_payload: serialized, p_archive_reference: archive.data,
    });
    await authorize();
    return receipt(completed);
  }, dependencies.signal);
}
