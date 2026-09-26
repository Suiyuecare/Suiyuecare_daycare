import { z } from "zod";

import { ok } from "@/lib/api/response";
import { getTenantContext } from "@/lib/auth/context";
import { requireSameOriginJsonWrite } from "@/lib/auth/same-origin-write";
import { IntegrationError } from "@/lib/integrations/errors";
import { databaseFailure, handleIntegrationRoute, readJsonObject, requireRecentAal2 } from "@/lib/integrations/http";
import { buildQuestionnaireRuleCatalogEntry } from "@/lib/questionnaire-assessments/rule-catalog";
import { parseRuleReviewHistory, parseRuleReviewReceipt, ruleReviewFormKeySchema, ruleReviewInputSchema,
  ruleReviewUuidSchema } from "@/lib/questionnaire-assessments/rule-review-contract";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PostgreSQL timestamps have microsecond precision. Reject finer client
// cursors instead of letting SQL round them while the receipt guard compares
// the original value, which could incorrectly reject a valid history page.
const cursorTimestampSchema = z.iso.datetime({ offset: true }).refine((value) => !/\.\d{7}/u.test(value));

async function authorize() {
  const actor = await getTenantContext("staff");
  if (!actor) throw new IntegrationError("AUTH_REQUIRED", "請先登入。", 401);
  if (actor.demo || !actor.scopes.includes("forms.manage")) throw new IntegrationError(
    "RULE_REVIEW_NOT_AUTHORIZED", "目前帳號沒有規則審核權限。", 403,
  );
  if (!actor.branchId) throw new IntegrationError("BRANCH_CONTEXT_REQUIRED", "請先選擇分支。", 409);
  // This is only an early application gate. Each RPC independently pins current
  // Google admission, live role/session and branch scope; writes also bind actual
  // recent factor verification and independent human approval in PostgreSQL.
  return { ...actor, branchId: actor.branchId };
}

function databaseError(code?: string, read = false) {
  if (code === "42501") return databaseFailure("RULE_REVIEW_NOT_AUTHORIZED", "授權、分支或身分確認已失效，請重新確認。", 403);
  if (code === "23505") return databaseFailure("RULE_REVIEW_IDEMPOTENCY_CONFLICT", "操作識別碼已用於其他內容，請重新載入。", 409);
  if (["23514", "40001"].includes(code ?? "")) return databaseFailure("RULE_REVIEW_CONFLICT", "待審狀態或生效期間已變更，請重新載入。", 409);
  if (["22023", "22007", "22008", "23502"].includes(code ?? "")) return databaseFailure("RULE_REVIEW_INVALID", "規則、日期或審核內容不符合要求。", 400);
  return databaseFailure("RULE_REVIEW_UNCONFIRMED", read ? "審核清單暫時無法載入，請稍後重試。"
    : "審核是否完成尚未確認；請保留內容，以相同操作識別碼重試。", 503);
}

export async function GET(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorize();
    const parameters = new URL(request.url).searchParams;
    const form = ruleReviewFormKeySchema.safeParse(parameters.get("form_key"));
    const beforeAt = parameters.get("before_created_at");
    const beforeId = parameters.get("before_id");
    if (!form.success || [...parameters.keys()].some((key) => !["form_key", "before_created_at", "before_id"].includes(key) || parameters.getAll(key).length !== 1) ||
      (beforeAt === null) !== (beforeId === null) || (beforeAt !== null && (!cursorTimestampSchema.safeParse(beforeAt).success ||
        !ruleReviewUuidSchema.safeParse(beforeId).success))) throw new IntegrationError("RULE_REVIEW_INVALID", "表單或分頁條件無效。", 400);
    const before = beforeAt !== null && beforeId !== null ? { createdAt: beforeAt, id: beforeId.toLowerCase() } : null;
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw new IntegrationError("SERVICE_NOT_CONFIGURED", "正式資料服務尚未設定。", 503);
    const { data, error } = await supabase.rpc("read_questionnaire_rule_review", {
      p_org: actor.organizationId, p_branch: actor.branchId, p_form_key: form.data,
      p_before_created_at: before?.createdAt ?? null, p_before_id: before?.id ?? null,
    });
    if (error || !data) throw databaseError(error?.code, true);
    try {
      const history = parseRuleReviewHistory(data, actor, form.data, before);
      const candidate = buildQuestionnaireRuleCatalogEntry(form.data);
      return ok({ ...history, candidate: { ...candidate,
        registered: history.catalogs.some((catalog) => catalog.catalogHash === candidate.catalogHash),
        adoptionRequired: true } }, 200, requestId);
    } catch { throw databaseFailure("RULE_REVIEW_HISTORY_INVALID", "規則或審核清單尚未完整確認，請重新載入。", 503); }
  });
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorize();
    await requireRecentAal2(actor);
    requireSameOriginJsonWrite(request);
    if (new URL(request.url).search.length !== 0) throw new IntegrationError("RULE_REVIEW_INVALID", "審核入口不接受額外篩選條件。", 400);
    const key = ruleReviewUuidSchema.safeParse(request.headers.get("idempotency-key"));
    const input = ruleReviewInputSchema.safeParse(await readJsonObject(request, 8192));
    if (!key.success || !input.success) throw new IntegrationError("RULE_REVIEW_INVALID", "審核内容或操作識別碼無效。", 400);
    // Date/registered-catalog checks belong AFTER the locked idempotency lookup
    // in SQL. Replaying a committed request must still work after midnight or a
    // source upgrade, even when a fresh request with those values is forbidden.
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw new IntegrationError("SERVICE_NOT_CONFIGURED", "正式資料服務尚未設定。", 503);
    const { data, error } = await supabase.rpc("write_questionnaire_rule_review", {
      p_org: actor.organizationId, p_branch: actor.branchId, p_key: key.data, p_input: input.data,
    });
    if (error || !data) throw databaseError(error?.code);
    try { return ok(parseRuleReviewReceipt(data, actor, input.data, key.data), 201, requestId); }
    catch { throw databaseFailure("RULE_REVIEW_RECEIPT_INVALID", "審核回覆尚未完整確認；請以相同操作識別碼重試。", 503); }
  });
}
