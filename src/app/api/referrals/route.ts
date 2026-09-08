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
  correlateReferralManagementReceipt,
  parseReferralManagementDatabaseReceipt,
  parseReferralManagementMutation,
} from "@/lib/referral-management/parser";
import type { ReferralManagementMutationInput } from "@/lib/referral-management/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function databaseWriteFailure(code?: string) {
  if (code === "42501") return databaseFailure(
    "REFERRAL_MANAGEMENT_NOT_AUTHORIZED",
    "目前角色、機構、分支、個案指派或近期雙因素驗證不允許這項操作。", 403,
  );
  if (code === "40001") return databaseFailure(
    "REFERRAL_MANAGEMENT_SEQUENCE_CONFLICT",
    "轉介已有新的事件、狀態或人員範圍；請重新載入後再操作。", 409,
  );
  if (code === "23505") return databaseFailure(
    "REFERRAL_MANAGEMENT_IDEMPOTENCY_CONFLICT",
    "相同操作鍵曾用於不同內容；請保留資料並重新載入。", 409,
  );
  if (["22023", "22P02", "23503", "23514"].includes(code ?? "")) {
    return databaseFailure(
      "INVALID_REFERRAL_MANAGEMENT_STATE",
      "轉介內容、接收單位、線性狀態、回覆或更正目標未通過驗證。", 400,
    );
  }
  return databaseFailure(
    "REFERRAL_MANAGEMENT_SAVE_FAILED",
    "操作結果尚未確認；請保留內容並以相同操作鍵重試。", 409,
  );
}

async function authorizeBase() {
  const actor = await authorizeStaffRequest();
  if (actor.demo) throw new IntegrationError(
    "DEMO_READ_ONLY", "展示模式只顯示合成轉介，不會寫入或假裝成功。", 403,
  );
  if (
    !actor.scopes.includes("clients.read") ||
    !actor.scopes.includes("referral_management.read")
  ) {
    throw new IntegrationError(
      "REFERRAL_MANAGEMENT_NOT_AUTHORIZED", "目前角色沒有個案及轉介管理讀取權限。", 403,
    );
  }
  return actor;
}

async function authorizeAction(
  actor: TenantContext, input: ReferralManagementMutationInput,
) {
  const permission = input.action === "create" ? "referral_management.create"
    : input.action === "submit" ? "referral_management.submit"
      : input.action === "register_received" ? "referral_management.receive"
        : input.action === "respond" ? "referral_management.respond"
          : input.action === "close" ? "referral_management.close"
            : "referral_management.correct";
  if (!actor.scopes.includes(permission)) throw new IntegrationError(
    "REFERRAL_MANAGEMENT_NOT_AUTHORIZED", "目前角色沒有這項轉介操作權限。", 403,
  );
  await requireRecentAal2(actor);
}

async function execute(input: ReferralManagementMutationInput, actor: TenantContext) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure(
    "SERVICE_NOT_CONFIGURED", "正式轉介管理資料服務尚未設定。", 503,
  );
  const { data, error } = await supabase.rpc("mutate_referral_management", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_action: input.action,
    p_referral_key: input.referralKey,
    p_previous_event_id: input.previousEventId,
    p_expected_sequence: input.expectedSequence,
    p_client_id: input.clientId,
    p_receiving_unit_state: input.receivingUnitState,
    p_receiving_unit_code: input.receivingUnitCode,
    p_receiving_unit_name: input.receivingUnitName,
    p_referral_date: input.referralDate,
    p_referral_reason: input.referralReason,
    p_entry_content: input.entryContent,
    p_correction_reason: input.correctionReason,
    p_corrects_event_id: input.correctsEventId,
    p_idempotency_key: input.idempotencyKey,
  }).maybeSingle();
  if (error || !data) throw databaseWriteFailure(error?.code);
  return correlateReferralManagementReceipt(
    parseReferralManagementDatabaseReceipt(data), input,
    actor.organizationId, actor.branchId,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeBase();
    const input = parseReferralManagementMutation(
      await readJsonObject(request, 32 * 1024), request.headers.get("idempotency-key"),
    );
    await authorizeAction(actor, input);
    const receipt = await execute(input, actor);
    return ok({
      organizationId: receipt.organization_id,
      branchId: receipt.branch_id,
      operationId: receipt.operation_id,
      operationKind: receipt.operation_kind,
      referralKey: receipt.referral_key,
      eventId: receipt.event_id,
      eventSequence: receipt.event_sequence,
      previousEventId: receipt.previous_event_id,
      eventKind: receipt.event_kind,
      referralStatus: receipt.referral_status,
      receivingUnitState: receipt.receiving_unit_state,
      notificationCount: receipt.notification_count,
      notificationQueueStatus: receipt.notification_queue_status,
      notificationProviderStatus: receipt.notification_provider_status,
      externalDeliveryStatus: receipt.external_delivery_status,
      deliveryClaim: receipt.delivery_claim,
      attachmentStatus: receipt.attachment_status,
      exportStatus: receipt.export_status,
      committedAt: receipt.committed_at,
      replayed: receipt.replayed,
      persisted: true as const,
      demo: false as const,
    }, receipt.replayed ? 200 : 201, requestId);
  });
}
