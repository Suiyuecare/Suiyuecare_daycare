import { BellRing, BookOpenCheck, CalendarClock, ChevronRight, CircleAlert, Eye, FilePenLine, Search, ShieldCheck, Undo2 } from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  StaffAnnouncementFilters,
  StaffAnnouncementItem,
  StaffAnnouncementLifecycle,
  StaffAnnouncementSnapshot,
} from "@/lib/staff-announcements/types";

import {
  StaffAnnouncementDraftAction,
  StaffAnnouncementPublishAction,
  StaffAnnouncementReadAction,
  StaffAnnouncementWithdrawAction,
} from "./staff-announcement-actions";
import styles from "./staff-announcements.module.css";

const lifecycleLabels: Record<StaffAnnouncementLifecycle, string> = {
  draft: "尚未發布",
  scheduled: "已排程",
  published: "已發布",
  expired: "已到期",
  withdrawn: "已撤回",
};

function formatTime(value: string | null) {
  if (!value) return "無到期時間";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

function statusClass(lifecycle: StaffAnnouncementLifecycle) {
  if (lifecycle === "published") return "status-pill status-pill--success";
  if (lifecycle === "withdrawn" || lifecycle === "expired") return "status-pill status-pill--danger";
  if (lifecycle === "scheduled") return "status-pill status-pill--warning";
  return "status-pill";
}

function DraftReleaseContent({ item }: { item: StaffAnnouncementItem }) {
  if (!item.hasPendingDraft || !item.activeReleaseVersion) return <>
    <strong>{item.title}</strong><p>{item.body}</p>
  </>;
  return <div className={styles.contentCompare}>
    <section><span>未發布草稿 v{item.version}</span><strong>{item.title}</strong><p>{item.body}</p></section>
    <section><span>目前發布 v{item.activeReleaseVersion}（已讀統計歸屬此版）</span><strong>{item.activeReleaseTitle}</strong><p>{item.activeReleaseBody}</p></section>
  </div>;
}

function RowActions({ item, snapshot, canPublish, hasRecentAal2, canRead }: {
  item: StaffAnnouncementItem;
  snapshot: StaffAnnouncementSnapshot;
  canPublish: boolean;
  hasRecentAal2: boolean;
  canRead: boolean;
}) {
  return <div className={styles.rowActions}>
    {snapshot.canManage ? <>
      <StaffAnnouncementDraftAction item={item} staff={snapshot.audienceStaff} roles={snapshot.audienceRoles} canManage demo={snapshot.demo} />
      {item.versionState === "draft" ? <StaffAnnouncementPublishAction item={item} canPublish={canPublish} hasRecentAal2={hasRecentAal2} demo={snapshot.demo} generatedAt={snapshot.generatedAt} /> : null}
      {item.activeReleaseVersionId && item.lifecycle !== "withdrawn" ? <StaffAnnouncementWithdrawAction item={item} canPublish={canPublish} hasRecentAal2={hasRecentAal2} demo={snapshot.demo} generatedAt={snapshot.generatedAt} /> : null}
      {item.activeReleaseVersionId ? <Link className="button button--quiet" href={`?release=${item.activeReleaseVersionId}`}><Eye aria-hidden="true" />收件明細</Link> : null}
    </> : null}
    <StaffAnnouncementReadAction item={item} enabled={canRead} demo={snapshot.demo} />
  </div>;
}

export function StaffAnnouncementsWorkspace({
  page, snapshot, filters, canPublish, hasRecentAal2, canRead, loadError = false,
}: {
  page: PageCatalogEntry;
  snapshot: StaffAnnouncementSnapshot | null;
  filters: StaffAnnouncementFilters;
  canPublish: boolean;
  hasRecentAal2: boolean;
  canRead: boolean;
  loadError?: boolean;
}) {
  if (loadError || !snapshot) return <section className="empty-card core-care-state" role="alert">
    <span className="empty-card__icon empty-card__icon--warning"><CircleAlert aria-hidden="true" /></span>
    <h1>公告管理暫時無法載入</h1>
    <p>系統不會改查其他分支、直接資料表、通知佇列或展示資料；請確認權限後重試。</p>
    <a className="button button--secondary" href="?">重新載入</a>
  </section>;
  const hasFilters = Boolean(filters.query || filters.status !== "all");
  const loadedLabel = snapshot.itemsTruncated
    ? `已載入最近 ${snapshot.items.length}／全量 ${snapshot.availableTotal} 則`
    : `已載入 ${snapshot.items.length}／全量 ${snapshot.availableTotal} 則`;
  return <>
    <nav aria-label="所在位置" className="context-bar"><span>工作台</span><ChevronRight aria-hidden="true" /><span>機構營運管理</span><ChevronRight aria-hidden="true" /><span aria-current="page" className="context-bar__crumb">{page.title}</span></nav>
    <header className="page-heading core-care-heading">
      <div><p className="eyebrow">員工入口公告・頁面 {page.number}</p><h1>{page.title}</h1><p className="page-heading__description">公告以不可變版本管理；發布時凍結本分支有效員工收件名單，已讀只來自收件人實際回條。</p></div>
      {snapshot.canManage ? <StaffAnnouncementDraftAction staff={snapshot.audienceStaff} roles={snapshot.audienceRoles} canManage demo={snapshot.demo} /> : null}
    </header>
    {snapshot.demo ? <div className={`callout ${styles.demoCallout}`} role="status"><CircleAlert aria-hidden="true" /><span><strong>展示模式：</strong>以下均為合成資料；建立、發布、撤回與已讀 API 都會回絕，不會假裝成功。</span></div> : <div className={`callout ${styles.securityCallout}`}><ShieldCheck aria-hidden="true" /><span>本頁由單一 audited DB snapshot 回傳公告、全量統計及選定收件明細；更新 {formatTime(snapshot.generatedAt)}。</span></div>}
    <div className={`callout ${styles.boundaryCallout}`}><BellRing aria-hidden="true" /><span><strong>傳遞邊界：</strong>目前僅是員工登入入口公告及實際已讀回條，不代表通知送達，也未串接 LINE、PWA 推播、簡訊、家屬端或外部 provider。</span></div>
    {snapshot.canManage && canPublish && !hasRecentAal2 && !snapshot.demo ? <div className={`callout ${styles.reauthCallout}`}><ShieldCheck aria-hidden="true" /><span>可建立草稿；發布與撤回前須完成最近 15 分鐘 AAL2。</span><Link className="button button--secondary" href="/mfa?audience=staff&purpose=sensitive-action">前往重新驗證</Link></div> : null}
    <section aria-label="公告摘要" className="metric-grid">
      {[
        ["草稿版本", snapshot.metrics.drafts, "則", <FilePenLine aria-hidden="true" key="draft" />],
        ["排程中", snapshot.metrics.scheduled, "則", <CalendarClock aria-hidden="true" key="scheduled" />],
        ["已發布", snapshot.metrics.published, "則", <BellRing aria-hidden="true" key="published" />],
        ["已到期", snapshot.metrics.expired, "則", <CalendarClock aria-hidden="true" key="expired" />],
        ["已撤回", snapshot.metrics.withdrawn, "則", <Undo2 aria-hidden="true" key="withdrawn" />],
        ["實際未讀", snapshot.metrics.unreadRecipients, "人次", <BookOpenCheck aria-hidden="true" key="unread" />],
      ].map(([label, value, unit, icon]) => <article className="metric-card" key={String(label)}><div className="metric-card__top"><span>{label}</span><span className="metric-card__icon">{icon}</span></div><div className="metric-card__value"><strong>{value}</strong><span>{unit}</span></div><p className="metric-card__foot">同一完整 DB aggregate</p></article>)}
    </section>
    <section className="panel">
      <div className="panel__header"><div className="panel__title"><h2>公告版本與發布狀態</h2><p>{loadedLabel}；篩選只作用於目前已載入列，完整統計不隨本地篩選改寫。</p></div></div>
      {snapshot.itemsTruncated ? <div className={`callout ${styles.truncatedCallout}`} role="status"><CircleAlert aria-hidden="true" /><span>七年歷史超過 100 則；此版尚未提供伺服器分頁，以下不宣稱為完整歷史搜尋。</span></div> : null}
      <form className="filter-bar" method="get">
        <label className="filter-search"><Search aria-hidden="true" /><span className="sr-only">搜尋已載入公告</span><input defaultValue={filters.query} maxLength={120} name="q" placeholder="搜尋已載入標題或內容…" type="search" /></label>
        <label className="field field--compact"><span>發布狀態</span><select defaultValue={filters.status} name="status"><option value="all">全部狀態</option>{Object.entries(lifecycleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button className="button button--secondary" type="submit">套用</button>{hasFilters ? <Link className="button button--quiet" href="?">清除</Link> : null}
      </form>
      {snapshot.items.length ? <>
        <div aria-label="公告管理表格，可左右捲動" className={`table-wrap ${styles.table}`} role="region" tabIndex={0}>
          <table className="data-table"><thead><tr>{["公告內容", "版本／狀態", "發布／到期", "目前發布版收件／已讀", "操作"].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead><tbody>{snapshot.items.map((item) => <tr key={item.announcementKey}>
            <td className={styles.contentCell}><DraftReleaseContent item={item} /></td>
            <td><strong>v{item.version}</strong><span className={statusClass(item.lifecycle)}>{lifecycleLabels[item.lifecycle]}</span>{item.hasPendingDraft ? <small className="data-table__secondary">另有目前發布 v{item.activeReleaseVersion}</small> : null}{item.withdrawalReason ? <small className="data-table__secondary">理由：{item.withdrawalReason}</small> : null}</td>
            <td><span>{formatTime(item.publishAt)}</span><small className="data-table__secondary">到期：{formatTime(item.expiresAt)}</small></td>
            <td>{item.activeReleaseVersionId ? <><strong>v{item.activeReleaseVersion}・{item.recipientCount} 人</strong><small className="data-table__secondary">實際已讀 {item.readCount}・未讀 {item.unreadCount}</small></> : "尚未發布，無收件快照"}</td>
            <td><RowActions item={item} snapshot={snapshot} canPublish={canPublish} hasRecentAal2={hasRecentAal2} canRead={canRead} /></td>
          </tr>)}</tbody></table>
        </div>
        <div className="mobile-records core-care-mobile">{snapshot.items.map((item) => <article className="record-card" key={item.announcementKey}><div className="record-card__top"><div><h3>{item.title}</h3><span>v{item.version}</span></div><span className={statusClass(item.lifecycle)}>{lifecycleLabels[item.lifecycle]}</span></div><DraftReleaseContent item={item} /><dl><div><dt>發布</dt><dd>{formatTime(item.publishAt)}</dd></div><div><dt>到期</dt><dd>{formatTime(item.expiresAt)}</dd></div><div><dt>目前發布版</dt><dd>{item.activeReleaseVersion ? `v${item.activeReleaseVersion}・收件 ${item.recipientCount}・已讀 ${item.readCount}` : "尚未發布"}</dd></div></dl><RowActions item={item} snapshot={snapshot} canPublish={canPublish} hasRecentAal2={hasRecentAal2} canRead={canRead} /></article>)}</div>
      </> : <div className="panel__body"><section className="empty-card"><Search aria-hidden="true" /><h2>沒有符合條件的已載入公告</h2><p>請調整關鍵字或狀態；系統不會擴大到其他分支。</p>{hasFilters ? <Link className="button button--secondary" href="?">清除篩選</Link> : null}</section></div>}
    </section>
    {snapshot.selectedReleaseId ? <section className={`panel ${styles.recipientPanel}`} aria-labelledby="recipient-detail-title"><div className="panel__header"><div className="panel__title"><h2 id="recipient-detail-title">發布版收件與實際已讀明細</h2><p>發布版本 {snapshot.selectedReleaseId}・與上方 aggregate 同一 DB snapshot</p></div><Link className="button button--quiet" href="?">關閉明細</Link></div><div className={`table-wrap ${styles.detailTable}`} role="region" tabIndex={0} aria-label="公告收件明細，可左右捲動"><table className="data-table"><thead><tr><th scope="col">員工</th><th scope="col">解析方式</th><th scope="col">實際已讀</th></tr></thead><tbody>{snapshot.selectedRecipients.map((recipient) => <tr key={recipient.userId}><td><strong>{recipient.displayName}</strong><small className="data-table__secondary">{recipient.employeeCode ?? recipient.profileKind}</small></td><td>{recipient.resolutionKind === "direct" ? "精確選取" : recipient.resolutionKind === "role" ? "治理角色解析" : "精確＋角色"}</td><td>{recipient.readAt ? formatTime(recipient.readAt) : "尚無實際回條"}</td></tr>)}</tbody></table></div><div aria-label="公告收件明細" className="mobile-records core-care-mobile" role="region">{snapshot.selectedRecipients.map((recipient) => <article className="record-card" key={recipient.userId}><div className="record-card__top"><div><h3>{recipient.displayName}</h3><span>{recipient.employeeCode ?? recipient.profileKind}</span></div><span className={recipient.readAt ? "status-pill status-pill--success" : "status-pill"}>{recipient.readAt ? "已讀" : "未讀"}</span></div><dl><div><dt>收件解析</dt><dd>{recipient.resolutionKind === "direct" ? "精確選取" : recipient.resolutionKind === "role" ? "治理角色解析" : "精確＋角色"}</dd></div><div><dt>實際已讀</dt><dd>{recipient.readAt ? formatTime(recipient.readAt) : "尚無實際回條"}</dd></div></dl></article>)}</div></section> : null}
    <p className={styles.readBoundary}>已到期公告仍可由原收件人補記實際閱讀；這只是一筆歷史閱讀回條，不代表任何通知曾送達。</p>
  </>;
}
