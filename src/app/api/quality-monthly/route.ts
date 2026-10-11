import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, handleIntegrationRoute, readJsonObject, requireRecentAal2 } from "@/lib/integrations/http";
import { qualityFreezeReceiptSchema, qualityFreezeRequestSchema, qualityMonthlySnapshotSchema, qualityMonthSchema } from "@/lib/quality-monthly/contract";
import { canReadQualityMonthly, loadQualityMonthlySnapshot } from "@/lib/quality-monthly/snapshot";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    const query = new URL(request.url).searchParams;
    if (!canReadQualityMonthly(actor)) throw new IntegrationError("QUALITY_MONTHLY_NOT_AUTHORIZED", "這個帳號不能查看月報。", 403);
    if ([...query.keys()].some((key) => !["month", "snapshot"].includes(key)) ||
      !qualityMonthSchema.safeParse(query.get("month")).success ||
      (query.has("snapshot") && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(query.get("snapshot") ?? ""))) throw new IntegrationError("INVALID_QUALITY_FILTER", "請重新選擇月份。", 400);
    try { return ok(await loadQualityMonthlySnapshot(actor, query.get("month") ?? "", query.get("snapshot")), 200, requestId); }
    catch { throw new IntegrationError("QUALITY_MONTHLY_UNAVAILABLE", "無法讀取這個月份；請確認權限後重試。", 503); }
  });
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    await requireRecentAal2(actor);
    if (!canReadQualityMonthly(actor) || !actor.scopes.includes("quality_monthly.export")) throw new IntegrationError("QUALITY_MONTHLY_NOT_AUTHORIZED", "這個帳號不能建立月報快照。", 403);
    const input = qualityFreezeRequestSchema.safeParse(await readJsonObject(request, 1024));
    if (!input.success || request.headers.get("idempotency-key") !== input.data.idempotency_key) throw new IntegrationError("INVALID_QUALITY_FREEZE", "請重新載入月份後再建立快照。", 400);
    const client = await createServerSupabaseClient();
    if (!client) throw new IntegrationError("SERVICE_NOT_CONFIGURED", "月報服務暫時不可用。", 503);
    const { data, error } = await client.rpc("quality_monthly_freeze", {
      p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId,
      p_month: input.data.month, p_expected_hash: input.data.expectedHash, p_idempotency_key: input.data.idempotency_key,
    });
    if (error?.code === "40001") throw new IntegrationError("QUALITY_MONTHLY_CHANGED", "本月資料已有更新，請重新載入後核對。", 409);
    if (error?.code === "42501") throw new IntegrationError("QUALITY_MONTHLY_NOT_AUTHORIZED", "權限或身分確認已失效。", 403);
    if (error?.code === "23505") throw new IntegrationError("QUALITY_MONTHLY_KEY_CONFLICT", "原操作內容不一致，請核對原快照。", 409);
    const parsed = qualityMonthlySnapshotSchema.safeParse(data);
    if (error || !parsed.success || !parsed.data.snapshotId || parsed.data.organizationId !== actor.organizationId ||
      parsed.data.branchId !== actor.branchId || parsed.data.month !== input.data.month || parsed.data.hash !== input.data.expectedHash) throw new IntegrationError("QUALITY_MONTHLY_RESULT_UNCERTAIN", "結果尚未確認，請用同一操作重試。", 409);
    const receipt = qualityFreezeReceiptSchema.safeParse({ ...parsed.data, actorUserId: actor.userId, idempotencyKey: input.data.idempotency_key });
    if (!receipt.success) throw new IntegrationError("QUALITY_MONTHLY_RESULT_UNCERTAIN", "結果尚未確認，請用同一操作重試。", 409);
    return ok(receipt.data, 200, requestId);
  });
}
