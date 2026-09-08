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
  parseStaffCertificateRecordInput,
  parseStaffCertificateRecordReceipt,
  STAFF_CERTIFICATE_RECORD_MAX_BYTES,
} from "@/lib/staff-certificates/parser";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function saveFailure(code: string | undefined) {
  if (code === "42501") return databaseFailure(
    "STAFF_CERTIFICATE_NOT_AUTHORIZED",
    "目前角色、分支、人員範圍或登入保證等級不允許保存此證照。", 403,
  );
  if (code === "23505") return databaseFailure(
    "STAFF_CERTIFICATE_IDEMPOTENCY_CONFLICT",
    "相同操作鍵已用於不同的證照內容。", 409,
  );
  if (["23514", "40001"].includes(code ?? "")) return databaseFailure(
    "STAFF_CERTIFICATE_VERSION_CONFLICT",
    "證照版本或人員狀態已變更；請重新載入。", 409,
  );
  if (["22023", "22P02"].includes(code ?? "")) return databaseFailure(
    "INVALID_STAFF_CERTIFICATE_RECORD",
    "證照類型、證號、日期、登錄、核驗或更正資料未通過驗證。", 400,
  );
  return databaseFailure(
    "STAFF_CERTIFICATE_SAVE_UNCERTAIN",
    "證照紀錄未確認完成；請保留相同操作鍵重試。", 409,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError(
      "DEMO_READ_ONLY", "展示模式只能檢視合成證照，不會保存資料。", 403,
    );
    if (!actor.scopes.includes("staff_certificates.read") ||
      !actor.scopes.includes("staff_certificates.manage")) throw new IntegrationError(
      "STAFF_CERTIFICATE_NOT_AUTHORIZED", "目前角色沒有員工證照管理權限。", 403,
    );
    const input = parseStaffCertificateRecordInput(
      await readJsonObject(request, STAFF_CERTIFICATE_RECORD_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure(
      "SERVICE_NOT_CONFIGURED", "正式員工證照資料服務尚未設定。", 503,
    );
    const { data, error } = await supabase.rpc("append_staff_certificate", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_action: input.action, p_certificate_key: input.certificateKey,
      p_previous_version_id: input.previousVersionId,
      p_expected_base_version: input.expectedBaseVersion,
      p_staff_membership_id: input.staffMembershipId,
      p_certificate_type: input.certificateType,
      p_certificate_number: input.certificateNumber,
      p_effective_on: input.effectiveOn, p_expires_on: input.expiresOn,
      p_registration_status: input.registrationStatus,
      p_verification_status: input.verificationStatus,
      p_evidence_status: input.evidenceStatus,
      p_attachment_reference: input.attachmentReference,
      p_attachment_sha256: input.attachmentSha256,
      p_correction_reason: input.correctionReason,
      p_idempotency_key: deterministicUuid(
        "page72-staff-certificate-record", actor.organizationId,
        actor.userId, input.idempotencyKey,
      ),
    }).maybeSingle();
    if (error || !data) throw saveFailure(error?.code);
    const receipt = parseStaffCertificateRecordReceipt(
      data, input, actor.organizationId, actor.branchId,
    );
    return ok({ receipt, persisted: true, demo: false },
      receipt.replayed ? 200 : 201, requestId);
  });
}
