import { z } from "zod";
import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, databaseFailure, handleIntegrationRoute, readJsonObject, requireRecentAal2 } from "@/lib/integrations/http";
import { parseRosterInput } from "@/lib/care-roster/parser";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const receiptSchema = z.object({ id: z.uuid(), clientId: z.uuid(), serviceDate: z.iso.date(), shift: z.enum(["morning", "afternoon"]), version: z.number().int().positive(), replayed: z.boolean() });
export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    if (request.headers.get("x-care-roster-action") !== "approve_assignment") throw new IntegrationError("INVALID_ROSTER_ACTION", "請從每日分工表操作。", 400);
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "展示模式不會改動正式每日分工。", 403);
    if (!["staff_scheduling.manage", "clients.read", "clients.view_all"].every((scope) => actor.scopes.includes(scope))) throw new IntegrationError("ROSTER_FORBIDDEN", "只有授權主管可安排每日分工。", 403);
    await requireRecentAal2(actor);
    const input = parseRosterInput(await readJsonObject(request, 8192));
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED", "每日分工暫時無法儲存，請稍後重試。", 503);
    const { data, error } = await supabase.rpc("save_care_roster", {
      p_organization_id: actor.organizationId, p_branch_id: actor.branchId, p_input: input,
    }).maybeSingle<{ receipt: unknown }>();
    if (error) throw databaseFailure(error.code === "42501" ? "ROSTER_FORBIDDEN" : "ROSTER_CONFLICT",
      error.code === "42501" ? "所選人員或個案不在可安排範圍，請主管確認授權。" : "分工資料已變更或未通過驗證；請重新載入確認，勿重複新增。", error.code === "42501" ? 403 : 409);
    const parsed = receiptSchema.safeParse(data?.receipt);
    if (!parsed.success || parsed.data.clientId !== input.clientId || parsed.data.serviceDate !== input.serviceDate || parsed.data.shift !== input.shift || parsed.data.version !== input.expectedVersion + 1) throw databaseFailure("ROSTER_RESULT_UNCERTAIN", "尚無法確認分工已儲存，請保留目前內容並以原操作重試。", 409);
    return ok({ receipt: parsed.data, persisted: true, demo: false }, parsed.data.replayed ? 200 : 201, requestId);
  });
}
