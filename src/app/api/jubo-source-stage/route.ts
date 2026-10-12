import "server-only";

import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import { handleIntegrationRoute } from "@/lib/integrations/http";
import { ImportError } from "@/lib/imports/errors";
import { authorizeImportRequest } from "@/lib/imports/http";
import { JuboPlanningError } from "@/lib/jubo-import/planner";
import { JuboPairPreparationError } from "@/lib/jubo-import/trusted-pair-preparation";
import { JuboStageError, type JuboStageReceipt } from "@/lib/jubo-import/trusted-pair-staging";
import {
  JuboStageRuntimeError,
  resolveJuboStageRuntimeConfiguration,
  stageApprovedJuboPairForCurrentStaff,
} from "@/lib/jubo-import/trusted-pair-runtime";
import { JuboXlsxReadError, MAX_JUBO_XLSX_BYTES } from "@/lib/jubo-import/xlsx-reader";

// Vercel's request limit is 4.5 MB. Bound the actual stream well below that,
// even if Content-Length is absent or false; neither file is ever written to disk.
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_FILE_BYTES = Math.min(MAX_JUBO_XLSX_BYTES, 1536 * 1024);
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ROUTE = "/api/jubo-source-stage";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const BOUNDARY = /^multipart\/form-data;\s*boundary=(?:[A-Za-z0-9'()+_,./:=?-]{1,70}|"[A-Za-z0-9'()+_,./:=?-]{1,70}")$/iu;

export const runtime = "nodejs";
export const preferredRegion = "hnd1";
export const dynamic = "force-dynamic";

function badRequest(code: string, message: string, status = 400): never {
  throw new IntegrationError(code, message, status);
}

function exactAppOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_ORIGIN;
  if (!configured) return badRequest("JUBO_STAGE_NOT_CONFIGURED", "來源暫存尚未開放。", 503);
  try {
    const url = new URL(configured);
    if (url.protocol === "https:" && !url.username && !url.password &&
        url.pathname === "/" && !url.search && !url.hash) return url.origin;
  } catch { /* Fail closed on malformed configuration. */ }
  return badRequest("JUBO_STAGE_NOT_CONFIGURED", "來源暫存尚未開放。", 503);
}

function assertSameOrigin(request: Request): void {
  const expected = exactAppOrigin();
  const url = new URL(request.url);
  const fetchSite = request.headers.get("sec-fetch-site");
  if (request.method !== "POST" || url.origin !== expected || url.pathname !== ROUTE || url.search || url.hash ||
      request.headers.get("origin") !== expected ||
      (fetchSite !== null && fetchSite !== "same-origin")) {
    badRequest("JUBO_STAGE_ORIGIN_DENIED", "請從日照系統重新開啟來源匯入。", 403);
  }
}

function declaredRequestLength(request: Request): number | null {
  const value = request.headers.get("content-length");
  if (value === null) return null;
  if (!/^[1-9][0-9]{0,8}$/u.test(value)) badRequest("JUBO_STAGE_INVALID_BODY", "上傳內容格式不正確。");
  const length = Number(value);
  if (length > MAX_REQUEST_BYTES) badRequest("JUBO_STAGE_REQUEST_TOO_LARGE", "兩份來源檔合計不得超過 2 MB。", 413);
  return length;
}

async function readBoundedMultipart(request: Request): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!BOUNDARY.test(contentType) ||
      (request.headers.get("content-encoding") ?? "identity") !== "identity") {
    badRequest("JUBO_STAGE_INVALID_BODY", "請用表單上傳兩份 XLSX 檔案。");
  }
  const declaredLength = declaredRequestLength(request);
  const reader = request.body?.getReader();
  if (!reader) badRequest("JUBO_STAGE_INVALID_BODY", "未收到完整上傳內容。");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_REQUEST_BYTES) {
        try { await reader.cancel(); } catch { /* Still reject the oversized body. */ }
        badRequest("JUBO_STAGE_REQUEST_TOO_LARGE", "兩份來源檔合計不得超過 2 MB。", 413);
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (length === 0 || (declaredLength !== null && length !== declaredLength)) {
    badRequest("JUBO_STAGE_INVALID_BODY", "未收到完整上傳內容。");
  }
  try {
    return await new Response(Buffer.concat(chunks), { headers: { "content-type": contentType } }).formData();
  } catch {
    return badRequest("JUBO_STAGE_INVALID_BODY", "上傳內容格式不正確。");
  }
}

