import {
  BellRing,
  CalendarDays,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  ClockAlert,
  ExternalLink,
  Inbox,
  Search,
} from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  NotificationCenterFilters,
  NotificationCenterItem,
  NotificationCenterSnapshot,
} from "@/lib/notification-center/types";

import { NotificationAcknowledgementAction } from "./notification-acknowledgement-action";
import styles from "./notification-center.module.css";

const priorityLabels = ["低", "一般", "高", "最高"] as const;
const statusLabels = {
  queued: "未讀",
  sent: "未讀",
  delivered: "未讀",
  read: "已讀",
  confirmed: "已確認",
  failed: "傳送失敗",
  suppressed: "已抑制",
} as const;

function formatDateTime(value: string | null) {
  if (!value) return "—";
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

function visibleStatus(item: NotificationCenterItem) {
  if (item.status === "confirmed") return "已確認";
  if (item.status === "read") {
    return item.requiresConfirmation ? "已讀・待確認" : "已讀";
  }
  return statusLabels[item.status];
}

function statusClass(item: NotificationCenterItem) {
  if (item.status === "confirmed") return "status-pill--success";
  if (item.requiresConfirmation && item.confirmedAt === null) {
    return "status-pill--warning";
  }
  return "";
}

function SourceLink({ item }: { item: NotificationCenterItem }) {
  if (!item.sourceHref) {
    return <span className={styles.muted}>無可開啟來源</span>;
  }
  return (
    <Link className={styles.sourceLink} href={item.sourceHref}>
      查看來源 <ExternalLink aria-hidden="true" />
    </Link>
  );
}

export function NotificationCenterWorkspace({
  page,
  snapshot,
  filters,
  canAcknowledge,
  loadError = false,
}: {
  page: PageCatalogEntry;
  snapshot: NotificationCenterSnapshot | null;
  filters: NotificationCenterFilters;
  canAcknowledge: boolean;
  loadError?: boolean;
}) {
  if (loadError || !snapshot) {
    return (
      <section className="empty-card core-care-state" role="alert">
        <span className="empty-card__icon empty-card__icon--warning">
          <CircleAlert aria-hidden="true" />
        </span>
        <h1>通知中心暫時無法載入</h1>
        <p>系統不會改查其他分支、管理員金鑰或展示資料來補值。</p>
        <Link className="button button--secondary" href="/app/staff/operations/notifications">
          重新載入
        </Link>
      </section>
    );
  }
  const categories = [...new Set(snapshot.items.map((item) => item.category))]
    .sort((left, right) => left.localeCompare(right, "zh-TW"));
  const disabledReason = snapshot.demo
    ? "展示模式只讀，不會寫入已讀或確認狀態"
    : !canAcknowledge
      ? "目前角色沒有 notifications.read 權限"
      : undefined;

  return (
    <>
      <nav aria-label="所在位置" className="context-bar">
        <span>工作台</span><ChevronRight aria-hidden="true" /><span>機構營運管理</span><ChevronRight aria-hidden="true" /><span aria-current="page" className="context-bar__crumb">{page.title}</span>
      </nav>
      <header className="page-heading">
        <div>
          <p className="eyebrow">收件者專用流程・頁面 67</p>
          <h1>{page.title}</h1>
          <p className="page-heading__description">只顯示目前登入人員在所選機構與分支收到的站內通知；每筆通知只出現一次。</p>
        </div>
      </header>

      <div className={`callout ${styles.boundaryCallout}`} role="status">
        <CircleAlert aria-hidden="true" />
        <span><strong>目前規則邊界：</strong>最高優先度（3）暫作需確認通知；正式確認期限與逾時升級規則尚未由業務發布，因此畫面不製造逾期數字，也不宣稱已完成自動升級。</span>
      </div>
      {snapshot.demo ? (
        <div className={`callout ${styles.demoCallout}`} role="status">
          <Inbox aria-hidden="true" /><span>目前為展示模式：全部通知皆為合成資料，已讀與確認按鈕維持停用。</span>
        </div>
      ) : null}
      {snapshot.itemsTruncated ? (
        <div className={`callout ${styles.truncatedCallout}`} role="status">
          <CircleAlert aria-hidden="true" /><span>單次安全快照只載入前 200 筆，現有 {snapshot.itemTotal} 筆；已優先顯示最高優先待確認與未讀通知。篩選只作用於已載入資料。</span>
        </div>
      ) : null}

      <section aria-label="通知摘要" className={`metric-grid ${styles.metrics}`}>
        <article className="metric-card"><div className="metric-card__top"><span>未讀</span><span className="metric-card__icon"><BellRing aria-hidden="true" /></span></div><div className="metric-card__value"><strong>{snapshot.unreadTotal}</strong><span>筆</span></div><p className="metric-card__foot">站內收件</p></article>
        <article className="metric-card"><div className="metric-card__top"><span>最高優先待確認</span><span className="metric-card__icon"><CheckCheck aria-hidden="true" /></span></div><div className="metric-card__value"><strong>{snapshot.confirmationPendingTotal}</strong><span>筆</span></div><p className="metric-card__foot">技術暫行規則</p></article>
        <article className="metric-card"><div className="metric-card__top"><span>今日通知</span><span className="metric-card__icon"><CalendarDays aria-hidden="true" /></span></div><div className="metric-card__value"><strong>{snapshot.todayTotal}</strong><span>筆</span></div><p className="metric-card__foot">Asia/Taipei</p></article>
        <article className="metric-card"><div className="metric-card__top"><span>逾期</span><span className="metric-card__icon"><ClockAlert aria-hidden="true" /></span></div><div className={`metric-card__value ${styles.pendingMetric}`}><strong>—</strong></div><p className="metric-card__foot">期限規則尚未發布</p></article>
      </section>

      <section className={`panel ${styles.filterPanel}`}>
        <form action="/app/staff/operations/notifications" className={styles.filters} method="get" role="search">
          <label className={`field ${styles.searchField}`}><span>關鍵字</span><div className={styles.inputWithIcon}><Search aria-hidden="true" /><input defaultValue={filters.query} maxLength={120} name="q" placeholder="搜尋主旨或分類" type="search" /></div></label>
          <label className="field"><span>狀態</span><select defaultValue={filters.status} name="status"><option value="all">全部狀態</option><option value="unread">未讀</option><option value="confirmation_pending">待確認</option><option value="confirmed">已確認</option></select></label>
          <label className="field"><span>分類</span><select defaultValue={filters.category} name="category"><option value="all">全部分類</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
          <label className="field"><span>優先度</span><select defaultValue={filters.priority} name="priority"><option value="all">全部優先度</option>{priorityLabels.map((label, priority) => <option key={label} value={priority}>{priority}・{label}</option>)}</select></label>
          <label className="field"><span>日期</span><input defaultValue={filters.date ?? ""} name="date" type="date" /></label>
          <div className={styles.filterActions}><button className="button button--primary" type="submit">套用篩選</button><Link className="button button--secondary" href="/app/staff/operations/notifications">清除篩選</Link></div>
        </form>
      </section>

      <section className="panel">
        <div className="panel__header">
          <div className="panel__title"><h2>我的站內通知</h2><p>顯示 {snapshot.items.length} 筆・快照總數 {snapshot.itemTotal} 筆・更新 {formatDateTime(snapshot.generatedAt)}</p></div>
          <span className={`status-pill ${snapshot.demo ? "status-pill--warning" : "status-pill--success"}`}>{snapshot.demo ? "展示合成資料" : "正式受限快照"}</span>
        </div>
        {snapshot.items.length ? (
          <>
            <div className={`table-wrap ${styles.tableWrap}`}>
              <table className={`data-table ${styles.table}`}>
                <thead><tr><th scope="col">時間／分類</th><th scope="col">優先度</th><th scope="col">主旨</th><th scope="col">來源</th><th scope="col">狀態</th><th scope="col">操作</th></tr></thead>
                <tbody>{snapshot.items.map((item) => (
                  <tr key={item.deliveryId}>
                    <td><span className={styles.stack}><strong>{formatDateTime(item.availableAt)}</strong><small>{item.category}</small></span></td>
                    <td><span className={`${styles.priority} ${item.priority === 3 ? styles.priorityCritical : ""}`}>{item.priority}・{priorityLabels[item.priority]}</span></td>
                    <td><span className={styles.message}><strong>{item.title}</strong><small>{item.body}</small></span></td>
                    <td><SourceLink item={item} /></td>
                    <td><span className={`status-pill ${statusClass(item)}`}>{visibleStatus(item)}</span></td>
                    <td><NotificationAcknowledgementAction disabledReason={disabledReason} enabled={canAcknowledge && !snapshot.demo} instance="desktop" item={item} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className={styles.mobileCards}>{snapshot.items.map((item) => (
              <article className={styles.mobileCard} key={`${item.deliveryId}-mobile`}>
                <div className={styles.cardTop}><div><p className="eyebrow">{formatDateTime(item.availableAt)}・{item.category}</p><h3>{item.title}</h3></div><span className={`status-pill ${statusClass(item)}`}>{visibleStatus(item)}</span></div>
                <p>{item.body}</p>
                <dl><div><dt>優先度</dt><dd>{item.priority}・{priorityLabels[item.priority]}</dd></div><div><dt>來源</dt><dd><SourceLink item={item} /></dd></div></dl>
                <NotificationAcknowledgementAction disabledReason={disabledReason} enabled={canAcknowledge && !snapshot.demo} instance="mobile" item={item} />
              </article>
            ))}</div>
          </>
        ) : (
          <div className="empty-card"><span className="empty-card__icon"><Inbox aria-hidden="true" /></span><h2>沒有符合條件的通知</h2><p>可清除篩選，或稍後重新整理查看新通知。</p><Link className="button button--secondary" href="/app/staff/operations/notifications">清除篩選</Link></div>
        )}
      </section>
    </>
  );
}
