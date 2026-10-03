import { ok } from "@/lib/api/response";
import { canUseToccDraft } from "@/lib/auth/tocc-draft";
import {
  parseToccDraftSaveInput,
  parseToccDraftSaveReceipt,
  toToccDraftPayload,
} from "@/lib/integrations/client-tocc-drafts";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
} from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(code: string | undefined) {
  if (code === "42501") return databaseFailure("TOCC_DRAFT_FORBIDDEN", "目前權限或個案指派不允許儲存草稿。", 403);
  if (code === "23505") return databaseFailure("TOCC_DRAFT_IDEMPOTENCY_CONFLICT", "草稿鍵或冪等鍵已對應其他操作。", 409);
  if (code === "PT409") return databaseFailure("TOCC_DRAFT_VERSION_CONFLICT", "草稿已有新版本，請重新載入。", 409);
  if (["22023", "22007", "22P02", "23514"].includes(code ?? ""))
    return databaseFailure("INVALID_TOCC_DRAFT", "草稿內容不符合規則。", 400);
  return databaseFailure("TOCC_DRAFT_SAVE_FAILED", "草稿結果未確認，請保留內容及相同冪等鍵重試。", 409);
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest({ routinePermission: "health.write" });
    if (actor.demo) throw new IntegrationError("DEMO_WRITE_DISABLED", "展示模式不能儲存 TOCC 草稿。", 403);
    if (!(await canUseToccDraft(actor, null, true))) {
      throw new IntegrationError("TOCC_DRAFT_FORBIDDEN", "目前帳號未獲准建立 TOCC 草稿。", 403);
    }
    const input = parseToccDraftSaveInput(
      await readJsonObject(request, 32 * 1024), request.headers.get("idempotency-key"));
    const db = await createServerSupabaseClient();
    if (!db) throw databaseFailure("SERVICE_NOT_CONFIGURED", "TOCC 草稿服務尚未設定。", 503);
    const { data, error } = await db.rpc("save_client_tocc_draft", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_action: input.action,
      p_payload: toToccDraftPayload(input),
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw failure(error.code);
    const receipt = parseToccDraftSaveReceipt(data, input);
    return ok(receipt, receipt.replayed ? 200 : 201, requestId);
  });
}
