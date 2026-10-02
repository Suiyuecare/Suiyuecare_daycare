import { z } from "zod";
import { ok } from "@/lib/api/response";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, handleIntegrationRoute } from "@/lib/integrations/http";
import { parseNursingOperationReceipt } from "@/lib/nursing-assessments/operation-receipt";
import { nursingReadUuid } from "@/lib/nursing-assessments/read-authority";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headersSchema = z.object({ organizationId: nursingReadUuid, branchId: nursingReadUuid, clientId: nursingReadUuid,
  action: z.enum(["create_draft", "revise_draft", "sign", "correct"]), idempotencyKey: nursingReadUuid,
  nonce: nursingReadUuid }).strict();
function unavailable(): never {
  throw new IntegrationError("NURSING_OPERATION_RECEIPT_UNAVAILABLE", "尚未取得原操作證明；請保留原操作並稍後再查。", 503);
}

/** Read only the current actor's original operation. Historic signing does not
 * grant a new signature and requires no new MFA or current write permission. */
export async function GET(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorizeStaffRequest();
    if (actor.demo || actor.assuranceLevel !== "aal2" ||
      !["clients.read", "nursing_assessments.read"].every((scope) => actor.scopes.includes(scope))) {
      throw new IntegrationError("NURSING_NOT_AUTHORIZED", "目前授權無法查證原護理操作。", 403);
    }
    const parsed = headersSchema.safeParse({ organizationId: request.headers.get("x-organization-id"),
      branchId: request.headers.get("x-branch-id"), clientId: request.headers.get("x-client-id"),
      action: request.headers.get("x-nursing-operation"), idempotencyKey: request.headers.get("idempotency-key"),
      nonce: request.headers.get("x-nursing-receipt-nonce") });
    const length = request.headers.get("content-length");
    if (!parsed.success || request.method !== "GET" || new URL(request.url).search || request.body !== null ||
      request.headers.has("x-idempotency-key") || request.headers.has("transfer-encoding") || length !== null && length !== "0") {
      throw new IntegrationError("INVALID_NURSING_RECEIPT_REQUEST", "請提供有效的原操作查證識別。", 400);
    }
    if (parsed.data.organizationId !== actor.organizationId.toLowerCase() || parsed.data.branchId !== actor.branchId.toLowerCase()) {
      throw new IntegrationError("NURSING_NOT_AUTHORIZED", "查證範圍與目前登入範圍不符。", 403);
    }
    const expected = { ...parsed.data, userId: actor.userId.toLowerCase() };
    let result;
    try {
      const supabase = await createServerSupabaseClient();
      if (!supabase) return unavailable();
      result = await supabase.rpc("nursing_assessment_operation_receipt", { p_organization_id: expected.organizationId,
        p_branch_id: expected.branchId, p_client_id: expected.clientId, p_action: expected.action,
        p_idempotency_key: expected.idempotencyKey, p_nonce: expected.nonce });
    } catch { return unavailable(); }
    if (!result || typeof result !== "object" || !("data" in result) || !("error" in result)) return unavailable();
    if (result.error) {
      if (result.error.code === "42501") throw new IntegrationError("NURSING_NOT_AUTHORIZED", "目前授權無法查證原護理操作。", 403);
      if (result.error.code === "22023") throw new IntegrationError("INVALID_NURSING_RECEIPT_REQUEST", "原操作查證識別未通過驗證。", 400);
      return unavailable();
    }
    try { return ok(parseNursingOperationReceipt(result.data, expected), 200, requestId); }
    catch { return unavailable(); }
  });
}
