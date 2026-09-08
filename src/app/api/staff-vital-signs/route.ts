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
  parseStaffVitalSignRecordInput,
  parseStaffVitalSignRecordReceipt,
  STAFF_VITAL_SIGN_RECORD_MAX_BYTES,
} from "@/lib/staff-vital-signs/parser";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function saveFailure(code: string | undefined) {
  if (code === "42501") return databaseFailure(
    "STAFF_VITAL_SIGN_NOT_AUTHORIZED",
    "目前角色、分支、人員範圍或近期雙重驗證不允許保存員工生命徵象。", 403,
  );
  if (code === "23505") return databaseFailure(
    "STAFF_VITAL_SIGN_IDEMPOTENCY_CONFLICT",
    "相同操作鍵已用於不同內容，或生命徵象識別已存在。", 409,
  );
  if (["23514", "40001"].includes(code ?? "")) return databaseFailure(
    "STAFF_VITAL_SIGN_VERSION_CONFLICT",
    "員工生命徵象版本或人員狀態已變更；請重新載入。", 409,
  );
  if (["22023", "22P02"].includes(code ?? "")) return databaseFailure(
    "INVALID_STAFF_VITAL_SIGN_RECORD",
    "員工、量測狀態、精確值、單位、時間、來源或更正資料未通過驗證。", 400,
  );
  return databaseFailure(
    "STAFF_VITAL_SIGN_SAVE_UNCERTAIN",
    "生命徵象未確認完成；請保留相同操作鍵重試。", 409,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError(
      "DEMO_READ_ONLY", "展示模式只能檢視合成生命徵象，不會保存內容。", 403,
    );
    if (actor.assuranceLevel !== "aal2" ||
      !actor.scopes.includes("staff_health.read") ||
      !actor.scopes.includes("staff_health.manage")) throw new IntegrationError(
      "STAFF_VITAL_SIGN_NOT_AUTHORIZED",
      "目前登入保證等級或角色沒有獨立員工健康管理權限。", 403,
    );
    // Authorization and recent-AAL2 verification deliberately happen before the
    // request body is read, so unauthorized health content is never parsed.
    await requireRecentAal2(actor);
    const input = parseStaffVitalSignRecordInput(
      await readJsonObject(request, STAFF_VITAL_SIGN_RECORD_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure(
      "SERVICE_NOT_CONFIGURED", "正式員工生命徵象服務尚未設定。", 503,
    );
    const { data, error } = await supabase.rpc("append_staff_vital_sign", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_action: input.action,
      p_vital_sign_key: input.vitalSignKey,
      p_previous_version_id: input.previousVersionId,
      p_expected_base_version: input.expectedBaseVersion,
      p_staff_membership_id: input.staffMembershipId,
      p_measurement_type: input.measurementType,
      p_value_status: input.valueStatus,
      p_value_decimal_text: input.valueDecimalText,
      p_unit: input.unit,
      p_status_reason: input.statusReason,
      p_occurred_at: input.occurredAt,
      p_source: input.source,
      p_note: input.note,
      p_correction_reason: input.correctionReason,
      p_idempotency_key: deterministicUuid(
        "page69-staff-vital-sign-record", actor.organizationId,
        actor.userId, input.idempotencyKey,
      ),
    }).maybeSingle();
    if (error || !data) throw saveFailure(error?.code);
    const receipt = parseStaffVitalSignRecordReceipt(
      data, input, actor.organizationId, actor.branchId,
    );
    return ok({ receipt, persisted: true, demo: false },
      receipt.replayed ? 200 : 201, requestId);
  });
}
