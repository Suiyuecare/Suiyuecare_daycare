import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, databaseFailure, handleIntegrationRoute,
  readJsonObject, requireRecentAal2 } from "@/lib/integrations/http";
import { deterministicUuid } from "@/lib/integrations/security";
import { clientVaccinationSaveFailure } from "@/lib/client-vaccinations/errors";
import { CLIENT_VACCINATION_BATCH_MAX_BYTES,
  parseClientVaccinationBatchInput,
  parseClientVaccinationBatchDatabaseReceipt } from "@/lib/client-vaccinations/parser";
import type { ClientVaccinationRecordInput } from "@/lib/client-vaccinations/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function databaseRecord(item: ClientVaccinationRecordInput) {
  if (item.action !== "create") throw new IntegrationError(
    "INVALID_CLIENT_VACCINATION_RECORD", "疫苗批次只接受新增紀錄。", 400,
  );
  return {
    action: item.action, vaccination_key: item.vaccinationKey,
    previous_version_id: null, expected_base_version: 0,
    client_id: item.clientId, vaccine_name: item.vaccineName,
    dose_number: item.doseNumber, vaccinated_on: item.vaccinatedOn,
    lot_number: item.lotNumber, provider_name: item.providerName,
    evidence_status: item.evidenceStatus, evidence_reference_id: null,
    evidence_sha256: null, evidence_file_name: null,
    source_system: "manual_entry", source_record_id: null,
    correction_reason: null,
  };
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError(
      "DEMO_READ_ONLY", "展示模式不會執行疫苗批次登錄。", 403,
    );
    if (actor.assuranceLevel !== "aal2" ||
      ["clients.read", "client_vaccinations.read", "client_vaccinations.manage"]
        .some((scope) => !actor.scopes.includes(scope))) {
      throw new IntegrationError("CLIENT_VACCINATION_NOT_AUTHORIZED",
        "目前登入保證等級或角色沒有個案疫苗批次登錄權限。", 403);
    }
    await requireRecentAal2(actor);
    const input = parseClientVaccinationBatchInput(
      await readJsonObject(request, CLIENT_VACCINATION_BATCH_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure(
      "SERVICE_NOT_CONFIGURED", "正式個案疫苗資料服務尚未設定。", 503,
    );
    const scopedItemKeys = input.items.map((item) => deterministicUuid(
      "page23-client-vaccination-record", actor.organizationId, actor.userId,
      item.idempotencyKey,
    ));
    const scopedBatchKey = deterministicUuid("page23-client-vaccination-batch",
      actor.organizationId, actor.userId, input.batchIdempotencyKey);
    const { data, error } = await supabase.rpc("append_client_vaccination_batch", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_items: input.items.map((item, index) => ({
        idempotency_key: scopedItemKeys[index], record: databaseRecord(item),
      })),
      p_batch_idempotency_key: scopedBatchKey,
    }).maybeSingle();
    if (error || !data) throw clientVaccinationSaveFailure(error?.code);
    const receipt = parseClientVaccinationBatchDatabaseReceipt(data, input,
      scopedItemKeys, scopedBatchKey, actor.organizationId, actor.branchId);
    return ok(receipt, 200, requestId);
  });
}
