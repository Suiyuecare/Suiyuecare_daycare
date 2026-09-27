import { createHash } from "node:crypto";
import { z } from "zod";
import { ok } from "@/lib/api/response";
import { getTenantContext } from "@/lib/auth/context";
import { requireSameOriginWrite } from "@/lib/auth/same-origin-write";
import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";
import { databaseFailure, handleIntegrationRoute } from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { configuredStaffCertificateDocumentScanner, processStaffCertificateDocumentUpload } from "@/lib/staff-certificate-documents/pipeline";
import { documentDeadline, readBoundedDocumentBody, readBoundedDocumentJson } from "@/lib/staff-certificate-documents/request";
import { STAFF_CERTIFICATE_DOCUMENT_BUCKET, MAX_STAFF_CERTIFICATE_DOCUMENT_BYTES, uploadFormInputSchema,
  documentsSnapshotSchema, downloadInputSchema, downloadReceiptSchema, reviewInputSchema, reviewReceiptSchema } from "@/lib/staff-certificate-documents/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = z.uuid().transform(value => value.toLowerCase());
const querySchema = z.object({ certificateKey: uuid, recordVersionId: uuid }).strict();
const evidenceSchema = z.object({ organizationId: uuid, branchId: uuid, actorUserId: uuid,
  verifiedAt: z.iso.datetime({ offset: true }) }).strict();

function failure(code?: string) {
  return databaseFailure(code === "42501" ? "STAFF_DOCUMENT_FORBIDDEN" : "STAFF_DOCUMENT_RESULT_UNCERTAIN",
    code === "42501" ? "目前沒有這位員工附件的操作授權，或身分確認已過期。"
      : "附件或證照版本尚未確認，請保留原檔與相同操作識別碼。", code === "42501" ? 403 : 409);
}
async function actorContext(manage: boolean) {
  const actor = await getTenantContext("staff");
  if (!actor) throw new IntegrationError("AUTH_REQUIRED", "請先以已核准帳號登入。", 401);
  if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "展示模式不會讀取或修改員工證明附件。", 403);
  if (!actor.branchId || actor.assuranceLevel !== "aal2" || !actor.scopes.includes("staff_certificates.read") ||
    (manage && !actor.scopes.includes("staff_certificates.manage"))) throw failure("42501");
  const server = await createServerSupabaseClient();
  if (!server) throw databaseFailure("STAFF_DOCUMENT_UNAVAILABLE", "員工附件資料服務尚未完成設定。", 503);
  return { actor, server };
}
async function recentEvidence(actor: TenantContext, server: NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>) {
  const { data, error } = await documentDeadline(Promise.resolve(server.rpc("staff_certificate_document_recent_aal2_evidence", {
    p_org: actor.organizationId, p_branch: actor.branchId,
  })));
  const evidence = evidenceSchema.safeParse(data);
  const now = Date.now();
  if (error || !evidence.success || evidence.data.organizationId !== actor.organizationId || evidence.data.branchId !== actor.branchId ||
    evidence.data.actorUserId !== actor.userId || Date.parse(evidence.data.verifiedAt) < now - 900000 || Date.parse(evidence.data.verifiedAt) > now + 1000) {
    throw failure("42501");
  }
}
function matchesActor(value: { organizationId: string; branchId: string }, actor: TenantContext) {
  return value.organizationId === actor.organizationId && value.branchId === actor.branchId;
}
function checkedSignedUrl(raw: string, path: string) {
  try {
    const url = new URL(raw), source = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    if (source.protocol !== "https:" || url.origin !== source.origin || url.username || url.password || url.hash ||
      decodeURIComponent(url.pathname) !== `/storage/v1/object/sign/${STAFF_CERTIFICATE_DOCUMENT_BUCKET}/${path}` ||
      url.searchParams.getAll("token").length !== 1 || !url.searchParams.get("token")) throw new Error("not exact private object");
    return url.href;
  } catch { throw databaseFailure("STAFF_DOCUMENT_DOWNLOAD_UNCERTAIN", "附件下載連結未通過核對。", 502); }
}
function noQuery(request: Request) {
  if (new URL(request.url).search) throw new IntegrationError("INVALID_STAFF_DOCUMENT_QUERY", "請從員工證照附件入口操作。", 400);
}

