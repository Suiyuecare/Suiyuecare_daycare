import "server-only";

import { z } from "zod";

import { ok } from "@/lib/api/response";
import { getTenantContext } from "@/lib/auth/context";
import { requireSameOriginJsonWrite } from "@/lib/auth/same-origin-write";
import { IntegrationError } from "@/lib/integrations/errors";
import { databaseFailure, handleIntegrationRoute, readJsonObject, requireRecentAal2 } from "@/lib/integrations/http";
import { parseRuleRetirementHistory, parseRuleRetirementReceipt, ruleRetirementInputSchema,
  ruleRetirementUuidSchema } from "@/lib/questionnaire-assessments/rule-retirement-contract";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cursorTimestampSchema = z.iso.datetime({ offset: true }).refine((value) => !/\.\d{7}/u.test(value));

async function authorize() {
  const actor = await getTenantContext("staff");
  if (!actor) throw new IntegrationError("AUTH_REQUIRED", "請先登入。", 401);
  if (actor.demo || !actor.scopes.includes("forms.manage")) throw new IntegrationError(
    "RULE_RETIREMENT_NOT_AUTHORIZED", "目前帳號沒有規則停用審核權限。", 403,
  );
  if (!actor.branchId) throw new IntegrationError("BRANCH_CONTEXT_REQUIRED", "請先選擇分支。", 409);
  // Each RPC independently checks live Google admission, session and scope.
  // Writes additionally require real recent-factor and independent approval
  // evidence; this application gate is not authority to retire a rule itself.
  return { ...actor, branchId: actor.branchId };
}

function databaseError(code?: string, read = false) {
  if (code === "42501") return databaseFailure("RULE_RETIREMENT_NOT_AUTHORIZED", "授權、分支或身分確認已失效，請重新確認。", 403);
  if (code === "23505") return databaseFailure("RULE_RETIREMENT_IDEMPOTENCY_CONFLICT", "操作識別碼已用於其他內容，請重新載入。", 409);
  if (["23514", "40001"].includes(code ?? "")) return databaseFailure("RULE_RETIREMENT_CONFLICT", "待審狀態或停用期限已變更，請重新載入。", 409);
  if (["22023", "22007", "22008", "23502"].includes(code ?? "")) return databaseFailure("RULE_RETIREMENT_INVALID", "規則、日期或審核內容不符合要求。", 400);
  return databaseFailure("RULE_RETIREMENT_UNCONFIRMED", read ? "停用審核清單暫時無法載入，請稍後重試。"
    : "停用審核是否完成尚未確認；請保留內容，以相同操作識別碼重試。", 503);
}

export async function GET(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorize();
    const parameters = new URL(request.url).searchParams;
    const activation = ruleRetirementUuidSchema.safeParse(parameters.get("activation_id"));
    const beforeAt = parameters.get("before_created_at");
    const beforeId = parameters.get("before_id");
    if (!activation.success || [...parameters.keys()].some((key) => !["activation_id", "before_created_at", "before_id"].includes(key) ||
      parameters.getAll(key).length !== 1) || (beforeAt === null) !== (beforeId === null) ||
      (beforeAt !== null && (!cursorTimestampSchema.safeParse(beforeAt).success || !ruleRetirementUuidSchema.safeParse(beforeId).success))) {
      throw new IntegrationError("RULE_RETIREMENT_INVALID", "規則識別碼或分頁條件無效。", 400);
    }
    const before = beforeAt !== null && beforeId !== null ? { createdAt: beforeAt, id: beforeId.toLowerCase() } : null;
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw new IntegrationError("SERVICE_NOT_CONFIGURED", "正式資料服務尚未設定。", 503);
    const { data, error } = await supabase.rpc("read_questionnaire_rule_retirement", {
      p_org: actor.organizationId, p_branch: actor.branchId, p_activation: activation.data,
      p_before_created_at: before?.createdAt ?? null, p_before_id: before?.id ?? null,
    });
    if (error || !data) throw databaseError(error?.code, true);
    try { return ok(parseRuleRetirementHistory(data, actor, activation.data, before), 200, requestId); }
    catch { throw databaseFailure("RULE_RETIREMENT_HISTORY_INVALID", "停用審核清單尚未完整確認，請重新載入。", 503); }
  });
}

export async function POST(request: Request) {
  return handleIntegrationRoute(async (requestId) => {
    const actor = await authorize();
    await requireRecentAal2(actor);
    requireSameOriginJsonWrite(request);
    if (new URL(request.url).search.length !== 0) throw new IntegrationError("RULE_RETIREMENT_INVALID", "審核入口不接受額外篩選條件。", 400);
    const key = ruleRetirementUuidSchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) throw new IntegrationError("RULE_RETIREMENT_INVALID", "操作識別碼無效。", 400);
    const input = ruleRetirementInputSchema.safeParse(await readJsonObject(request, 8192));
    if (!input.success) throw new IntegrationError("RULE_RETIREMENT_INVALID", "停用審核內容無效。", 400);
    // Do not preflight today's date, active catalog or pending history here.
    // The locked SQL operation lookup owns exact old-key replay semantics.
    const supabase = await createServerSupabaseClient();
    if (!supabase) throw new IntegrationError("SERVICE_NOT_CONFIGURED", "正式資料服務尚未設定。", 503);
    const { data, error } = await supabase.rpc("write_questionnaire_rule_retirement", {
      p_org: actor.organizationId, p_branch: actor.branchId, p_key: key.data, p_input: input.data,
    });
    if (error || !data) throw databaseError(error?.code);
    try { return ok(parseRuleRetirementReceipt(data, actor, input.data, key.data), 201, requestId); }
    catch { throw databaseFailure("RULE_RETIREMENT_RECEIPT_INVALID", "停用審核回覆尚未完整確認；請以相同操作識別碼重試。", 503); }
  });
}
