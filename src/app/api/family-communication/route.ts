import { z } from "zod";
import { ok } from "@/lib/api/response";
import { getTenantContext } from "@/lib/auth/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { familyMessageReceiptSchema, familyStaffWorkspaceSchema, familyStaffWriteSchema } from "@/lib/family/workspace-schema";
import { IntegrationError } from "@/lib/integrations/errors";
import { databaseFailure, handleIntegrationRoute, readJsonObject } from "@/lib/integrations/http";

export const dynamic = "force-dynamic";
async function services() {
  const actor = await getTenantContext("staff");
  if (!actor || actor.demo || !actor.branchId) throw new IntegrationError("FAMILY_COMMUNICATION_AUTH_REQUIRED", "請登入有家屬溝通權限的員工帳號。", actor ? 403 : 401);
  const db = await createServerSupabaseClient();
  if (!db) throw databaseFailure("FAMILY_COMMUNICATION_UNAVAILABLE", "家屬溝通暫時無法使用。", 503);
  return { actor, db };
}
const query = z.object({ clientId: z.uuid(), recipientId: z.uuid().nullable() }).strict();
export async function GET(request: Request) { return handleIntegrationRoute(async requestId => {
  const { actor, db } = await services(); const url = new URL(request.url);
  const input = query.safeParse({ clientId: url.searchParams.get("client"), recipientId: url.searchParams.get("recipient") });
  if (!input.success) throw new IntegrationError("FAMILY_COMMUNICATION_QUERY_INVALID", "請選擇個案與家屬。", 400);
  const { data, error } = await db.rpc("family_staff_workspace", { p_org: actor.organizationId, p_branch: actor.branchId, p_client: input.data.clientId, p_recipient: input.data.recipientId }).maybeSingle<{ payload: unknown }>();
  if (error) throw databaseFailure("FAMILY_COMMUNICATION_FORBIDDEN", "請核對個案／家屬授權，或重新載入。", error.code === "42501" ? 403 : 409);
  const snapshot = familyStaffWorkspaceSchema.safeParse(data?.payload);
  if (!snapshot.success || snapshot.data.clientId !== input.data.clientId || snapshot.data.recipientId !== input.data.recipientId) throw databaseFailure("FAMILY_COMMUNICATION_UNCERTAIN", "溝通資料尚未讀回，請重新載入。", 502);
  return ok({ snapshot: snapshot.data }, 200, requestId);
}); }
export async function POST(request: Request) { return handleIntegrationRoute(async requestId => {
  const { actor, db } = await services(); const input = familyStaffWriteSchema.safeParse(await readJsonObject(request, 12_000));
  if (!input.success) throw new IntegrationError("FAMILY_COMMUNICATION_FIELDS_INVALID", "請填寫訊息或撤回理由。", 400);
  const operation = input.data.action === "message" ? "family_message_write" : input.data.action === "reviewConflict" ? "family_message_conflict_review" : "family_withdraw";
  const parameters = { p_org: actor.organizationId, p_branch: actor.branchId, p_input: input.data, ...(input.data.action === "message" ? { p_staff: true } : {}) };
  const { data, error } = await db.rpc(operation, parameters).maybeSingle<{ receipt: unknown }>();
  if (error) throw databaseFailure("FAMILY_COMMUNICATION_DENIED", error.code === "42501" ? "權限或家屬授權已失效；撤回資料另需最近驗證。" : "操作結果待核對，請重試原操作。", error.code === "42501" ? 403 : 409);
  const receipt = familyMessageReceiptSchema.safeParse(data?.receipt);
  if (!receipt.success || (input.data.action === "withdraw" && receipt.data.id !== input.data.publicationId)) throw databaseFailure("FAMILY_COMMUNICATION_UNCERTAIN", "操作結果尚未確認。", 502);
  return ok({ receipt: receipt.data }, receipt.data.status === "conflict" ? 409 : 200, requestId);
}); }
