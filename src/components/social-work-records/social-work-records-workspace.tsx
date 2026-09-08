import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  ClockAlert,
  FilePenLine,
  Search,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { StatusPill } from "@/components/ui/status-pill";
import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  SocialWorkRecordFilters,
  SocialWorkRecordSnapshot,
  SocialWorkServiceRecord,
} from "@/lib/social-work-records/types";

import {
  NewSocialWorkRecordForm,
  SocialWorkRecordActions,
  SocialWorkRecordFreshness,
} from "./social-work-record-actions";
import styles from "./social-work-records.module.css";

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(`${value}T12:00:00+08:00`));
}

function stateText(record: SocialWorkServiceRecord) {
  if (record.recordState === "draft") return "草稿";
  if (record.recordState === "corrected") return "已簽更正版";
  return "已簽署";
}

function followUpText(record: SocialWorkServiceRecord) {
  if (record.followUpOverdue) return "追蹤逾期";
  if (record.followUpStatus === "pending") return "待追蹤";
  if (record.followUpStatus === "completed") return "追蹤完成";
  if (record.followUpStatus === "cancelled") return "追蹤取消";
  return "無追蹤";
}

function RecordHistory({ record }: { record: SocialWorkServiceRecord }) {
  return <details className={styles.history}>
    <summary>版本與追蹤歷程（{record.versionHistoryTotal + record.followUpHistoryTotal} 筆）</summary>
    {record.versionHistoryTruncated || record.followUpHistoryTruncated ? <p role="status">
      歷程超過單鏈 50 筆，畫面顯示最早 50 筆；正式鏈仍完整保留。
    </p> : null}
    <ol>
      {record.versionHistory.map((version) => <li key={version.versionId}>
        <strong>紀錄 v{version.recordVersion}・{version.recordState === "draft" ? "草稿" : version.recordState === "signed" ? "簽署" : "更正"}</strong>
        <span>{formatTimestamp(version.createdAt)}・{version.authorDisplayName}</span>
        <p>{version.serviceContent}</p><p><strong>結果：</strong>{version.serviceResult}</p>
        {version.correctionReason ? <p><strong>更正理由：</strong>{version.correctionReason}</p> : null}
      </li>)}
      {record.followUpHistory.map((item) => <li key={item.eventId}>
        <strong>追蹤 #{item.sequence}・{item.status === "pending" ? "待追蹤" : item.status === "completed" ? "完成" : "取消"}</strong>
        <span>{formatTimestamp(item.committedAt)}・{item.committerDisplayName}</span>
        <p>{item.plan ?? item.outcome ?? item.transitionReason}</p>
        {item.dueOn ? <p>期限：{formatDate(item.dueOn)}</p> : null}
      </li>)}
    </ol>
  </details>;
}

