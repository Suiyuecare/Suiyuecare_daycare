import {
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  FileClock,
  Link2,
  Search,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { StatusPill } from "@/components/ui/status-pill";
import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  PhysicalTherapyServiceFilters,
  PhysicalTherapyServiceRecord,
  PhysicalTherapyServiceSnapshot,
  PhysicalTherapyServiceValue,
} from "@/lib/physical-therapy-services/types";

import {
  PhysicalTherapyServiceCreateAction,
  PhysicalTherapyServiceFreshness,
  PhysicalTherapyServiceRecordActions,
} from "./physical-therapy-service-actions";
import styles from "./physical-therapy-services.module.css";

function formatTimestamp(value: string | null) {
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

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(`${value}T12:00:00+08:00`));
}

function stateText(record: PhysicalTherapyServiceRecord) {
  if (record.recordState === "draft") return "草稿待簽";
  if (record.recordState === "corrected") return "已簽更正版";
  return "已簽署";
}

function ValueSummary({ label, value }: {
  label: string;
  value: PhysicalTherapyServiceValue;
}) {
  const text = value.state === "recorded" ? value.text
    : value.state === "missing" ? `缺值：${value.reason}`
      : `不適用：${value.reason}`;
  return <div>
    <dt>{label}・{
      value.state === "recorded" ? "已記錄"
        : value.state === "missing" ? "缺值" : "不適用"
    }</dt>
    <dd>{text}</dd>
  </div>;
}

function ServiceNarratives({ record }: { record: PhysicalTherapyServiceRecord }) {
  return <dl className={styles.narrativeList}>
    <ValueSummary label="服務內容" value={record.serviceContent} />
    <ValueSummary label="個案反應" value={record.clientReaction} />
    <ValueSummary label="人工建議" value={record.recommendation} />
  </dl>;
}

function AssessmentReference({ record }: { record: PhysicalTherapyServiceRecord }) {
  const reference = record.assessmentReference;
  return reference.status === "linked" ? <div className={styles.statuses}>
    <StatusPill status="唯讀連結" />
    <span>{formatDate(reference.assessedOn)}・v{reference.assessmentVersion}</span>
    <small>{reference.therapistDisplayName}</small>
  </div> : <div className={styles.statuses}>
    <StatusPill status="無可連結評估" />
    <small>服務紀錄仍獨立保存，不自動造出評估。</small>
  </div>;
}

function ServiceHistory({ record }: { record: PhysicalTherapyServiceRecord }) {
  return <details className={styles.history}>
    <summary>不可變版本歷程（{record.versionHistoryTotal} 筆）</summary>
    {record.versionHistoryTruncated ? <p role="status">
      版本超過 50 筆，畫面只顯示最新 50 筆；資料庫仍保留完整鏈。
    </p> : null}
    <ol>
      {record.versionHistory.map((version) => <li key={version.versionId}>
        <strong>v{version.recordVersion}・{
          version.recordState === "draft" ? "草稿"
            : version.recordState === "signed" ? "簽署" : "更正"
        }</strong>
        <span>{formatTimestamp(version.createdAt)}・{version.therapistDisplayName}</span>
        <p><strong>發生時間：</strong>{formatTimestamp(version.occurredAt)}</p>
        <ServiceNarratives record={{ ...record,
          serviceContent: version.serviceContent,
          clientReaction: version.clientReaction,
          recommendation: version.recommendation,
        }} />
        {version.correctionReason ? <p>
          <strong>更正理由：</strong>{version.correctionReason}
        </p> : null}
      </li>)}
    </ol>
  </details>;
}

