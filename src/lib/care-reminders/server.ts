import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/domain/types";
import { reminderSnapshotSchema, type ReminderSnapshot } from "./contracts";
import { databaseFailure } from "@/lib/integrations/http";

export async function loadCareReminders(context: TenantContext, clientId: string): Promise<ReminderSnapshot> {
  if (context.demo) return {
    client_id: clientId, client_version: 1, reviewer: false, generated_at: new Date().toISOString(),
    formally_imported: false, reminders: [], sources: [],
  };
  if (!context.branchId || ["clients.read", "health.read", "care_records.read"].some((permission) => !context.scopes.includes(permission))) {
    throw databaseFailure("CARE_REMINDER_ACCESS_DENIED", "目前沒有查閱此個案照顧提醒的權限。", 403);
  }
  const client = await createServerSupabaseClient();
  if (!client) throw databaseFailure("CARE_REMINDER_UNAVAILABLE", "暫時無法取得照顧提醒，請稍後重試。", 503);
  const { data, error } = await client.rpc("care_reminder_snapshot", {
    p_expected_organization_id: context.organizationId, p_expected_branch_id: context.branchId, p_client_id: clientId,
  });
  if (error) throw databaseFailure("CARE_REMINDER_UNAVAILABLE", "暫時無法取得照顧提醒；這不表示個案沒有注意事項。", error.code === "42501" ? 403 : 503);
  const parsed = reminderSnapshotSchema.safeParse(data);
  if (!parsed.success || parsed.data.client_id !== clientId) throw databaseFailure("CARE_REMINDER_INVALID_RESPONSE", "照顧提醒結果無法確認，請重新載入。", 502);
  return parsed.data;
}
