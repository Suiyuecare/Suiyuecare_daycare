import { getTenantContext } from "@/lib/auth/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { IntegrationError } from "@/lib/integrations/errors";
import { handleIntegrationRoute, databaseFailure, readJsonObject } from "@/lib/integrations/http";
import { familyPublishSchema } from "@/lib/family/workspace-schema";
import { ok } from "@/lib/api/response";
import { z } from "zod";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return handleIntegrationRoute(async requestId => {
  const actor = await getTenantContext("staff"); if (!actor || actor.demo || !actor.branchId) throw new IntegrationError("FAMILY_PUBLISH_AUTH_REQUIRED", "請登入有發布權限的員工帳號。", actor ? 403 : 401);
  const input = familyPublishSchema.safeParse(await readJsonObject(request, 8192)); if (!input.success) throw new IntegrationError("FAMILY_PUBLISH_FIELDS_INVALID", "請填寫給家屬看的標題與摘要。", 400);
  const db = await createServerSupabaseClient(); if (!db) throw databaseFailure("FAMILY_PUBLISH_UNAVAILABLE", "發布服務暫時無法使用。", 503);
  const { data, error } = await db.rpc("family_publish", { p_org: actor.organizationId, p_branch: actor.branchId, p_input: input.data }).maybeSingle<{ receipt: unknown }>();
  if (error) throw databaseFailure("FAMILY_PUBLISH_DENIED", error.code === "42501" ? "請核對資料與發布權限，並完成最近 15 分鐘的驗證。" : "資料已更新，請重新核對來源紀錄。", error.code === "42501" ? 403 : 409);
  return ok({ receipt: z.object({ id: z.uuid(), replayed: z.boolean() }).strict().parse(data?.receipt) }, 200, requestId);
}); }
