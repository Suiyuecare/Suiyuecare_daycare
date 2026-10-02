import { ok } from "@/lib/api/response";
import { parseAbcdAssessmentReceipt } from "@/lib/abcd-assessments/parser";
import { parseAbcdRecoveryContinuation, parseAbcdRecoverySummary } from
  "@/lib/abcd-assessments/recovery";
import { getTenantContext } from "@/lib/auth/context";
import { authorizeRoutineIntake } from "@/lib/auth/routine-intake";
import type { TenantContext } from "@/lib/domain/types";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, databaseFailure, handleIntegrationRoute,
  readJsonObject } from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const continuationRequest = z.object({ reservation_id: uuid }).strict();

async function authorize(): Promise<TenantContext> {
  const preliminary = await getTenantContext("staff");
  if (!preliminary) throw new IntegrationError("AUTH_REQUIRED", "請先登入。", 401);
  const actor = preliminary.assuranceLevel === "aal2" ? await authorizeStaffRequest() : preliminary;
  if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY",
    "展示模式不會查詢或續做正式 ABCD 候選評估。", 403);
  if (!actor.branchId) throw new IntegrationError("BRANCH_CONTEXT_REQUIRED", "請先選擇作業分支。", 409);
  if (["clients.read", "abcd_assessments.read", "abcd_assessments.manage"]
    .some((scope) => !actor.scopes.includes(scope))) throw new IntegrationError(
      "ABCD_ASSESSMENT_NOT_AUTHORIZED", "目前角色沒有完整的 ABCD 候選評估權限。", 403);
  return actor;
}

function failure(code?: string): IntegrationError {
  if (code === "42501") return databaseFailure("ABCD_ASSESSMENT_NOT_AUTHORIZED",
    "目前帳號、分支、個案指派或驗證狀態不允許查證或續做。", 403);
  if (code === "40001") return databaseFailure("ABCD_ASSESSMENT_VERSION_CONFLICT",
    "評估版本已改變；請重新載入並人工核對。", 409);
  if (code === "23505") return databaseFailure("ABCD_ASSESSMENT_IDEMPOTENCY_CONFLICT",
    "原操作鍵與保留內容不一致；請人工核對。", 409);
  if (["23514", "23503", "55000"].includes(code ?? "")) return databaseFailure(
    "ABCD_ASSESSMENT_STATE_CONFLICT", "原操作不能安全續做；請人工核對。", 409);
  if (["22023", "22P02", "22007", "22008"].includes(code ?? "")) return databaseFailure(
    "INVALID_ABCD_ASSESSMENT_OPERATION", "查證或續做參數無效。", 400);
  return databaseFailure("ABCD_ASSESSMENT_RESULT_UNCERTAIN",
    "目前無法確認原操作結果；請勿以新操作鍵重送。", 409);
}

export async function GET(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorize();
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].some((key) => key !== "client_id") ||
      url.searchParams.getAll("client_id").length > 1) {
      throw new IntegrationError("INVALID_ABCD_ASSESSMENT_RECOVERY_FILTER",
        "查證篩選條件無效。", 400);
    }
    const rawClient = url.searchParams.get("client_id");
    const clientId = rawClient === null ? null : uuid.safeParse(rawClient);
    if (clientId !== null && !clientId.success) throw new IntegrationError(
      "INVALID_ABCD_ASSESSMENT_RECOVERY_FILTER", "查證個案代碼無效。", 400);
    if (actor.assuranceLevel !== "aal2" && clientId !== null) {
      const routine = await authorizeRoutineIntake("abcd.read", clientId.data);
      if (routine.userId !== actor.userId || routine.organizationId !== actor.organizationId ||
        routine.branchId !== actor.branchId) throw new IntegrationError(
        "ABCD_ASSESSMENT_NOT_AUTHORIZED", "作業身分或分支已變更，請重新載入。", 403);
    }
    // With no selected client, the private RPC applies approved Google
    // routine authority to each returned client. An opaque reservation ID on
    // POST likewise cannot authorize a client at the HTTP layer.
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式 ABCD 候選評估服務尚未設定。", 503);
    const { data, error } = await supabase.rpc("abcd_assessment_recovery_snapshot", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_client_id: clientId === null ? null : clientId.data,
    });
    if (error || !data) throw failure(error?.code);
    return ok(parseAbcdRecoverySummary(data, actor.organizationId, actor.branchId,
      clientId === null ? null : clientId.data), 200, requestId);
  });
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorize();
    const body = continuationRequest.safeParse(await readJsonObject(request, 1024));
    if (!body.success) throw new IntegrationError("INVALID_ABCD_ASSESSMENT_RECOVERY_REQUEST",
      "請指定單一原操作保留編號。", 400);
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED", "正式 ABCD 候選評估服務尚未設定。", 503);
    const { data, error } = await supabase.rpc("resume_abcd_assessment_operation", {
      p_expected_organization_id: actor.organizationId,
      p_expected_branch_id: actor.branchId,
      p_reservation_id: body.data.reservation_id,
    });
    if (error || !data) throw failure(error?.code);
    const stored = parseAbcdRecoveryContinuation(data);
    const result = parseAbcdAssessmentReceipt(stored.receipt, stored.input,
      actor.organizationId, actor.branchId);
    return ok({ ...result, reservationId: body.data.reservation_id },
      result.replayed ? 200 : 201, requestId);
  });
}
