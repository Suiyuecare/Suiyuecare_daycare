import { AlertTriangle, Brain, Clock3, FileWarning, ShieldCheck } from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type { BehaviorEvent, BehaviorEventFilters, BehaviorEventSnapshot,
  BehaviorNarrativeField } from "@/lib/behavior-events/types";

import { BehaviorEventActions, CreateBehaviorEvent } from "./behavior-event-actions";
import styles from "./behavior-events.module.css";

const STATE: Record<string, string> = { draft: "草稿", signed: "已簽署", corrected: "更正版", voided: "已作廢" };
const FIELD: Record<string, string> = { recorded: "已記錄", missing: "缺值", not_applicable: "不適用" };
function taipei(value: string) { return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)); }
function FieldValue({ label, value }: { label: string; value: BehaviorNarrativeField }) {
  return <div className={styles.fieldValue}><dt>{label}<span className={`${styles.fieldState} ${styles[`field_${value.state}`]}`}>{FIELD[value.state]}</span></dt>
    <dd>{value.text ?? (value.state === "missing" ? "尚未記錄；不可視為空字或零。" : "此事件明確標記不適用。")}</dd></div>;
}
function History({ event }: { event: BehaviorEvent }) {
  return <details className={styles.history}><summary>版本與簽署證據（{event.historyTotal}）</summary>
    {event.historyTruncated ? <p>僅顯示最早 50 版；完整歷程仍保存在資料庫。</p> : null}
    <ol>{event.history.map((item) => <li key={item.versionId}><strong>v{item.version}・{STATE[item.eventState]}</strong>
      <span>{taipei(item.createdAt)}・{item.authorDisplayName}</span>
      <span>發生 {taipei(item.occurredAt)}・雜湊 {item.contentHash.slice(0, 10)}…</span>
      {item.signedAt && item.signerDisplayName && item.signaturePurpose ? <>
        <span>簽署人：{item.signerDisplayName}（{item.signerRoleKeys?.join("、")}）</span>
        <span>伺服器簽署時間：{taipei(item.signedAt)}・目的：{item.signaturePurpose}</span>
        <span>重驗證證據：{item.signatureReauthChallengeId?.slice(0, 8)}…</span>
      </> : <span>此版尚未簽署</span>}
      {item.correctionReason ? <span>更正理由：{item.correctionReason}</span> : null}
      {item.voidReason ? <span>作廢理由：{item.voidReason}</span> : null}</li>)}</ol></details>;
}
function EventDetails({ event }: { event: BehaviorEvent }) {
  return <><dl className={styles.fields}><FieldValue label="前因" value={event.antecedent} />
    <FieldValue label="行為" value={event.behavior} /><FieldValue label="人工處置" value={event.intervention} />
    <FieldValue label="人工結果" value={event.outcome} /></dl><p className={styles.noInference}>
      <Brain aria-hidden="true" /> 以上均為人員明確選擇與原文；系統不自動診斷，也不從敘事推論欄位或結果。</p><History event={event} /></>;
}

