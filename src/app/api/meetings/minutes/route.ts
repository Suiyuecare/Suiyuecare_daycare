import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
  requireRecentAal2,
} from "@/lib/integrations/http";
import { deterministicUuid } from "@/lib/integrations/security";
import {
  MEETING_MINUTE_MAX_BYTES,
  parseMeetingMinuteInput,
  parseMeetingMinuteReceipt,
} from "@/lib/meetings/parser";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function saveFailure(code: string | undefined) {
  if (code === "42501") return databaseFailure(
    "MEETING_MINUTE_NOT_AUTHORIZED",
    "目前角色、分支、人員範圍或近期雙因素驗證不允許簽署此會議紀錄。",
    403,
  );
  if (code === "23505") return databaseFailure(
    "MEETING_MINUTE_IDEMPOTENCY_CONFLICT",
    "相同操作鍵已用於不同的會議內容。",
    409,
  );
  if (["23514", "40001"].includes(code ?? "")) return databaseFailure(
    "MEETING_MINUTE_VERSION_CONFLICT",
    "會議版本或既有行動已變更；請重新載入後建立更正版。",
    409,
  );
  if (["22023", "22P02"].includes(code ?? "")) return databaseFailure(
    "INVALID_MEETING_MINUTES",
    "會議時間、出席者、議程、決議或行動未通過驗證。",
    400,
  );
  return databaseFailure(
    "MEETING_MINUTE_SAVE_UNCERTAIN",
    "會議簽署未確認完成；請保留相同操作鍵重試。",
    409,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    // Identity, tenant, branch, demo, permissions and fresh AAL2 are checked
    // before reading any potentially sensitive meeting body.
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError(
      "DEMO_READ_ONLY",
      "展示模式只提供合成會議檢視，不會簽署或建立更正版。",
      403,
    );
    if (
      !actor.scopes.includes("meetings.read") ||
      !actor.scopes.includes("meetings.manage") ||
      !actor.scopes.includes("meetings.sign")
    ) throw new IntegrationError(
      "MEETING_MINUTE_NOT_AUTHORIZED",
      "目前角色沒有簽署會議紀錄的權限。",
      403,
    );
    await requireRecentAal2(actor);

    const input = parseMeetingMinuteInput(
      await readJsonObject(request, MEETING_MINUTE_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure(
      "SERVICE_NOT_CONFIGURED",
      "正式會議資料服務尚未設定。",
      503,
    );
    const { data, error } = await supabase.rpc("record_signed_meeting_minutes", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_meeting_key: input.meetingKey,
      p_previous_version_id: input.previousVersionId,
      p_correction_reason: input.correctionReason,
      p_meeting_type: input.meetingType,
      p_title: input.title,
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_staff_attendee_user_ids: input.staffAttendeeUserIds,
      p_external_attendee_names: input.externalAttendeeNames,
      p_agenda_items: input.agendaItems.map((item) => ({
        item_id: item.itemId, item_order: item.itemOrder, topic: item.topic,
      })),
      p_decisions: input.decisions.map((item) => ({
        decision_id: item.decisionId, item_order: item.itemOrder,
        decision: item.decision,
      })),
      p_action_items: input.actionItems.map((item) => ({
        action_id: item.actionId, item_order: item.itemOrder, action: item.action,
        responsible_user_id: item.responsibleUserId, due_date: item.dueDate,
      })),
      p_idempotency_key: deterministicUuid(
        "page75-meeting-minute", actor.organizationId, actor.userId,
        input.idempotencyKey,
      ),
    }).maybeSingle();
    if (error || !data) throw saveFailure(error?.code);
    const receipt = parseMeetingMinuteReceipt(data, input);
    return ok(
      { receipt, persisted: true, demo: false },
      receipt.replayed ? 200 : 201,
      requestId,
    );
  });
}
