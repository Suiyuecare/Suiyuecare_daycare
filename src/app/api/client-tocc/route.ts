import { ok } from "@/lib/api/response";
import {
  CLIENT_TOCC_SINGLE_MAX_BYTES,
  parseClientToccSingleInput,
  parseClientToccSingleResult,
} from "@/lib/integrations/client-tocc";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
  requireRecentAal2,
} from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function writeFailure(code: string | undefined) {
  if (code === "42501") {
    return databaseFailure(
      "CLIENT_TOCC_NOT_AUTHORIZED",
      "目前角色、分支、個案指派或 AAL2 證據不允許新增 TOCC 評估。",
      403,
    );
  }
  if (code === "23505") {
    return databaseFailure(
      "CLIENT_TOCC_IDEMPOTENCY_CONFLICT",
      "相同 UUID 冪等鍵曾用於不同的 TOCC 內容。",
      409,
    );
  }
  if (["22023", "22007", "22P02", "23514"].includes(code ?? "")) {
    return databaseFailure(
      "INVALID_CLIENT_TOCC",
      "TOCC 日期、結果、摘要、證明或處置狀態不符合規則。",
      400,
    );
  }
  return databaseFailure(
    "CLIENT_TOCC_SAVE_FAILED",
    "TOCC 評估未確認儲存；請保留內容並以相同 UUID 冪等鍵重試。",
    409,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) {
      throw new IntegrationError(
        "DEMO_WRITE_DISABLED",
        "展示模式只提供合成資料檢視，TOCC 寫入不會執行或持久化。",
        403,
      );
    }
    if (
      !actor.scopes.includes("clients.read") ||
      !actor.scopes.includes("health.write")
    ) {
      throw new IntegrationError(
        "CLIENT_TOCC_NOT_AUTHORIZED",
        "目前角色沒有新增 TOCC 評估的權限。",
        403,
      );
    }
    await requireRecentAal2(actor);
    const input = parseClientToccSingleInput(
      await readJsonObject(request, CLIENT_TOCC_SINGLE_MAX_BYTES),
      request.headers.get("idempotency-key"),
      new Date(),
    );

    const supabase = await createServerSupabaseClient();
    if (!supabase) {
      throw databaseFailure(
        "SERVICE_NOT_CONFIGURED",
        "正式 TOCC 服務尚未設定。",
        503,
      );
    }
    const { data, error } = await supabase.rpc(
      "record_client_tocc_assessment",
      {
        p_expected_organization_id: actor.organizationId,
        p_expected_branch_id: actor.branchId,
        p_client_id: input.clientId,
        p_assessment_date: input.assessmentDate,
        p_result_status: input.resultStatus,
        p_symptom_summary: input.symptomSummary,
        p_risk_summary: input.riskSummary,
        p_evidence_status: input.evidenceStatus,
        p_action_status: input.actionStatus,
        p_idempotency_key: input.idempotencyKey,
      },
    );
    if (error) throw writeFailure(error.code);

    const result = parseClientToccSingleResult(data, input);
    return ok(result, result.replayed ? 200 : 201, requestId);
  });
}

