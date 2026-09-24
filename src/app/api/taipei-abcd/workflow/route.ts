import { ok } from "@/lib/api/response";
import { authorizeRoutineIntake } from "@/lib/auth/routine-intake";
import { getTenantContext } from "@/lib/auth/context";
import { IntegrationError } from "@/lib/integrations/errors";
import { handleIntegrationRoute, readJsonObject } from "@/lib/integrations/http";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { transitionReceiptSchema, transitionSchema } from "@/lib/taipei-abcd/workflow";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleIntegrationRoute(async requestId => {
    const preliminary = await getTenantContext("staff");
    if (!preliminary) throw new IntegrationError("AUTH_REQUIRED", "請先登入。", 401);
    if (preliminary.demo) throw new IntegrationError("TAIPEI_REVIEW_DENIED", "展示模式不會更動正式審核紀錄。", 403);
    const input = transitionSchema.safeParse(await readJsonObject(request, 40000));
    if (!input.success || input.data.idempotency_key !== request.headers.get("idempotency-key")) throw new IntegrationError("TAIPEI_REVIEW_INVALID", "請核對送審欄位、版本與處理理由。", 400);
    const payload = input.data;
    const actor = preliminary.assuranceLevel === "aal2" ? preliminary : await authorizeRoutineIntake(payload.action === "submit" ? "abcd.submit" : payload.action === "correct" ? "abcd.save" : "abcd.review", payload.clientId);
    const client = await createServerSupabaseClient();
    if (!client) throw new IntegrationError("TAIPEI_REVIEW_UNAVAILABLE", "審核服務尚未設定。", 503);
    const { data, error } = await client.rpc("taipei_abcd_transition", { p_expected_organization_id: actor.organizationId, p_expected_branch_id: actor.branchId, p_input: payload });
    if (error) throw new IntegrationError("TAIPEI_REVIEW_UNCERTAIN", error.code === "42501" ? "需要同一分支且不是填表／送審人的授權主管；也請核對個案與資料類別權限。" : error.code === "22023" ? "請核對每個區段、說明未填內容，並先確認所有來源建議。" : "表單或審核版本已變更。請保留輸入，重新載入核對後再試。", error.code === "42501" ? 403 : error.code === "22023" ? 400 : 409);
    const receipt = transitionReceiptSchema.safeParse(data);
    const state = { submit: "submitted", return: "returned", approve: "approved", correct: "draft" }[payload.action];
    if (!receipt.success || receipt.data.idempotencyKey !== payload.idempotency_key || receipt.data.state !== state ||
      (payload.action !== "correct" && (receipt.data.draftId !== payload.draftId || receipt.data.sequence !== payload.expectedSequence + 1)) ||
      (payload.action === "correct" && (receipt.data.draftId === payload.draftId || receipt.data.sequence !== 1))) throw new IntegrationError("TAIPEI_REVIEW_RECEIPT_MISMATCH", "審核回條尚未核對，請保留原操作重試。", 502);
    return ok(receipt.data, receipt.data.replayed ? 200 : 201, requestId);
  });
}
