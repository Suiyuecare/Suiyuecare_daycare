import {
  Activity,
  BadgeCheck,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  LockKeyhole,
  Search,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { StatusPill } from "@/components/ui/status-pill";
import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  FallEventFilters,
  FallEventSnapshot,
  FallIncidentItem,
  FallTimelineEntry,
} from "@/lib/fall-events/types";

import { FallEventAction, FallEventFreshness } from "./fall-event-action";
import styles from "./fall-events.module.css";

function formatTimestamp(value: string) {
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

function statusText(status: FallIncidentItem["handlingStatus"]) {
  if (status === "reported") return "待處置";
  if (status === "in_progress") return "處理中";
  return "已結案";
}

function injuryText(incident: FallIncidentItem) {
  if (incident.injuryDegreeState === "missing") return "缺值";
  if (incident.injuryDegreeState === "not_applicable") return "不適用";
  return incident.injuryDegreeText!;
}

function entryLabel(entry: FallTimelineEntry) {
  if (entry.entryType === "treatment") return "處置";
  if (entry.entryType === "follow_up") return "追蹤";
  return "結案";
}

function Timeline({ incident }: { incident: FallIncidentItem }) {
  return (
    <details className={styles.timeline}>
      <summary>
        <span>查看事件與 {incident.timelineTotal} 筆時間軸紀錄</span>
        <span>鏈版本 v{incident.chainVersion}</span>
      </summary>
      <ol>
        <li>
          <span className={styles.timelineMarker} aria-hidden="true" />
          <div>
            <div className={styles.timelineHeading}><strong>事件通報</strong><time dateTime={incident.occurredAt}>{formatTimestamp(incident.occurredAt)}</time></div>
            <p>{incident.eventSummary}</p>
            <small>地點：{incident.location}・通報者：{incident.reporterDisplayName}・伺服器收件：{formatTimestamp(incident.reportedAt)}</small>
            {incident.lateEntryReason ? <small className={styles.lateEvidence}>補登理由：{incident.lateEntryReason}</small> : null}
          </div>
        </li>
        {incident.timeline.map((entry) => (
          <li key={entry.id}>
            <span className={styles.timelineMarker} aria-hidden="true" />
            <div>
              <div className={styles.timelineHeading}><strong>{entryLabel(entry)}・#{entry.sequenceNumber}</strong><time dateTime={entry.occurredAt}>{formatTimestamp(entry.occurredAt)}</time></div>
              {entry.entryType === "closure" ? (
                <>
                  <p>結果：{entry.closureOutcome}</p>
                  <p>理由：{entry.closureReason}</p>
                </>
              ) : <p>{entry.entryText}</p>}
              <small>{entry.committerDisplayName}・伺服器提交 {formatTimestamp(entry.committedAt)}</small>
            </div>
          </li>
        ))}
      </ol>
      {incident.timelineTruncated ? <p className={styles.timelineWarning}>時間軸超過 100 筆；此快照只載入最新 100 筆，總數仍以完整鏈計算。</p> : null}
    </details>
  );
}

function IncidentActions({
  incident,
  instance,
  snapshot,
  canManage,
  canClose,
  hasRecentAal2,
}: {
  incident: FallIncidentItem;
  instance: string;
  snapshot: FallEventSnapshot;
  canManage: boolean;
  canClose: boolean;
  hasRecentAal2: boolean;
}) {
  if (incident.handlingStatus === "closed") {
    return <span className={styles.locked}><LockKeyhole aria-hidden="true" />已結案，歷史鎖定</span>;
  }
  return (
    <div className={styles.rowActions}>
      <FallEventAction canClose={canClose} canManage={canManage} clients={snapshot.clientOptions} demo={snapshot.demo} hasRecentAal2={hasRecentAal2} incident={incident} instance={`${instance}-treatment`} kind="treatment" />
      <FallEventAction canClose={canClose} canManage={canManage} clients={snapshot.clientOptions} demo={snapshot.demo} hasRecentAal2={hasRecentAal2} incident={incident} instance={`${instance}-follow`} kind="follow_up" />
      <FallEventAction canClose={canClose} canManage={canManage} clients={snapshot.clientOptions} demo={snapshot.demo} hasRecentAal2={hasRecentAal2} incident={incident} instance={`${instance}-close`} kind="close" />
    </div>
  );
}

export function FallEventsWorkspace({
  page,
  snapshot,
  filters,
  canManage,
  canClose,
  hasRecentAal2,
  loadError = false,
}: {
  page: PageCatalogEntry;
  snapshot: FallEventSnapshot | null;
  filters: FallEventFilters;
  canManage: boolean;
  canClose: boolean;
  hasRecentAal2: boolean;
  loadError?: boolean;
}) {
  if (loadError || !snapshot) {
    return (
      <section className="empty-card core-care-state" role="alert">
        <span className="empty-card__icon empty-card__icon--warning"><CircleAlert aria-hidden="true" /></span>
        <h1>跌倒事件暫時無法載入</h1>
        <p>正式快照採失敗即關閉；系統沒有擴大機構、分支或個案指派範圍，也沒有改用展示資料。</p>
        <a className="button button--secondary" href="?status=all">重新載入</a>
      </section>
    );
  }

  return (
    <>
      <nav aria-label="所在位置" className="context-bar">
        <span>工作台</span><ChevronRight aria-hidden="true" />
        <span>品質與異常指標</span><ChevronRight aria-hidden="true" />
        <span aria-current="page" className="context-bar__crumb">{page.title}</span>
      </nav>
      <header className="page-heading core-care-heading">
        <div>
          <p className="eyebrow">可查看個案品質事件・頁面 {page.number}</p>
          <h1>{page.title}</h1>
          <p className="page-heading__description">依事件日期、機構人工填寫的傷害程度與處理狀態查詢；事件、處置、追蹤及結案維持同一條不可改寫的時間軸。</p>
        </div>
        <div className="page-heading__actions">
          <FallEventAction canClose={canClose} canManage={canManage} clients={snapshot.clientOptions} demo={snapshot.demo} hasRecentAal2={hasRecentAal2} instance="header" kind="report" />
        </div>
      </header>

      {snapshot.demo ? (
        <div className={`callout ${styles.demoCallout}`} role="status"><CircleAlert aria-hidden="true" /><span><strong>展示模式：</strong>以下個案與事件都是合成示例；所有新增、處置、追蹤及結案按鈕與 API 均維持唯讀。</span></div>
      ) : (
        <div className={`callout ${styles.securityCallout}`}><ShieldCheck aria-hidden="true" /><span>只讀取目前機構、分支與目前權限可查看的個案範圍；每次寫入以使用者專屬冪等鍵與鏈版本提交。結案另要求同一工作階段最近 15 分鐘 AAL2。</span></div>
      )}

      <div className={`callout ${styles.ruleCallout}`} role="note"><ClipboardList aria-hidden="true" /><span><strong>規則邊界：</strong>傷害分類、嚴重度評分與法定通報門檻均尚未由機構發布，系統不自動診斷、分級或判定通報。逾 24 小時需補登理由只是稽核治理界線。</span></div>

      {!snapshot.demo && (!canManage || !canClose || !hasRecentAal2) ? (
        <div className="callout" role="status"><ShieldCheck aria-hidden="true" /><span>{!canManage ? "目前角色只有查看權限。" : !canClose ? "目前角色可追加處置與追蹤，但沒有結案權限。" : "結案前仍需在同一工作階段完成最近 15 分鐘 AAL2 驗證。"}</span></div>
      ) : null}

      <section aria-label="跌倒事件摘要" className="metric-grid">
        {[
          ["符合事件", snapshot.matchingTotal, "筆", snapshot.itemsTruncated ? `畫面載入 ${snapshot.itemTotal}／${snapshot.matchingTotal} 筆` : "完整篩選集合", <Activity aria-hidden="true" key="all" />],
          ["待處置", snapshot.metrics.awaitingAction, "筆", "尚未追加任何處置或追蹤", <CircleAlert aria-hidden="true" key="report" />],
          ["處理中", snapshot.metrics.awaitingClosure, "筆", "已有時間軸紀錄，尚未結案", <ClipboardList aria-hidden="true" key="progress" />],
          ["已結案", snapshot.metrics.closed, "筆", `${snapshot.metrics.injuryProvided} 筆有機構傷害文字`, <BadgeCheck aria-hidden="true" key="closed" />],
        ].map(([label, value, unit, foot, icon]) => (
          <article className="metric-card" key={String(label)}>
            <div className="metric-card__top"><span>{label}</span><span className="metric-card__icon">{icon}</span></div>
            <div className="metric-card__value"><strong>{value}</strong><span>{unit}</span></div>
            <p className="metric-card__foot">{foot}</p>
          </article>
        ))}
      </section>

      <section className="panel">
        <div className="panel__header">
          <div className="panel__title"><h2>事件清單</h2><p>顯示 {snapshot.itemTotal}／{snapshot.matchingTotal} 筆・快照 {formatTimestamp(snapshot.generatedAt)}・<FallEventFreshness demo={snapshot.demo} staleAfter={snapshot.staleAfter} /></p></div>
        </div>
        <form className={`filter-bar ${styles.filters}`} method="get">
          <label className="field field--compact"><span>事件起日</span><input defaultValue={filters.dateFrom ?? ""} name="from" type="date" /></label>
          <label className="field field--compact"><span>事件迄日</span><input defaultValue={filters.dateTo ?? ""} name="to" type="date" /></label>
          <label className="field field--compact"><span>傷害程度</span><select defaultValue={filters.injuryDegree ?? ""} name="injury"><option value="">全部</option><option value="__missing__">缺值</option><option value="__not_applicable__">不適用</option>{snapshot.injuryDegreeOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
          <label className="field field--compact"><span>處理狀態</span><select defaultValue={filters.handlingStatus} name="status"><option value="all">全部</option><option value="reported">待處置</option><option value="in_progress">處理中</option><option value="closed">已結案</option></select></label>
          <label className="field field--compact"><span>個案</span><select defaultValue={filters.clientId ?? ""} name="client"><option value="">全部可查看個案</option>{snapshot.clientOptions.map((option) => <option key={option.clientId} value={option.clientId}>{option.displayName}{option.clientStatus === "active" ? "" : "（歷史）"}</option>)}</select></label>
          <button className="button button--secondary" type="submit">套用篩選</button>
          <Link className="button button--quiet" href="?status=all">清除</Link>
        </form>

        {snapshot.itemsTruncated ? <div className={`callout ${styles.truncated}`} role="status"><CircleAlert aria-hidden="true" /><span>符合 {snapshot.matchingTotal} 筆，畫面只載入排序後前 {snapshot.itemTotal} 筆；四張摘要卡仍使用完整篩選集合。請縮小日期、傷害程度、狀態或個案。</span></div> : null}
        {snapshot.clientOptionsTruncated || snapshot.injuryOptionsTruncated ? <div className={`callout ${styles.truncated}`} role="status"><CircleAlert aria-hidden="true" /><span>個案或傷害文字選項超過 200 個，選單只載入前 200 個；未載入選項不會被誤判為不存在。</span></div> : null}

        {snapshot.items.length ? (
          <>
            <div aria-label="跌倒事件表格，可左右捲動" className={`table-wrap ${styles.table}`} role="region" tabIndex={0}>
              <table className="data-table">
                <thead><tr>{["個案／事件", "事件時間／地點", "傷害程度", "狀態", "最後活動", "時間軸", "操作"].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
                <tbody>{snapshot.items.map((incident) => (
                  <tr key={incident.id}>
                    <td className={styles.summaryCell}><strong>{incident.clientDisplayName}</strong><small>{incident.eventSummary}</small></td>
                    <td>{formatTimestamp(incident.occurredAt)}<small className="data-table__secondary">{incident.location}</small></td>
                    <td className={incident.injuryDegreeState === "missing" ? styles.missing : undefined}>{injuryText(incident)}</td>
                    <td><StatusPill status={statusText(incident.handlingStatus)} /></td>
                    <td>{formatTimestamp(incident.lastActivityAt)}</td>
                    <td><Timeline incident={incident} /></td>
                    <td><IncidentActions canClose={canClose} canManage={canManage} hasRecentAal2={hasRecentAal2} incident={incident} instance={`desktop-${incident.id}`} snapshot={snapshot} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="mobile-records core-care-mobile">{snapshot.items.map((incident) => (
              <article className="record-card" key={incident.id}>
                <div className="record-card__top"><div><h3>{incident.clientDisplayName}</h3><span className="data-table__secondary">{formatTimestamp(incident.occurredAt)}・{incident.location}</span></div><StatusPill status={statusText(incident.handlingStatus)} /></div>
                <p className={styles.mobileSummary}>{incident.eventSummary}</p>
                <dl className={styles.cardGrid}><div><dt>傷害程度</dt><dd>{injuryText(incident)}</dd></div><div><dt>最後活動</dt><dd>{formatTimestamp(incident.lastActivityAt)}</dd></div><div><dt>鏈版本</dt><dd>v{incident.chainVersion}</dd></div><div><dt>通報者</dt><dd>{incident.reporterDisplayName}</dd></div></dl>
                <Timeline incident={incident} />
                <IncidentActions canClose={canClose} canManage={canManage} hasRecentAal2={hasRecentAal2} incident={incident} instance={`mobile-${incident.id}`} snapshot={snapshot} />
              </article>
            ))}</div>
          </>
        ) : (
          <div className="panel__body"><section className="empty-card core-care-state"><Search aria-hidden="true" /><h2>沒有符合條件的跌倒事件</h2><p>請調整事件日期、傷害程度、處理狀態或個案；系統不會擴大到其他分支或目前權限不可查看的個案。</p><Link className="button button--secondary" href="?status=all">清除篩選</Link></section></div>
        )}
      </section>
    </>
  );
}
