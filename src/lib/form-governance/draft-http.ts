import "server-only";
import { IntegrationError } from "@/lib/integrations/errors";
import { authorizeStaffRequest, databaseFailure } from "@/lib/integrations/http";
import { requireCustomFormAal2 } from "./lifecycle-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function authorizeCustomDraft(write: boolean) {
  const actor = await authorizeStaffRequest();
  if (!actor.scopes.includes("forms.manage")) throw new IntegrationError("CUSTOM_FORM_NOT_AUTHORIZED", "目前角色沒有表單治理權限。", 403);
  if (actor.demo) throw new IntegrationError("DEMO_READ_ONLY", "展示模式不讀寫正式自訂表單。", 403);
  if (write) await requireCustomFormAal2(actor);
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw databaseFailure("SERVICE_NOT_CONFIGURED", "表單資料服務尚未設定。", 503);
  return { actor, supabase };
}

export async function runCustomDraftRpc<T>(query: { abortSignal(signal: AbortSignal): PromiseLike<T> }): Promise<T> {
  try {
    return await query.abortSignal(AbortSignal.timeout(10_000));
  } catch {
    // Cancellation stops the HTTP wait, not necessarily a transaction already
    // committed by PostgreSQL. The client must retain its original retry key.
    throw databaseFailure("CUSTOM_FORM_TIMEOUT", "資料服務未在期限內回覆；儲存結果尚未確認，請保留內容並以原操作重試。", 503);
  }
}

export function customDraftFailure(code?: string) {
  if (code === "42501") return databaseFailure("CUSTOM_FORM_NOT_AUTHORIZED", "目前帳號、機構、分支或驗證狀態不允許操作此表單。", 403);
  if (code === "23505" || code === "40001") return databaseFailure("CUSTOM_FORM_CONFLICT", "表單已被更新、代碼已使用或操作內容不同；請保留輸入並重新載入核對。", 409);
  if (code === "23514" || code === "55000") return databaseFailure("CUSTOM_FORM_LOCKED", "只能編輯此工具建立且尚未送審的自訂草稿；官方、歷史與已送審版本皆鎖定。", 409);
  if (code === "22023") return databaseFailure("INVALID_CUSTOM_FORM_DRAFT", "表單欄位或生效期間未通過驗證。", 400);
  return databaseFailure("CUSTOM_FORM_UNAVAILABLE", "操作尚未確認完成，請保留內容並以相同操作重試。", 503);
}
