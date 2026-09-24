import { z } from "zod";
import { ok } from "@/lib/api/response";
import { authorizeCustomDraft, runCustomDraftRpc } from "@/lib/form-governance/draft-http";
import { parseLifecycleHistory, parseLifecycleInput, parseLifecycleReceipt } from "@/lib/form-governance/lifecycle";
import { IntegrationError } from "@/lib/integrations/errors";
import { databaseFailure, handleIntegrationRoute, readJsonObject } from "@/lib/integrations/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function failure(code?: string) {
  if (code === "42501") return databaseFailure("FORM_LIFECYCLE_DENIED", "目前帳號、分支、重新驗證或第二人覆核資格不允許此操作。", 403);
  if (code === "22023") return databaseFailure("FORM_LIFECYCLE_INVALID", "請確認表單、操作及原因。", 400);
  if (["23514", "23505", "40001", "55000"].includes(code ?? "")) return databaseFailure("FORM_LIFECYCLE_CONFLICT", "已有草稿、待覆核申請，或版本尚未生效／狀態已改變；請重新載入核對。", 409);
  return databaseFailure("FORM_LIFECYCLE_UNCERTAIN", "操作結果尚未確認，請保留視窗並以原操作重試。", 503);
}
export async function GET(request: Request) {
  return handleIntegrationRoute(async requestId => {
    const { actor, supabase } = await authorizeCustomDraft(false);
    const params = new URL(request.url).searchParams;
    const id = z.uuid().safeParse(params.get("version"));
    if (!id.success || [...params].length !== 1) throw new IntegrationError("INVALID_FORM_LIFECYCLE", "請選擇單一表單版本。", 400);
    const { data, error } = await runCustomDraftRpc(supabase.rpc("read_custom_form_lifecycle", { p_org: actor.organizationId, p_branch: actor.branchId, p_version: id.data }));
    if (error || !data) throw failure(error?.code);
    return ok({ history: parseLifecycleHistory(data, id.data), demo: false }, 200, requestId);
  });
}
export async function POST(request: Request) {
  return handleIntegrationRoute(async requestId => {
    const { actor, supabase } = await authorizeCustomDraft(true);
    const { input, idempotencyKey } = parseLifecycleInput(await readJsonObject(request, 8192), request.headers.get("idempotency-key"));
    const { data, error } = await runCustomDraftRpc(supabase.rpc("write_custom_form_lifecycle", { p_org: actor.organizationId, p_branch: actor.branchId, p_key: idempotencyKey, p_input: input }));
    if (error || !data) throw failure(error?.code);
    const receipt = parseLifecycleReceipt(data, input, actor.userId, actor.branchId);
    return ok({ receipt, persisted: true, demo: false }, receipt.replayed ? 200 : 201, requestId);
  });
}
