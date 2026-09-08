import { ok } from "@/lib/api/response";
import {
  authorizeStaffRequest,
  databaseFailure,
  handleIntegrationRoute,
  readJsonObject,
  requireRecentAal2,
} from "@/lib/integrations/http";
import { IntegrationError } from "@/lib/integrations/errors";
import { deterministicUuid } from "@/lib/integrations/security";
import {
  DOCUMENT_PRINT_JOB_MAX_BYTES,
  parseCreateDocumentPrintJob,
  parseDocumentPrintJobOperationResult,
} from "@/lib/document-printing/parser";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(code: string | undefined) {
  if (code === "42501") return databaseFailure(
    "DOCUMENT_PRINT_NOT_AUTHORIZED",
    "目前角色、分支、個案範圍或近期雙重驗證不允許建立文件。",
    403,
  );
  if (code === "23505") return databaseFailure(
    "DOCUMENT_PRINT_IDEMPOTENCY_CONFLICT",
    "相同操作鍵已用於不同文件內容。",
    409,
  );
  if (["55000", "40001"].includes(code ?? "")) return databaseFailure(
    "DOCUMENT_TEMPLATE_UNAVAILABLE",
    "核准範本不存在、版本期間重疊，或不可變文件完整性無法確認。",
    409,
  );
  if (["22023", "22P02", "23514"].includes(code ?? "")) return databaseFailure(
    "INVALID_DOCUMENT_PRINT_JOB",
    "範本、個案或文件日期未通過伺服器驗證。",
    400,
  );
  return databaseFailure(
    "DOCUMENT_PRINT_SAVE_UNCERTAIN",
    "文件工作尚未確認完成；內容未修改時請保留相同操作鍵重試。",
    409,
  );
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo) throw new IntegrationError(
      "DEMO_READ_ONLY",
      "展示模式只能檢視合成文件，不會建立正式文件工作。",
      403,
    );
    const required = ["clients.read", "document_printing.read",
      "document_printing.manage"];
    if (actor.assuranceLevel !== "aal2" ||
      !required.every((scope) => actor.scopes.includes(scope))) {
      throw new IntegrationError(
        "DOCUMENT_PRINT_NOT_AUTHORIZED",
        "目前登入保證等級或工作範圍不允許建立文件。",
        403,
      );
    }
    // Recent same-session AAL2 and the governed action are established before
    // any client or document selection is parsed.
    await requireRecentAal2(actor);
    if (request.headers.get("x-document-print-operation") !== "create_job") {
      throw new IntegrationError(
        "DOCUMENT_PRINT_ACTION_REQUIRED",
        "請明確指定建立不可變文件工作。",
        400,
        "x-document-print-operation",
      );
    }
    const input = parseCreateDocumentPrintJob(
      await readJsonObject(request, DOCUMENT_PRINT_JOB_MAX_BYTES),
      request.headers.get("idempotency-key"),
    );
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure(
      "SERVICE_NOT_CONFIGURED",
      "正式文件資料服務尚未設定。",
      503,
    );
    const { data, error } = await supabase.rpc("create_document_print_job", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_template_version_id: input.templateVersionId,
      p_client_id: input.clientId,
      p_document_date: input.documentDate,
      p_idempotency_key: deterministicUuid(
        "page62-document-print-job",
        actor.organizationId,
        actor.userId,
        input.idempotencyKey,
      ),
    }).maybeSingle();
    if (error || !data) throw failure(error?.code);
    const result = parseDocumentPrintJobOperationResult(data, input);
    const receipt = {
      action: "create_job" as const,
      ...result,
      persisted: true as const,
      demo: false as const,
    };
    return ok({ receipt, persisted: true, demo: false },
      receipt.replayed ? 200 : 201, requestId);
  });
}