export function PhysicalTherapyServicesWorkspace({
  canManage,
  canSign,
  filters,
  hasRecentAal2,
  loadError = false,
  page,
  snapshot,
}: {
  canManage: boolean;
  canSign: boolean;
  filters: PhysicalTherapyServiceFilters;
  hasRecentAal2: boolean;
  loadError?: boolean;
  page: PageCatalogEntry;
  snapshot: PhysicalTherapyServiceSnapshot | null;
}) {
  if (loadError || !snapshot) {
    return <section className="empty-card core-care-state" role="alert">
      <span className="empty-card__icon empty-card__icon--warning">
        <CircleAlert aria-hidden="true" />
      </span>
      <h1>物理治療服務紀錄暫時無法載入</h1>
      <p>正式快照採失敗即關閉；不會擴大到其他分支、未指派個案或展示資料。</p>
      <a className="button button--secondary" href="?">重新載入</a>
    </section>;
  }

  return <>
    <nav aria-label="所在位置" className="context-bar">
      <span>工作台</span><ChevronRight aria-hidden="true" />
      <span>專業服務</span><ChevronRight aria-hidden="true" />
      <span aria-current="page" className="context-bar__crumb">{page.title}</span>
    </nav>
    <header className="page-heading core-care-heading">
      <div>
        <p className="eyebrow">實際服務時間軸・頁面 {page.number}</p>
        <h1>{page.title}</h1>
        <p className="page-heading__description">
          保存發生時間、內容、個案反應、人工建議、物理治療師與不可覆寫版本鏈。
        </p>
      </div>
      <PhysicalTherapyServiceCreateAction
        canManage={canManage}
        canSign={canSign}
        hasRecentAal2={hasRecentAal2}
        snapshot={snapshot}
      />
    </header>

    <div className={`callout ${styles.manual}`} role="note">
      <Link2 aria-hidden="true" />
      <span><strong>獨立服務領域：</strong>第 34 頁最近已簽／已更正評估只作為唯讀參照；本頁不共用其版本或寫入權限。</span>
    </div>
    {snapshot.demo ? <div className={`callout ${styles.demo}`} role="status">
      <CircleAlert aria-hidden="true" />
      <span><strong>展示模式：</strong>所有個案、治療師、內容與評估連結皆為合成示例；正式操作唯讀。</span>
    </div> : <div className={`callout ${styles.security}`}>
      <ShieldCheck aria-hidden="true" />
      <span>只載入目前機構、分支及指派個案。簽署與更正需最近 15 分鐘同 session AAL2；已簽紀錄禁止更新或刪除。</span>
    </div>}
    <div className={`callout ${styles.offline}`} role="status">
      <ClipboardList aria-hidden="true" />
      <span><strong>尚未設定：</strong>治療公式、診斷、自動建議、附件、匯出與離線消費者均不啟用。</span>
    </div>

    <section aria-label="物理治療服務摘要" className="metric-grid">
      {[
        ["今日服務", snapshot.metrics.today, "筆", "依 Asia/Taipei 發生時間", <FileClock aria-hidden="true" key="today" />],
        ["草稿待簽", snapshot.metrics.drafts, "筆", "尚未成為已簽證據", <ClipboardList aria-hidden="true" key="draft" />],
        ["已簽署", snapshot.metrics.signed, "筆", "禁止原地覆寫", <CheckCircle2 aria-hidden="true" key="signed" />],
        ["已簽更正版", snapshot.metrics.corrected, "筆", "保留原紀錄與理由", <ShieldCheck aria-hidden="true" key="corrected" />],
        ["連結最近評估", snapshot.metrics.linkedAssessments, "筆", "只讀凍結參照", <Link2 aria-hidden="true" key="linked" />],
      ].map(([label, value, unit, foot, icon]) => <article className="metric-card" key={String(label)}>
        <div className="metric-card__top">
          <span>{label}</span><span className="metric-card__icon">{icon}</span>
        </div>
        <div className="metric-card__value"><strong>{value}</strong><span>{unit}</span></div>
        <p className="metric-card__foot">{foot}</p>
      </article>)}
    </section>

    <section className="panel">
      <div className="panel__header">
        <div className="panel__title">
          <h2>物理治療服務時間軸</h2>
          <p>{snapshot.matchingTotal} 筆符合條件・快照 {formatTimestamp(snapshot.generatedAt)}・<PhysicalTherapyServiceFreshness demo={snapshot.demo} staleAfter={snapshot.staleAfter} /></p>
        </div>
      </div>
      <form className={`filter-bar ${styles.filters}`} method="get">
        <label className="field field--compact"><span>起日</span><input defaultValue={filters.dateFrom ?? ""} name="from" type="date" /></label>
        <label className="field field--compact"><span>迄日</span><input defaultValue={filters.dateTo ?? ""} name="to" type="date" /></label>
        <label className="field field--compact"><span>個案</span><select defaultValue={filters.clientId ?? ""} name="client"><option value="">全部指派個案</option>{snapshot.clientOptions.map((item) => <option key={item.clientId} value={item.clientId}>{item.displayName}</option>)}</select></label>
        <label className="field field--compact"><span>物理治療師</span><select defaultValue={filters.therapistUserId ?? ""} name="therapist"><option value="">全部治療師</option>{snapshot.therapistOptions.map((item) => <option key={item.userId} value={item.userId}>{item.displayName}</option>)}</select></label>
        <label className="field field--compact"><span>紀錄狀態</span><select defaultValue={filters.recordState ?? ""} name="state"><option value="">全部</option><option value="draft">草稿</option><option value="signed">已簽署</option><option value="corrected">已簽更正版</option></select></label>
        <label className="field field--compact"><span>關鍵字</span><input defaultValue={filters.keyword ?? ""} maxLength={80} name="q" type="search" /></label>
        <button className="button button--secondary" type="submit">套用篩選</button>
        <Link className="button button--quiet" href="?">清除</Link>
      </form>
      {snapshot.recordsTruncated ? <div className={`callout ${styles.truncated}`} role="status"><CircleAlert aria-hidden="true" /><span>結果超過 200 筆，摘要仍使用同一完整快照；請縮小篩選。</span></div> : null}

      {snapshot.records.length ? <>
        <div aria-label="物理治療服務紀錄，可左右捲動" className={`table-wrap ${styles.table}`} role="region" tabIndex={0}>
          <table className="data-table">
            <thead><tr>{["個案／狀態", "發生時間／治療師", "內容／反應／建議", "評估參照", "版本／操作"].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
            <tbody>{snapshot.records.map((record) => <tr key={record.recordKey}>
              <td><span className="data-table__primary"><span className="avatar" aria-hidden="true">{record.clientDisplayName.slice(0, 1)}</span><span>{record.clientDisplayName}<small className="data-table__secondary"><StatusPill status={stateText(record)} /></small></span></span></td>
              <td><div className={styles.statuses}><span>{formatTimestamp(record.occurredAt)}</span><small>{record.therapistDisplayName}・v{record.recordVersion}</small></div></td>
              <td className={styles.narrative}><ServiceNarratives record={record} /></td>
              <td><AssessmentReference record={record} /></td>
              <td><ServiceHistory record={record} /><PhysicalTherapyServiceRecordActions canManage={canManage} canSign={canSign} hasRecentAal2={hasRecentAal2} record={record} snapshot={snapshot} /></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="mobile-records core-care-mobile">
          {snapshot.records.map((record) => <article className={`record-card ${styles.card}`} key={record.recordKey}>
            <div className="record-card__top"><div><h3>{record.clientDisplayName}</h3><span className="data-table__secondary">{formatTimestamp(record.occurredAt)}</span></div><StatusPill status={stateText(record)} /></div>
            <dl><div><dt>物理治療師</dt><dd>{record.therapistDisplayName}</dd></div><div><dt>版本</dt><dd>v{record.recordVersion}</dd></div></dl>
            <ServiceNarratives record={record} />
            <AssessmentReference record={record} />
            <ServiceHistory record={record} />
            <PhysicalTherapyServiceRecordActions canManage={canManage} canSign={canSign} hasRecentAal2={hasRecentAal2} record={record} snapshot={snapshot} />
          </article>)}
        </div>
      </> : <div className="panel__body"><section className="empty-card core-care-state"><Search aria-hidden="true" /><h2>沒有符合條件的服務紀錄</h2><p>請調整日期、個案、治療師、狀態或關鍵字；系統不會擴大資料範圍。</p><Link className="button button--secondary" href="?">清除篩選</Link></section></div>}
    </section>
  </>;
}
