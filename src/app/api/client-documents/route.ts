import { z } from "zod";
import { ok } from "@/lib/api/response";
import { getTenantContext } from "@/lib/auth/context";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, databaseFailure, handleIntegrationRoute, readJsonObject, requireRecentAal2 } from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { attachmentDetailsSchema, categorySchema, hasDocumentCategoryPermission, documentsSnapshotSchema, MAX_DOCUMENT_BYTES, reviewInputSchema, reviewReceiptSchema } from "@/lib/client-documents/schema";
import { configuredDocumentScanner, DOCUMENT_BUCKET, processDocumentUpload } from "@/lib/client-documents/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function failure(code?: string) { return databaseFailure(code === "42501" ? "DOCUMENT_FORBIDDEN" : "DOCUMENT_CONFLICT", code === "42501" ? "沒有此個案與附件類別的操作授權。" : "附件或覆核版本已變更，請保留原操作並重新載入確認。", code === "42501" ? 403 : 409); }
async function boundedFormData(request: Request) {
  const limit = MAX_DOCUMENT_BYTES + 16384;
  if (Number(request.headers.get("content-length")) > limit || !request.body) throw new IntegrationError("DOCUMENT_TOO_LARGE", "附件上限 4MB，請縮小檔案後重試。", 413);
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; total += chunk.value.length; if (total > limit) { await reader.cancel(); throw new IntegrationError("DOCUMENT_TOO_LARGE", "附件上限 4MB。", 413); } chunks.push(chunk.value); }
    return await new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } finally { reader.releaseLock(); }
}
export async function GET(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await getTenantContext("staff");
    if (!actor) throw new IntegrationError("AUTH_REQUIRED", "請先登入。", 401);
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "展示模式不查詢正式附件。", 403);
    if (!actor.branchId || !actor.scopes.includes("clients.read")) throw failure("42501");
    const clientId = z.uuid().safeParse(new URL(request.url).searchParams.get("client"));
    if (!clientId.success) throw new IntegrationError("INVALID_DOCUMENT_QUERY", "請先選擇個案。", 400);
    const server = await createServerSupabaseClient(); if (!server) throw databaseFailure("DOCUMENT_UNAVAILABLE", "附件資料暫時無法讀取。", 503);
    const { data, error } = await server.rpc("client_documents_snapshot", { p_org: actor.organizationId, p_branch: actor.branchId, p_client: clientId.data }).maybeSingle<{ payload: unknown }>();
    if (error) throw failure(error.code);
    const parsed = documentsSnapshotSchema.safeParse(data?.payload);
    if (!parsed.success || parsed.data.clientId !== clientId.data) throw databaseFailure("DOCUMENT_SNAPSHOT_UNCERTAIN", "附件清單尚未完整讀回，請重試。", 502);
    if (parsed.data.rows.some(row => row.accessible && !hasDocumentCategoryPermission(actor.scopes, row.category)) ||
      parsed.data.history.some(row => !hasDocumentCategoryPermission(actor.scopes, row.category))) throw failure("42501");
    return ok({ snapshot: parsed.data, uploadConfigured: configuredDocumentScanner() !== null && createSupabaseAdminClient() !== null }, 200, requestId);
  });
}
export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const action = request.headers.get("x-client-document-action");
    if (action !== "upload" && action !== "download") throw new IntegrationError("INVALID_DOCUMENT_ACTION", "請從個案附件操作。", 400);
    const actor = await authorizeStaffRequest(); if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "展示模式不會上傳或下載正式附件。", 403);
    await requireRecentAal2(actor);
    if (!actor.scopes.includes("clients.read")) throw failure("42501");
    const server = await createServerSupabaseClient(); const admin = createSupabaseAdminClient();
    if (!server || !admin) throw databaseFailure("DOCUMENT_UNAVAILABLE", "附件儲存服務尚未設定，檔案不會上傳。", 503);
    if (action === "download") {
      const parsed = z.object({ clientId: z.uuid(), documentId: z.uuid(), idempotency_key: z.uuid() }).strict().safeParse(await readJsonObject(request, 2048));
      if (!parsed.success) throw new IntegrationError("INVALID_DOCUMENT_DOWNLOAD", "請選擇有效的附件版本。", 400);
      const { data, error } = await server.rpc("prepare_client_document_download", { p_org: actor.organizationId, p_branch: actor.branchId, p_client: parsed.data.clientId, p_document: parsed.data.documentId }).maybeSingle<{ payload: unknown }>();
      if (error) throw failure(error.code);
      const payload = z.object({ id: z.uuid(), clientId: z.uuid(), category: categorySchema, version: z.number().int().positive(), objectPath: z.string(), mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]), expiresSeconds: z.literal(60),
        disposition: z.enum(["unreviewed", "reviewed", "needs_replacement", "inactive"]).optional(), historicalOnly: z.boolean().optional(),
      }).refine((value) => (value.disposition === undefined) === (value.historicalOnly === undefined) &&
        (value.disposition !== "inactive" || value.historicalOnly === true)).safeParse(data?.payload);
      if (!payload.success || payload.data.id !== parsed.data.documentId || payload.data.clientId !== parsed.data.clientId || payload.data.objectPath !== `${actor.organizationId}/${parsed.data.clientId}/${parsed.data.documentId}`) throw databaseFailure("DOCUMENT_DOWNLOAD_UNCERTAIN", "附件下載授權尚未確認。", 409);
      if (!hasDocumentCategoryPermission(actor.scopes, payload.data.category)) throw failure("42501");
      const extension = payload.data.mimeType === "application/pdf" ? "pdf" : payload.data.mimeType === "image/png" ? "png" : "jpg";
      const { data: signed, error: signError } = await admin.storage.from(DOCUMENT_BUCKET).createSignedUrl(payload.data.objectPath, 60, { download: `${payload.data.category}-v${payload.data.version}.${extension}` });
      if (signError || !signed?.signedUrl) throw databaseFailure("DOCUMENT_DOWNLOAD_UNAVAILABLE", "下載連結暫時無法建立，請稍後重試。", 503);
      return ok({ url: signed.signedUrl, expiresSeconds: 60, documentId: payload.data.id, version: payload.data.version,
        ...(payload.data.disposition !== undefined ? { disposition: payload.data.disposition, historicalOnly: payload.data.historicalOnly } : {}),
      }, 200, requestId);
    }
    const scanner = configuredDocumentScanner();
    if (!scanner) throw new IntegrationError("DOCUMENT_SCANNER_NOT_CONFIGURED", "附件安全檢查尚未設定，檔案不會上傳；請聯絡系統管理員。", 503);
    const form = await boundedFormData(request);
    const required = ["clientId", "category", "expectedDocumentVersion", "idempotency_key", "file"];
    const detailKeys = ["documentLabel", "provider", "documentDate", "validUntil", "periodFrom", "periodTo"];
    const allowed = [...required, ...detailKeys];
    if (Array.from(form.keys()).some((key) => !allowed.includes(key)) || required.some((key) => form.getAll(key).length !== 1) || detailKeys.some((key) => form.getAll(key).length > 1)) throw new IntegrationError("INVALID_DOCUMENT_FORM", "請重新選擇附件，勿加入額外欄位。", 400);
    const file = form.get("file"); if (!(file instanceof File)) throw new IntegrationError("DOCUMENT_REQUIRED", "請選擇附件。", 400);
    const ext = file.name.toLowerCase().split(".").pop();
    if (!ext || !({ pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" } as Record<string, string>)[ext] || ({ pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" } as Record<string, string>)[ext] !== file.type) throw new IntegrationError("INVALID_DOCUMENT_EXTENSION", "副檔名與檔案格式不一致。", 400);
    const candidate = z.object({ clientId: z.uuid(), category: categorySchema, expectedDocumentVersion: z.number().int().min(0).max(1000000), idempotency_key: z.uuid(), ...attachmentDetailsSchema.shape })
      .refine((v) => (!v.validUntil || !v.documentDate || v.validUntil >= v.documentDate) && ((v.periodFrom === null) === (v.periodTo === null)) && (!v.periodFrom || !v.periodTo || v.periodFrom <= v.periodTo))
      .safeParse({ clientId: form.get("clientId"), category: form.get("category"), expectedDocumentVersion: Number(form.get("expectedDocumentVersion")), idempotency_key: form.get("idempotency_key"), ...Object.fromEntries(detailKeys.map((key) => [key, form.get(key) || null])) });
    if (!candidate.success) throw new IntegrationError("INVALID_DOCUMENT_FORM", "請確認個案、附件類別與版本。", 400);
    if (!hasDocumentCategoryPermission(actor.scopes, candidate.data.category, true)) throw failure("42501");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const receipt = await processDocumentUpload({ scanner,
      reserve: async (input) => { const { data, error } = await server.rpc("reserve_client_document", { p_org: actor.organizationId, p_branch: actor.branchId, p_input: input }).maybeSingle<{ receipt: unknown }>(); if (error) throw failure(error.code); return data?.receipt; },
      storage: {
        upload: async (path, contents, mimeType) => { const { error } = await admin.storage.from(DOCUMENT_BUCKET).upload(path, contents, { contentType: mimeType, cacheControl: "0", upsert: false }); if (error) throw databaseFailure("DOCUMENT_UPLOAD_UNCERTAIN", "附件尚未確認上傳，請使用原操作重試。", 503); },
        read: async (path) => { const { data, error } = await admin.storage.from(DOCUMENT_BUCKET).download(path); if (error && error.message !== "Object not found") throw databaseFailure("DOCUMENT_UPLOAD_UNCERTAIN", "附件版本尚未確認，請稍後重試。", 503); return data ? new Uint8Array(await data.arrayBuffer()) : null; },
      },
      complete: async (id, sha256, verdict, name) => { const { data, error } = await admin.rpc("complete_client_document_scan", { p_document: id, p_sha256: sha256, p_verdict: verdict, p_scanner: name }).maybeSingle<{ receipt: unknown }>(); if (error) throw failure(error.code); return data?.receipt; },
    }, candidate.data, bytes, file.type);
    return ok({ receipt, readyForReview: receipt.scanStatus === "clean" }, 201, requestId);
  });
}
export async function PATCH(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    if (request.headers.get("x-client-document-action") !== "review") throw new IntegrationError("INVALID_DOCUMENT_ACTION", "請從附件覆核操作。", 400);
    const actor = await authorizeStaffRequest(); if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "展示模式不改動正式附件。", 403); await requireRecentAal2(actor);
    const parsed = reviewInputSchema.safeParse(await readJsonObject(request, 4096));
    if (!parsed.success) throw new IntegrationError("INVALID_DOCUMENT_REVIEW", "請確認附件版本、處置與至少三字的理由。", 400);
    if (!actor.scopes.includes("clients.read") || !hasDocumentCategoryPermission(actor.scopes, parsed.data.category, true)) throw failure("42501");
    const server = await createServerSupabaseClient(); if (!server) throw databaseFailure("DOCUMENT_UNAVAILABLE", "附件覆核暫時無法儲存。", 503);
    const { data, error } = await server.rpc("review_client_document", { p_org: actor.organizationId, p_branch: actor.branchId, p_input: parsed.data }).maybeSingle<{ receipt: unknown }>();
    if (error) throw failure(error.code);
    const receipt = reviewReceiptSchema.safeParse(data?.receipt);
    if (!receipt.success || receipt.data.clientId !== parsed.data.clientId || receipt.data.category !== parsed.data.category || receipt.data.reviewVersion !== parsed.data.expectedReviewVersion + 1 || receipt.data.decision !== parsed.data.decision) throw databaseFailure("DOCUMENT_REVIEW_UNCERTAIN", "覆核回條尚未確認，請保留原操作並重試。", 409);
    return ok({ receipt: receipt.data }, receipt.data.replayed ? 200 : 201, requestId);
  });
}
