import { z } from "zod";
import { ok } from "@/lib/api/response";
import { diaryActionSchema, diaryRecordSchema } from "@/lib/care-diary/schema";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, databaseFailure, handleIntegrationRoute, readJsonObject, requireRecentAal2 } from "@/lib/integrations/http";
import { assertIdempotencyKey, deterministicUuid } from "@/lib/integrations/security";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    const id = z.uuid().safeParse((await context.params).id);
    const parsed = diaryActionSchema.safeParse(await readJsonObject(request));
    if (!id.success || !parsed.success) throw new IntegrationError("INVALID_DIARY_ACTION", "請檢查日誌版本、欄位與操作確認。", 422);
    const action = parsed.data;
    const permission = action.action === "sign" ? "care_records.sign" : "care_records.write";
    if (!actor.demo && (!actor.scopes.includes(permission) || !actor.scopes.includes("care_records.read"))) throw new IntegrationError("DIARY_NOT_AUTHORIZED", "目前沒有此項日誌操作的權限。", 403);
    if (action.action === "sign") await requireRecentAal2(actor);
    const key = assertIdempotencyKey(request.headers.get("idempotency-key") ?? action.idempotency_key);
    // Demo is intentionally not a mutable diary database or a fake signature.
    if (actor.demo) throw new IntegrationError("DEMO_DIARY_READ_ONLY", "展示模式不保存日誌版本，也不會產生正式簽署。", 409);
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED", "目前無法儲存正式日誌。", 503);
    const { data, error } = await supabase.rpc("mutate_care_diary", {
      p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId,
      p_action: action.action, p_record_id: id.data, p_base_version: action.base_version,
      p_fields: action.action === "edit" ? action.data : null,
      p_reason: action.action === "correct" || action.action === "reopen" ? action.reason : null,
      p_idempotency_key: deterministicUuid("care-diary-action", actor.organizationId, actor.userId, key),
    });
    if (error) {
      const code = error.code;
      throw databaseFailure(code === "42501" ? "DIARY_NOT_AUTHORIZED" : code === "40001" ? "VERSION_CONFLICT" : code === "23505" ? "IDEMPOTENCY_CONFLICT" : "DIARY_ACTION_FAILED",
        code === "40001" ? "日誌已有新版本。請保留內容，重新讀取後人工確認，不會直接覆蓋。" : code === "42501" ? "目前權限或身分確認不足，尚未完成此操作。" : code === "23514" ? "請先補齊觀察摘要；標記需留意時也要填後續行動，並確認日誌狀態。" : "尚未確認完成，請保留內容並重試同一次操作。",
        code === "42501" ? 403 : code === "22023" || code === "23514" ? 422 : 409);
    }
    const receipt = z.object({ record: diaryRecordSchema, replayed: z.boolean() }).safeParse(data);
    if (!receipt.success) throw databaseFailure("DIARY_RECEIPT_INCOMPLETE", "回覆不完整；結果未知，請保留內容重試。", 503);
    const record = receipt.data.record;
    const expectedState = action.action === "submit" ? "submitted" : "draft";
    if (record.previous_version_id !== id.data || record.version !== action.base_version + 1 ||
      (action.action === "sign" ? !["signed", "corrected"].includes(record.status) : record.status !== expectedState) ||
      (action.action === "correct" && record.correction_source_id !== id.data)) {
      throw databaseFailure("DIARY_RECEIPT_INCOMPLETE", "回覆版本或狀態不一致；請保留內容重試。", 503);
    }
    return ok({ ...receipt.data, persisted: true, demo: false }, receipt.data.replayed ? 200 : 201, requestId);
  });
}
