import {
  BellRing,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  Clock3,
  Inbox,
  Search,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import { filterPushNotificationHistory } from "@/lib/push-notifications/projection";
import type {
  PushNotificationFilters,
  PushNotificationHistoryItem,
  PushNotificationManagementSnapshot,
} from "@/lib/push-notifications/types";

import { PushNotificationComposer } from "./push-notification-composer";
import styles from "./push-notifications.module.css";

const priorityLabels = ["低", "一般", "高", "最高"] as const;

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function visibleStatus(notification: PushNotificationHistoryItem, now = new Date()) {
  if (notification.notificationStatus === "cancelled") return "已取消";
  if (
    notification.notificationStatus === "scheduled" &&
    new Date(notification.scheduledFor) > now
  ) {
    return "排程中";
  }
  if (notification.deliveryCounts.failed > 0) return "有失敗紀錄";
  if (notification.deliveryCounts.queued > 0) return "已建立・站內 queued";
  if (
    notification.deliveryCounts.read + notification.deliveryCounts.confirmed >
    0
  ) {
    return "已有收件者開啟";
  }
  return notification.notificationStatus;
}

function DeliverySummary({ notification }: { notification: PushNotificationHistoryItem }) {
  const counts = notification.deliveryCounts;
  return (
    <span className={styles.deliveryStack}>
      <strong>{notification.deliveryTotal} 筆站內 delivery</strong>
      <small>queued {counts.queued}・sent {counts.sent}・delivered {counts.delivered}</small>
      <small>read {counts.read}・confirmed {counts.confirmed}・failed {counts.failed}・suppressed {counts.suppressed}</small>
    </span>
  );
}

export function PushNotificationsWorkspace({
  page,
  snapshot,
  filters,
  hasRecentAal2,
  loadError = false,
}: {
  page: PageCatalogEntry;
  snapshot: PushNotificationManagementSnapshot | null;
  filters: PushNotificationFilters;
  hasRecentAal2: boolean;
  loadError?: boolean;
}) {
  if (loadError || !snapshot) {
    return (
      <section className="empty-card core-care-state" role="alert">
        <span className="empty-card__icon empty-card__icon--warning"><CircleAlert aria-hidden="true" /></span>
        <h1>推播通知管理暫時無法載入</h1>
        <p>系統不會改查其他機構、其他分支、管理員密鑰或展示資料來補值。</p>
        <Link className="button button--secondary" href="/app/staff/communication/push-notifications">重新載入</Link>
      </section>
    );
  }
  const snapshotNow = new Date(snapshot.generatedAt);
  const notifications = filterPushNotificationHistory(
    snapshot,
    filters,
    snapshotNow,
  );
  const categories = [...new Set(snapshot.notifications.map((item) => item.category))]
    .sort((left, right) => left.localeCompare(right, "zh-TW"));
  const previewEnabled = snapshot.demo || (hasRecentAal2 && !snapshot.recipientsTruncated);
  const queueEnabled = !snapshot.demo && hasRecentAal2 && !snapshot.recipientsTruncated;
  const disabledReason = snapshot.recipientsTruncated
    ? `收件者總數 ${snapshot.recipientTotal} 人已超過單次安全上限 500 人；分頁／搜尋尚未交付，因此建立功能已關閉。`
    : !hasRecentAal2 && !snapshot.demo
      ? "建立通知需要最近 15 分鐘內完成雙因素重新驗證。"
      : undefined;

  return (
    <>
      <nav aria-label="所在位置" className="context-bar"><span>工作台</span><ChevronRight aria-hidden="true" /><span>安心照顧與溝通</span><ChevronRight aria-hidden="true" /><span aria-current="page" className="context-bar__crumb">{page.title}</span></nav>
      <header className="page-heading"><div><p className="eyebrow">站內員工通知・頁面 45</p><h1>{page.title}</h1><p className="page-heading__description">以目前機構／分支的有效員工為收件者，先預覽實際名單，再建立或排程站內通知。</p></div></header>

      <div className={`callout ${styles.boundaryCallout}`} role="status"><ShieldAlert aria-hidden="true" /><span><strong>第一版正式邊界：</strong>僅開放 in_app 站內員工通知。PWA、LINE、簡訊與家屬收件均停用；queue 只代表資料已持久化排入，絕不等同 sent、delivered 或 read。</span></div>
      <div className={`callout ${styles.retryCallout}`} role="status"><TriangleAlert aria-hidden="true" /><span><strong>部分失敗重試尚未交付：</strong>目前沒有 provider worker 與失敗 delivery 的個別重試交易，因此畫面只如實顯示 failed 數量，不提供會造成假成功的重試按鈕。</span></div>
      {snapshot.demo ? <div className={`callout ${styles.demoCallout}`} role="status"><Inbox aria-hidden="true" /><span>目前為展示模式：收件者與歷史均為合成資料；可測試伺服器預覽，但不會建立任何通知。</span></div> : !hasRecentAal2 ? <div className={`callout ${styles.reauthCallout}`} role="status"><ShieldAlert aria-hidden="true" /><span>建立與排程需要最近 15 分鐘 AAL2 重新驗證；快照仍保持唯讀。</span><Link className="button button--secondary" href="/mfa?audience=staff">立即重新驗證</Link></div> : null}
      {snapshot.notificationsTruncated ? <div className={`callout ${styles.truncatedCallout}`} role="status"><CircleAlert aria-hidden="true" /><span>歷史單次只載入最新 100 筆；目前共有 {snapshot.notificationTotal} 筆，以下篩選只作用於已載入資料。</span></div> : null}

      <section aria-label="通知建立摘要" className={`metric-grid ${styles.metrics}`}>
        <article className="metric-card"><div className="metric-card__top"><span>有效員工收件者</span><span className="metric-card__icon"><BellRing aria-hidden="true" /></span></div><div className="metric-card__value"><strong>{snapshot.recipientTotal}</strong><span>人</span></div><p className="metric-card__foot">本分支＋機構層級</p></article>
        <article className="metric-card"><div className="metric-card__top"><span>未來排程</span><span className="metric-card__icon"><Clock3 aria-hidden="true" /></span></div><div className="metric-card__value"><strong>{snapshot.scheduledTotal}</strong><span>則</span></div><p className="metric-card__foot">尚未到可見時間</p></article>
        <article className="metric-card"><div className="metric-card__top"><span>站內 queued</span><span className="metric-card__icon"><Inbox aria-hidden="true" /></span></div><div className="metric-card__value"><strong>{snapshot.queuedDeliveryTotal}</strong><span>筆</span></div><p className="metric-card__foot">不代表已送達</p></article>
        <article className="metric-card"><div className="metric-card__top"><span>已讀／已確認</span><span className="metric-card__icon"><CheckCheck aria-hidden="true" /></span></div><div className="metric-card__value"><strong>{snapshot.readOrConfirmedTotal}</strong><span>筆</span></div><p className="metric-card__foot">實際收件操作</p></article>
      </section>

      <PushNotificationComposer demo={snapshot.demo} disabledReason={disabledReason} previewEnabled={previewEnabled} queueEnabled={queueEnabled} recipients={snapshot.recipients} />

      <section className={`panel ${styles.filterPanel}`}>
        <form action="/app/staff/communication/push-notifications" className={styles.filters} method="get" role="search">
          <label className={`field ${styles.searchField}`}><span>關鍵字</span><div className={styles.inputWithIcon}><Search aria-hidden="true" /><input defaultValue={filters.query} maxLength={120} name="q" placeholder="搜尋主旨、分類或建立者" type="search" /></div></label>
          <label className="field"><span>分類</span><select defaultValue={filters.category} name="category"><option value="all">全部分類</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
          <label className="field"><span>真實狀態</span><select defaultValue={filters.status} name="status"><option value="all">全部狀態</option><option value="scheduled">未來排程</option><option value="queued">仍有 queued</option><option value="activity">已有收件活動</option><option value="failed">含 failed</option><option value="cancelled">已取消</option></select></label>
          <label className="field"><span>排程日期</span><input defaultValue={filters.date ?? ""} name="date" type="date" /></label>
          <div className={styles.filterActions}><button className="button button--primary" type="submit">套用篩選</button><Link className="button button--secondary" href="/app/staff/communication/push-notifications">清除</Link></div>
        </form>
      </section>

      <section className="panel">
        <div className="panel__header"><div className="panel__title"><h2>站內通知建立紀錄</h2><p>顯示 {notifications.length} 筆・快照總數 {snapshot.notificationTotal} 筆・更新 {formatDateTime(snapshot.generatedAt)}</p></div><span className={`status-pill ${snapshot.demo ? "status-pill--warning" : "status-pill--success"}`}>{snapshot.demo ? "展示合成資料" : "正式受限快照"}</span></div>
        {notifications.length ? <><div className={`table-wrap ${styles.tableWrap}`}><table className={`data-table ${styles.table}`}><thead><tr><th scope="col">主旨／分類</th><th scope="col">排程／建立</th><th scope="col">對象</th><th scope="col">delivery 實況</th><th scope="col">狀態</th></tr></thead><tbody>{notifications.map((notification) => <tr key={notification.notificationId}><td><span className={styles.message}><strong>{notification.title}</strong><small>{notification.category}・優先度 {notification.priority}（{priorityLabels[notification.priority]}）</small><small>{notification.body}</small></span></td><td><span className={styles.stack}><strong>{formatDateTime(notification.scheduledFor)}</strong><small>建立 {formatDateTime(notification.createdAt)}</small><small>{notification.createdByLabel}</small></span></td><td>員工・站內<br /><small>{notification.deliveryTotal} 人次</small></td><td><DeliverySummary notification={notification} /></td><td><span className={`status-pill ${notification.deliveryCounts.failed ? "status-pill--warning" : ""}`}>{visibleStatus(notification, snapshotNow)}</span></td></tr>)}</tbody></table></div><div className={styles.mobileCards}>{notifications.map((notification) => <article className={styles.mobileCard} key={`${notification.notificationId}-mobile`}><div className={styles.cardTop}><div><p className="eyebrow">{notification.category}・優先度 {notification.priority}</p><h3>{notification.title}</h3></div><span className={`status-pill ${notification.deliveryCounts.failed ? "status-pill--warning" : ""}`}>{visibleStatus(notification, snapshotNow)}</span></div><p>{notification.body}</p><dl><div><dt>排程時間</dt><dd>{formatDateTime(notification.scheduledFor)}</dd></div><div><dt>建立者</dt><dd>{notification.createdByLabel}</dd></div></dl><DeliverySummary notification={notification} /></article>)}</div></> : <div className="empty-card"><span className="empty-card__icon"><Inbox aria-hidden="true" /></span><h2>沒有符合條件的建立紀錄</h2><p>可清除篩選，或在上方完成收件者預覽後建立第一則站內通知。</p></div>}
      </section>
    </>
  );
}
