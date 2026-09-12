import type { TenantContext } from "@/lib/domain/types";
import { loadCareReminders } from "@/lib/care-reminders/server";
import { CareReminderPanel, RefreshCareReminders } from "./care-reminder-panel";

export async function CareReminderCard({ context, clientId }: { context: TenantContext; clientId: string }) {
  const snapshot = await loadCareReminders(context, clientId).catch(() => null);
  if (!snapshot) {
    return <section className="panel" aria-labelledby="care-reminder-unavailable"><div className="panel__body">
      <h2 id="care-reminder-unavailable">個案照顧提醒</h2><p role="status">目前無法取得提醒或您尚無查閱權限，這不表示沒有注意事項。請向負責人確認現行照顧計畫。</p>
      <RefreshCareReminders />
    </div></section>;
  }
  return <CareReminderPanel key={clientId} initial={snapshot} demo={context.demo} />;
}
