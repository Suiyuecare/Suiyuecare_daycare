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
import { deterministicUuid } from "@/lib/integrations/security";
import {
  CLIENT_INSPECTION_REPORT_MAX_BYTES,
  clientInspectionReportRpcPayload,
  parseClientInspectionReportInput,
  parseClientInspectionReportReceipt,
} from "@/lib/client-inspection-reports/parser";
import type { ClientInspectionReportInput } from "@/lib/client-inspection-reports/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Operation = "create" | "correct" | "void";

function declaredOperation(request: Request): Operation {
  const value = request.headers.get("x-client-inspection-report-operation");
  if (!value || !["create", "correct", "void"].includes(value)) {
    throw new IntegrationError(
      "INVALID_CLIENT_INSPECTION_REPORT_OPERATION",
      "缺少或不支援的個案檢查報告受治理操作標頭。",
      400,
      "x-client-inspection-report-operation",
    );
  }
  return value as Operation;
}

async function authorize(operation: Operation): Promise<TenantContext> {
  const actor = await authorizeStaffRequest();
  if (actor.demo) throw new IntegrationError(
    "DEMO_READ_ONLY", "展示模式只能檢視合成檢查報告，不會保存資料。", 403,
  );
  if (actor.assuranceLevel !== "aal2") throw new IntegrationError(
    "AAL2_REQUIRED", "所有個案檢查報告作業都必須完成雙重驗證。", 403,
  );
  const required = ["clients.read", "health.read", "client_reports.read",
    "client_reports.manage"];
  if (required.some((permission) => !actor.scopes.includes(permission))) {
    throw new IntegrationError(
      "CLIENT_INSPECTION_REPORT_NOT_AUTHORIZED",
      "目前角色沒有完整的個案檢查報告操作權限。",
      403,
    );
  }
  if (operation !== "create") await requireRecentAal2(actor);
  return actor;
}

function operationMatches(operation: Operation, input: ClientInspectionReportInput) {
  return operation === input.action;
}

function saveFailure(code?: string) {
  if (code === "42501") return databaseFailure(
    "CLIENT_INSPECTION_REPORT_NOT_AUTHORIZED",
    "目前角色、分支、個案指派或工作階段不允許保存這份檢查報告。", 403,
  );
  if (code === "23505") return databaseFailure(
    "CLIENT_INSPECTION_REPORT_IDEMPOTENCY_CONFLICT",
    "相同操作鍵已用於不同內容，或檢查報告識別已存在。", 409,
  );
  if (["40001", "23514", "23503", "55000"].includes(code ?? "")) {
    return databaseFailure(
      "CLIENT_INSPECTION_REPORT_VERSION_CONFLICT",
      "檢查報告版本、附件證據或終端狀態已改變；請重新載入。", 409,
    );
  }
  if (["22023", "22P02", "22007", "22008"].includes(code ?? "")) {
    return databaseFailure(
      "INVALID_CLIENT_INSPECTION_REPORT",
      "個案、檢查日期、結果、來源或附件狀態未通過驗證。", 400,
    );
  }
  return databaseFailure(
    "CLIENT_INSPECTION_REPORT_SAVE_UNCERTAIN",
    "檢查報告尚未確認保存；請保留相同操作鍵重試。", 409,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const operation = declaredOperation(request);
    const actor = await authorize(operation);
    const input = parseClientInspectionReportInput(
      await readJsonObject(request, CLIENT_INSPECTION_REPORT_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    if (!operationMatches(operation, input)) throw new IntegrationError(
      "INVALID_CLIENT_INSPECTION_REPORT_OPERATION",
      "受治理操作標頭與檢查報告內容不一致。", 400,
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure(
      "SERVICE_NOT_CONFIGURED", "正式個案檢查報告服務尚未設定。", 503,
    );
    const { data, error } = await supabase.rpc("append_client_inspection_report", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_payload: clientInspectionReportRpcPayload(input),
      p_idempotency_key: deterministicUuid(
        "page22-client-inspection-report", actor.organizationId,
        actor.userId, input.idempotencyKey,
      ),
    }).maybeSingle();
    if (error || !data) throw saveFailure(error?.code);
    const receipt = parseClientInspectionReportReceipt(
      data, input, actor.organizationId, actor.branchId,
    );
    return ok({ receipt, persisted: true, demo: false },
      receipt.replayed ? 200 : 201, requestId);
  });
}
