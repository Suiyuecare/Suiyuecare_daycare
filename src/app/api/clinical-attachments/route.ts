import { z } from "zod";
import { ok } from "@/lib/api/response";
import { getTenantContext } from "@/lib/auth/context";
import { configuredDocumentScanner } from "@/lib/client-documents/pipeline";
import { MAX_DOCUMENT_BYTES } from "@/lib/client-documents/schema";
import { CLINICAL_ATTACHMENT_BUCKET, clinicalSnapshotSchema, clinicalSourceKind, clinicalUploadSchema } from "@/lib/clinical-attachments/schema";
import { processClinicalAttachment } from "@/lib/clinical-attachments/pipeline";
import { IntegrationError } from "@/lib/integrations/errors";
import { databaseFailure, handleIntegrationRoute, readJsonObject } from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function services(request: Request) {
  const url = new URL(request.url);
  const audience = url.searchParams.get("audience") ?? "staff";
  if (!["staff", "family"].includes(audience)) throw new IntegrationError("INVALID_ATTACHMENT_AUDIENCE", "請從紀錄附件操作。", 400);
  if (audience === "family" && url.searchParams.get("kind") !== "family_message") throw new IntegrationError("ATTACHMENT_FORBIDDEN", "此附件類別未授權家屬使用。", 403);
  const actor = await getTenantContext(audience as "staff" | "family");
  if (!actor) throw new IntegrationError("AUTH_REQUIRED", "請先登入。", 401);
  if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "試用模式不處理正式附件。", 403);
  if (!actor.branchId) throw new IntegrationError("BRANCH_REQUIRED", "請選擇分支。", 409);
  const server = await createServerSupabaseClient();
  if (!server) throw databaseFailure("ATTACHMENT_UNAVAILABLE", "附件服務暫時無法使用。", 503);
  return { actor, server, audience };
}
function assertSourceAudience(audience: string, kind: string) {
  if (audience === "family" && kind !== "family_message") throw new IntegrationError("ATTACHMENT_FORBIDDEN", "此附件類別未授權家屬使用。", 403);
}
function rpcFailure(code?: string) { return databaseFailure(code === "42501" ? "ATTACHMENT_FORBIDDEN" : "ATTACHMENT_CONFLICT", code === "42501" ? "您沒有此個案或紀錄附件的權限。" : "紀錄已更新或附件結果待核對，請保留原操作並重新讀取。", code === "42501" ? 403 : 409); }
const querySchema = z.object({ clientId: z.uuid(), sourceKind: clinicalSourceKind, sourceId: z.uuid() });
export async function GET(request: Request) {
  return handleIntegrationRoute(async requestId => {
    const { actor, server } = await services(request);
    const url = new URL(request.url);
    const input = querySchema.safeParse({ clientId: url.searchParams.get("client"), sourceKind: url.searchParams.get("kind"), sourceId: url.searchParams.get("source") });
    if (!input.success) throw new IntegrationError("INVALID_ATTACHMENT_QUERY", "請選擇個案與紀錄。", 400);
    const { data, error } = await server.rpc("clinical_attachments_snapshot", { p_org: actor.organizationId, p_branch: actor.branchId, p_client: input.data.clientId, p_kind: input.data.sourceKind, p_source: input.data.sourceId }).maybeSingle<{ payload: unknown }>();
    if (error) throw rpcFailure(error.code);
    const snapshot = clinicalSnapshotSchema.safeParse(data?.payload);
    if (!snapshot.success || snapshot.data.clientId !== input.data.clientId || snapshot.data.sourceKind !== input.data.sourceKind || snapshot.data.sourceId !== input.data.sourceId) throw databaseFailure("ATTACHMENT_SNAPSHOT_UNCERTAIN", "附件資料尚未讀回，請重新載入。", 502);
    return ok({ snapshot: snapshot.data, uploadConfigured: Boolean(configuredDocumentScanner() && createSupabaseAdminClient()) }, 200, requestId);
  });
}
export async function POST(request: Request) {
  return handleIntegrationRoute(async requestId => {
    const { actor, server, audience } = await services(request);
    if (request.headers.get("x-attachment-action") === "cancel") {
      const input = querySchema.extend({ attachmentId: z.uuid(), idempotency_key: z.uuid() }).strict().safeParse(await readJsonObject(request, 2048));
      if (!input.success) throw new IntegrationError("INVALID_ATTACHMENT_CANCEL", "請選擇尚未完成的附件。", 400);
      assertSourceAudience(audience, input.data.sourceKind);
      const { data, error } = await server.rpc("cancel_clinical_attachment", { p_org: actor.organizationId, p_branch: actor.branchId, p_input: input.data }).maybeSingle<{ receipt: unknown }>();
      if (error) throw rpcFailure(error.code);
      const receipt = z.object({ id: z.uuid(), cancelled: z.literal(true) }).strict().safeParse(data?.receipt);
      if (!receipt.success || receipt.data.id !== input.data.attachmentId) throw databaseFailure("ATTACHMENT_CANCEL_UNCERTAIN", "中止結果尚未確認，請重試。", 502);
      return ok({ receipt: receipt.data }, 200, requestId);
    }
    const admin = createSupabaseAdminClient();
    if (!admin) throw databaseFailure("ATTACHMENT_UNAVAILABLE", "附件儲存服務尚未設定。", 503);
    if (request.headers.get("x-attachment-action") === "download") {
      const input = querySchema.extend({ attachmentId: z.uuid(), idempotency_key: z.uuid() }).strict().safeParse(await readJsonObject(request, 2048));
      if (!input.success) throw new IntegrationError("INVALID_ATTACHMENT_QUERY", "請選擇有效附件。", 400);
      assertSourceAudience(audience, input.data.sourceKind);
      const { data, error } = await server.rpc("prepare_clinical_attachment_download", { p_org: actor.organizationId, p_branch: actor.branchId, p_client: input.data.clientId, p_kind: input.data.sourceKind, p_source: input.data.sourceId, p_id: input.data.attachmentId }).maybeSingle<{ payload: unknown }>();
      if (error) throw rpcFailure(error.code);
      const payload = z.object({ id: z.uuid(), clientId: z.uuid(), objectPath: z.string(), mimeType: z.enum(["image/png", "image/jpeg", "application/pdf"]), expiresSeconds: z.literal(60) }).safeParse(data?.payload);
      if (!payload.success || payload.data.id !== input.data.attachmentId || payload.data.clientId !== input.data.clientId || payload.data.objectPath !== `${actor.organizationId}/${input.data.clientId}/${input.data.attachmentId}`) throw databaseFailure("ATTACHMENT_DOWNLOAD_UNCERTAIN", "附件授權結果尚未確認。", 409);
      const { data: signed, error: signError } = await admin.storage.from(CLINICAL_ATTACHMENT_BUCKET).createSignedUrl(payload.data.objectPath, 60, { download: `attachment-${payload.data.id}.${payload.data.mimeType === "application/pdf" ? "pdf" : payload.data.mimeType === "image/png" ? "png" : "jpg"}` });
      if (signError || !signed?.signedUrl) throw databaseFailure("ATTACHMENT_DOWNLOAD_UNAVAILABLE", "無法取得檔案，請稍後重試。", 503);
      return ok({ url: signed.signedUrl, expiresSeconds: 60, attachmentId: payload.data.id }, 200, requestId);
    }
    if (request.headers.get("x-attachment-action") !== "upload") throw new IntegrationError("INVALID_ATTACHMENT_ACTION", "請從紀錄附件操作。", 400);
    const scanner = configuredDocumentScanner();
    if (!scanner) throw new IntegrationError("DOCUMENT_SCANNER_NOT_CONFIGURED", "附件安全檢查尚未設定，請聯絡管理員。", 503);
    const limit = MAX_DOCUMENT_BYTES + 16384;
    if (!request.body || Number(request.headers.get("content-length")) > limit) throw new IntegrationError("ATTACHMENT_TOO_LARGE", "單檔上限 4MB。", 413);
    const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > limit) { await reader.cancel(); throw new IntegrationError("ATTACHMENT_TOO_LARGE", "單檔上限 4MB。", 413); } chunks.push(item.value); } } finally { reader.releaseLock(); }
    const form = await new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
    const keys = ["clientId", "sourceKind", "sourceId", "sourceVersion", "label", "idempotency_key", "file"];
    if (Array.from(form.keys()).some(key => !keys.includes(key)) || keys.some(key => form.getAll(key).length !== 1)) throw new IntegrationError("INVALID_ATTACHMENT_FORM", "請重新選擇附件。", 400);
    const input = clinicalUploadSchema.safeParse({ ...Object.fromEntries(keys.filter(key => key !== "file").map(key => [key, form.get(key)])), sourceVersion: Number(form.get("sourceVersion")) });
    const file = form.get("file");
    const types: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
    if (!input.success || !(file instanceof File) || types[file.name.toLowerCase().split(".").pop() ?? ""] !== file.type) throw new IntegrationError("INVALID_ATTACHMENT_FORM", "請選擇 PDF、JPEG 或 PNG，並填寫附件名稱。", 400);
    assertSourceAudience(audience, input.data.sourceKind);
    const receipt = await processClinicalAttachment({ scanner, reserve: async metadata => { const { data, error } = await server.rpc("reserve_clinical_attachment", { p_org: actor.organizationId, p_branch: actor.branchId, p_input: metadata }).maybeSingle<{ receipt: unknown }>(); if (error) throw rpcFailure(error.code); return data?.receipt; },
      storage: { upload: async (path, bytes, mimeType) => { const { error } = await admin.storage.from(CLINICAL_ATTACHMENT_BUCKET).upload(path, bytes, { contentType: mimeType, cacheControl: "0", upsert: false }); if (error) throw databaseFailure("ATTACHMENT_UPLOAD_UNCERTAIN", "附件結果待確認，請重試原操作。", 503); }, read: async path => { const { data, error } = await admin.storage.from(CLINICAL_ATTACHMENT_BUCKET).download(path); if (error && error.message !== "Object not found") throw databaseFailure("ATTACHMENT_STORAGE_UNCERTAIN", "附件結果待確認，請重試原操作。", 503); return data ? new Uint8Array(await data.arrayBuffer()) : null; } },
      complete: async (id, hash, verdict, scannerName) => { const { data, error } = await admin.rpc("complete_clinical_attachment", { p_id: id, p_sha256: hash, p_verdict: verdict, p_scanner: scannerName }).maybeSingle<{ receipt: unknown }>(); if (error) throw rpcFailure(error.code); return data?.receipt; },
    }, input.data, new Uint8Array(await file.arrayBuffer()), file.type, actor.organizationId);
    return ok({ receipt }, 201, requestId);
  });
}
