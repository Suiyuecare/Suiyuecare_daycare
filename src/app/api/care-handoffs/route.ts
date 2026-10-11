import { z } from "zod";
import { getTenantContext } from "@/lib/auth/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { IntegrationError } from "@/lib/integrations/errors";
import { handleIntegrationRoute, databaseFailure, readJsonObject } from "@/lib/integrations/http";
import { ok } from "@/lib/api/response";
import { handoffSnapshotSchema, handoffWriteSchema } from "@/lib/care-handoff/schema";
export const dynamic = "force-dynamic";
async function context() {
  const actor = await getTenantContext("staff");
  if (!actor || actor.demo || !actor.branchId) throw new IntegrationError("HANDOFF_AUTH_REQUIRED", "請登入並選擇分支。", actor ? 403 : 401);
  const db = await createServerSupabaseClient(); if (!db) throw databaseFailure("HANDOFF_UNAVAILABLE", "交班暫時無法使用。", 503);
  return { actor, db };
}
function fail(code?: string) { return databaseFailure(code === "42501" ? "HANDOFF_FORBIDDEN" : "HANDOFF_CONFLICT", code === "42501" ? "此個案或交班操作沒有授權。" : "交班資料已更新，請重新讀取後核對。", code === "42501" ? 403 : 409); }
export async function GET(request: Request) { return handleIntegrationRoute(async requestId => {
  const { actor, db } = await context(); const client = z.uuid().safeParse(new URL(request.url).searchParams.get("client"));
  if (!client.success) throw new IntegrationError("HANDOFF_INVALID_CLIENT", "請選擇個案。", 400);
  const { data, error } = await db.rpc("care_handoff_snapshot", { p_org: actor.organizationId, p_branch: actor.branchId, p_client: client.data }).maybeSingle<{ payload: unknown }>();
  if (error) throw fail(error.code); const snapshot = handoffSnapshotSchema.parse(data?.payload);
  if (snapshot.clientId !== client.data || snapshot.actorId !== actor.userId) throw fail();
  return ok({ snapshot }, 200, requestId);
}); }
export async function POST(request: Request) { return handleIntegrationRoute(async requestId => {
  const { actor, db } = await context(); const input = handoffWriteSchema.safeParse(await readJsonObject(request, 8192));
  if (!input.success) throw new IntegrationError("HANDOFF_FIELDS_INVALID", "請確認接班人、期限與內容。", 400);
  const { data, error } = await db.rpc("care_handoff_write", { p_org: actor.organizationId, p_branch: actor.branchId, p_input: input.data }).maybeSingle<{ receipt: unknown }>();
  if (error) throw fail(error.code);
  return ok({ receipt: z.object({ id: z.uuid(), version: z.number().int().positive(), replayed: z.boolean() }).strict().parse(data?.receipt) }, 200, requestId);
}); }