function requiredFile(form: FormData, key: "master" | "monthlySummary"): File {
  const values = form.getAll(key);
  const file = values[0];
  if (values.length !== 1 || !(file instanceof File) ||
      file.name.length < 6 || file.name.length > 120 ||
      !/^[^\\/\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]+\.xlsx$/iu.test(file.name) ||
      file.type.trim().toLowerCase() !== XLSX_MIME || file.size < 22) {
    return badRequest("JUBO_STAGE_INVALID_FILE", "請選擇未修改的 XLSX 來源檔。");
  }
  if (file.size > MAX_FILE_BYTES) {
    return badRequest("JUBO_STAGE_FILE_TOO_LARGE", "每份來源檔不得超過 1.5 MB。", 413);
  }
  return file;
}

function footerReason(form: FormData): string {
  const values = form.getAll("footerReviewReason");
  const value = values[0];
  if (values.length !== 1 || typeof value !== "string") {
    return badRequest("JUBO_STAGE_REVIEW_REQUIRED", "請填寫來源末列的人工覆核理由。");
  }
  const reason = value.trim();
  if (reason.length < 10 || reason.length > 500 || Buffer.byteLength(reason, "utf8") > 1500 ||
      /[\u0000-\u001f\u007f]/u.test(reason)) {
    return badRequest("JUBO_STAGE_REVIEW_REQUIRED", "覆核理由需為 10 至 500 字，且不能包含控制字元。");
  }
  return reason;
}

function aggregateReceipt(receipt: JuboStageReceipt) {
  if (!receipt || !receipt.sourceStatus || !UUID.test(receipt.operationId) || receipt.masterRows !== 23 ||
      receipt.monthlyRows !== 17 || receipt.masterNonRecordRows !== 1 ||
      receipt.sourceStatus.active !== 17 || receipt.sourceStatus.suspended !== 1 ||
      receipt.sourceStatus.closed !== 5 || receipt.stagingOnly !== true ||
      receipt.formallyImported !== false || typeof receipt.replayed !== "boolean") {
    badRequest("JUBO_STAGE_RECEIPT_INVALID", "來源暫存回執尚未通過驗證，請保留原檔與操作編號。", 502);
  }
  // No file name, cell, person, raw source hash or storage locator is returned.
  return {
    operationId: receipt.operationId,
    masterRows: receipt.masterRows,
    monthlyRows: receipt.monthlyRows,
    masterNonRecordRows: receipt.masterNonRecordRows,
    sourceStatus: { active: 17 as const, suspended: 1 as const, closed: 5 as const },
    stagingOnly: true as const,
    formallyImported: false as const,
    replayed: receipt.replayed,
  };
}

