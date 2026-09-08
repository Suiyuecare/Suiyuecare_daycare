import { AlertTriangle, CalendarDays, Clock3, MapPin, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  ReassuranceCalendarCategory,
  ReassuranceCalendarFilters,
  ReassuranceCalendarItem,
  ReassuranceCalendarSnapshot,
  ReassuranceCalendarStatus,
} from "@/lib/reassurance-calendar/types";

import {
  ReassuranceCalendarCancelForm,
  ReassuranceCalendarEventForm,
} from "./reassurance-calendar-actions";
import styles from "./reassurance-calendar.module.css";

const categoryLabel: Record<ReassuranceCalendarCategory, string> = {
  care: "照顧", activity: "活動", transport: "交通",
  appointment: "約定", reminder: "提醒",
};
const statusLabel: Record<ReassuranceCalendarStatus, string> = {
  scheduled: "已排程", cancelled: "已取消",
};
function formatTaipei(value: string, timeOnly = false) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: timeOnly ? undefined : "numeric",
    month: timeOnly ? undefined : "2-digit", day: timeOnly ? undefined : "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

function EventSummary({ item, compact = false }: {
  item: ReassuranceCalendarItem; compact?: boolean;
}) {
  return <div className={compact ? styles.compactEvent : styles.eventSummary}>
    <div className={styles.eventTitle}><strong>{item.title}</strong>
      <span>{statusLabel[item.status]}</span></div>
    <p>{formatTaipei(item.startsAt, compact)} – {formatTaipei(item.endsAt, compact)}</p>
    {item.status === "cancelled" ? <p className={styles.cancelReason}><strong>取消原因：</strong>{item.cancellationReason}</p> : null}
  </div>;
}