export async function GET(request: Request) {
  return handleIntegrationRoute(async requestId => {
    const parameters = new URL(request.url).searchParams;
    if ([...parameters.keys()].some(key => parameters.getAll(key).length !== 1)) throw new IntegrationError("INVALID_STAFF_DOCUMENT_QUERY", "附件篩選條件無效。", 400);
    const query = querySchema.safeParse(Object.fromEntries(parameters));
    if (!query.success) throw new IntegrationError("INVALID_STAFF_DOCUMENT_QUERY", "請選擇證照與版本。", 400);
    const { actor, server } = await actorContext(false);
    const { data, error } = await documentDeadline(Promise.resolve(server.rpc("staff_certificate_documents_snapshot", {
      p_org: actor.organizationId, p_branch: actor.branchId,
      p_certificate_key: query.data.certificateKey, p_record_version_id: query.data.recordVersionId,
    }).maybeSingle<{ payload: unknown }>()));
    if (error) throw failure(error.code);
    const parsed = documentsSnapshotSchema.safeParse(data?.payload);
    if (!parsed.success || !matchesActor(parsed.data, actor) || parsed.data.actorUserId !== actor.userId ||
      parsed.data.certificateKey !== query.data.certificateKey || parsed.data.recordVersionId !== query.data.recordVersionId ||
      Date.parse(parsed.data.generatedAt) < Date.now() - 60000 || Date.parse(parsed.data.generatedAt) > Date.now() + 1000 ||
      (parsed.data.staffUserId !== actor.userId && !actor.scopes.includes("staff_certificates.manage"))) {
      throw databaseFailure("STAFF_DOCUMENT_SNAPSHOT_UNCERTAIN", "員工附件清單尚未完整核對，請重試。", 502);
    }
    return ok({ snapshot: parsed.data, uploadConfigured: configuredStaffCertificateDocumentScanner() !== null && createSupabaseAdminClient() !== null }, 200, requestId);
  });
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async requestId => {
    noQuery(request);
    const action = request.headers.get("x-staff-document-action");
    if (action !== "upload" && action !== "download") throw new IntegrationError("INVALID_STAFF_DOCUMENT_ACTION", "請從員工附件上傳或下載入口操作。", 400);
    requireSameOriginWrite(request, { method: "POST", format: action === "upload" ? "multipart" : "json" });
    const { actor, server } = await actorContext(action === "upload");
    await recentEvidence(actor, server);
    const admin = createSupabaseAdminClient();
    if (!admin) throw databaseFailure("STAFF_DOCUMENT_UNAVAILABLE", "員工附件儲存服務尚未完成設定。", 503);
    if (action === "download") {
      const input = downloadInputSchema.safeParse(await readBoundedDocumentJson(request));
      if (!input.success) throw new IntegrationError("INVALID_STAFF_DOCUMENT_DOWNLOAD", "請選擇正確的附件及證照版本。", 400);
      const prepare = async () => {
        const { data, error } = await documentDeadline(Promise.resolve(server.rpc("prepare_staff_certificate_document_download", {
          p_org: actor.organizationId, p_branch: actor.branchId, p_document: input.data.documentId,
        }).maybeSingle<{ payload: unknown }>()));
        if (error) throw failure(error.code);
        const parsed = downloadReceiptSchema.safeParse(data?.payload);
        if (!parsed.success || !matchesActor(parsed.data, actor) || parsed.data.documentId !== input.data.documentId ||
          parsed.data.recordVersionId !== input.data.recordVersionId || parsed.data.recordContentHash !== input.data.recordContentHash ||
          (parsed.data.staffUserId !== actor.userId && !actor.scopes.includes("staff_certificates.manage"))) {
          throw databaseFailure("STAFF_DOCUMENT_DOWNLOAD_UNCERTAIN", "附件下載授權尚未完整確認。", 502);
        }
        return parsed.data;
      };
      const proof = await prepare();
      const bucket = admin.storage.from(STAFF_CERTIFICATE_DOCUMENT_BUCKET);
      const { data: blob, error: blobError } = await documentDeadline(bucket.download(proof.objectPath));
      if (blobError || !blob || blob.size !== proof.fileSizeBytes || blob.size > MAX_STAFF_CERTIFICATE_DOCUMENT_BYTES ||
        createHash("sha256").update(new Uint8Array(await documentDeadline(blob.arrayBuffer()))).digest("hex") !== proof.sha256) {
        throw databaseFailure("STAFF_DOCUMENT_STORAGE_MISMATCH", "附件內容未通過核對，無法提供下載。", 409);
      }
      const extension = proof.mimeType === "application/pdf" ? "pdf" : proof.mimeType === "image/png" ? "png" : "jpg";
      const { data: signed, error: signError } = await documentDeadline(bucket.createSignedUrl(proof.objectPath, 60, { download: `staff-certificate.${extension}` }));
      if (signError || !signed?.signedUrl) throw databaseFailure("STAFF_DOCUMENT_DOWNLOAD_UNAVAILABLE", "下載連結暫時無法建立。", 503);
      const url = checkedSignedUrl(signed.signedUrl, proof.objectPath);
      // Storage admin bypasses RLS. Obtain user authorization again after its
      // asynchronous work; never expose a URL following a stale/denied proof.
      if (JSON.stringify(await prepare()) !== JSON.stringify(proof)) throw failure();
      await recentEvidence(actor, server);
      return ok({ url, expiresSeconds: 60, documentId: proof.documentId,
        serviceEligibility: "not_evaluated", signable: false }, 200, requestId);
    }
    const scanner = configuredStaffCertificateDocumentScanner();
    if (!scanner) throw new IntegrationError("STAFF_DOCUMENT_SCANNER_NOT_CONFIGURED", "員工附件安全檢查尚未設定，檔案不會上傳。", 503);
    const bytes = await readBoundedDocumentBody(request, MAX_STAFF_CERTIFICATE_DOCUMENT_BYTES + 16384);
    let form: FormData;
    try { form = await documentDeadline(new Response(bytes as BodyInit, { headers: { "content-type": request.headers.get("content-type")! } }).formData(), 10000); }
    catch (error) { if (error instanceof IntegrationError) throw error; throw new IntegrationError("INVALID_STAFF_DOCUMENT_FORM", "附件上傳內容無效，請重新選擇原檔。", 400); }
    const fields = ["staffMembershipId", "certificateKey", "recordVersionId", "recordContentHash", "idempotency_key"];
    if ([...form.keys()].some(key => ![...fields, "file"].includes(key)) || [...fields, "file"].some(key => form.getAll(key).length !== 1)) {
      throw new IntegrationError("INVALID_STAFF_DOCUMENT_FORM", "附件上傳包含無效或重複欄位。", 400);
    }
    const input = uploadFormInputSchema.safeParse(Object.fromEntries(fields.map(key => [key, form.get(key)])));
    const file = form.get("file");
    if (!input.success || !(file instanceof File)) throw new IntegrationError("INVALID_STAFF_DOCUMENT_FORM", "請選擇員工、證照版本及附件。", 400);
    const extensions: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
    if (!file.size || file.size > MAX_STAFF_CERTIFICATE_DOCUMENT_BYTES || extensions[file.name.toLowerCase().split(".").pop() ?? ""] !== file.type) {
      throw new IntegrationError("INVALID_STAFF_DOCUMENT_FILE", "附件需為 4MB 以內、格式一致的 PDF、JPEG 或 PNG。", 400);
    }
    const receipt = await processStaffCertificateDocumentUpload({ actor, scanner,
      reserve: async metadata => { const { data, error } = await server.rpc("reserve_staff_certificate_document", {
        p_org: actor.organizationId, p_branch: actor.branchId, p_input: metadata,
      }).maybeSingle<{ payload: unknown }>(); if (error) throw failure(error.code); return data?.payload; },
      complete: async (documentId, sha256, verdict, name) => { const { data, error } = await admin.rpc("complete_staff_certificate_document_scan", {
        p_document: documentId, p_sha256: sha256, p_verdict: verdict, p_scanner: name,
      }).maybeSingle<{ payload: unknown }>(); if (error) throw failure(error.code); return data?.payload; },
      storage: {
        upload: async (path, contents, mimeType) => { const { error } = await admin.storage.from(STAFF_CERTIFICATE_DOCUMENT_BUCKET).upload(path, contents, {
          contentType: mimeType, cacheControl: "0", upsert: false,
        }); if (error) throw failure(); },
        read: async path => { const { data, error } = await admin.storage.from(STAFF_CERTIFICATE_DOCUMENT_BUCKET).download(path);
          if (error) { if (String(error.statusCode) === "404") return null; throw failure(); }
          if (!data) return null;
          if (data.size > MAX_STAFF_CERTIFICATE_DOCUMENT_BYTES) throw failure();
          return new Uint8Array(await documentDeadline(data.arrayBuffer())); },
      },
    }, input.data, new Uint8Array(await documentDeadline(file.arrayBuffer())), file.type);
    return ok({ receipt, needsVerification: receipt.scanStatus === "clean", serviceEligibility: "not_evaluated", signable: false }, 201, requestId);
  });
}

