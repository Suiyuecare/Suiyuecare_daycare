import { ok } from "@/lib/api/response";
import {
  HAND_HYGIENE_CORRECTION_MAX_BYTES,
  parseHandHygieneCorrectionInput,
  parseHandHygieneDatabaseReceipt,
} from "@/lib/hand-hygiene/parser";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
} from "@/lib/integrations/http";
import { deterministicUuid } from "@/lib/integrations/security";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function writeFailure(code?: string) {
  if (code === "42501") return databaseFailure(
    "HAND_HYGIENE_NOT_AUTHORIZED",
    "目前角色、分支、員工範圍或登入保證等級不允許修正這筆事件。",
    403,
  );
  if (code === "23505") return databaseFailure(
    "HAND_HYGIENE_IDEMPOTENCY_CONFLICT",
    "相同操作鍵曾用於不同修正內容；請重新載入。",
    409,
  );
  if (code === "40001") return databaseFailure(
    "HAND_HYGIENE_VERSION_CONFLICT",
    "事件配對已被其他人更新；請重新載入後再確認。",
    409,
  );
  if (["22023", "22P02", "23503", "23514"].includes(code ?? "")) {
    return databaseFailure(
      "INVALID_HAND_HYGIENE_CORRECTION",
      "配對狀態、員工、事件或修正理由未通過驗證。",
      400,
    );
  }
  return databaseFailure(
    "HAND_HYGIENE_SAVE_UNCERTAIN",
    "修正結果尚未確認；請保留內容並使用相同操作鍵重試。",
    409,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError(
      "DEMO_READ_ONLY",
      "展示模式只顯示合成設備事件，不會保存修正。",
      403,
    );
    if (!actor.scopes.includes("hand_hygiene.read") ||
        !actor.scopes.includes("hand_hygiene.manage")) throw new IntegrationError(
      "HAND_HYGIENE_NOT_AUTHORIZED",
      "目前角色沒有洗手事件修正權限。",
      403,
    );
    const input = parseHandHygieneCorrectionInput(
      await readJsonObject(request, HAND_HYGIENE_CORRECTION_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure(
      "SERVICE_NOT_CONFIGURED",
      "正式洗手管理資料服務尚未設定。",
      503,
    );
    const { data, error } = await supabase.rpc("correct_hand_hygiene_match", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_event_id: input.eventId,
      p_expected_correction_sequence: input.expectedCorrectionSequence,
      p_match_status: input.matchStatus,
      p_staff_membership_id: input.staffMembershipId,
      p_reason: input.reason,
      p_idempotency_key: deterministicUuid(
        "page66-hand-hygiene-correction",
        actor.organizationId,
        actor.userId,
        input.idempotencyKey,
      ),
    }).maybeSingle();
    if (error || !data) throw writeFailure(error?.code);
    const receipt = parseHandHygieneDatabaseReceipt(
      data,
      input,
      actor.organizationId,
      actor.branchId,
    );
    return ok({
      ...receipt,
      organizationId: actor.organizationId,
      branchId: actor.branchId,
    }, receipt.replayed ? 200 : 201, requestId);
  });
}
