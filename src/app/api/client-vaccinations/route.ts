import { ok } from "@/lib/api/response";
import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, databaseFailure, handleIntegrationRoute,
  readJsonObject, requireRecentAal2 } from "@/lib/integrations/http";
import { deterministicUuid } from "@/lib/integrations/security";
import { CLIENT_VACCINATION_RECORD_MAX_BYTES,
  parseClientVaccinationRecordInput,
  parseClientVaccinationRecordReceipt } from "@/lib/client-vaccinations/parser";
import type { ClientVaccinationRecordInput } from "@/lib/client-vaccinations/types";
import { clientVaccinationSaveFailure } from "@/lib/client-vaccinations/errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Operation = ClientVaccinationRecordInput["action"];

function declaredOperation(request: Request): Operation {
  const value = request.headers.get("x-client-vaccination-operation");
  if (value !== "create" && value !== "correct" && value !== "void") {
    throw new IntegrationError("INVALID_CLIENT_VACCINATION_OPERATION",
      "缺少或不支援的個案疫苗受治理操作標頭。", 400,
      "x-client-vaccination-operation");
  }
  return value;
}

async function authorize(operation: Operation): Promise<TenantContext> {
  const actor = await authorizeStaffRequest();
  if (actor.demo) throw new IntegrationError(
    "DEMO_READ_ONLY", "展示模式只能檢視合成疫苗資料。", 403,
  );
  if (actor.assuranceLevel !== "aal2" ||
    ["clients.read", "client_vaccinations.read", "client_vaccinations.manage"]
      .some((scope) => !actor.scopes.includes(scope))) {
    throw new IntegrationError("CLIENT_VACCINATION_NOT_AUTHORIZED",
      "目前登入保證等級或角色沒有個案疫苗管理權限。", 403);
  }
  if (operation === "correct" || operation === "void") {
    await requireRecentAal2(actor);
  }
  return actor;
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const operation = declaredOperation(request);
    const actor = await authorize(operation);
    const input = parseClientVaccinationRecordInput(
      await readJsonObject(request, CLIENT_VACCINATION_RECORD_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    if (input.action !== operation) throw new IntegrationError(
      "INVALID_CLIENT_VACCINATION_OPERATION",
      "受治理操作標頭與疫苗紀錄內容不一致。", 400,
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure(
      "SERVICE_NOT_CONFIGURED", "正式個案疫苗資料服務尚未設定。", 503,
    );
    const { data, error } = await supabase.rpc("append_client_vaccination", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_action: input.action,
      p_vaccination_key: input.vaccinationKey,
      p_previous_version_id: input.previousVersionId,
      p_expected_base_version: input.expectedBaseVersion,
      p_client_id: input.clientId,
      p_vaccine_name: input.vaccineName,
      p_dose_number: input.doseNumber,
      p_vaccinated_on: input.vaccinatedOn,
      p_lot_number: input.lotNumber,
      p_provider_name: input.providerName,
      p_evidence_status: input.evidenceStatus,
      p_evidence_reference_id: input.evidenceReferenceId,
      p_evidence_sha256: input.evidenceSha256,
      p_evidence_file_name: input.evidenceFileName,
      p_source_system: input.sourceSystem,
      p_source_record_id: input.sourceRecordId,
      p_correction_reason: input.correctionReason,
      p_idempotency_key: deterministicUuid("page23-client-vaccination-record",
        actor.organizationId, actor.userId, input.idempotencyKey),
    }).maybeSingle();
    if (error || !data) throw clientVaccinationSaveFailure(error?.code);
    const receipt = parseClientVaccinationRecordReceipt(
      data, input, actor.organizationId, actor.branchId,
    );
    return ok({ receipt, persisted: true, demo: false },
      receipt.replayed ? 200 : 201, requestId);
  });
}
