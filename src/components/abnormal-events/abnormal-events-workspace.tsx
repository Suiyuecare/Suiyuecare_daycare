import {
  Activity, BadgeCheck, ChevronRight, CircleAlert, ClipboardList, LockKeyhole,
  Search, ShieldCheck, TimerOff,
} from "lucide-react";
import Link from "next/link";

import { StatusPill } from "@/components/ui/status-pill";
import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  AbnormalEventFilters,
  AbnormalEventSnapshot,
  AbnormalIncidentItem,
  AbnormalTimelineEntry,
} from "@/lib/abnormal-events/types";

import { AbnormalEventAction, AbnormalEventFreshness } from "./abnormal-event-action";
import styles from "./abnormal-events.module.css";

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

function statusText(status: AbnormalIncidentItem["handlingStatus"]) {
  if (status === "reported") return "待改善";
  if (status === "in_progress") return "處理中";
  return "已結案";
}

function majorText(state: AbnormalIncidentItem["majorState"]) {
  if (state === "major") return "重大（人工選擇）";
  if (state === "not_major") return "非重大（人工選擇）";
  return "未分類";
}

function affectedKindText(kind: AbnormalIncidentItem["affectedTargetKind"]) {
  return { client: "個案", staff: "員工", visitor: "訪客", facility: "設施", other: "其他" }[kind];
}

function entryLabel(entry: AbnormalTimelineEntry) {
  if (entry.entryType === "manual_notification") return "人工通知證據";
  if (entry.entryType === "improvement") return "改善";
  if (entry.entryType === "follow_up") return "追蹤";
  return "結案";
}

function Timeline({ incident }: { incident: AbnormalIncidentItem }) {
  return <details className={styles.timeline}>
    <summary><span>事件與 {incident.timelineTotal} 筆時間軸</span><span>鏈 v{incident.chainVersion}</span></summary>
    <ol>
      <li><span aria-hidden="true" className={styles.timelineMarker} /><div>
        <div className={styles.timelineHeading}><strong>事件報告</strong>
          <time dateTime={incident.occurredAt}>{formatTimestamp(incident.occurredAt)}</time></div>
        <p>{incident.eventSummary}</p><p>即時處置：{incident.immediateAction}</p>
        <small>地點：{incident.location}・通報者：{incident.reporterDisplayName}・伺服器收件：{formatTimestamp(incident.reportedAt)}</small>
        {incident.lateEntryReason ? <small className={styles.lateEvidence}>補登理由：{incident.lateEntryReason}</small> : null}
      </div></li>
      {incident.timeline.map((entry) => <li key={entry.id}>
        <span aria-hidden="true" className={styles.timelineMarker} /><div>
          <div className={styles.timelineHeading}><strong>{entryLabel(entry)}・#{entry.sequenceNumber}</strong>
            <time dateTime={entry.occurredAt}>{formatTimestamp(entry.occurredAt)}</time></div>
          {entry.entryType === "manual_notification" ? <>
            <p>對象：{entry.notificationTarget}・方式：{entry.notificationMethod}</p>
            <p>人工結果證據：{entry.notificationResult}</p>
          </> : entry.entryType === "closure" ? <>
            <p>結果：{entry.closureOutcome}</p><p>理由：{entry.closureReason}</p>
          </> : <><p>{entry.entryText}</p>
            <small>責任人：{entry.responsibleDisplayName}・期限：{entry.effectiveDueDate}
              {entry.dueDateAction === "replace" ? "（本筆明確更新）" : "（維持）"}</small></>}
          <small>{entry.committerDisplayName}・伺服器提交 {formatTimestamp(entry.committedAt)}</small>
        </div>
      </li>)}
    </ol>
    {incident.timelineTruncated ? <p className={styles.timelineWarning}>此快照只載入最新 100 筆；總數與目前責任／期限仍由完整不可變鏈計算。</p> : null}
  </details>;
}

function IncidentActions({ incident, instance, snapshot, canManage, canClose, hasRecentAal2 }: {
  incident: AbnormalIncidentItem; instance: string; snapshot: AbnormalEventSnapshot;
  canManage: boolean; canClose: boolean; hasRecentAal2: boolean;
}) {
  if (incident.handlingStatus === "closed") return <span className={styles.locked}>
    <LockKeyhole aria-hidden="true" />已結案，歷史鎖定</span>;
  const common = { canClose, canManage, clients: snapshot.clientOptions,
    responsibles: snapshot.responsibleOptions, demo: snapshot.demo,
    hasRecentAal2, incident };
  return <div className={styles.rowActions}>
    <AbnormalEventAction {...common} instance={`${instance}-notification`} kind="manual_notification" />
    <AbnormalEventAction {...common} instance={`${instance}-improvement`} kind="improvement" />
    <AbnormalEventAction {...common} instance={`${instance}-follow`} kind="follow_up" />
    <AbnormalEventAction {...common} instance={`${instance}-close`} kind="close" />
  </div>;
}

