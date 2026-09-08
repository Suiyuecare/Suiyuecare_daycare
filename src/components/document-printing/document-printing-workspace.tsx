import {
  AlertTriangle,
  FileCheck2,
  FileText,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  DocumentPrintingFilters,
  DocumentPrintingSnapshot,
  DocumentPrintJobItem,
} from "@/lib/document-printing/types";

import { DocumentPrintJobForm } from "./document-printing-actions";
import styles from "./document-printing.module.css";

function formatTaipei(value: string) {
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

function stateLabel(state: "recorded" | "missing" | "not_applicable") {
  if (state === "missing") return "未提供";
  if (state === "not_applicable") return "不適用";
  return "已記錄";
}

function ImmutableDocumentDetails({ job }: { job: DocumentPrintJobItem }) {
  return <details className={styles.documentDetails}>
    <summary>核對 HTML 預覽資料與不可變內容雜湊</summary>
    <div className={styles.documentHeading}>
      <div><p className="eyebrow">{job.renderModel.watermark}</p>
        <h3>{job.renderModel.title}</h3></div>
      <code>{job.renderModelHash.slice(0, 16)}…</code>
    </div>
    {job.renderModel.sections.map((section) => <section
      className={styles.renderSection} key={section.heading}>
      <h4>{section.heading}</h4>
      <dl>{section.rows.map((row, index) => <div key={`${row.label}-${index}`}>
        <dt>{row.label}<small>{stateLabel(row.state)}</small></dt>
        <dd>{row.state === "recorded" ? row.value : stateLabel(row.state)}</dd>
      </div>)}</dl>
    </section>)}
    <p className={styles.footerNote}>{job.renderModel.footerNote}</p>
  </details>;
}

function AccessActions({ job, hasRecentAal2 }: {
  job: DocumentPrintJobItem;
  hasRecentAal2: boolean;
}) {
  if (!hasRecentAal2) return <span className={styles.accessUnavailable}>
    重新驗證後才能預覽或下載
  </span>;
  if (!job.previewUrl || !job.downloadUrl) return <span
    className={styles.accessUnavailable}>短效下載簽章尚未設定</span>;
  return <div className={styles.accessActions}>
    <a className="button button--secondary" href={job.previewUrl}
      target="_blank" rel="noreferrer">預覽 PDF</a>
    <a className="button button--ghost" href={job.downloadUrl}>下載 PDF</a>
  </div>;
}

function JobCard({ job, hasRecentAal2 }: {
  job: DocumentPrintJobItem;
  hasRecentAal2: boolean;
}) {
  return <article className={styles.jobCard}>
    <div className={styles.cardHeading}><div><p className="eyebrow">
      {job.templateTitle} · v{job.templateVersion}</p>
      <h3>{job.clientDisplayName}</h3></div>
      <span>{job.documentDate}</span></div>
    <dl className={styles.metaList}>
      <div><dt>產生者</dt><dd>{job.createdByDisplayName}</dd></div>
      <div><dt>產生時間</dt><dd>{formatTaipei(job.createdAt)}</dd></div>
      <div><dt>預覽授權</dt><dd>{job.previewCount} 次</dd></div>
      <div><dt>下載授權</dt><dd>{job.downloadCount} 次</dd></div>
    </dl>
    <AccessActions job={job} hasRecentAal2={hasRecentAal2} />
    <ImmutableDocumentDetails job={job} />
  </article>;
}

export function DocumentPrintingWorkspace({
  canManage,
  filters,
  hasRecentAal2,
  loadError,
  page,
  snapshot,
}: {
  canManage: boolean;
  filters: DocumentPrintingFilters;
  hasRecentAal2: boolean;
  loadError: boolean;
  page: PageCatalogEntry;
  snapshot: DocumentPrintingSnapshot | null;
}) {
  if (loadError || !snapshot) return <section className="empty-card"
    aria-labelledby="document-printing-load-error">
    <span className="empty-card__icon empty-card__icon--warning">
      <AlertTriangle aria-hidden="true" />
    </span>
    <p className="eyebrow">載入失敗、無權限或篩選有誤</p>
    <h1 id="document-printing-load-error">無法取得文件列印快照</h1>
    <p>系統不會顯示未完成機構、分支、個案與頁面權限核對的局部資料。</p>
    <Link className="button button--secondary"
      href="/app/staff/operations/document-printing">重新載入</Link>
  </section>;

  return <div className={styles.workspace}>
    <header className={styles.hero}><div>
      <p className="eyebrow">第 {page.number} 頁 · 機構營運管理</p>
      <h1>{page.title}</h1>
      <p>先以核准範本凍結一份資料快照；畫面核對內容與 PDF 使用同一模型，歷史工作不可覆寫。</p>
    </div><div className={styles.snapshotMeta}>
      <time dateTime={snapshot.generatedAt}>更新 {formatTaipei(snapshot.generatedAt)}</time>
      <span>快照 60 秒後視為過期</span>
      <span>時區 Asia/Taipei</span>
    </div></header>

    {snapshot.demo ? <div className={styles.notice} role="status">
      展示模式：以下範本、個案與文件均為合成資料；不會建立、預覽或下載正式文件。
    </div> : null}
    {snapshot.templateGovernanceStatus === "not_configured" ? <div
      className={styles.warning} role="alert">
      正式範本尚未配置。系統不會自行猜測官方表單、欄位或字型；完成範本與私有中文字型雙重核准前，正式產生功能保持停用。
    </div> : null}
    <div className={styles.notice} role="note">
      本頁只提供 PDF；附件合併、作廢／簽署狀態與離線列印尚未配置。預覽與下載次數是「授權事件」紀錄，不宣稱使用者已完成閱讀或實體列印。
    </div>
    {!snapshot.demo && snapshot.templateTotal > 0 &&
      snapshot.shortLivedUrlStatus === "not_configured" ? <div
      className={styles.warning} role="alert">
      短效下載簽章尚未設定，因此現有文件可核對內容但不會顯示 PDF 網址。
    </div> : null}

    <section className={styles.metrics} aria-label="文件列印統計">
      <article><FileCheck2 aria-hidden="true" /><span>目前核准範本</span>
        <strong>{snapshot.templateTotal}</strong></article>
      <article><UsersRound aria-hidden="true" /><span>範圍內個案</span>
        <strong>{snapshot.clientTotal}</strong></article>
      <article><FileText aria-hidden="true" /><span>不可變文件工作</span>
        <strong>{snapshot.jobTotal}</strong></article>
      <article><ShieldCheck aria-hidden="true" /><span>PDF 產生器</span>
        <strong>{snapshot.pdfRendererStatus === "available" ? "可用" : "停用"}</strong></article>
    </section>

    <DocumentPrintJobForm canManage={canManage}
      hasRecentAal2={hasRecentAal2} snapshot={snapshot} />

    <form className={styles.filters} method="get" aria-label="篩選文件工作">
      <label><span>範本版本</span><select name="template"
        defaultValue={filters.templateVersionId ?? "all"}>
        <option value="all">全部範本</option>
        {snapshot.templates.map((template) => <option key={template.versionId}
          value={template.versionId}>{template.title} · v{template.version}</option>)}
      </select></label>
      <label><span>個案</span><select name="client"
        defaultValue={filters.clientId ?? "all"}>
        <option value="all">全部個案</option>
        {snapshot.clients.map((client) => <option key={client.clientId}
          value={client.clientId}>{client.displayName}</option>)}
      </select></label>
      <label><span>文件日期</span><input name="date" type="date"
        defaultValue={filters.documentDate ?? ""} /></label>
      <label><span>搜尋</span><input name="q" maxLength={120}
        defaultValue={filters.query} placeholder="範本、個案或產生者" /></label>
      <button className="button button--secondary" type="submit">套用篩選</button>
      <Link className="button button--ghost"
        href="/app/staff/operations/document-printing">清除</Link>
    </form>

    <section className={styles.records} aria-labelledby="document-jobs-heading">
      <div className={styles.sectionHeading}><div>
        <p className="eyebrow">不可變產生歷程</p>
        <h2 id="document-jobs-heading">文件工作</h2></div>
        <p>顯示 {snapshot.jobs.length} / {snapshot.jobTotal} 筆</p></div>
      {snapshot.jobsTruncated ? <p role="status">清單上限 100 筆，請縮小篩選條件。</p> : null}
      {snapshot.jobs.length === 0 ? <div className="empty-card">
        <span className="empty-card__icon"><FileText aria-hidden="true" /></span>
        <h3>沒有符合條件的文件工作</h3>
        <p>{snapshot.templateTotal === 0
          ? "須先完成核准範本與私有中文字型配置。"
          : "可清除篩選，或在上方建立新的不可變文件工作。"}</p>
      </div> : <>
        <div className={styles.tableWrap} role="region" tabIndex={0}
          aria-label="可水平捲動的文件工作表格">
          <table className={styles.table}><thead><tr>
            <th>範本／個案</th><th>文件日期</th><th>產生者／時間</th>
            <th>授權事件</th><th>PDF</th>
          </tr></thead><tbody>{snapshot.jobs.map((job) => <tr key={job.jobId}>
            <td><strong>{job.templateTitle} · v{job.templateVersion}</strong>
              <br /><small>{job.clientDisplayName}</small></td>
            <td>{job.documentDate}</td>
            <td>{job.createdByDisplayName}<br /><small>{formatTaipei(job.createdAt)}</small></td>
            <td>預覽 {job.previewCount}<br />下載 {job.downloadCount}</td>
            <td><AccessActions job={job} hasRecentAal2={hasRecentAal2} /></td>
          </tr>)}</tbody></table>
        </div>
        <div className={styles.desktopDetails}>{snapshot.jobs.map((job) =>
          <ImmutableDocumentDetails job={job} key={job.jobId} />)}</div>
        <div className={styles.mobileCards}>{snapshot.jobs.map((job) =>
          <JobCard hasRecentAal2={hasRecentAal2} job={job} key={job.jobId} />)}</div>
      </>}
    </section>
  </div>;
}