export function ReassuranceCalendarWorkspace({
  filters, hasRecentAal2, loadError, page, snapshot,
}: {
  filters: ReassuranceCalendarFilters; hasRecentAal2: boolean;
  loadError: boolean; page: PageCatalogEntry;
  snapshot: ReassuranceCalendarSnapshot | null;
}) {
  if (loadError || !snapshot) return <section className="empty-card" aria-labelledby="calendar-load-error">
    <span className="empty-card__icon empty-card__icon--warning"><AlertTriangle aria-hidden="true" /></span>
    <p className="eyebrow">載入失敗或逾時</p><h1 id="calendar-load-error">無法取得安心行事曆快照</h1>
    <p>系統沒有顯示未經完整機構、分支與資料範圍驗證的局部資料。</p>
    <Link className="button button--secondary" href="/app/staff/communication/calendar">重新載入</Link>
  </section>;
  return <main className={styles.workspace}>
    <header className={styles.hero}><div><p className="eyebrow">第 {page.number} 頁 · 安心照顧與溝通</p>
      <h1>{page.title}</h1><p>{page.description} 已發布版本一律不可原地覆寫。</p></div>
      <div className={styles.snapshotMeta}><time dateTime={snapshot.generatedAt}>更新 {formatTaipei(snapshot.generatedAt)}</time>
        <span>快照 {snapshot.snapshotToken.slice(0, 12)}…</span><span>60 秒後視為可能過期</span></div></header>
    {snapshot.demo ? <div className={styles.notice} role="status">展示模式：全部為合成資料；新增、更正與取消皆唯讀。</div> : null}
    <div className={styles.notice} role="note">月曆與列表直接共用同一不可變快照，共 {snapshot.items.length} 筆；外部通知與電子簽署均為 <strong>not_configured</strong>，沒有宣稱已送達或已簽署。</div>
    <section className={styles.metrics} aria-label="行事曆統計">
      <article><CalendarDays aria-hidden="true" /><span>符合行程</span><strong>{snapshot.matchingTotal}</strong></article>
      <article><Clock3 aria-hidden="true" /><span>今日行程</span><strong>{snapshot.metrics.today}</strong></article>
      <article><ShieldCheck aria-hidden="true" /><span>已排程</span><strong>{snapshot.metrics.scheduled}</strong></article>
      <article><AlertTriangle aria-hidden="true" /><span>已取消</span><strong>{snapshot.metrics.cancelled}</strong></article>
    </section>
    <ReassuranceCalendarEventForm canManage={snapshot.canManage && !snapshot.demo}
      clients={snapshot.clientOptions} referenceTime={snapshot.generatedAt}
      staff={snapshot.staffOptions} />
    <form className={styles.filters} method="get" aria-label="篩選安心行事曆">
      <label><span>月份</span><input type="month" name="month" defaultValue={filters.month} /></label>
      <label><span>機構</span><select name="organization" defaultValue={snapshot.organizationId}>
        <option value={snapshot.organizationId}>{snapshot.organizationName}</option></select></label>
      <label><span>分類</span><select name="category" defaultValue={filters.category ?? "all"}>
        <option value="all">全部分類</option>{snapshot.categoryOptions.map((value) =>
          <option key={value} value={value}>{categoryLabel[value]}</option>)}</select></label>
      <label><span>狀態</span><select name="status" defaultValue={filters.status}>
        <option value="all">全部狀態</option><option value="scheduled">已排程</option>
        <option value="cancelled">已取消</option></select></label>
      <label className={styles.todayToggle}><input type="checkbox" name="today" value="1" defaultChecked={filters.todayOnly} /><span>只看今日</span></label>
      <label className={styles.wide}><span>關鍵字</span><input name="q" maxLength={120} defaultValue={filters.query} placeholder="搜尋標題、摘要或地點" /></label>
      <button className="button button--secondary" type="submit">套用篩選</button>
      <Link className="button button--ghost" href="/app/staff/communication/calendar">清除</Link>
    </form>
    <section className={styles.viewConsistency} aria-label="檢視一致性">
      <strong>同一快照：月曆 {snapshot.items.length} 筆／列表 {snapshot.items.length} 筆</strong>
      <span>{snapshot.branchName} · {snapshot.monthStart.slice(0, 7)}</span>
    </section>
    {snapshot.itemsTruncated ? <p className={styles.warning} role="status">明細只顯示前 200 筆；統計仍是完整篩選結果。</p> : null}
    <section aria-labelledby="month-calendar-title"><div className={styles.sectionHeading}>
      <h2 id="month-calendar-title">月曆檢視</h2><span>取消原因在行程內直接呈現</span></div>
      <div className={styles.calendarGrid}>{snapshot.calendarDays.map((day) => <article className={styles.day} key={day.date}>
        <h3><time dateTime={day.date}>{day.day} 日</time></h3>
        {day.events.length === 0 ? <span className={styles.noEvent}>無行程</span> : day.events.map((item) =>
          <div data-calendar-event={item.eventKey} key={item.eventKey}><EventSummary item={item} compact /></div>)}
      </article>)}</div>
    </section>
    <section aria-labelledby="calendar-list-title"><div className={styles.sectionHeading}>
      <h2 id="calendar-list-title">列表檢視</h2><span>與月曆共用 snapshot.items</span></div>
      {snapshot.items.length === 0 ? <div className="empty-card"><span className="empty-card__icon"><CalendarDays aria-hidden="true" /></span>
        <h3>本月沒有符合條件的行程</h3><p>可調整機構、分類、狀態、今日或關鍵字篩選。</p></div> :
        <div className={styles.list}>{snapshot.items.map((item) => <article className={styles.card} data-list-event={item.eventKey} key={item.eventKey}>
          <header><div><p className="eyebrow">{categoryLabel[item.category]} · v{item.version}</p><h3>{item.title}</h3></div>
            <span className={item.status === "cancelled" ? styles.cancelledBadge : styles.statusBadge}>{statusLabel[item.status]}</span></header>
          <EventSummary item={item} /><p>{item.summary}</p>
          <div className={styles.details}><p><MapPin aria-hidden="true" />{item.location}</p>
            <p><Users aria-hidden="true" />負責：{item.responsibleDisplayName}</p>
            <p><Users aria-hidden="true" />對象：{item.audience.map((value) => value.displayName).join("、")}</p>
            <p>發布：{formatTaipei(item.publishedAt)} · {item.publisherDisplayName}</p></div>
          {item.cancellationReason ? <p className={styles.cancelReason}><strong>取消原因：</strong>{item.cancellationReason}</p> : null}
          {item.status === "scheduled" ? <div className={styles.actions}>
            <ReassuranceCalendarEventForm event={item} canManage={snapshot.canManage && !snapshot.demo}
              clients={snapshot.clientOptions} referenceTime={snapshot.generatedAt} staff={snapshot.staffOptions} />
            <ReassuranceCalendarCancelForm event={item} canCancel={snapshot.canCancel && !snapshot.demo} hasRecentAal2={hasRecentAal2} />
          </div> : null}
          <details className={styles.history}><summary>不可覆寫版本歷程（{item.history.length}）</summary>
            <ol>{item.history.map((entry) => <li key={entry.versionId}>v{entry.version} · {statusLabel[entry.status]} · {formatTaipei(entry.publishedAt)} · {entry.publisherDisplayName}{entry.reason ? `；理由：${entry.reason}` : ""}<br /><code>{entry.contentHash.slice(0, 12)}…</code></li>)}</ol>
          </details>
        </article>)}</div>}
    </section>
  </main>;
}
