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
  parseStaffLabReportRecordInput,
  parseStaffLabReportRecordReceipt,
  STAFF_LAB_REPORT_RECORD_MAX_BYTES,
} from "@/lib/staff-lab-reports/parser";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function saveFailure(code: string | undefined) {
  if (code === "42501") return databaseFailure(
    "STAFF_LAB_REPORT_NOT_AUTHORIZED",
    "目前角色、分支、人員範圍或近期雙重驗證不允許保存員工檢驗報告。", 403,
  );
  if (code === "23505") return databaseFailure(
    "STAFF_LAB_REPORT_IDEMPOTENCY_CONFLICT",
    "相同操作鍵已用於不同內容，或檢驗報告識別已存在。", 409,
  );
  if (["23514", "40001"].includes(code ?? "")) return databaseFailure(
    "STAFF_LAB_REPORT_VERSION_CONFLICT",
    "員工檢驗報告版本或人員狀態已變更；請重新載入。", 409,
  );
  if (["22023", "22P02"].includes(code ?? "")) return databaseFailure(
    "INVALID_STAFF_LAB_REPORT_RECORD",
    "員工、檢驗、日期、人工效期、證明或更正資料未通過驗證。", 400,
  );
  return databaseFailure(
    "STAFF_LAB_REPORT_SAVE_UNCERTAIN",
    "檢驗報告未確認完成；請保留相同操作鍵重試。", 409,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError(
      "DEMO_READ_ONLY", "展示模式只能檢視合成檢驗報告，不會保存內容。", 403,
    );
    if (actor.assuranceLevel !== "aal2" ||
      !actor.scopes.includes("staff_health.read") ||
      !actor.scopes.includes("staff_health.manage")) throw new IntegrationError(
      "STAFF_LAB_REPORT_NOT_AUTHORIZED",
      "目前登入保證等級或角色沒有獨立員工健康管理權限。", 403,
    );
    await requireRecentAal2(actor);
    const input = parseStaffLabReportRecordInput(
      await readJsonObject(request, STAFF_LAB_REPORT_RECORD_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure(
      "SERVICE_NOT_CONFIGURED", "正式員工檢驗報告服務尚未設定。", 503,
    );
    const { data, error } = await supabase.rpc("append_staff_lab_report", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_action: input.action,
      p_report_key: input.reportKey,
      p_previous_version_id: input.previousVersionId,
      p_expected_base_version: input.expectedBaseVersion,
      p_staff_membership_id: input.staffMembershipId,
      p_report_type: input.reportType,
      p_tested_on: input.testedOn,
      p_provider_name: input.providerName,
      p_result_text: input.resultText,
      p_valid_through: input.validThrough,
      p_validity_basis: input.validityBasis,
      p_evidence_status: input.evidenceStatus,
      p_attachment_reference: input.attachmentReference,
      p_attachment_sha256: input.attachmentSha256,
      p_correction_reason: input.correctionReason,
      p_idempotency_key: deterministicUuid(
        "page78-staff-lab-report-record", actor.organizationId,
        actor.userId, input.idempotencyKey,
      ),
    }).maybeSingle();
    if (error || !data) throw saveFailure(error?.code);
    const receipt = parseStaffLabReportRecordReceipt(
      data, input, actor.organizationId, actor.branchId,
    );
    return ok({ receipt, persisted: true, demo: false },
      receipt.replayed ? 200 : 201, requestId);
  });
}