export async function PATCH(request: Request) {
  return handleIntegrationRoute(async requestId => {
    noQuery(request);
    requireSameOriginWrite(request, { method: "PATCH", format: "json" });
    if (request.headers.get("x-staff-document-action") !== "review") throw new IntegrationError("INVALID_STAFF_DOCUMENT_ACTION", "請從員工附件核驗入口操作。", 400);
    const { actor, server } = await actorContext(true);
    await recentEvidence(actor, server);
    const input = reviewInputSchema.safeParse(await readBoundedDocumentJson(request));
    if (!input.success) throw new IntegrationError("INVALID_STAFF_DOCUMENT_REVIEW", "請確認附件版本、核驗結果與理由。", 400);
    const { data, error } = await documentDeadline(Promise.resolve(server.rpc("review_staff_certificate_document", {
      p_org: actor.organizationId, p_branch: actor.branchId, p_input: input.data,
    }).maybeSingle<{ payload: unknown }>()));
    if (error) throw failure(error.code);
    const receipt = reviewReceiptSchema.safeParse(data?.payload);
    if (!receipt.success || !matchesActor(receipt.data, actor) || receipt.data.reviewedBy !== actor.userId ||
      receipt.data.documentId !== input.data.documentId || receipt.data.recordVersionId !== input.data.recordVersionId ||
      receipt.data.recordContentHash !== input.data.recordContentHash || receipt.data.decision !== input.data.decision || receipt.data.reason !== input.data.reason) {
      throw databaseFailure("STAFF_DOCUMENT_REVIEW_UNCERTAIN", "核驗結果尚未完整確認，請保留相同操作識別碼。", 502);
    }
    return ok({ receipt: receipt.data, serviceEligibility: "not_evaluated", signable: false }, receipt.data.replayed ? 200 : 201, requestId);
  });
}
