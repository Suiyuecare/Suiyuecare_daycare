"use client";

import { z } from "zod";
import { CLIENT_WRITE_TIMEOUT_MS, fetchJsonWithTimeout } from "@/lib/api/client-fetch";
import { parseImportUploadEnvelope } from "./client-contract";
import { uploadOperationLocatorResultSchema } from "./operation-locator-model";
import { trustedRecoveryReceiptSchema } from "./recovery-model";
import type { CmsUploadFile, CmsUploadOperation, CmsUploadScope } from "./upload-pending";

export type CmsUploadResult = Readonly<{ batchId: string; reservationId: string | null; fileSha256: string;
  payloadSha256: string | null; mappingVersion: string; contentFingerprint: string | null; sectionCount: number | null; fieldCount: number | null }>;
export class CmsUploadClientError extends Error {
  constructor(readonly status: number | null = null) {
    super(status === 401 || status === 403 ? "登入或權限已變更。請重新登入後確認原上傳結果；不要另建個案。" :
      "尚未確認完整結果。請保留原檔，先確認上傳結果，再繼續原操作。");
    this.name = "CmsUploadClientError";
  }
}
const envelope = <T extends z.ZodType>(data: T) => z.object({ requestId: z.uuid(), status: z.literal("ok"),
  data, errors: z.array(z.never()).length(0) }).strict();
