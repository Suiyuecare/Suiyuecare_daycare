import { z } from "zod";
import { getTenantContext } from "@/lib/auth/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { IntegrationError } from "@/lib/integrations/errors";
import { handleIntegrationRoute, databaseFailure, readJsonObject } from "@/lib/integrations/http";
import { ok } from "@/lib/api/response";
import { familyMessageReceiptSchema, familyMutationSchema, familyWorkspaceSchema } from "@/lib/family/workspace-schema";
import { assertOfflineCareScope } from "@/lib/offline/scope";
import { CLINICAL_ATTACHMENT_BUCKET } from "@/lib/clinical-attachments/schema";
export const dynamic = "force-dynamic";
async function context() {
  const actor = await getTenantContext("family"); if (!actor || actor.demo || !actor.branchId) throw new IntegrationError("FAMILY_AUTH_REQUIRED", "請登入已授權的家屬帳號。", actor ? 403 : 401);
  const db = await createServerSupabaseClient(); if (!db) throw databaseFailure("FAMILY_UNAVAILABLE", "資料暫時無法讀取。", 503);
  return { actor, db };
}
function denied(code?: string) { return databaseFailure(code === "42501" ? "FAMILY_CONSENT_REQUIRED" : "FAMILY_CONFLICT", code === "42501" ? "此個案或資料類別的授權已失效，請聯絡機構。" : "資料已更新，請重新讀取後核對。", code === "42501" ? 403 : 409); }
export async function GET(request: Request) { return handleIntegrationRoute(async requestId => {
  const { actor, db } = await context(); const client = z.uuid().safeParse(new URL(request.url).searchParams.get("client"));
  if (!client.success) throw new IntegrationError("FAMILY_INVALID_CLIENT", "請選擇個案。", 400);
  const { data, error } = await db.rpc("family_workspace", { p_org: actor.organizationId, p_branch: actor.branchId, p_client: client.data }).maybeSingle<{ payload: unknown }>(); if (error) throw denied(error.code);
  const snapshot = familyWorkspaceSchema.parse(data?.payload); if (snapshot.clientId !== client.data || (snapshot.actorScope && (snapshot.actorScope.organizationId !== actor.organizationId || snapshot.actorScope.branchId !== actor.branchId || snapshot.actorScope.userId !== actor.userId))) throw denied(); return ok({ snapshot }, 200, requestId);
}); }
export async function POST(request: Request) { return handleIntegrationRoute(async requestId => {
  const { actor, db } = await context(); assertOfflineCareScope(request, actor); const input = familyMutationSchema.safeParse(await readJsonObject(request, 8192)); if (!input.success) throw new IntegrationError("FAMILY_FIELDS_INVALID", "請確認填寫內容。", 400);
  const args = { p_org: actor.organizationId, p_branch: actor.branchId };
  if (input.data.action === "read") { const { error } = await db.rpc("family_read_message", { ...args, p_client: input.data.clientId, p_id: input.data.messageId }); if (error) throw denied(error.code); return ok({ confirmed: true }, 200, requestId); }
  if (input.data.action === "download") {
    const admin = createSupabaseAdminClient(); if (!admin) throw databaseFailure("FAMILY_DOWNLOAD_UNAVAILABLE", "文件暫時無法開啟。", 503);
    const { data, error } = await db.rpc("family_document_download", { ...args, p_client: input.data.clientId, p_publication: input.data.publicationId }).maybeSingle<{ payload: unknown }>(); if (error) throw denied(error.code);
    const source = z.object({ id: z.uuid(), objectPath: z.string(), mimeType: z.enum(["image/png", "image/jpeg", "application/pdf"]), expiresSeconds: z.literal(60) }).strict().parse(data?.payload);
    if (source.objectPath !== `${actor.organizationId}/${input.data.clientId}/${source.id}`) throw denied();
    const { data: signed, error: signError } = await admin.storage.from(CLINICAL_ATTACHMENT_BUCKET).createSignedUrl(source.objectPath, 60, { download: true }); if (signError || !signed?.signedUrl) throw databaseFailure("FAMILY_DOWNLOAD_UNAVAILABLE", "文件不存在或暫時無法開啟。", 503);
    return ok({ url: signed.signedUrl, expiresSeconds: 60, publicationId: input.data.publicationId }, 200, requestId);
  }
  const { action, ...payload } = input.data;
  const { data, error } = await db.rpc(action === "message" ? "family_message_write" : "family_preference_write", { ...args, p_input: payload }).maybeSingle<{ receipt: unknown }>(); if (error) throw denied(error.code);
  const receipt = familyMessageReceiptSchema.parse(data?.receipt); return ok({ receipt }, receipt.status === "conflict" ? 409 : 200, requestId);
}); }
