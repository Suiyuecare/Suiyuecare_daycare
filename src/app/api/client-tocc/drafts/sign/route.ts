import { ok } from "@/lib/api/response";
import { parseToccDraftSignInput, parseToccDraftSignReceipt } from "@/lib/integrations/client-tocc-drafts";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
  requireRecentAal2,
} from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(code: string | undefined) {
  if (code === "42501") return databaseFailure("TOCC_DRAFT_SIGN_FORBIDDEN", "目前權限、指派或 AAL2 證據不允許簽署。", 403);
  if (code === "23505") return databaseFailure("TOCC_DRAFT_ALREADY_SIGNED", "此草稿已簽署或冪等鍵衝突。", 409);
  if (code === "PT409") return databaseFailure("TOCC_DRAFT_VERSION_CONFLICT", "草稿或正式紀錄已有新版本，請重新載入。", 409);
  if (["22023", "22007", "22P02"].includes(code ?? ""))
    return databaseFailure("INVALID_TOCC_DRAFT_SIGN", "簽署條件格式錯誤。", 400);
  return databaseFailure("TOCC_DRAFT_SIGN_FAILED", "簽署結果未確認，請以相同冪等鍵重試。", 409);
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError("DEMO_WRITE_DISABLED", "展示模式不能簽署 TOCC。", 403);
    if (!["clients.read", "health.write"].every((scope) => actor.scopes.includes(scope))) {
      throw new IntegrationError("TOCC_DRAFT_SIGN_FORBIDDEN", "目前角色沒有 TOCC 簽署權限。", 403);
    }
    await requireRecentAal2(actor);
    const input = parseToccDraftSignInput(
      await readJsonObject(request, 8 * 1024), request.headers.get("idempotency-key"));
    const db = await createServerSupabaseClient();
    if (!db) throw databaseFailure("SERVICE_NOT_CONFIGURED", "TOCC 簽署服務尚未設定。", 503);
    const { data, error } = await db.rpc("sign_client_tocc_draft", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_draft_key: input.draft_key,
      p_expected_version_id: input.expected_version_id,
      p_expected_version: input.expected_version,
      p_expected_content_hash: input.expected_content_hash,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw failure(error.code);
    const receipt = parseToccDraftSignReceipt(data, input);
    return ok(receipt, receipt.replayed ? 200 : 201, requestId);
  });
}