async function bounded<T>(work: (signal: AbortSignal) => Promise<T>, owner?: AbortSignal) {
  const controller = new AbortController();
  const cancel = () => controller.abort(); owner?.addEventListener("abort", cancel, { once: true });
  let rejectAbort = () => {};
  const aborted = new Promise<never>((_, reject) => { const cancel = () => reject(new CmsUploadClientError());
    controller.signal.addEventListener("abort", cancel, { once: true }); rejectAbort = () => controller.signal.removeEventListener("abort", cancel); });
  const timer = setTimeout(cancel, CLIENT_WRITE_TIMEOUT_MS);
  try {
    if (owner?.aborted) cancel();
    if (controller.signal.aborted) throw new CmsUploadClientError();
    const value = await Promise.race([work(controller.signal), aborted]);
    if (controller.signal.aborted) throw new CmsUploadClientError(); return value;
  } finally { clearTimeout(timer); rejectAbort(); owner?.removeEventListener("abort", cancel); }
}
async function digest(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
}
export async function describeCmsUploadFile(file: File, mode: CmsUploadScope["mode"], signal?: AbortSignal): Promise<CmsUploadFile> {
  const mime = file.type.split(";", 1)[0]!.trim().toLowerCase();
  if (!file.size || file.size > (mode === "general" ? 25 : 4) * 1024 * 1024 || !/\.html?$/iu.test(file.name) ||
      file.name.length > 255 || /[\\/\u0000-\u001f\u007f]/u.test(file.name) || !["text/html", "application/xhtml+xml"].includes(mime))
    throw new Error(mode === "general" ? "請選擇非空白、25 MB 以下的 HTML 原檔。" : "請選擇非空白、4 MB 以下的 HTML 原檔。");
  return bounded(async () => {
    const bytes = await file.arrayBuffer(); if (bytes.byteLength !== file.size) throw new CmsUploadClientError();
    return Object.freeze({ name: file.name, size: file.size, mime, sha256: await digest(bytes) });
  }, signal);
}
export async function originalCmsUploadId(scope: CmsUploadScope, key: string) {
  const bytes = new TextEncoder().encode(JSON.stringify(["trusted-html-upload/v1", scope.organizationId, scope.branchId, scope.actorUserId, key]));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  hash[6] = (hash[6]! & 0x0f) | 0x50; hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = Array.from(hash.subarray(0, 16), v => v.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function sameCmsUploadFile(a: CmsUploadFile, b: CmsUploadFile) {
  return a.name === b.name && a.mime === b.mime && a.size === b.size && a.sha256 === b.sha256;
}
const baseUrl = (scope: CmsUploadScope) => scope.mode === "general" ? "/api/imports" : "/api/client-intake/imports";
export async function locateCmsUploadResult(operation: CmsUploadOperation, scope: CmsUploadScope, signal: AbortSignal) {
  const { payload } = await fetchJsonWithTimeout(`${baseUrl(scope)}/operations`, { headers: { "idempotency-key": operation.key }, signal });
  const parsed = envelope(uploadOperationLocatorResultSchema).safeParse(payload);
  if (!parsed.success) throw new CmsUploadClientError();
  const source = parsed.data.data.operation;
  if (source && (source.original_operation_id !== operation.originalId || source.organization_id !== scope.organizationId ||
      source.branch_id !== scope.branchId || source.actor_user_id !== scope.actorUserId || source.mode !== scope.mode ||
      !sameCmsUploadFile(operation.file, { name: source.file_name, size: source.file_size_bytes, mime: source.mime_type, sha256: source.file_sha256 })))
    throw new CmsUploadClientError();
  return source;
}
export async function sendCmsUpload(operation: CmsUploadOperation, scope: CmsUploadScope, file: File, recover: boolean, signal: AbortSignal): Promise<CmsUploadResult> {
  return bounded(async requestSignal => {
    const selected = await describeCmsUploadFile(file, scope.mode, requestSignal);
    if (!sameCmsUploadFile(selected, operation.file)) throw new Error("檔案與原上傳不同。請重新選取同一份原檔；不會另建操作。");
    const form = new FormData(); form.set("file", file);
    const key = recover ? operation.recoveryKey : operation.key;
    if (!key || recover && !operation.reservationId) throw new CmsUploadClientError();
    if (scope.mode === "general" || recover) form.set("idempotency_key", key);
    if (recover) { form.set("reservation_id", operation.reservationId!); form.set("original_operation_key", operation.key); }
    const response = await fetch(recover ? `${baseUrl(scope)}/recovery` : scope.mode === "general" ? `${baseUrl(scope)}/html` : baseUrl(scope),
      { method: "POST", headers: { "idempotency-key": key }, body: form, credentials: "same-origin", redirect: "error", signal: requestSignal });
    if (!response.ok || response.redirected) throw new CmsUploadClientError(response.status);
    const payload: unknown = await response.json();
    if (scope.mode === "routine-intake") {
      if (!recover) {
        const duplicate = envelope(z.object({ reservation_id: z.uuid(), status: z.literal("completed"), recovered: z.literal(true),
          file_sha256: z.string().regex(/^[a-f0-9]{64}$/u), payload_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
          mapping_version: z.literal("central-care-plan-html@1") }).strict()).safeParse(payload);
        if (duplicate.success) {
          if (response.status !== 200 || duplicate.data.data.file_sha256 !== operation.file.sha256) throw new CmsUploadClientError();
          return { batchId: duplicate.data.data.reservation_id, reservationId: duplicate.data.data.reservation_id,
            fileSha256: operation.file.sha256, payloadSha256: duplicate.data.data.payload_sha256,
            mappingVersion: duplicate.data.data.mapping_version, contentFingerprint: null, sectionCount: null, fieldCount: null };
        }
      }
      const receipt = envelope(trustedRecoveryReceiptSchema).parse(payload).data;
      if (response.status !== 200 || receipt.file_sha256 !== operation.file.sha256 ||
          operation.reservationId !== null && receipt.reservation_id !== operation.reservationId) throw new CmsUploadClientError();
      return { batchId: receipt.reservation_id, reservationId: receipt.reservation_id, fileSha256: receipt.file_sha256,
        payloadSha256: receipt.payload_sha256, mappingVersion: receipt.mapping_version, contentFingerprint: receipt.content_fingerprint,
        sectionCount: receipt.section_count, fieldCount: receipt.field_count };
    }
    let normal: unknown = payload;
    if (recover) {
      const recovered = envelope(z.object({ status: z.string(), duplicate: z.literal(false), replayed: z.boolean(), batch: z.unknown(),
        staging_only: z.literal(true), formally_imported: z.literal(false) }).strict()).parse(payload);
      normal = { ...recovered, data: { status: recovered.data.status, duplicate: false, replayed: recovered.data.replayed, batch: recovered.data.batch } };
    }
    const receipt = parseImportUploadEnvelope(normal, { fileName: file.name, byteLength: file.size,
      fileSha256: operation.file.sha256, httpStatus: response.status }).data;
    if (operation.batchId !== null && receipt.batch.id !== operation.batchId) throw new CmsUploadClientError();
    return { batchId: receipt.batch.id, reservationId: operation.reservationId, fileSha256: receipt.batch.fileSha256,
      payloadSha256: null, mappingVersion: receipt.batch.mappingVersion, contentFingerprint: receipt.batch.contentFingerprint,
      sectionCount: receipt.batch.sectionCount, fieldCount: receipt.batch.fieldCount };
  }, signal);
}