export function AbnormalEventsWorkspace({ page, snapshot, filters, canManage, canClose,
  hasRecentAal2, loadError = false }: {
  page: PageCatalogEntry; snapshot: AbnormalEventSnapshot | null; filters: AbnormalEventFilters;
  canManage: boolean; canClose: boolean; hasRecentAal2: boolean; loadError?: boolean;
}) {
  if (loadError || !snapshot) return <section className="empty-card core-care-state" role="alert">
    <span className="empty-card__icon empty-card__icon--warning"><CircleAlert aria-hidden="true" /></span>
    <h1>異常事件暫時無法載入</h1>
    <p>正式快照採失敗即關閉；系統沒有擴大機構、分支、個案指派或欄位權限。</p>
    <a className="button button--secondary" href="?status=all&affected=all">重新載入</a>
  </section>;

  const reportProps = { canClose, canManage, clients: snapshot.clientOptions,
    responsibles: snapshot.responsibleOptions, demo: snapshot.demo, hasRecentAal2 };
  return <>
    <nav aria-label="所在位置" className="context-bar"><span>工作台</span><ChevronRight aria-hidden="true" />
      <span>品質與異常指標</span><ChevronRight aria-hidden="true" />
      <span aria-current="page" className="context-bar__crumb">{page.title}</span></nav>
    <header className="page-heading core-care-heading"><div><p className="eyebrow">分支異常治理・頁面 {page.number}</p>
      <h1>{page.title}</h1><p className="page-heading__description">依台北日期含起訖日、機構人工事件類型、影響對象與處理狀態查詢；事件、人工通知、改善、追蹤與結案維持同一條不可改寫時間軸。</p></div>
      <div className="page-heading__actions"><AbnormalEventAction {...reportProps} instance="header" kind="report" /></div></header>

    {snapshot.demo ? <div className={`callout ${styles.demoCallout}`} role="status">
      <CircleAlert aria-hidden="true" /><span><strong>展示模式：</strong>以下對象與事件都是合成示例；頁面與 API 均明確唯讀，不會假裝寫入成功。</span></div>
      : <div className={`callout ${styles.securityCallout}`}><ShieldCheck aria-hidden="true" /><span>只讀取目前機構、分支與權限可查看的範圍；個案事件另依目前指派驗證。每次寫入使用使用者專屬冪等鍵與預期鏈版本。</span></div>}
    <div className={`callout ${styles.ruleCallout}`} role="note"><ClipboardList aria-hidden="true" /><span>
      <strong>明確邊界：</strong>事件類型 taxonomy、重大性判準及法定通報規則尚未設定；外部通知整合尚未實作。系統不診斷、不推論重大性、不自動通報，人工通知欄只保存人員提供的證據。</span></div>
    {!snapshot.demo && (!canManage || !canClose || !hasRecentAal2) ? <div className="callout" role="status">
      <ShieldCheck aria-hidden="true" /><span>{!canManage ? "目前角色只有查看權限。"
        : !canClose ? "目前角色可新增與追加紀錄，但沒有結案權限。"
          : "結案前仍需在同一工作階段完成最近 15 分鐘 AAL2 驗證。"}</span></div> : null}

    <section aria-label="異常事件摘要" className="metric-grid">
      {[
        ["符合事件", snapshot.matchingTotal, snapshot.itemsTruncated ? `畫面載入 ${snapshot.itemTotal}／${snapshot.matchingTotal} 筆` : "完整篩選集合", <Activity aria-hidden="true" key="all" />],
        ["人工標為重大", snapshot.metrics.major, "未分類不會自動算入重大", <CircleAlert aria-hidden="true" key="major" />],
        ["待改善", snapshot.metrics.awaitingImprovement, `${snapshot.metrics.overdue} 筆依明確期限逾期`, <TimerOff aria-hidden="true" key="due" />],
        ["已結案", snapshot.metrics.closed, "結案後歷史鎖定", <BadgeCheck aria-hidden="true" key="closed" />],
      ].map(([label, value, foot, metricIcon]) => <article className="metric-card" key={String(label)}>
        <div className="metric-card__top"><span>{label}</span><span className="metric-card__icon">{metricIcon}</span></div>
        <div className="metric-card__value"><strong>{value}</strong><span>筆</span></div>
        <p className="metric-card__foot">{foot}</p></article>)}
    </section>

    <section className="panel"><div className="panel__header"><div className="panel__title"><h2>事件清單</h2>
      <p>顯示 {snapshot.itemTotal}／{snapshot.matchingTotal} 筆・快照 {formatTimestamp(snapshot.generatedAt)}・<AbnormalEventFreshness demo={snapshot.demo} staleAfter={snapshot.staleAfter} /></p></div></div>
      <form className={`filter-bar ${styles.filters}`} method="get">
        <label className="field field--compact"><span>事件起日</span><input defaultValue={filters.dateFrom ?? ""} name="from" type="date" /></label>
        <label className="field field--compact"><span>事件迄日</span><input defaultValue={filters.dateTo ?? ""} name="to" type="date" /></label>
        <label className="field field--compact"><span>事件類型</span><select defaultValue={filters.eventType ?? ""} name="type"><option value="">全部</option>
          {snapshot.eventTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
        <label className="field field--compact"><span>影響對象</span><select defaultValue={filters.affectedTargetKind} name="affected">
          <option value="all">全部</option><option value="client">個案</option><option value="staff">員工</option>
          <option value="visitor">訪客</option><option value="facility">設施</option><option value="other">其他</option></select></label>
        <label className="field field--compact"><span>處理狀態</span><select defaultValue={filters.handlingStatus} name="status">
          <option value="all">全部</option><option value="reported">待改善</option><option value="in_progress">處理中</option><option value="closed">已結案</option></select></label>
        <button className="button button--secondary" type="submit">套用篩選</button>
        <Link className="button button--quiet" href="?status=all&affected=all">清除</Link>
      </form>
      {snapshot.itemsTruncated ? <div className={`callout ${styles.truncated}`} role="status"><CircleAlert aria-hidden="true" />
        <span>符合 {snapshot.matchingTotal} 筆，畫面只載入排序後前 {snapshot.itemTotal} 筆；摘要仍使用完整篩選集合。請縮小條件。</span></div> : null}
      {snapshot.clientOptionsTruncated || snapshot.responsibleOptionsTruncated || snapshot.eventTypeOptionsTruncated
        ? <div className={`callout ${styles.truncated}`} role="status"><CircleAlert aria-hidden="true" />
          <span>選項超過上限：個案 {snapshot.clientOptions.length}/{snapshot.clientOptionsAvailableTotal}、責任人 {snapshot.responsibleOptions.length}/{snapshot.responsibleOptionsAvailableTotal}、類型 {snapshot.eventTypeOptions.length}/{snapshot.eventTypeOptionsAvailableTotal}。未載入項目不會被宣稱不存在。</span></div> : null}

      {snapshot.items.length ? <><div aria-label="異常事件表格，可左右捲動" className={`table-wrap ${styles.table}`} role="region" tabIndex={0}>
        <table className="data-table"><thead><tr>{["影響對象／事件", "時間／地點", "重大性", "責任／期限", "狀態", "時間軸", "操作"].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
          <tbody>{snapshot.items.map((incident) => <tr key={incident.id}>
            <td className={styles.summaryCell}><strong>{affectedKindText(incident.affectedTargetKind)}・{incident.affectedTargetLabel}</strong><small>{incident.eventType}・{incident.eventSummary}</small></td>
            <td>{formatTimestamp(incident.occurredAt)}<small className="data-table__secondary">{incident.location}</small></td>
            <td className={incident.majorState === "unclassified" ? styles.missing : undefined}>{majorText(incident.majorState)}</td>
            <td>{incident.currentResponsibleDisplayName}<small className="data-table__secondary">期限 {incident.currentImprovementDueDate}</small></td>
            <td><StatusPill status={statusText(incident.handlingStatus)} /></td><td><Timeline incident={incident} /></td>
            <td><IncidentActions canClose={canClose} canManage={canManage} hasRecentAal2={hasRecentAal2}
              incident={incident} instance={`desktop-${incident.id}`} snapshot={snapshot} /></td>
          </tr>)}</tbody></table></div>
        <div className="mobile-records core-care-mobile">{snapshot.items.map((incident) => <article className="record-card" key={incident.id}>
          <div className="record-card__top"><div><h3>{affectedKindText(incident.affectedTargetKind)}・{incident.affectedTargetLabel}</h3>
            <span className="data-table__secondary">{formatTimestamp(incident.occurredAt)}・{incident.location}</span></div>
            <StatusPill status={statusText(incident.handlingStatus)} /></div>
          <p className={styles.mobileSummary}>{incident.eventType}・{incident.eventSummary}</p>
          <dl className={styles.cardGrid}><div><dt>重大性</dt><dd>{majorText(incident.majorState)}</dd></div>
            <div><dt>責任人</dt><dd>{incident.currentResponsibleDisplayName}</dd></div><div><dt>改善期限</dt><dd>{incident.currentImprovementDueDate}</dd></div>
            <div><dt>鏈版本</dt><dd>v{incident.chainVersion}</dd></div></dl>
          <Timeline incident={incident} /><IncidentActions canClose={canClose} canManage={canManage}
            hasRecentAal2={hasRecentAal2} incident={incident} instance={`mobile-${incident.id}`} snapshot={snapshot} />
        </article>)}</div></> : <div className="panel__body"><section className="empty-card core-care-state">
          <Search aria-hidden="true" /><h2>沒有符合條件的異常事件</h2>
          <p>請調整台北日期、事件類型、影響對象或處理狀態；系統不會擴大到其他分支或不可查看個案。</p>
          <Link className="button button--secondary" href="?status=all&affected=all">清除篩選</Link>
        </section></div>}
    </section>
  </>;
}
