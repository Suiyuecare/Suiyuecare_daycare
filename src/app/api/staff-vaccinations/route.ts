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
  parseStaffVaccinationRecordInput,
  parseStaffVaccinationRecordReceipt,
  STAFF_VACCINATION_RECORD_MAX_BYTES,
} from "@/lib/staff-vaccinations/parser";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function saveFailure(code: string | undefined) {
  if (code === "42501") return databaseFailure(
    "STAFF_HEALTH_NOT_AUTHORIZED",
    "目前角色、分支、人員範圍或登入保證等級不允許保存員工疫苗資料。", 403,
  );
  if (code === "23505") return databaseFailure(
    "STAFF_VACCINATION_IDEMPOTENCY_CONFLICT",
    "相同操作鍵已用於不同內容，或疫苗紀錄識別已存在。", 409,
  );
  if (["23514", "40001"].includes(code ?? "")) return databaseFailure(
    "STAFF_VACCINATION_VERSION_CONFLICT",
    "疫苗紀錄版本或人員狀態已變更；請重新載入。", 409,
  );
  if (["22023", "22P02"].includes(code ?? "")) return databaseFailure(
    "INVALID_STAFF_VACCINATION_RECORD",
    "員工、疫苗名稱、劑次、日期、批號、院所、證明或更正資料未通過驗證。", 400,
  );
  return databaseFailure(
    "STAFF_VACCINATION_SAVE_UNCERTAIN",
    "員工疫苗紀錄未確認完成；請保留相同操作鍵重試。", 409,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError(
      "DEMO_READ_ONLY", "展示模式只能檢視合成疫苗資料，不會保存內容。", 403,
    );
    if (actor.assuranceLevel !== "aal2" ||
      !actor.scopes.includes("staff_health.read") ||
      !actor.scopes.includes("staff_health.manage")) throw new IntegrationError(
      "STAFF_HEALTH_NOT_AUTHORIZED",
      "目前登入保證等級或角色沒有員工健康資料管理權限。", 403,
    );
    const input = parseStaffVaccinationRecordInput(
      await readJsonObject(request, STAFF_VACCINATION_RECORD_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure(
      "SERVICE_NOT_CONFIGURED", "正式員工疫苗資料服務尚未設定。", 503,
    );
    const { data, error } = await supabase.rpc("append_staff_vaccination", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_action: input.action,
      p_vaccination_key: input.vaccinationKey,
      p_previous_version_id: input.previousVersionId,
      p_expected_base_version: input.expectedBaseVersion,
      p_staff_membership_id: input.staffMembershipId,
      p_vaccine_name: input.vaccineName,
      p_dose_number: input.doseNumber,
      p_vaccinated_on: input.vaccinatedOn,
      p_lot_number: input.lotNumber,
      p_provider_name: input.providerName,
      p_evidence_status: input.evidenceStatus,
      p_attachment_reference: input.attachmentReference,
      p_attachment_sha256: input.attachmentSha256,
      p_correction_reason: input.correctionReason,
      p_idempotency_key: deterministicUuid(
        "page73-staff-vaccination-record",
        actor.organizationId,
        actor.userId,
        input.idempotencyKey,
      ),
    }).maybeSingle();
    if (error || !data) throw saveFailure(error?.code);
    const receipt = parseStaffVaccinationRecordReceipt(
      data, input, actor.organizationId, actor.branchId,
    );
    return ok({ receipt, persisted: true, demo: false },
      receipt.replayed ? 200 : 201, requestId);
  });
}
