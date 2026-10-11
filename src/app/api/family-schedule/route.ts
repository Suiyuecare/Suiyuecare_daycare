import { z } from "zod";
import { ok } from "@/lib/api/response";
import { getTenantContext } from "@/lib/auth/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { familyScheduleSchema } from "@/lib/family/workspace-schema";
import { IntegrationError } from "@/lib/integrations/errors";
import { databaseFailure, handleIntegrationRoute } from "@/lib/integrations/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return handleIntegrationRoute(async requestId => {
  const url = new URL(request.url);
  const query = z.object({ client: z.uuid(), month: z.string().regex(/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/), audience: z.enum(["staff", "family"]) }).strict().safeParse({ client: url.searchParams.get("client"), month: url.searchParams.get("month"), audience: url.searchParams.get("audience") ?? "family" });
  if (!query.success) throw new IntegrationError("FAMILY_SCHEDULE_QUERY", "請選擇個案與月份。", 400);
  const actor = await getTenantContext(query.data.audience);
  if (!actor || actor.demo || !actor.branchId) throw new IntegrationError("FAMILY_SCHEDULE_AUTH", "請登入已授權帳號。", actor ? 403 : 401);
  const db = await createServerSupabaseClient();
  if (!db) throw databaseFailure("FAMILY_SCHEDULE_UNAVAILABLE", "行程暫時無法讀取。", 503);
  const { data, error } = await db.rpc("family_schedule_snapshot", { p_org: actor.organizationId, p_branch: actor.branchId, p_client: query.data.client, p_month: `${query.data.month}-01`, p_staff: query.data.audience === "staff" }).maybeSingle<{ payload: unknown }>();
  if (error) throw databaseFailure("FAMILY_SCHEDULE_FORBIDDEN", "行程權限已失效或資料尚未讀回，請重試。", error.code === "42501" ? 403 : 409);
  const snapshot = familyScheduleSchema.safeParse(data?.payload);
  if (!snapshot.success || snapshot.data.clientId !== query.data.client || snapshot.data.month !== query.data.month) throw databaseFailure("FAMILY_SCHEDULE_UNCERTAIN", "行程結果尚未確認，請重新讀取。", 502);
  return ok({ snapshot: snapshot.data }, 200, requestId);
}); }
