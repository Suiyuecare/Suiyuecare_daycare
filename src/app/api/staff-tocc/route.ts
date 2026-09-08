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
  parseStaffToccRecordInput,
  parseStaffToccRecordReceipt,
  STAFF_TOCC_RECORD_MAX_BYTES,
} from "@/lib/staff-tocc/parser";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function saveFailure(code: string | undefined) {
  if (code === "42501") return databaseFailure(
    "STAFF_TOCC_NOT_AUTHORIZED",
    "目前角色、分支、人員範圍或登入保證等級不允許保存員工 TOCC 資料。", 403,
  );
  if (code === "23505") return databaseFailure(
    "STAFF_TOCC_IDEMPOTENCY_CONFLICT",
    "相同操作鍵已用於不同內容，或員工 TOCC 紀錄識別已存在。", 409,
  );
  if (["23514", "40001"].includes(code ?? "")) return databaseFailure(
    "STAFF_TOCC_VERSION_CONFLICT",
    "員工 TOCC 紀錄版本或人員狀態已變更；請重新載入。", 409,
  );
  if (["22023", "22P02"].includes(code ?? "")) return databaseFailure(
    "INVALID_STAFF_TOCC_RECORD",
    "員工、日期、人工效期來源、結果、警示、證明、處置或更正資料未通過驗證。", 400,
  );
  return databaseFailure(
    "STAFF_TOCC_SAVE_UNCERTAIN",
    "員工 TOCC 紀錄未確認完成；請保留相同操作鍵重試。", 409,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError(
      "DEMO_READ_ONLY", "展示模式只能檢視合成員工 TOCC 資料，不會保存內容。", 403,
    );
    if (actor.assuranceLevel !== "aal2" ||
      !actor.scopes.includes("staff_tocc.read") ||
      !actor.scopes.includes("staff_tocc.manage")) throw new IntegrationError(
      "STAFF_TOCC_NOT_AUTHORIZED",
      "目前登入保證等級或角色沒有獨立員工 TOCC 管理權限。", 403,
    );
    const input = parseStaffToccRecordInput(
      await readJsonObject(request, STAFF_TOCC_RECORD_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure(
      "SERVICE_NOT_CONFIGURED", "正式員工 TOCC 資料服務尚未設定。", 503,
    );
    const { data, error } = await supabase.rpc("append_staff_tocc", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_action: input.action,
      p_tocc_key: input.toccKey,
      p_previous_version_id: input.previousVersionId,
      p_expected_base_version: input.expectedBaseVersion,
      p_staff_membership_id: input.staffMembershipId,
      p_assessed_on: input.assessedOn,
      p_valid_through: input.validThrough,
      p_validity_source: input.validitySource,
      p_result_text: input.resultText,
      p_manual_attention_flag: input.manualAttentionFlag,
      p_attention_note: input.attentionNote,
      p_evidence_status: input.evidenceStatus,
      p_attachment_reference: input.attachmentReference,
      p_attachment_sha256: input.attachmentSha256,
      p_disposition_status: input.dispositionStatus,
      p_disposition_note: input.dispositionNote,
      p_correction_reason: input.correctionReason,
      p_idempotency_key: deterministicUuid(
        "page74-staff-tocc-record", actor.organizationId, actor.userId,
        input.idempotencyKey,
      ),
    }).maybeSingle();
    if (error || !data) throw saveFailure(error?.code);
    const receipt = parseStaffToccRecordReceipt(
      data, input, actor.organizationId, actor.branchId,
    );
    return ok({ receipt, persisted: true, demo: false },
      receipt.replayed ? 200 : 201, requestId);
  });
}