export function BehaviorEventsWorkspace({ page, snapshot, filters, loadError, canManage, canSign, hasRecentAal2 }: {
  page: PageCatalogEntry; snapshot: BehaviorEventSnapshot | null; filters: BehaviorEventFilters;
  loadError: boolean; canManage: boolean; canSign: boolean; hasRecentAal2: boolean;
}) {
  if (loadError || !snapshot) return <main id="main-content" className="workspace-page"><section className="empty-card core-care-state">
    <FileWarning aria-hidden="true" /><h1>{page.title}</h1><p>篩選條件無效，或正式事件快照暫時無法取得。</p>
    <Link className="button button--secondary" href="?">清除篩選並重試</Link></section></main>;
  const basePath = `/app/${page.slug}`;
  return <main id="main-content" className="workspace-page"><header className="page-heading core-care-heading"><div>
    <p className="eyebrow">評估量表・Page 20</p><h1>{page.title}</h1>
    <p className="page-heading__description">{page.description} 每筆事件獨立版本化，清單永遠依實際發生時間而非輸入時間排序。</p></div>
    <div className={`page-heading__actions ${styles.headerMeta}`}><span><ShieldCheck aria-hidden="true" /> 指派個案隔離</span>
      <span><Clock3 aria-hidden="true" /> 更新 {taipei(snapshot.generatedAt)}</span></div></header>
    <section aria-label="資料邊界" className={styles.boundary}><AlertTriangle aria-hidden="true" />
      <div><strong>人工紀錄邊界</strong><p>前因、行為、人工處置、人工結果逐欄保存已記錄／缺值／不適用；不自動診斷或從文字推論。</p>
      <p>附件、外部通知、匯出與 24 小時離線草稿均為 not_configured，正式流程 fail closed。</p></div></section>
    {snapshot.demo ? <p className="demo-banner">目前為合成展示資料；所有正式寫入操作均關閉。</p> : null}
    <CreateBehaviorEvent canManage={canManage} snapshot={snapshot} />
    <section aria-label="行為事件統計" className={`metric-grid ${styles.metrics}`}>
      {[{ label: "符合事件", value: snapshot.metrics.eventTotal }, { label: "含缺值", value: snapshot.metrics.missingFieldTotal },
        { label: "草稿", value: snapshot.metrics.draftTotal }, { label: "已簽／更正", value: snapshot.metrics.signedTotal },
        { label: "已作廢", value: snapshot.metrics.voidedTotal }].map((item) => <article className="metric-card" key={item.label}>
          <span>{item.label}</span><strong>{item.value}</strong><small>完整符合集合</small></article>)}</section>
    <form action={basePath} className={styles.filters} method="get"><label><span>起日</span><input defaultValue={filters.dateFrom ?? ""} name="from" type="date" /></label>
      <label><span>迄日</span><input defaultValue={filters.dateTo ?? ""} name="to" type="date" /></label>
      <label><span>個案</span><select defaultValue={filters.clientId ?? ""} name="client"><option value="">全部授權個案</option>
        {snapshot.clients.map((item) => <option key={item.clientId} value={item.clientId}>{item.displayName}</option>)}</select></label>
      <label><span>事件類型</span><select defaultValue={filters.eventType ?? ""} name="type"><option value="">全部類型</option>
        {snapshot.eventTypes.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label><span>紀錄狀態</span><select defaultValue={filters.state} name="state"><option value="all">全部</option>
        {Object.entries(STATE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button className="button button--secondary" type="submit">套用篩選</button><Link className="button button--quiet" href={basePath}>清除</Link></form>
    <section aria-labelledby="behavior-event-list" className={styles.records}><div className={styles.sectionHeading}><div>
      <p className="eyebrow">同一不可變快照</p><h2 id="behavior-event-list">事件時間軸</h2></div>
      <p>{snapshot.events.length} / {snapshot.matchingTotal} 筆</p></div>
      {snapshot.eventsTruncated ? <p role="status">清單只顯示最新 200 筆；統計仍使用完整符合集合，請縮小篩選。</p> : null}
      {!snapshot.events.length ? <section className="empty-card"><Brain aria-hidden="true" /><h3>沒有符合條件的事件</h3>
        <p>請調整日期、個案、事件類型或紀錄狀態；系統不會擴大至其他分支或未指派個案。</p></section> : <>
        <div aria-label="可水平捲動的行為事件表格" className={styles.tableWrap} role="region" tabIndex={0}><table className={styles.table}>
          <thead><tr><th>個案／發生時間</th><th>類型／狀態</th><th>人工四欄</th><th>版本</th><th>操作</th></tr></thead>
          <tbody>{snapshot.events.map((event) => <tr key={event.eventKey}><td><strong>{event.clientDisplayName}</strong><small>{taipei(event.occurredAt)}</small></td>
            <td>{event.eventType}<small>{STATE[event.eventState]}{event.hasMissingFields ? "・含缺值" : ""}</small></td>
            <td><EventDetails event={event} /></td><td>v{event.version}<small>{event.authorDisplayName}</small></td>
            <td><BehaviorEventActions canManage={canManage} canSign={canSign} event={event}
              hasRecentAal2={hasRecentAal2} /></td></tr>)}</tbody></table></div>
        <div className={styles.mobileCards}>{snapshot.events.map((event) => <article key={event.eventKey}>
          <div className={styles.cardHeading}><div><h3>{event.clientDisplayName}</h3><small>{taipei(event.occurredAt)}・{event.eventType}</small></div>
            <span className={`${styles.pill} ${styles[`pill_${event.eventState}`]}`}>{STATE[event.eventState]}</span></div>
          <EventDetails event={event} /><BehaviorEventActions canManage={canManage} canSign={canSign} event={event}
            hasRecentAal2={hasRecentAal2} /></article>)}</div></>}
    </section></main>;
}
