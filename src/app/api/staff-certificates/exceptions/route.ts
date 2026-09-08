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
  parseStaffCertificateExceptionInput,
  parseStaffCertificateExceptionReceipt,
  STAFF_CERTIFICATE_EXCEPTION_MAX_BYTES,
} from "@/lib/staff-certificates/parser";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function saveFailure(code: string | undefined) {
  if (code === "42501") return databaseFailure(
    "STAFF_CERTIFICATE_EXCEPTION_NOT_AUTHORIZED",
    "例外需要近期 15 分鐘 AAL2、有效權限與獨立覆核人；申請人不得自批。", 403,
  );
  if (code === "23505") return databaseFailure(
    "STAFF_CERTIFICATE_EXCEPTION_IDEMPOTENCY_CONFLICT",
    "相同操作鍵已用於不同的證照例外操作。", 409,
  );
  if (["23514", "40001"].includes(code ?? "")) return databaseFailure(
    "STAFF_CERTIFICATE_EXCEPTION_VERSION_CONFLICT",
    "證照版本或核准人數已變更；請重新載入。", 409,
  );
  if (["22023", "22P02"].includes(code ?? "")) return databaseFailure(
    "INVALID_STAFF_CERTIFICATE_EXCEPTION",
    "例外必須有完整理由、有限起訖日期與正確基準版本。", 400,
  );
  return databaseFailure(
    "STAFF_CERTIFICATE_EXCEPTION_SAVE_UNCERTAIN",
    "例外結果未確認完成；請保留相同操作鍵重試。", 409,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError(
      "DEMO_READ_ONLY", "展示模式只能檢視合成例外，不會送出核准。", 403,
    );
    if (!actor.scopes.includes("staff_certificates.read") ||
      !actor.scopes.includes("staff_certificates.exceptions")) throw new IntegrationError(
      "STAFF_CERTIFICATE_EXCEPTION_NOT_AUTHORIZED",
      "目前角色沒有證照例外管理權限。", 403,
    );
    await requireRecentAal2(actor);
    const input = parseStaffCertificateExceptionInput(
      await readJsonObject(request, STAFF_CERTIFICATE_EXCEPTION_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure(
      "SERVICE_NOT_CONFIGURED", "正式員工證照資料服務尚未設定。", 503,
    );
    const key = deterministicUuid(
      "page72-staff-certificate-exception", actor.organizationId,
      actor.userId, input.idempotencyKey,
    );
    const result = input.action === "request"
      ? await supabase.rpc("request_staff_certificate_exception", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_certificate_key: input.certificateKey,
        p_certificate_version_id: input.certificateVersionId,
        p_expected_certificate_version: input.expectedCertificateVersion,
        p_valid_from: input.validFrom, p_valid_through: input.validThrough,
        p_reason: input.reason, p_idempotency_key: key,
      }).maybeSingle()
      : await supabase.rpc("approve_staff_certificate_exception", {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_request_id: input.requestId,
        p_expected_certificate_version: input.expectedCertificateVersion,
        p_expected_approval_count: input.expectedApprovalCount,
        p_idempotency_key: key,
      }).maybeSingle();
    if (result.error || !result.data) throw saveFailure(result.error?.code);
    const receipt = parseStaffCertificateExceptionReceipt(
      result.data, input, actor.organizationId, actor.branchId,
    );
    return ok({ receipt, persisted: true, demo: false },
      receipt.replayed ? 200 : 201, requestId);
  });
}
