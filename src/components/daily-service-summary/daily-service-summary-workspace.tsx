import {
  CalendarDays, ChevronRight, CircleAlert, Download, ExternalLink,
  FileWarning, Gauge, LockKeyhole, ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { StatusPill } from "@/components/ui/status-pill";
import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  DailyServiceSummaryFilters,
  DailyServiceSummaryRow,
  DailyServiceSummarySnapshot,
  DailySummaryCell,
} from "@/lib/daily-service-summary/types";

import styles from "./daily-service-summary.module.css";

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

function metric(value: number | null, suffix = "人") {
  return value === null ? "未知" : `${value} ${suffix}`;
}

function cellStatus(cell: DailySummaryCell) {
  if (cell.accessStatus === "not_authorized") return "未授權・未知";
  if (cell.accessStatus === "not_configured") return "未配置・未知";
  if (cell.evidenceStatus === "no_record") return "已查詢・無紀錄";
  if ((cell.exceptionCount ?? 0) > 0) return `有 ${cell.exceptionCount} 項例外`;
  if ((cell.pendingCount ?? 0) > 0) return `${cell.pendingCount} 筆待完成`;
  return `${cell.recordCount} 筆紀錄`;
}

function CellEvidence({ cell, clientName }: {
  cell: DailySummaryCell; clientName: string;
}) {
  return <div className={styles.cell}>
    <StatusPill status={cellStatus(cell)} />
    <span className={styles.cellText}>{cell.statusText}</span>
    <Link aria-label={`查看 ${clientName} 的${cell.sourceLabel}來源`}
      className={styles.drilldown} href={cell.sourceHref}>
      查看來源 <ExternalLink aria-hidden="true" />
    </Link>
    <details className={styles.evidence}>
      <summary>快照證據</summary>
      {cell.accessStatus === "authorized" ? <dl>
        <div><dt>紀錄</dt><dd>{cell.recordCount}</dd></div>
        <div><dt>完成</dt><dd>{cell.completedCount}</dd></div>
        <div><dt>待完成</dt><dd>{cell.pendingCount}</dd></div>
        <div><dt>例外</dt><dd>{cell.exceptionCount}</dd></div>
        <div className={styles.wide}><dt>來源 ID</dt><dd>{
          cell.sourceRecordIds.length ? cell.sourceRecordIds.join("、") : "無"
        }{cell.sourceRecordsTruncated ? "（僅列前 50 筆）" : ""}</dd></div>
        <div className={styles.wide}><dt>來源雜湊</dt>
          <dd className={styles.hash}>{cell.sourceHash ?? "無來源紀錄"}</dd></div>
      </dl> : <p>{cell.accessStatus === "not_configured"
        ? "此來源尚未配置；快照未查詢也未以 0 補值。"
        : "目前使用者不可讀此來源；快照未查詢也未以 0 補值。"}</p>}
    </details>
  </div>;
}

function RowCompleteness({ row }: { row: DailyServiceSummaryRow }) {
  return <div className={styles.completeness}>
    <strong>{row.completenessPercent === null ? "未知" : `${row.completenessPercent}%`}</strong>
    <span>{row.coveredSourceCount}／{row.authorizedSourceCount} 個可讀來源有紀錄</span>
    {row.notAuthorizedSourceCount > 0 ? <small>
      {row.notAuthorizedSourceCount} 個未知來源（未授權或未配置）不列入分母
    </small> : null}
  </div>;
}

function exportHref(snapshot: DailyServiceSummarySnapshot) {
  const params = new URLSearchParams({ snapshot: snapshot.snapshotId,
    date: snapshot.filters.serviceDate,
    completeness: snapshot.filters.completeness });
  if (snapshot.filters.clientId) params.set("client", snapshot.filters.clientId);
  return `/api/daily-service-summary/export?${params.toString()}`;
}

