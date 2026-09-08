import {
  AlertTriangle,
  CalendarClock,
  CopyCheck,
  FileWarning,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  StaffLabReportDuplicateBasis,
  StaffLabReportFilters,
  StaffLabReportSnapshot,
} from "@/lib/staff-lab-reports/types";

import {
  StaffLabReportCreateForm,
  StaffLabReportRevisionForm,
} from "./staff-lab-report-actions";
import styles from "./staff-lab-reports.module.css";

const evidenceLabels = {
  provided: "已保存可信證明參照", missing: "缺證明", not_applicable: "不適用",
};
const validityLabels = {
  active: "人工效期內", expired: "人工效期已過", voided: "已作廢",
};

function formatTaipei(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

function duplicateLabel(value: StaffLabReportDuplicateBasis) {
  return value === "exact_content" ? "內容完全相同" :
    "同員工、檢驗類型、檢驗日與院所相同";
}

export function StaffLabReportsWorkspace({
  canManage, filters, hasRecentAal2, loadError, page, snapshot,
}: {
  canManage: boolean;
  filters: StaffLabReportFilters;
  hasRecentAal2: boolean;
  loadError: boolean;
  page: PageCatalogEntry;
  snapshot: StaffLabReportSnapshot | null;
}) {
  if (!hasRecentAal2) return <section className="empty-card"
    aria-labelledby="staff-lab-report-reauth">
    <span className="empty-card__icon empty-card__icon--warning">
      <ShieldCheck aria-hidden="true" />
    </span>
    <p className="eyebrow">敏感員工健康資料</p>
    <h1 id="staff-lab-report-reauth">需要重新完成雙重驗證</h1>
    <p>為保護員工檢驗結果，每次查閱與保存都必須使用同一工作階段最近 15 分鐘內的雙重驗證。此狀態下不會載入任何結果明細。</p>
    <Link className="button button--primary" href="/mfa?audience=staff">
      前往雙重驗證
    </Link>
  </section>;

  if (loadError || !snapshot) return <section className="empty-card"
    aria-labelledby="staff-lab-report-load-error">
    <span className="empty-card__icon empty-card__icon--warning">
      <AlertTriangle aria-hidden="true" />
    </span>
    <p className="eyebrow">載入失敗、無權限或篩選有誤</p>
    <h1 id="staff-lab-report-load-error">無法取得員工檢驗報告快照</h1>
    <p>系統不顯示未經完整核對的局部健康資料。請確認網路、分支、人員範圍與獨立員工健康權限後重試。</p>
    <Link className="button button--secondary"
      href="/app/staff/operations/staff-lab-reports">重新載入</Link>
  </section>;

  const duplicates = snapshot.records.filter((record) => record.duplicateWarning);
  return <div className={styles.workspace}>
    <header className={styles.hero}><div>
      <p className="eyebrow">第 {page.number} 頁 · 機構營運管理</p>
      <h1>{page.title}</h1>
      <p>{page.description} 原始版本、更正與作廢均保留不可變歷程。</p>
    </div><div className={styles.snapshotMeta}>
      <span>台北快照日 {snapshot.snapshotDate}</span>
      <time dateTime={snapshot.generatedAt}>更新 {formatTaipei(snapshot.generatedAt)}</time>
      <span>正式資料超過 5 分鐘時請重新載入</span>
    </div></header>

    {snapshot.demo ? <div className={styles.notice} role="status">
      展示模式：以下均為合成資料，只能檢視，不會保存員工健康內容。
    </div> : null}
    <div className={styles.warning} role="alert">
      本頁只照錄機構輸入的檢驗結果與人工效期。系統不解析結果、不判定正常或異常，也不提供診斷；「已過期」只表示人工有效至早於台北快照日。
    </div>
    <div className={styles.notice} role="note">
      機構效期規則與提醒排程尚未發布，故即將到期天數與人數顯示未設定。附件可信儲存與掃毒亦未配置，瀏覽器寫入會被拒絕；本頁不提供離線快取。
    </div>

    <section className={styles.metrics} aria-label="員工檢驗報告統計">
      <article><ShieldCheck aria-hidden="true" /><span>人工效期內</span>
        <strong>{snapshot.activeTotal}</strong></article>
      <article><CalendarClock aria-hidden="true" /><span>即將到期</span>
        <strong>未設定</strong></article>
      <article><FileWarning aria-hidden="true" /><span>人工效期已過</span>
        <strong>{snapshot.expiredTotal}</strong></article>
      <article><CopyCheck aria-hidden="true" /><span>重複警示</span>
        <strong>{snapshot.duplicateWarningTotal}</strong></article>
    </section>
    <p className={styles.metricNote}>目前篩選結果另有 {snapshot.missingEvidenceTotal} 筆缺證明；重複筆數只提示，不會自動合併或覆寫。</p>

    <StaffLabReportCreateForm canManage={canManage && !snapshot.demo}
      snapshot={snapshot} />
    <StaffLabReportRevisionForm canManage={canManage && !snapshot.demo}
      snapshot={snapshot} />

    <form className={styles.filters} method="get" aria-label="篩選員工檢驗報告">
      <label><span>員工</span><select name="staff"
        defaultValue={filters.staffMembershipId ?? "all"}>
        <option value="all">全部可見員工</option>{snapshot.staffOptions.map((staff) =>
          <option key={staff.staffMembershipId} value={staff.staffMembershipId}>
            {staff.employeeCode ? `${staff.employeeCode} · ` : ""}{staff.displayName}
            {staff.isCurrent ? "" : "（歷史人員）"}
          </option>)}</select></label>
      <label><span>檢驗類型</span><select name="type"
        defaultValue={filters.reportType ?? "all"}>
        <option value="all">全部類型</option>{snapshot.typeOptions.map((option) =>
          <option key={option.reportType} value={option.reportType}>
            {option.reportType}（{option.recordCount}）
          </option>)}</select></label>
      <label><span>人工效期狀態</span><select name="validity"
        defaultValue={filters.validityStatus}>
        <option value="all">全部</option><option value="active">人工效期內</option>
        <option value="expired">人工效期已過</option><option value="voided">已作廢</option>
      </select></label>
      <label><span>重複警示</span><select name="duplicate"
        defaultValue={filters.duplicateStatus}>
        <option value="all">全部</option><option value="any">任一警示</option>
        <option value="exact">內容完全相同</option>
        <option value="key_fields">關鍵欄位相同</option>
        <option value="none">無警示</option>
      </select></label>
      <label><span>證明狀態</span><select name="evidence"
        defaultValue={filters.evidenceStatus}>
        <option value="all">全部</option><option value="provided">已提供</option>
        <option value="missing">缺證明</option><option value="not_applicable">不適用</option>
      </select></label>
      <label><span>檢驗日起</span><input name="from" type="date"
        defaultValue={filters.dateFrom ?? ""} /></label>
      <label><span>檢驗日至</span><input name="to" type="date"
        defaultValue={filters.dateTo ?? ""} /></label>
      <label><span>搜尋</span><input name="q" defaultValue={filters.query}
        maxLength={120} placeholder="員工、類型、院所、結果或效期依據" /></label>
      <button className="button button--secondary" type="submit">套用篩選</button>
      <Link className="button button--ghost"
        href="/app/staff/operations/staff-lab-reports">清除</Link>
    </form>

    <div className={styles.resultHeader}>
      <p>顯示 {snapshot.records.length} / {snapshot.recordTotal} 筆終端版本。</p>
      {snapshot.recordsTruncated ? <p role="status">紀錄上限 200 筆；統計仍涵蓋全部符合資料。</p> : null}
    </div>

    <section className={styles.records} aria-labelledby="staff-lab-records-heading">
      <h2 id="staff-lab-records-heading">員工檢驗報告終端版本</h2>
      {snapshot.records.length === 0 ? <div className="empty-card">
        <span className="empty-card__icon"><ShieldCheck aria-hidden="true" /></span>
        <h3>沒有符合條件的檢驗報告</h3>
        <p>請調整員工、類型、人工效期、重複、證明、日期或搜尋條件。</p>
      </div> : <>
        <div className={styles.tableWrap} role="region" tabIndex={0}
          aria-label="可水平捲動的員工檢驗報告表格">
          <table className={styles.table}><thead><tr><th>員工</th><th>類型／日期</th>
            <th>院所</th><th>結果</th><th>人工效期／證明</th>
            <th>重複／版本</th></tr></thead>
          <tbody>{snapshot.records.map((record) => <tr key={record.recordVersionId}>
            <td>{record.staffEmployeeCode ? `${record.staffEmployeeCode} · ` : ""}
              {record.staffDisplayName}</td>
            <td>{record.reportType}<br /><small>{record.testedOn}</small></td>
            <td>{record.providerName}</td><td>{record.resultText}<br />
              <small>醫療判定：未評估</small></td>
            <td>有效至 {record.validThrough}<br /><small>{record.validityBasis}</small><br />
              <small>證明：{evidenceLabels[record.evidenceStatus]}</small></td>
            <td>{record.duplicateWarning ? <ul className={styles.compactList}>
              {record.duplicateBases.map((basis) =>
                <li key={basis}>{duplicateLabel(basis)}</li>)}</ul> : "無重複警示"}<br />
              <small>v{record.version} · {validityLabels[record.validityStatus]}</small></td>
          </tr>)}</tbody></table>
        </div>
        <div className={styles.mobileCards}>{snapshot.records.map((record) => <article
          key={record.recordVersionId}><h3>{record.staffDisplayName}</h3>
          <p>{record.staffEmployeeCode ?? "無員工代碼"} · v{record.version}</p>
          <dl><div><dt>檢驗</dt><dd>{record.reportType}<br />{record.testedOn}</dd></div>
            <div><dt>院所</dt><dd>{record.providerName}</dd></div>
            <div><dt>結果</dt><dd>{record.resultText}<br /><small>醫療判定：未評估</small></dd></div>
            <div><dt>人工效期</dt><dd>{record.validThrough}<br />{record.validityBasis}</dd></div>
            <div><dt>證明</dt><dd>{evidenceLabels[record.evidenceStatus]}</dd></div>
            <div><dt>重複提示</dt><dd>{record.duplicateBases.length
              ? record.duplicateBases.map(duplicateLabel).join("；") : "無"}</dd></div>
            <div><dt>狀態</dt><dd>{validityLabels[record.validityStatus]}</dd></div></dl>
        </article>)}</div>
      </>}
    </section>

    <section className={styles.duplicates} aria-labelledby="staff-lab-duplicates-heading">
      <h2 id="staff-lab-duplicates-heading">可解釋的重複警示</h2>
      <p>完全相同會核對完整內容雜湊；關鍵欄位相同只比較員工、檢驗類型、檢驗日與院所。每筆仍保留獨立識別與版本。</p>
      {duplicates.length === 0 ? <p>目前篩選結果沒有重複警示。</p> :
        <div className={styles.duplicateGrid}>{duplicates.map((record) => <article
          key={record.recordVersionId}><h3>{record.staffDisplayName} · {record.reportType}</h3>
          <ul>{record.duplicateBases.map((basis) =>
            <li key={basis}>{duplicateLabel(basis)}</li>)}</ul>
          <p>完全相同 {record.exactDuplicateCount} 筆；關鍵欄位相同合計 {record.keyFieldDuplicateCount} 筆。</p>
          <p>系統只提示，未合併、未刪除，也未判定結果。</p>
        </article>)}</div>}
    </section>

    <section className={styles.history} aria-labelledby="staff-lab-history-heading">
      <h2 id="staff-lab-history-heading">不可變版本歷程</h2>
      <p>顯示 {snapshot.history.length} / {snapshot.historyTotal} 個版本；已完成版本不能直接修改或刪除。</p>
      {snapshot.historyTruncated ? <p role="status">歷程上限 500 筆，請縮小篩選範圍。</p> : null}
      <div className={styles.historyGrid}>{snapshot.history.map((record) => <article
        key={record.recordVersionId}><h3>{record.reportType} · {record.testedOn} · v{record.version}</h3>
        <dl><div><dt>院所</dt><dd>{record.providerName}</dd></div>
          <div><dt>結果</dt><dd>{record.resultText}</dd></div>
          <div><dt>人工效期</dt><dd>{record.validThrough}<br />{record.validityBasis}</dd></div>
          <div><dt>證明</dt><dd>{evidenceLabels[record.evidenceStatus]}</dd></div>
          <div><dt>紀錄狀態</dt><dd>{record.recordStatus === "voided"
            ? "作廢終端" : "有效於當時"}</dd></div>
          <div><dt>保存時間</dt><dd>{formatTaipei(record.recordedAt)}</dd></div>
          <div><dt>保存人</dt><dd>{record.recordedByDisplayName}</dd></div>
          <div><dt>更正理由</dt><dd>{record.correctionReason ?? "原始版本"}</dd></div></dl>
      </article>)}</div>
    </section>
  </div>;
}
