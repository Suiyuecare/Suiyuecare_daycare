import { AlertTriangle, CopyCheck, FileSearch, Paperclip, ShieldCheck } from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  ClientInspectionReportFilters,
  ClientInspectionReportSnapshot,
  ClientReportDuplicateBasis,
} from "@/lib/client-inspection-reports/types";

import {
  ClientInspectionReportCreateForm,
  ClientInspectionReportRevisionForm,
} from "./client-inspection-report-actions";
import styles from "./client-inspection-reports.module.css";

const valueLabels = {
  present: "已提供", missing: "缺值", not_applicable: "不適用",
};
const attachmentLabels = {
  provided: "既有可信附件證據", missing: "缺附件", not_applicable: "不適用",
};

function formatTaipei(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

function duplicateLabel(value: ClientReportDuplicateBasis) {
  if (value === "exact_content") return "內容雜湊完全相同";
  if (value === "same_attachment_sha256") return "附件 SHA-256 相同";
  return "同個案、類型、日期與來源";
}

function StateValue({ status, text, reason }: {
  status: "present" | "missing" | "not_applicable";
  text: string | null;
  reason: string | null;
}) {
  return <>{valueLabels[status]}<br /><span>{text ?? reason}</span></>;
}

export function ClientInspectionReportsWorkspace({
  canManage, filters, hasAal2, hasRecentAal2, loadError, page, snapshot,
}: {
  canManage: boolean;
  filters: ClientInspectionReportFilters;
  hasAal2: boolean;
  hasRecentAal2: boolean;
  loadError: boolean;
  page: PageCatalogEntry;
  snapshot: ClientInspectionReportSnapshot | null;
}) {
  if (!hasAal2) return <section className="empty-card"
    aria-labelledby="client-report-aal2-heading">
    <span className="empty-card__icon empty-card__icon--warning">
      <ShieldCheck aria-hidden="true" />
    </span>
    <p className="eyebrow">敏感個案健康資料</p>
    <h1 id="client-report-aal2-heading">需要完成雙重驗證</h1>
    <p>所有員工查閱與建立個案檢查報告都需要 AAL2；目前不會載入任何結果、來源或附件欄位。</p>
    <Link className="button button--primary" href="/mfa?audience=staff&purpose=sensitive-action">前往雙重驗證</Link>
  </section>;

  if (loadError || !snapshot) return <section className="empty-card"
    aria-labelledby="client-report-error-heading">
    <span className="empty-card__icon empty-card__icon--warning">
      <AlertTriangle aria-hidden="true" />
    </span>
    <p className="eyebrow">資料未載入</p>
    <h1 id="client-report-error-heading">無法安全顯示個案檢查報告</h1>
    <p>篩選條件、分支、個案指派或權限可能已改變；請重新整理或返回清除篩選。</p>
    <Link className="button button--primary" href={`/app/${page.slug}`}>清除篩選並重試</Link>
  </section>;

  const duplicateRecords = snapshot.records.filter(({ duplicateWarning }) => duplicateWarning);
  return <div className={styles.workspace}>
    <header className={styles.hero}>
      <div><p className="eyebrow">第 22 頁 · 個案專用垂直切片</p>
        <h1>{page.title}</h1>
        <p>{page.description}</p></div>
      <dl className={styles.snapshotMeta}>
        <div><dt>資料時間</dt><dd>{formatTaipei(snapshot.generatedAt)}</dd></div>
        <div><dt>統計快照</dt><dd>{snapshot.snapshotDate}（Asia/Taipei）</dd></div>
        <div><dt>資料來源</dt><dd>{snapshot.demo ? "全合成展示資料" : "授權分支正式資料"}</dd></div>
      </dl>
    </header>

    {snapshot.demo ? <p className={styles.notice} role="status">
      展示模式僅使用合成個案、結果與雜湊；所有建立、更正、作廢與下載均為唯讀。
    </p> : null}
    <p className={styles.warning}><strong>邊界：</strong>本頁只保存來源文字，不提供醫療判讀、診斷或 OCR。附件上傳、掃毒、私有下載與匯出均為 not_configured；畫面不會把任意 UUID 當成已保存附件。</p>

    <section className={styles.metrics} aria-label="檢查報告統計">
      <article><FileSearch aria-hidden="true" /><span>篩選報告</span>
        <strong>{snapshot.recordTotal}</strong><p>目前顯示 {snapshot.records.length} 筆</p></article>
      <article><AlertTriangle aria-hidden="true" /><span>缺結果</span>
        <strong>{snapshot.missingResultTotal}</strong><p>缺值不會當成空字串或 0</p></article>
      <article><Paperclip aria-hidden="true" /><span>缺附件</span>
        <strong>{snapshot.missingAttachmentTotal}</strong><p>上傳服務尚未配置</p></article>
      <article><CopyCheck aria-hidden="true" /><span>重複警示</span>
        <strong>{snapshot.duplicateWarningTotal}</strong><p>只警示，不自動合併</p></article>
    </section>

    <ClientInspectionReportCreateForm canManage={canManage} snapshot={snapshot} />
    {canManage && !hasRecentAal2 ? <p className={styles.warning} role="status">
      建立原始版本可繼續；更正與作廢需在同一工作階段最近 15 分鐘內重新驗證。
      <Link href="/mfa?audience=staff&purpose=sensitive-action"> 前往重新驗證</Link>
    </p> : null}
    <ClientInspectionReportRevisionForm canRevise={canManage && hasRecentAal2}
      snapshot={snapshot} />

    <form className={styles.filters} method="get" aria-label="檢查報告篩選">
      <label><span>個案</span><select name="client" defaultValue={filters.clientId ?? "all"}>
        <option value="all">全部已授權個案</option>
        {snapshot.clientOptions.map((client) => <option key={client.clientId}
          value={client.clientId}>{client.clientCode} · {client.displayName}</option>)}
      </select></label>
      <label><span>檢查類型</span><select name="type" defaultValue={filters.reportType ?? "all"}>
        <option value="all">全部類型</option>
        {snapshot.typeOptions.map((type) => <option key={type.reportType}
          value={type.reportType}>{type.reportType}（{type.recordCount}）</option>)}
      </select></label>
      <label><span>紀錄狀態</span><select name="status" defaultValue={filters.recordStatus}>
        <option value="all">全部</option><option value="active">有效終端</option>
        <option value="voided">已作廢終端</option>
      </select></label>
      <label><span>結果狀態</span><select name="result" defaultValue={filters.resultStatus}>
        <option value="all">全部</option><option value="present">已提供</option>
        <option value="missing">缺值</option><option value="not_applicable">不適用</option>
      </select></label>
      <label><span>來源狀態</span><select name="source" defaultValue={filters.sourceStatus}>
        <option value="all">全部</option><option value="present">已提供</option>
        <option value="missing">缺值</option><option value="not_applicable">不適用</option>
      </select></label>
      <label><span>附件狀態</span><select name="attachment" defaultValue={filters.attachmentStatus}>
        <option value="all">全部</option><option value="provided">既有可信證據</option>
        <option value="missing">缺附件</option><option value="not_applicable">不適用</option>
      </select></label>
      <label><span>重複提示</span><select name="duplicate" defaultValue={filters.duplicateStatus}>
        <option value="all">全部</option><option value="any">任一警示</option>
        <option value="exact">內容完全相同</option><option value="key_fields">關鍵欄位相同</option>
        <option value="attachment">附件雜湊相同</option><option value="none">無警示</option>
      </select></label>
      <label><span>檢查日起</span><input name="from" type="date"
        defaultValue={filters.examinedFrom ?? ""} /></label>
      <label><span>檢查日迄</span><input name="to" type="date"
        defaultValue={filters.examinedTo ?? ""} /></label>
      <label className={styles.wide}><span>搜尋</span><input name="q" maxLength={120}
        defaultValue={filters.query} placeholder="個案代碼、姓名、類型或來源" /></label>
      <div className={styles.filterActions}><button className="button button--primary" type="submit">套用篩選</button>
        <Link className="button button--secondary" href={`/app/${page.slug}`}>清除</Link></div>
    </form>

    <section className={styles.records} aria-labelledby="client-report-list-heading">
      <div className={styles.resultHeader}><div><h2 id="client-report-list-heading">個案檢查報告</h2>
        <p>一個 report key 只顯示一個最新終端版本；可由下方歷程重現舊版。</p></div>
        <p>{snapshot.records.length} / {snapshot.recordTotal} 筆</p></div>
      {snapshot.recordsTruncated ? <p role="status">清單上限 200 筆，請縮小篩選範圍。</p> : null}
      {snapshot.records.length === 0 ? <p className={styles.empty}>目前條件沒有資料，可清除篩選或確認個案指派。</p> : <>
        <div className={styles.tableWrap} role="region" tabIndex={0}
          aria-label="桌面版檢查報告表格，可水平捲動">
          <table className={styles.table}><thead><tr><th>個案</th><th>檢查</th><th>結果</th>
            <th>來源</th><th>附件</th><th>版本／警示</th></tr></thead><tbody>
          {snapshot.records.map((record) => <tr key={record.recordVersionId}>
            <td>{record.clientDisplayName}<br /><small>{record.clientCode}</small></td>
            <td>{record.reportType}<br /><small>{record.examinedOn}</small></td>
            <td><StateValue status={record.resultStatus} text={record.resultText}
              reason={record.resultReason} /><br /><small>未提供醫療判讀</small></td>
            <td><StateValue status={record.sourceStatus} text={record.sourceText}
              reason={record.sourceReason} /></td>
            <td>{attachmentLabels[record.attachmentStatus]}
              {record.attachmentSourceFilename ? <><br /><small>{record.attachmentSourceFilename}<br />SHA-256：{record.attachmentSha256?.slice(0, 12)}…（不可下載）</small></> : null}</td>
            <td>v{record.version} · {record.recordStatus === "active" ? "有效終端" : "作廢終端"}
              {record.duplicateBases.length ? <ul>{record.duplicateBases.map((basis) =>
                <li key={basis}>{duplicateLabel(basis)}</li>)}</ul> : <><br /><small>無重複警示</small></>}</td>
          </tr>)}</tbody></table>
        </div>
        <div className={styles.mobileCards}>{snapshot.records.map((record) => <article
          key={record.recordVersionId}><h3>{record.clientDisplayName}</h3>
          <p>{record.clientCode} · v{record.version} · {record.recordStatus === "active" ? "有效終端" : "作廢終端"}</p>
          <dl><div><dt>檢查</dt><dd>{record.reportType}<br />{record.examinedOn}</dd></div>
            <div><dt>結果</dt><dd><StateValue status={record.resultStatus}
              text={record.resultText} reason={record.resultReason} /></dd></div>
            <div><dt>來源</dt><dd><StateValue status={record.sourceStatus}
              text={record.sourceText} reason={record.sourceReason} /></dd></div>
            <div><dt>附件</dt><dd>{attachmentLabels[record.attachmentStatus]}</dd></div>
            <div><dt>重複</dt><dd>{record.duplicateBases.length
              ? record.duplicateBases.map(duplicateLabel).join("；") : "無"}</dd></div></dl>
        </article>)}</div>
      </>}
    </section>

    <section className={styles.duplicates} aria-labelledby="client-report-duplicate-heading">
      <h2 id="client-report-duplicate-heading">分級重複警示</h2>
      <p>內容雜湊、關鍵欄位與附件 SHA-256 分開說明；每份報告仍保持獨立，不自動合併或覆寫。</p>
      {duplicateRecords.length === 0 ? <p>目前篩選結果沒有重複警示。</p> :
        <div className={styles.cardGrid}>{duplicateRecords.map((record) => <article
          key={record.recordVersionId}><h3>{record.clientDisplayName} · {record.reportType}</h3>
          <ul>{record.duplicateBases.map((basis) => <li key={basis}>{duplicateLabel(basis)}</li>)}</ul>
          <p>內容 {record.exactDuplicateCount}；關鍵欄位 {record.keyFieldDuplicateCount}；附件 {record.attachmentDuplicateCount}。</p>
          <p>處置：只警示，不自動合併。</p></article>)}</div>}
    </section>

    <section className={styles.history} aria-labelledby="client-report-history-heading">
      <h2 id="client-report-history-heading">不可變版本歷程</h2>
      <p>顯示 {snapshot.history.length} / {snapshot.historyTotal} 個版本；更正與作廢都新增終端，不直接修改或刪除舊紀錄。</p>
      {snapshot.historyTruncated ? <p role="status">歷程上限 500 筆，請縮小篩選範圍。</p> : null}
      <div className={styles.cardGrid}>{snapshot.history.map((record) => <article
        key={record.recordVersionId}><h3>{record.reportType} · {record.examinedOn} · v{record.version}</h3>
        <dl><div><dt>結果</dt><dd>{record.resultText ?? record.resultReason}</dd></div>
          <div><dt>來源</dt><dd>{record.sourceText ?? record.sourceReason}</dd></div>
          <div><dt>附件</dt><dd>{attachmentLabels[record.attachmentStatus]}</dd></div>
          <div><dt>狀態</dt><dd>{record.recordStatus === "active" ? "有效於當時" : "作廢終端"}</dd></div>
          <div><dt>保存人</dt><dd>{record.recordedByDisplayName}</dd></div>
          <div><dt>保存時間</dt><dd>{formatTaipei(record.recordedAt)}</dd></div>
          <div><dt>理由</dt><dd>{record.correctionReason ?? "原始版本"}</dd></div></dl>
      </article>)}</div>
    </section>
  </div>;
}
