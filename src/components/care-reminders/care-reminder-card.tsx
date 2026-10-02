import type { TenantContext } from "@/lib/domain/types";
import { loadCareReminders } from "@/lib/care-reminders/server";
import { formatCareTaipeiTime } from "@/lib/core-care/date";
import { NavigationLink } from "@/components/app/navigation-link";
import { CareReminderPanel, RefreshCareReminders } from "./care-reminder-panel";
import styles from "./care-reminders.module.css";

export async function CareReminderCard({ context, clientId }: { context: TenantContext; clientId: string }) {
  const snapshot = await loadCareReminders(context, clientId).catch(() => null);
  if (!snapshot) {
    return <section className="panel" aria-labelledby="care-reminder-unavailable"><div className="panel__body">
      <h2 id="care-reminder-unavailable">個案照顧提醒</h2><p role="status">目前無法取得提醒或您尚無查閱權限，這不表示沒有注意事項。請向負責人確認現行照顧計畫。</p>
      <RefreshCareReminders />
    </div></section>;
  }
  if (!snapshot.reviewer && snapshot.reminders.length === 0) {
    const canViewPlan = context.demo || (context.assuranceLevel === "aal2" &&
      ["clients.read", "care_plans.read"].every((scope) => context.scopes.includes(scope)));
    return <section className="panel" aria-labelledby="care-reminder-empty-heading">
      <div className={`panel__body ${styles.compactEmpty}`}>
        <h2 id="care-reminder-empty-heading">個案照顧提醒</h2>
        <p role="status">沒有已核對提醒，不等於沒有風險。請核對照顧計畫；無法查閱請洽負責人。</p>
        <p className={styles.compactMeta}>提醒更新：{formatCareTaipeiTime(snapshot.generated_at)}（臺北時間）。</p>
        {context.demo ? <p className={styles.compactDemo}>展示資料，非真實個案提醒；勿作照顧判斷。</p> : null}
        <div className={styles.compactActions}>
          {canViewPlan ? <NavigationLink className="button button--primary" href={`/app/staff/service-management/approved-care-plans?client=${snapshot.client_id}`} loadingLabel="核定照顧計畫" prefetch={false}>查詢核定照顧計畫</NavigationLink> : null}
          {!context.demo ? <RefreshCareReminders /> : null}
        </div>
      </div>
    </section>;
  }
  return <CareReminderPanel key={clientId} initial={snapshot} demo={context.demo} />;
}
