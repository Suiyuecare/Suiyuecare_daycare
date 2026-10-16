import { z } from "zod";
import { ok } from "@/lib/api/response";
import { isSyntheticReadMode } from "@/lib/env";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, databaseFailure, handleIntegrationRoute, readJsonObject } from "@/lib/integrations/http";
import { evaluationPreparationReceiptSchema } from "@/lib/evaluation-preparation/contract";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const lookupSchema = z.object({
  request: z.record(z.string(), z.unknown()), idempotency_key: z.uuid(),
}).strict();

/** Read-only reconciliation. A missing or denied receipt never proves non-commit. */
export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    if (isSyntheticReadMode()) throw new IntegrationError("DEMO_READ_ONLY", "展示環境沒有正式保存回執。", 403);
    const actor = await authorizeStaffRequest();
    if (actor.demo || !actor.scopes.includes("audit.view") ||
      !actor.roles.some((role) => role === "organization_manager" || role === "branch_supervisor")) {
      throw new IntegrationError("EVALUATION_PREPARATION_NOT_AUTHORIZED", "目前帳號沒有核對此回執的權限。", 403);
    }
    const raw = await readJsonObject(request, 2048);
    const parsed = lookupSchema.safeParse(raw);
    if (!parsed.success || request.headers.get("idempotency-key") !== parsed.data.idempotency_key) {
      throw new IntegrationError("INVALID_EVALUATION_PREPARATION", "請確認原操作識別碼與內容。", 400);
    }
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式評鑑準備服務尚未設定。", 503);
    const { data, error } = await supabase.rpc("evaluation_preparation_receipt", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_request: parsed.data.request,
      p_idempotency_key: parsed.data.idempotency_key,
    });
    if (error) {
      if (error.code === "42501") throw databaseFailure("EVALUATION_PREPARATION_NOT_AUTHORIZED", "目前權限不允許核對此回執。", 403);
      if (error.code === "23505") throw databaseFailure("EVALUATION_PREPARATION_IDEMPOTENCY_CONFLICT", "原操作識別碼與內容不一致。", 409);
      throw databaseFailure("EVALUATION_PREPARATION_RESULT_UNCERTAIN", "目前無法核對保存回執。", 503);
    }
    if (data === null) return ok({ receipt: null }, 200, requestId);
    const receipt = evaluationPreparationReceiptSchema.safeParse(data);
    if (!receipt.success || receipt.data.organizationId !== actor.organizationId ||
      receipt.data.branchId !== actor.branchId || receipt.data.actorUserId !== actor.userId ||
      receipt.data.idempotencyKey !== parsed.data.idempotency_key ||
      receipt.data.result.recordedBy !== actor.userId) {
      throw databaseFailure("EVALUATION_PREPARATION_RESULT_UNCERTAIN", "保存回執無法核對。", 503);
    }
    return ok({ receipt: receipt.data }, 200, requestId);
  });
}
