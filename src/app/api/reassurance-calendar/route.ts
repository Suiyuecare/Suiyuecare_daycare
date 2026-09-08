import { ok } from "@/lib/api/response";
import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
  requireRecentAal2,
} from "@/lib/integrations/http";
import {
  correlateReassuranceCalendarReceipt,
  parseReassuranceCalendarDatabaseReceipt,
  parseReassuranceCalendarMutation,
} from "@/lib/reassurance-calendar/parser";
import type { ReassuranceCalendarMutationInput } from "@/lib/reassurance-calendar/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function databaseWriteFailure(code?: string) {
  if (code === "42501") return databaseFailure(
    "REASSURANCE_CALENDAR_NOT_AUTHORIZED",
    "目前角色、機構、分支、對象範圍或近期雙因素驗證不允許這項操作。", 403,
  );
  if (code === "40001") return databaseFailure(
    "REASSURANCE_CALENDAR_VERSION_CONFLICT",
    "這筆行程已有新版本或對象範圍已改變；請重新載入後再操作。", 409,
  );
  if (code === "23505") return databaseFailure(
    "REASSURANCE_CALENDAR_IDEMPOTENCY_CONFLICT",
    "相同操作鍵曾用於不同內容；請保留資料並重新載入。", 409,
  );
  if (["22023", "22P02", "23503", "23514"].includes(code ?? "")) {
    return databaseFailure(
      "INVALID_REASSURANCE_CALENDAR_STATE",
      "行程、時間、對象、負責人、版本或取消理由未通過驗證。", 400,
    );
  }
  return databaseFailure(
    "REASSURANCE_CALENDAR_SAVE_FAILED",
    "操作結果尚未確認；請保留內容並以相同操作鍵重試。", 409,
  );
}

async function authorizeBase() {
  const actor = await authorizeStaffRequest();
  if (actor.demo) throw new IntegrationError(
    "DEMO_READ_ONLY", "展示模式只顯示合成行事曆，不會寫入或假裝成功。", 403,
  );
  if (!actor.scopes.includes("reassurance_calendar.read")) {
    throw new IntegrationError(
      "REASSURANCE_CALENDAR_NOT_AUTHORIZED", "目前角色沒有安心行事曆讀取權限。", 403,
    );
  }
  await requireRecentAal2(actor);
  return actor;
}

function authorizeAction(actor: TenantContext, input: ReassuranceCalendarMutationInput) {
  const permission = input.action === "cancel"
    ? "reassurance_calendar.cancel" : "reassurance_calendar.manage";
  if (!actor.scopes.includes(permission)) throw new IntegrationError(
    "REASSURANCE_CALENDAR_NOT_AUTHORIZED", "目前角色沒有這項行事曆操作權限。", 403,
  );
}

async function execute(input: ReassuranceCalendarMutationInput, actor: TenantContext) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure(
    "SERVICE_NOT_CONFIGURED", "正式安心行事曆資料服務尚未設定。", 503,
  );
  const { data, error } = await supabase.rpc("mutate_reassurance_calendar_event", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_action: input.action,
    p_event_key: input.eventKey,
    p_previous_version_id: input.previousVersionId,
    p_expected_version: input.expectedVersion,
    p_category: input.category,
    p_title: input.title,
    p_summary: input.summary,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_location: input.location,
    p_audience_kind: input.audienceKind,
    p_target_client_ids: input.targetClientIds,
    p_responsible_user_id: input.responsibleUserId,
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle();
  if (error || !data) throw databaseWriteFailure(error?.code);
  return correlateReassuranceCalendarReceipt(
    parseReassuranceCalendarDatabaseReceipt(data), input,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    // Establish the actor and recent AAL2 before body validation can become an oracle.
    const actor = await authorizeBase();
    const input = parseReassuranceCalendarMutation(
      await readJsonObject(request, 32 * 1024),
      request.headers.get("idempotency-key"),
    );
    authorizeAction(actor, input);
    const receipt = await execute(input, actor);
    return ok({
      operationId: receipt.operation_id,
      operationKind: receipt.operation_kind,
      eventKey: receipt.event_key,
      versionId: receipt.version_id,
      eventVersion: receipt.event_version,
      previousVersionId: receipt.previous_version_id,
      recordKind: receipt.record_kind,
      eventStatus: receipt.event_status,
      eventCategory: receipt.event_category,
      audienceCount: receipt.audience_count,
      publicationState: receipt.publication_state,
      signatureStatus: receipt.signature_status,
      notificationStatus: receipt.notification_status,
      notificationDelivery: receipt.notification_delivery,
      committedAt: receipt.committed_at,
      replayed: receipt.replayed,
      persisted: true as const,
      demo: false as const,
    }, receipt.replayed ? 200 : 201, requestId);
  });
}
