import { ok } from "@/lib/api/response";
import { isSyntheticReadMode } from "@/lib/env";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, databaseFailure, handleIntegrationRoute, readJsonObject } from "@/lib/integrations/http";
import { evaluationPreparationReceiptSchema, evaluationPreparationRequestSchema } from "@/lib/evaluation-preparation/contract";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  itemCode: z.string(), expectedVersion: z.number(), ownerUserId: z.string().nullable(),
  dueOn: z.string().nullable(), evidenceReference: z.string().nullable(),
  progress: z.string(), changeReason: z.string(), idempotency_key: z.uuid(),
}).strict();

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    if (isSyntheticReadMode()) throw new IntegrationError("DEMO_READ_ONLY", "展示環境不保存評鑑準備資料。", 403);
    const actor = await authorizeStaffRequest();
    if (actor.demo || !actor.scopes.includes("audit.view") ||
      !actor.roles.some((role) => role === "organization_manager" || role === "branch_supervisor")) {
      throw new IntegrationError("EVALUATION_PREPARATION_NOT_AUTHORIZED", "只有具稽核權限的主管可整理評鑑準備資料。", 403);
    }
    const raw = await readJsonObject(request, 2048);
    const envelope = requestSchema.safeParse(raw);
    if (!envelope.success || request.headers.get("idempotency-key") !== envelope.data.idempotency_key) {
      throw new IntegrationError("INVALID_EVALUATION_PREPARATION", "請確認操作識別碼與欄位內容後重試。", 400);
    }
    const { idempotency_key: idempotencyKey, ...input } = envelope.data;
    const parsed = evaluationPreparationRequestSchema.safeParse(input);
    if (!parsed.success) throw new IntegrationError("INVALID_EVALUATION_PREPARATION", "項目代碼、日期、負責人、證據或進度尚未通過驗證。", 400);
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式評鑑準備服務尚未設定。", 503);
    const { data, error } = await supabase.rpc("evaluation_preparation_mutate", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_request: parsed.data,
      p_idempotency_key: idempotencyKey,
    });
    if (error || !data) {
      if (error?.code === "42501") throw databaseFailure("EVALUATION_PREPARATION_NOT_AUTHORIZED", "目前角色、分支或工作階段不允許保存。", 403);
      if (error?.code === "40001") throw databaseFailure("EVALUATION_PREPARATION_VERSION_CONFLICT", "已有其他人更新這項準備資料，請重新載入後核對。", 409);
      if (error?.code === "23505") throw databaseFailure("EVALUATION_PREPARATION_IDEMPOTENCY_CONFLICT", "相同操作識別碼已用於不同內容。", 409);
      if (["22023", "23514", "22007", "22008"].includes(error?.code ?? "")) throw databaseFailure("INVALID_EVALUATION_PREPARATION", "欄位、負責人或進度不符合規則，尚未保存。", 400);
      throw databaseFailure("EVALUATION_PREPARATION_RESULT_UNCERTAIN", "尚未確認保存結果；請保留相同內容與操作識別碼重試。", 409);
    }
    const receipt = evaluationPreparationReceiptSchema.safeParse(data);
    if (!receipt.success || receipt.data.organizationId !== actor.organizationId ||
      receipt.data.branchId !== actor.branchId || receipt.data.actorUserId !== actor.userId ||
      receipt.data.idempotencyKey !== idempotencyKey || receipt.data.result.itemCode !== parsed.data.itemCode ||
      receipt.data.result.version !== parsed.data.expectedVersion + 1) {
      throw databaseFailure("EVALUATION_PREPARATION_RESULT_UNCERTAIN", "保存回執無法核對；請保留相同內容與操作識別碼重試。", 409);
    }
    return ok(receipt.data, receipt.data.replayed ? 200 : 201, requestId);
  });
}