function safeError(error: unknown, requestId: string): IntegrationError {
  if (error instanceof IntegrationError) return error;
  if (error instanceof ImportError) {
    return new IntegrationError(error.code, error.message, error.httpStatus, error.field);
  }
  if (error instanceof JuboStageRuntimeError) {
    return error.code === "AUTH_DENIED"
      ? new IntegrationError("JUBO_STAGE_AUTH_DENIED", "無法確認本次匯入權限，請重新登入。", 403)
      : new IntegrationError("JUBO_STAGE_DISABLED", "來源暫存尚未開放。", 503);
  }
  if (error instanceof JuboStageError) {
    if (error.code === "FOOTER_REVIEW_REQUIRED") return new IntegrationError("JUBO_STAGE_REVIEW_REQUIRED", "請填寫來源末列的人工覆核理由。", 400);
    if (error.code === "UNVERIFIED_ACTOR") return new IntegrationError("JUBO_STAGE_AUTH_DENIED", "無法確認本次匯入權限，請重新登入。", 403);
    if (error.code === "IDEMPOTENCY_CONFLICT" || error.code === "ALREADY_STAGED") return new IntegrationError("JUBO_STAGE_CONFLICT", "來源或操作鍵已使用，請查核既有回執；勿改鍵重送。", 409);
    return new IntegrationError("JUBO_STAGE_RESULT_UNKNOWN", "暫存結果尚未確認；請保留原檔與相同操作鍵後重試。", 503);
  }
  if (error instanceof JuboXlsxReadError && error.code === "FILE_TOO_LARGE") {
    return new IntegrationError("JUBO_STAGE_FILE_TOO_LARGE", "每份來源檔不得超過 1.5 MB。", 413);
  }
  if (error instanceof JuboXlsxReadError || error instanceof JuboPairPreparationError ||
      error instanceof JuboPlanningError) {
    return new IntegrationError("JUBO_STAGE_SOURCE_REJECTED", "來源檔未通過固定格式與逐列核對，請保留原檔交由資料負責人確認。", 422);
  }
  // Log only a stable code and request ID; never log the exception, file or form.
  console.error("JUBO_STAGE_UNEXPECTED", requestId);
  return new IntegrationError("JUBO_STAGE_RESULT_UNKNOWN", "暫存結果尚未確認；請保留原檔與相同操作鍵後重試。", 503);
}

/** Staging only: never creates or changes public.clients or service records. */
export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    try {
      assertSameOrigin(request);
      // Check the production/Tokyo opt-in before reading any uploaded bytes.
      const config = resolveJuboStageRuntimeConfiguration();
      const idempotencyKey = request.headers.get("idempotency-key") ?? "";
      if (!UUID.test(idempotencyKey)) badRequest("JUBO_STAGE_INVALID_KEY", "請重新開始上傳並保留同一操作鍵。");
      // Reject unadmitted/unverified staff before parsing untrusted multipart.
      // Both permissions are needed. The private transaction independently
      // rechecks them, the actor, branch and recent AAL2 before staging.
      const approver = await authorizeImportRequest(request, "approve");
      const uploader = await authorizeImportRequest(request, "upload");
      if (approver.organizationId.toLowerCase() !== config.organizationId ||
          approver.branchId.toLowerCase() !== config.branchId ||
          uploader.organizationId !== approver.organizationId ||
          uploader.branchId !== approver.branchId ||
          uploader.userId !== approver.userId) {
        badRequest("JUBO_STAGE_SCOPE_DENIED", "此帳號未獲准處理本分支來源。", 403);
      }
      const form = await readBoundedMultipart(request);
      if ([...form.keys()].some((key) => !["master", "monthlySummary", "footerReviewReason"].includes(key))) {
        badRequest("JUBO_STAGE_INVALID_BODY", "上傳欄位不正確。");
      }
      const master = requiredFile(form, "master");
      const monthlySummary = requiredFile(form, "monthlySummary");
      const footerReviewReason = footerReason(form);
      const receipt = await stageApprovedJuboPairForCurrentStaff({
        idempotencyKey,
        master: { kind: "master", fileName: master.name, mimeType: master.type,
          bytes: new Uint8Array(await master.arrayBuffer()) },
        monthlySummary: { kind: "monthlySummary", fileName: monthlySummary.name,
          mimeType: monthlySummary.type, bytes: new Uint8Array(await monthlySummary.arrayBuffer()) },
        footerReviewReason,
      });
      return ok(aggregateReceipt(receipt), receipt.replayed ? 200 : 201, requestId);
    } catch (error) {
      throw safeError(error, requestId);
    }
  });
}