export function SocialWorkRecordsWorkspace({
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
  filters: SocialWorkRecordFilters;
  hasRecentAal2: boolean;
  loadError?: boolean;
  page: PageCatalogEntry;
  snapshot: SocialWorkRecordSnapshot | null;
}) {
  if (loadError || !snapshot) {
    return <section className="empty-card core-care-state" role="alert">
      <span className="empty-card__icon empty-card__icon--warning"><CircleAlert aria-hidden="true" /></span>
      <h1>社工服務紀錄暫時無法載入</h1>
      <p>正式快照採失敗即關閉；系統沒有擴大機構、分支或個案指派範圍，也沒有改用展示資料。</p>
      <a className="button button--secondary" href="?">重新載入</a>
    </section>;
  }

  return <>
    <nav aria-label="所在位置" className="context-bar">
      <span>工作台</span><ChevronRight aria-hidden="true" />
      <span>社工服務</span><ChevronRight aria-hidden="true" />
      <span aria-current="page" className="context-bar__crumb">{page.title}</span>
    </nav>
    <header className="page-heading core-care-heading">
      <div>
        <p className="eyebrow">指派個案時間軸・頁面 {page.number}</p>
        <h1>{page.title}</h1>
        <p className="page-heading__description">
          以實際發生時間記錄服務類型、內容、結果與作者；草稿、簽署、更正及追蹤皆追加新版本，原紀錄不會被覆寫。
        </p>
      </div>
      <div className="page-heading__actions">
        <NewSocialWorkRecordForm canManage={canManage} snapshot={snapshot} />
      </div>
    </header>

    {snapshot.demo ? <div className={`callout ${styles.demo}`} role="status">
      <CircleAlert aria-hidden="true" /><span><strong>展示模式：</strong>個案、作者與內容皆為合成示例；所有正式寫入按鈕維持唯讀。</span>
    </div> : <div className={`callout ${styles.security}`}>
      <ShieldCheck aria-hidden="true" /><span>只載入目前機構、分支及被指派個案。簽署與更正需最近 15 分鐘 AAL2；已簽紀錄只能追加帶理由且連回原版的更正版。</span>
    </div>}
    <div className={`callout ${styles.offline}`} role="status">
      <ClipboardList aria-hidden="true" /><span><strong>離線正式同步尚未設定：</strong>本頁不會宣稱離線草稿已送達；網路中斷時請保留畫面並用同一操作重試。</span>
    </div>
    {!snapshot.demo && !canManage ? <div className="callout" role="status">
      <ShieldCheck aria-hidden="true" /><span>目前角色只有查看權限；新增、修訂、簽署、更正與追蹤均由 API 及資料庫拒絕。</span>
    </div> : null}

    <section aria-label="社工服務摘要" className="metric-grid">
      {[
        ["符合服務", snapshot.matchingTotal, "筆", "依實際發生時間與目前篩選", <FilePenLine aria-hidden="true" key="total" />],
        ["本月服務", snapshot.metrics.currentMonth, "筆", "Asia/Taipei 當月發生", <CalendarClock aria-hidden="true" key="month" />],
        ["待追蹤", snapshot.metrics.pendingFollowUp, "筆", "含尚未到期及已逾期", <CheckCircle2 aria-hidden="true" key="pending" />],
        ["已逾期", snapshot.metrics.overdueFollowUp, "筆", `另有 ${snapshot.metrics.drafts} 筆草稿待簽`, <ClockAlert aria-hidden="true" key="overdue" />],
      ].map(([label, value, unit, foot, icon]) => <article className="metric-card" key={String(label)}>
        <div className="metric-card__top"><span>{label}</span><span className="metric-card__icon">{icon}</span></div>
        <div className="metric-card__value"><strong>{value}</strong><span>{unit}</span></div>
        <p className="metric-card__foot">{foot}</p>
      </article>)}
    </section>

    <section className="panel">
      <div className="panel__header"><div className="panel__title">
        <h2>服務時間軸</h2><p>{snapshot.matchingTotal} 筆符合條件・快照 {formatTimestamp(snapshot.generatedAt)}・<SocialWorkRecordFreshness demo={snapshot.demo} staleAfter={snapshot.staleAfter} /></p>
      </div></div>
      <form className={`filter-bar ${styles.filters}`} method="get">
        <label className="field field--compact"><span>起日</span><input defaultValue={filters.dateFrom ?? ""} name="from" type="date" /></label>
        <label className="field field--compact"><span>迄日</span><input defaultValue={filters.dateTo ?? ""} name="to" type="date" /></label>
        <label className="field field--compact"><span>個案</span><select defaultValue={filters.clientId ?? ""} name="client"><option value="">全部指派個案</option>{snapshot.clientOptions.map((client) => <option key={client.clientId} value={client.clientId}>{client.displayName}</option>)}</select></label>
        <label className="field field--compact"><span>服務類型</span><select defaultValue={filters.serviceType ?? ""} name="type"><option value="">全部類型</option>{snapshot.serviceTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
        <label className="field field--compact"><span>作者</span><select defaultValue={filters.authorUserId ?? ""} name="author"><option value="">全部作者</option>{snapshot.authorOptions.map((author) => <option key={author.userId} value={author.userId}>{author.displayName}</option>)}</select></label>
        <button className="button button--secondary" type="submit">套用篩選</button>
        <Link className="button button--quiet" href="?">清除</Link>
      </form>
      {snapshot.recordsTruncated ? <div className={`callout ${styles.truncated}`} role="status">
        <CircleAlert aria-hidden="true" /><span>結果超過 200 筆，畫面依實際發生時間顯示前 200 筆；摘要仍採相同完整快照。請縮小日期、個案、類型或作者。</span>
      </div> : null}
      {snapshot.clientOptionsTruncated || snapshot.serviceTypeOptionsTruncated || snapshot.authorOptionsTruncated ? <div className={`callout ${styles.truncated}`} role="status">
        <CircleAlert aria-hidden="true" /><span>篩選選項超過 200 筆，選單只顯示前 200 筆；系統不會把未載入選項誤判為不存在。</span>
      </div> : null}

      {snapshot.records.length ? <>
        <div aria-label="社工服務紀錄表格，可左右捲動" className={`table-wrap ${styles.table}`} role="region" tabIndex={0}>
          <table className="data-table"><thead><tr>{["個案／發生時間", "服務類型", "內容摘要", "結果", "作者", "狀態／追蹤", "操作"].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
            <tbody>{snapshot.records.map((record) => <tr key={record.recordKey}>
              <td><span className="data-table__primary"><span className="avatar" aria-hidden="true">{record.clientDisplayName.slice(0, 1)}</span><span>{record.clientDisplayName}<small className="data-table__secondary">{formatTimestamp(record.occurredAt)}・v{record.recordVersion}</small></span></span></td>
              <td>{record.serviceType}</td>
              <td className={styles.narrative}>{record.serviceContent}<RecordHistory record={record} /></td>
              <td className={styles.narrative}>{record.serviceResult}</td>
              <td>{record.authorDisplayName}</td>
              <td><div className={styles.statuses}><StatusPill status={stateText(record)} /><StatusPill status={followUpText(record)} />{record.followUpDueOn ? <small>期限 {formatDate(record.followUpDueOn)}</small> : null}</div></td>
              <td><SocialWorkRecordActions canManage={canManage} canSign={canSign} hasRecentAal2={hasRecentAal2} record={record} snapshot={snapshot} /></td>
            </tr>)}</tbody></table>
        </div>
        <div className="mobile-records core-care-mobile">{snapshot.records.map((record) => <article className={`record-card ${styles.card}`} key={record.recordKey}>
          <div className="record-card__top"><div><h3>{record.clientDisplayName}</h3><span className="data-table__secondary">{formatTimestamp(record.occurredAt)}・{record.serviceType}・v{record.recordVersion}</span></div><StatusPill status={stateText(record)} /></div>
          <dl><div><dt>服務內容</dt><dd>{record.serviceContent}</dd></div><div><dt>服務結果</dt><dd>{record.serviceResult}</dd></div><div><dt>作者</dt><dd>{record.authorDisplayName}</dd></div><div><dt>追蹤</dt><dd>{followUpText(record)}{record.followUpDueOn ? `・${formatDate(record.followUpDueOn)}` : ""}</dd></div></dl>
          <RecordHistory record={record} />
          <SocialWorkRecordActions canManage={canManage} canSign={canSign} hasRecentAal2={hasRecentAal2} record={record} snapshot={snapshot} />
        </article>)}</div>
      </> : <div className="panel__body"><section className="empty-card core-care-state">
        <Search aria-hidden="true" /><h2>沒有符合條件的服務紀錄</h2><p>請調整日期、個案、服務類型或作者；系統不會擴大到其他分支或未指派個案。</p><Link className="button button--secondary" href="?">清除篩選</Link>
      </section></div>}
    </section>
  </>;
}
