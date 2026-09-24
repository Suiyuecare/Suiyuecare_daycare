import { z } from "zod";
import { ok } from "@/lib/api/response";
import { authorizeCustomDraft, runCustomDraftRpc } from "@/lib/form-governance/draft-http";
import { parsePublicationReviewHistory, parsePublicationReviewInput, parsePublicationReviewReceipt } from "@/lib/form-governance/publication-review";
import { IntegrationError } from "@/lib/integrations/errors";
import { databaseFailure, handleIntegrationRoute, readJsonObject } from "@/lib/integrations/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function failure(code?: string) {
  if (code === "42501") return databaseFailure("PUBLICATION_REVIEW_DENIED", "目前帳號、分支、重新驗證或覆核資格不允許這項操作。", 403);
  if (code === "22023") return databaseFailure("PUBLICATION_REVIEW_INVALID", "請確認表單版本、操作與原因。", 400);
  if (["23514", "23505", "40001", "55000"].includes(code ?? "")) return databaseFailure("PUBLICATION_REVIEW_CONFLICT", "申請已處理或草稿內容需要核對。退回或撤回後，須實際修改欄位或日期並儲存，不能只重存相同內容。", 409);
  return databaseFailure("PUBLICATION_REVIEW_UNCERTAIN", "尚未確認操作結果，請保留視窗並以原操作重試。", 503);
}
export async function GET(request: Request) {
  return handleIntegrationRoute(async requestId => {
    const { actor, supabase } = await authorizeCustomDraft(false);
    const params = new URL(request.url).searchParams; const version = z.uuid().safeParse(params.get("version"));
    if (!version.success || [...params].length !== 1) throw new IntegrationError("INVALID_PUBLICATION_REVIEW", "請選擇單一表單版本。", 400);
    const { data, error } = await runCustomDraftRpc(supabase.rpc("read_custom_form_publication_history_v2", { p_org: actor.organizationId, p_branch: actor.branchId, p_version: version.data }));
    if (error || !data) throw failure(error?.code);
    return ok({ history: parsePublicationReviewHistory(data, version.data), demo: false }, 200, requestId);
  });
}
export async function POST(request: Request) {
  return handleIntegrationRoute(async requestId => {
    const { actor, supabase } = await authorizeCustomDraft(true);
    const { input, idempotencyKey } = parsePublicationReviewInput(await readJsonObject(request, 8192), request.headers.get("idempotency-key"));
    const { data, error } = await runCustomDraftRpc(supabase.rpc("write_custom_form_publication_v2", { p_org: actor.organizationId, p_branch: actor.branchId, p_key: idempotencyKey, p_input: input }));
    if (error || !data) throw failure(error?.code);
    // Approval retains the original request branch in immutable legacy
    // evidence; SQL separately checks/audits the caller's current branch.
    const receipt = parsePublicationReviewReceipt(data, input, actor.userId, input.action === "approve" ? undefined : actor.branchId);
    return ok({ receipt, persisted: true, demo: false }, receipt.replayed ? 200 : 201, requestId);
  });
}