export function DailyServiceSummaryWorkspace({
  canExport, filters, hasRecentAal2, loadError = false, page, snapshot,
}: {
  canExport: boolean;
  filters: DailyServiceSummaryFilters;
  hasRecentAal2: boolean;
  loadError?: boolean;
  page: PageCatalogEntry;
  snapshot: DailyServiceSummarySnapshot | null;
}) {
  if (loadError || !snapshot) return <section
    className="empty-card core-care-state" role="alert">
    <span className="empty-card__icon empty-card__icon--warning">
      <CircleAlert aria-hidden="true" />
    </span>
    <h1>每日服務彙整暫時無法載入</h1>
    <p>專用快照採失敗即關閉；不會以其他分支、未指派個案或展示資料補位。</p>
    <a className="button button--secondary" href="?">重新載入</a>
  </section>;

  const exportReady = snapshot.demo || (canExport && hasRecentAal2);
  const sources = snapshot.sourceConfiguration;
  return <>
    <nav aria-label="所在位置" className="context-bar">
      <span>工作台</span><ChevronRight aria-hidden="true" />
      <span>服務管理</span><ChevronRight aria-hidden="true" />
      <span aria-current="page" className="context-bar__crumb">{page.title}</span>
    </nav>
    <header className="page-heading core-care-heading">
      <div><p className="eyebrow">單一資料庫陳述式快照・頁面 {page.number}</p>
        <h1>{page.title}</h1>
        <p className="page-heading__description">
          同一快照彙整已授權個案的出勤、生命徵象、照顧／服務、活動、餐食、接送與異常。
        </p></div>
      <div className="page-heading__actions">{exportReady ? <a
        className="button button--secondary" href={exportHref(snapshot)}>
        <Download aria-hidden="true" />匯出同一快照
      </a> : <button className="button button--secondary" disabled
        title={canExport ? "請先完成最近 15 分鐘內雙重驗證" : "目前角色沒有匯出權限"}
        type="button"><Download aria-hidden="true" />{
          canExport ? "重新驗證後匯出" : "無匯出權限"
        }</button>}</div>
    </header>

    {snapshot.demo ? <div className={`callout ${styles.demo}`} role="status">
      <CircleAlert aria-hidden="true" /><span><strong>展示模式：</strong>
        本頁僅用合成、唯讀資料展示；不會寫入照顧或服務紀錄。</span>
    </div> : <div className={`callout ${styles.security}`} role="status">
      <ShieldCheck aria-hidden="true" /><span>
        快照固定於目前機構、分支、使用者與已指派個案；每項來源再以自己的讀取權限限縮。
      </span></div>}
    <div className={`callout ${styles.warning}`} role="note">
      <FileWarning aria-hidden="true" /><span><strong>離線狀態：未設定。</strong>
        本頁沒有 24 小時離線唯讀快取；離線時不會顯示可能過期的正式彙整。
        未授權來源一律顯示「未知」，且不列入完整度分母。</span>
    </div>

    <section aria-label="每日服務指標" className="metric-grid">
      {[
        ["出勤有紀錄", metric(snapshot.metrics.recordedAttendanceClients),
          "僅統計可讀來源", <CalendarDays aria-hidden="true" key="attendance" />],
        ["生命徵象有紀錄", metric(snapshot.metrics.recordedVitalClients),
          "未授權不當作 0", <Gauge aria-hidden="true" key="vitals" />],
        ["可讀來源覆蓋", `${snapshot.metrics.coveredCellTotal}／${snapshot.metrics.authorizedCellTotal}`,
          "有紀錄／可讀且已配置", <ShieldCheck aria-hidden="true" key="coverage" />],
        ["未知格數", `${snapshot.metrics.notAuthorizedCellTotal} 格`,
          "未授權或未配置，不補 0", <LockKeyhole aria-hidden="true" key="hidden" />],
      ].map(([label, value, foot, icon]) => <article className="metric-card" key={String(label)}>
        <div className="metric-card__top"><span>{label}</span>
          <span className="metric-card__icon">{icon}</span></div>
        <div className="metric-card__value"><strong>{value}</strong></div>
        <p className="metric-card__foot">{foot}</p>
      </article>)}
    </section>

    <section className="panel">
      <div className="panel__header"><div className="panel__title">
        <h2>{snapshot.filters.serviceDate} 服務明細</h2>
        <p>{snapshot.matchingRowTotal} 位符合個案・快照 {formatTimestamp(snapshot.generatedAt)}</p>
      </div></div>
      <form className={`filter-bar ${styles.filters}`} method="get">
        <label className="field field--compact"><span>日期</span>
          <input defaultValue={filters.serviceDate} max="2200-12-31"
            min="2000-01-01" name="date" required type="date" /></label>
        <label className="field field--compact"><span>個案</span>
          <select defaultValue={filters.clientId ?? ""} name="client">
            <option value="">全部已授權個案</option>
            {snapshot.clientOptions.map((client) => <option key={client.clientId}
              value={client.clientId}>{client.displayName}</option>)}
          </select></label>
        <label className="field field--compact"><span>資料完整度</span>
          <select defaultValue={filters.completeness} name="completeness">
            <option value="all">全部</option><option value="complete">可讀來源皆有紀錄</option>
            <option value="incomplete">可讀來源有缺紀錄</option>
            <option value="limited_access">含未授權來源</option>
          </select></label>
        <button className="button button--secondary" type="submit">套用篩選</button>
        <Link className="button button--quiet" href={`?date=${filters.serviceDate}`}>
          清除其他條件</Link>
      </form>
      {snapshot.rowsTruncated ? <div className={`callout ${styles.warning}`} role="status">
        <CircleAlert aria-hidden="true" /><span>符合個案超過 200 位；指標仍取自同一完整快照，
          明細與 CSV 僅列前 200 位。請縮小篩選後重新建立快照。</span></div> : null}
      {snapshot.rows.length ? <>
        <div aria-label="每日服務彙整表，可左右捲動" className={`table-wrap ${styles.table}`}
          role="region" tabIndex={0}>
          <table className="data-table"><thead><tr><th scope="col">個案</th>
            {sources.map((source) => <th key={source.sourceKind} scope="col">{
              source.sourceLabel}</th>)}<th scope="col">完整度</th></tr></thead>
            <tbody>{snapshot.rows.map((row) => <tr key={row.clientId}>
              <td><strong>{row.displayName}</strong><small className="data-table__secondary">
                {row.clientCode}</small></td>
              {row.cells.map((cell) => <td key={cell.sourceKind}>
                <CellEvidence cell={cell} clientName={row.displayName} /></td>)}
              <td><RowCompleteness row={row} /></td>
            </tr>)}</tbody></table>
        </div>
        <div className={`mobile-records core-care-mobile ${styles.mobile}`}>
          {snapshot.rows.map((row) => <article className="record-card" key={row.clientId}>
            <div className="record-card__top"><div><h3>{row.displayName}</h3>
              <span className="data-table__secondary">{row.clientCode}</span></div>
              <RowCompleteness row={row} /></div>
            <div className={styles.mobileSources}>{row.cells.map((cell) => <section
              key={cell.sourceKind}><h4>{cell.sourceLabel}</h4>
              <CellEvidence cell={cell} clientName={row.displayName} /></section>)}</div>
          </article>)}
        </div>
      </> : <div className="panel__body"><section className="empty-card core-care-state">
        <CalendarDays aria-hidden="true" /><h2>這組條件沒有可顯示的個案</h2>
        <p>這不代表服務已完成；未授權來源不會被推測為零。</p>
        <Link className="button button--secondary" href={`?date=${filters.serviceDate}`}>
          清除其他條件</Link></section></div>}
    </section>

    <section className={`panel ${styles.sources}`}><div className="panel__header">
      <div className="panel__title"><h2>來源與權限口徑</h2>
        <p>8 個獨立來源；每格均可回到白名單頁面核對。餐食與接送舊頁僅支援日期下鑽，精確來源 ID 保存在快照證據，不宣稱舊頁已具個案定位。</p></div></div>
      <div className={styles.sourceGrid}>{sources.map((source) => <article
        key={source.sourceKind}><div><strong>頁面 {source.sourcePage}・{source.sourceLabel}</strong>
          <StatusPill status={source.configurationStatus === "configured" ? "已配置" : "未配置"} />
        </div><code>{source.permission}</code></article>)}</div>
    </section>
  </>;
}
