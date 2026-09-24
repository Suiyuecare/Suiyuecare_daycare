import "server-only";
import { authorizeStaffRequest, databaseFailure, requireRecentAal2 } from "@/lib/integrations/http";
import { IntegrationError } from "@/lib/integrations/errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { printTokenConfigured } from "./print-token";

export async function authorizeCustomPrint(prepare: boolean) {
  const actor = await authorizeStaffRequest();
  const permissions = ["care_records.read", "document_printing.read", "document_printing.access", ...(prepare ? ["document_printing.manage"] : [])];
  if (actor.demo || actor.assuranceLevel !== "aal2" || !permissions.every((p) => actor.scopes.includes(p))) throw new IntegrationError("CUSTOM_PRINT_FORBIDDEN", "目前帳號沒有此個案表單的文件輸出權限。", 403);
  await requireRecentAal2(actor);
  if (!printTokenConfigured()) throw new IntegrationError("CUSTOM_PRINT_SIGNING_NOT_CONFIGURED", "文件下載服務尚未啟用，請由管理員完成設定。", 503);
  const db = await createServerSupabaseClient();
  if (!db) throw new IntegrationError("CUSTOM_PRINT_UNAVAILABLE", "文件資料服務暫時無法使用。", 503);
  return { actor, db };
}
export function customPrintFailure(code?: string) {
  if (code === "42501") return databaseFailure("CUSTOM_PRINT_FORBIDDEN", "目前帳號、個案範圍或近期驗證已不允許輸出。", 403);
  if (code === "55000") return databaseFailure("CUSTOM_PRINT_EXPIRED", "這份下載連結已過期或無法使用，請重新準備列印。", 410);
  if (code === "23505") return databaseFailure("CUSTOM_PRINT_CONFLICT", "原操作識別碼已用於其他紀錄，請核對原操作。", 409);
  if (code === "22023") return databaseFailure("INVALID_CUSTOM_PRINT", "請選擇已保存的有效紀錄版本。", 400);
  return databaseFailure("CUSTOM_PRINT_UNAVAILABLE", "列印準備結果尚未確認，請保留原操作重試。", 503);
}
