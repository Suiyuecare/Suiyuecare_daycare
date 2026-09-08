import { AlertTriangle, CalendarDays, CheckCircle2, Clock3, MapPin, Users } from "lucide-react";
import Link from "next/link";

import type { ActivityFilters, ActivityManagementSnapshot, ActivityStatus } from "@/lib/activities/types";
import type { PageCatalogEntry } from "@/lib/catalog";

import { ActivityScheduleForm, ActivityTransitionForm } from "./activity-actions";
import styles from "./activities.module.css";

const statusLabel: Record<ActivityStatus, string> = {
  scheduled: "已排程", in_progress: "進行中", completed: "已完成", cancelled: "已取消",
};
function formatTaipei(value: string) {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

export function ActivityManagementWorkspace({ canCancel, canManage, filters, hasRecentAal2, loadError, page, snapshot }: {
  canCancel: boolean; canManage: boolean; filters: ActivityFilters; hasRecentAal2: boolean;
  loadError: boolean; page: PageCatalogEntry; snapshot: ActivityManagementSnapshot | null;
}) {
  if (loadError || !snapshot) return <section className="empty-card" aria-labelledby="activity-load-error">
    <span className="empty-card__icon empty-card__icon--warning"><AlertTriangle aria-hidden="true" /></span>
    <p className="eyebrow">載入失敗或逾時</p><h1 id="activity-load-error">無法取得活動管理快照</h1>
    <p>系統沒有顯示未經完整授權與驗證的局部資料。請確認網路後重新載入。</p>
    <Link className="button button--secondary" href="/app/staff/social-work/activities">重新載入</Link>
  </section>;
  return <main className={styles.workspace}>
    <header className={styles.hero}><div><p className="eyebrow">第 {page.number} 頁 · 社工服務</p><h1>{page.title}</h1>
      <p>{page.description} 每次排程修改與狀態轉換都保留原版本，不以姓名模糊合併。</p></div>
      <div className={styles.snapshotMeta}><time dateTime={snapshot.generatedAt}>更新 {formatTaipei(snapshot.generatedAt)}</time><span>60 秒後視為可能過期，操作後重新取快照。</span></div></header>
    {snapshot.demo ? <div className={styles.notice} role="status">展示模式：以下皆為合成資料；所有建立、更正、狀態與取消按鈕皆為唯讀。</div> : null}
    <div className={styles.notice} role="note">過去活動補建／補改治理與取消通知規則目前未設定。系統不自創門檻，也不會送出 LINE、簡訊或其他外部通知。</div>
    <section className={styles.metrics} aria-label="活動統計">
      <article><CalendarDays aria-hidden="true" /><span>符合活動</span><strong>{snapshot.matchingTotal}</strong></article>
      <article><Clock3 aria-hidden="true" /><span>即將舉行</span><strong>{snapshot.metrics.upcoming}</strong></article>
      <article><CheckCircle2 aria-hidden="true" /><span>已完成</span><strong>{snapshot.metrics.completed}</strong></article>
      <article><AlertTriangle aria-hidden="true" /><span>已取消</span><strong>{snapshot.metrics.cancelled}</strong></article>
    </section>
    <ActivityScheduleForm canManage={canManage && !snapshot.demo} clients={snapshot.clientOptions} quickClientId={filters.quickClientId} referenceTime={snapshot.generatedAt} staff={snapshot.staffOptions} />
    <form className={styles.filters} method="get" aria-label="篩選活動">
      <label><span>起日</span><input type="date" name="from" defaultValue={filters.dateFrom ?? ""} /></label>
      <label><span>迄日</span><input type="date" name="to" defaultValue={filters.dateTo ?? ""} /></label>
      <label><span>分支</span><input value="目前授權分支" disabled /></label>
      <label><span>活動類型</span><select name="type" defaultValue={filters.activityType ?? "all"}><option value="all">全部類型</option>{snapshot.typeOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label><span>狀態</span><select name="status" defaultValue={filters.status}><option value="all">全部狀態</option><option value="scheduled">已排程</option><option value="in_progress">進行中</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></label>
      <label className={styles.wide}><span>關鍵字</span><input name="q" defaultValue={filters.query} maxLength={120} placeholder="只搜尋活動類型、標題、摘要與地點" /></label>
      <button className="button button--secondary" type="submit">套用篩選</button><Link className="button button--ghost" href="/app/staff/social-work/activities">清除</Link>
    </form>
    <div className={styles.resultHeader}><p>顯示 {snapshot.items.length} / {snapshot.matchingTotal} 筆活動</p>
      {snapshot.itemsTruncated ? <p role="status">明細上限 200 筆；卡片統計仍涵蓋完整篩選集合。</p> : null}
      {snapshot.clientTruncated ? <p role="status">個案選項顯示 {snapshot.clientOptions.length} / {snapshot.clientTotal} 人。</p> : null}
      {snapshot.staffTruncated ? <p role="status">負責人選項顯示 {snapshot.staffOptions.length} / {snapshot.staffTotal} 人。</p> : null}
      {snapshot.typeTruncated ? <p role="status">類型選項顯示 {snapshot.typeOptions.length} / {snapshot.typeTotal} 種。</p> : null}</div>
    {snapshot.items.length === 0 ? <section className="empty-card" aria-labelledby="activity-empty"><span className="empty-card__icon"><CalendarDays aria-hidden="true" /></span><h2 id="activity-empty">沒有符合條件的活動</h2><p>請調整日期、類型、狀態或關鍵字；具管理權限者也可建立未來活動。</p></section> :
      <section className={styles.cards} aria-label="活動明細">{snapshot.items.map((activity) => <article className={styles.card} key={activity.activityId}>
        <header className={styles.cardHeader}><div><p className="eyebrow">{activity.activityType}</p><h2>{activity.title}</h2><p>{formatTaipei(activity.startsAt)} – {formatTaipei(activity.endsAt)}</p></div><div className={styles.badges}><span>{statusLabel[activity.status]}</span><span>排程 v{activity.scheduleVersion}</span><span>狀態 #{activity.statusSequence}</span></div></header>
        <p>{activity.searchSummary}</p><div className={styles.details}><p><MapPin aria-hidden="true" />{activity.location}</p><p><Users aria-hidden="true" />負責：{activity.responsibleDisplayName}</p><p>參與 {activity.participantCount} / 容量 {activity.capacity}：{activity.participants.length ? activity.participants.map((value) => value.displayName).join("、") : "未指定"}</p></div>
        {activity.cancellationReason ? <p className={styles.warning}><strong>取消原因：</strong>{activity.cancellationReason}</p> : null}
        <div className={styles.actions}>
          {activity.status === "scheduled" ? <><ActivityTransitionForm action="start" activity={activity} canAct={canManage && !snapshot.demo} hasRecentAal2={hasRecentAal2} /><ActivityTransitionForm action="complete" activity={activity} canAct={canManage && !snapshot.demo} hasRecentAal2={hasRecentAal2} /></> : null}
          {activity.status === "in_progress" ? <ActivityTransitionForm action="complete" activity={activity} canAct={canManage && !snapshot.demo} hasRecentAal2={hasRecentAal2} /> : null}
          {!["completed", "cancelled"].includes(activity.status) ? <ActivityTransitionForm action="cancel" activity={activity} canAct={canCancel && !snapshot.demo} hasRecentAal2={hasRecentAal2} /> : null}
        </div>
        {activity.status === "scheduled" ? <ActivityScheduleForm activity={activity} canManage={canManage && !snapshot.demo} clients={snapshot.clientOptions} quickClientId={null} referenceTime={snapshot.generatedAt} staff={snapshot.staffOptions} /> : null}
        <details className={styles.history}><summary>查看不可覆寫歷程（排程 {activity.scheduleHistoryTotal}、狀態 {activity.statusHistoryTotal}）</summary>
          <h3>狀態歷程</h3><ol>{activity.statusHistory.map((entry) => <li key={entry.statusEventId}>#{entry.sequence} {entry.fromStatus ? `${statusLabel[entry.fromStatus]} → ` : ""}{statusLabel[entry.toStatus]} · {formatTaipei(entry.changedAt)} · {entry.changerDisplayName}{entry.transitionNote ? `；${entry.transitionNote}` : ""}</li>)}</ol>
          <h3>排程版本</h3><ol>{activity.scheduleHistory.map((entry) => <li key={entry.scheduleVersionId}>v{entry.version} · {formatTaipei(entry.startsAt)} · {entry.creatorDisplayName}{entry.revisionReason ? `；理由：${entry.revisionReason}` : ""}</li>)}</ol>
          {activity.scheduleHistoryTotal > activity.scheduleHistory.length || activity.statusHistoryTotal > activity.statusHistory.length ? <p>單一歷程顯示最近 50 筆；總數仍完整。</p> : null}
        </details>
      </article>)}</section>}
  </main>;
}
