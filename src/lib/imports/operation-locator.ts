import "server-only";
import { z } from "zod";
import { isImportError, ImportError } from "./errors";
import { isIntegrationError } from "@/lib/integrations/errors";
import { importRecoveryModeSchema, type ImportRecoveryMode } from "./recovery-model";
import { originalOperationKeySchema, trustedUploadOperationEnvelopeSchema, type TrustedUploadOperationEnvelope } from "./operation-locator-model";
import { requireImportRead } from "./request-security";
import { trustedUploadOperationId, type StagingRpcClient } from "./trusted-staging";
import type { ImportActor } from "./types";

export interface UploadOperationLocatorDependencies {
  /** Must create the request-JWT user client, never a worker/admin client. */
  createUserClient(): Promise<StagingRpcClient | null>;
  reauthorize(mode: ImportRecoveryMode): Promise<ImportActor>;
  signal?: AbortSignal;
}
const actorSchema = z.object({ organizationId: z.uuid(), branchId: z.uuid(), userId: z.uuid(),
  assuranceLevel: z.enum(["aal1", "aal2"]), recentAal2At: z.string().nullable() }).strict();
const DEADLINE_MS = 20_000;
function invalidRequest(): never { throw new ImportError("IMPORT_OPERATION_INVALID_REQUEST", "請提供原始上傳操作識別碼後重新核對。", 400); }
function invalidResponse(): never { throw new ImportError("IMPORT_OPERATION_INVALID_RESPONSE", "原始上傳回執未通過核對，請保留原操作並聯絡管理員。", 502); }
function unknownResult(): never { throw new ImportError("IMPORT_OPERATION_RESULT_UNKNOWN", "目前尚未取得可靠的原始上傳結果，請保留原操作後再核對。", 503); }
function denied(): never { throw new ImportError("IMPORT_OPERATION_DENIED", "目前無法授權查證原始上傳操作，請確認帳號與分支。", 403); }

export function readUploadOperationKey(request: Request): string {
  requireImportRead(request, []);
  if (new URL(request.url).href.split("#")[0]!.includes("?")) invalidRequest();
  const raw = request.headers.get("idempotency-key");
  const parsed = originalOperationKeySchema.safeParse(raw);
  // Native Headers combines repeated values using commas. Reject ambiguity;
  // comma-bearing legacy keys cannot be queried through this header endpoint.
  if (!parsed.success || parsed.data.includes(",")) invalidRequest();
  return parsed.data;
}

/** One bounded observational read; null cannot prove rollback or permit retry. */
export async function readTrustedUploadOperation(dependencies: UploadOperationLocatorDependencies,
  originalOperationKey: string, mode: ImportRecoveryMode): Promise<TrustedUploadOperationEnvelope | null> {
  if (!originalOperationKeySchema.safeParse(originalOperationKey).success || !importRecoveryModeSchema.safeParse(mode).success) invalidRequest();
  const started = performance.now(); let stopped = false;
  let rejectStop!: (error: unknown) => void;
  const cancelled = new Promise<never>((_, reject) => { rejectStop = reject; });
  const stop = () => { stopped = true; try { unknownResult(); } catch (error) { rejectStop(error); } };
  const check = () => { if (stopped || dependencies.signal?.aborted || performance.now() - started >= DEADLINE_MS) unknownResult(); };
  const timer = setTimeout(stop, DEADLINE_MS);
  dependencies.signal?.addEventListener("abort", stop, { once: true });
  async function bounded<T>(work: () => PromiseLike<T>): Promise<T> {
    check(); const result = await Promise.race([Promise.resolve().then(() => { check(); return work(); }), cancelled]);
    check(); return result;
  }
  async function authorize(): Promise<ImportActor> {
    let raw: unknown;
    try { raw = await bounded(() => dependencies.reauthorize(mode)); }
    catch (error) {
      check();
      if (isImportError(error) || isIntegrationError(error)) {
        if (error.httpStatus === 401) throw new ImportError("IMPORT_AUTH_REQUIRED", "請先登入並選擇作業分支。", 401);
        if (error.httpStatus === 403) denied();
      }
      unknownResult();
    }
    const parsed = actorSchema.safeParse(raw);
    if (!parsed.success) invalidResponse();
    if (mode === "general" && parsed.data.assuranceLevel !== "aal2") denied();
    return Object.freeze(parsed.data);
  }
  try {
    check();
    const actor = await authorize();
    const originalOperation = trustedUploadOperationId(actor, originalOperationKey);
    let client: StagingRpcClient | null;
    try { client = await bounded(() => dependencies.createUserClient()); } catch { check(); unknownResult(); }
    if (!client) throw new ImportError("IMPORT_AUTH_NOT_CONFIGURED", "目前無法查證原操作，請保留原識別碼。", 503);
    const current = await authorize();
    const assertOwner = (live: ImportActor) => {
      if (live.organizationId !== actor.organizationId || live.branchId !== actor.branchId || live.userId !== actor.userId) denied();
    };
    assertOwner(current);
    let result: Awaited<ReturnType<StagingRpcClient["rpc"]>>;
    try { result = await bounded(() => client.rpc("import_upload_operation_receipt", {
      p_org: actor.organizationId, p_branch: actor.branchId, p_original_operation: originalOperation, p_mode: mode,
    })); } catch { check(); unknownResult(); }
    assertOwner(await authorize());
    check();
    if (!result || typeof result !== "object" || !("data" in result) || !("error" in result)) invalidResponse();
    if (result.error !== null) {
      const code = typeof result.error === "object" && result.error !== null && "code" in result.error ? result.error.code : null;
      if (code === "42501") denied();
      if (["22023", "23505", "55000"].includes(String(code))) throw new ImportError("IMPORT_OPERATION_CONFLICT", "原始上傳操作與目前狀態不一致，請保留原操作後核對。", 409);
      unknownResult();
    }
    if (result.data === null) return null;
    const parsed = trustedUploadOperationEnvelopeSchema.safeParse(result.data);
    if (!parsed.success) invalidResponse();
    const operation = parsed.data;
    if (operation.organization_id !== actor.organizationId || operation.branch_id !== actor.branchId || operation.actor_user_id !== actor.userId ||
        operation.original_operation_id !== originalOperation || operation.mode !== mode) invalidResponse();
    check(); return operation;
  } catch (error) {
    if (isImportError(error)) throw error;
    return unknownResult();
  } finally {
    stopped = true; clearTimeout(timer); dependencies.signal?.removeEventListener("abort", stop);
  }
}
