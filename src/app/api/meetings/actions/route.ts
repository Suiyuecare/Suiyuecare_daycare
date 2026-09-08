import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
} from "@/lib/integrations/http";
import { deterministicUuid } from "@/lib/integrations/security";
import {
  MEETING_ACTION_MAX_BYTES,
  parseMeetingActionUpdateInput,
  parseMeetingActionUpdateReceipt,
} from "@/lib/meetings/parser";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function saveFailure(code: string | undefined) {
  if (code === "42501") return databaseFailure(
    "MEETING_ACTION_NOT_AUTHORIZED",
    "目前角色、分支或雙因素驗證不允許更新此行動。",
    403,
  );
  if (code === "23505") return databaseFailure(
    "MEETING_ACTION_IDEMPOTENCY_CONFLICT",
    "相同操作鍵已用於不同的行動進度。",
    409,
  );
  if (["40001", "23514"].includes(code ?? "")) return databaseFailure(
    "MEETING_ACTION_VERSION_CONFLICT",
    "會議或行動進度版本已變更；請重新載入後再更新。",
    409,
  );
  if (["22023", "22P02"].includes(code ?? "")) return databaseFailure(
    "INVALID_MEETING_ACTION_UPDATE",
    "行動狀態或備註未通過驗證。",
    400,
  );
  return databaseFailure(
    "MEETING_ACTION_SAVE_UNCERTAIN",
    "行動進度未確認完成；請保留相同操作鍵重試。",
    409,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError(
      "DEMO_READ_ONLY",
      "展示模式只提供合成行動狀態，不會寫入進度。",
      403,
    );
    if (
      !actor.scopes.includes("meetings.read") ||
      !actor.scopes.includes("meetings.manage")
    ) throw new IntegrationError(
      "MEETING_ACTION_NOT_AUTHORIZED",
      "目前角色沒有更新會議行動的權限。",
      403,
    );

    const input = parseMeetingActionUpdateInput(
      await readJsonObject(request, MEETING_ACTION_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure(
      "SERVICE_NOT_CONFIGURED",
      "正式會議資料服務尚未設定。",
      503,
    );
    const { data, error } = await supabase.rpc("append_meeting_action_update", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_meeting_key: input.meetingKey,
      p_minute_version_id: input.minuteVersionId,
      p_action_id: input.actionId,
      p_expected_previous_update_id: input.expectedPreviousUpdateId,
      p_progress_status: input.progressStatus,
      p_progress_note: input.progressNote,
      p_idempotency_key: deterministicUuid(
        "page75-meeting-action", actor.organizationId, actor.userId,
        input.idempotencyKey,
      ),
    }).maybeSingle();
    if (error || !data) throw saveFailure(error?.code);
    const receipt = parseMeetingActionUpdateReceipt(data, input);
    return ok(
      { receipt, persisted: true, demo: false },
      receipt.replayed ? 200 : 201,
      requestId,
    );
  });
}
