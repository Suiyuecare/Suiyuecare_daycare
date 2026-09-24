import {
  AlertTriangle,
  Ban,
  CircleSlash2,
  Gauge,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  StaffVitalSignFilters,
  StaffVitalSignRecord,
  StaffVitalSignSnapshot,
} from "@/lib/staff-vital-signs/types";

import {
  StaffVitalSignCreateForm,
  StaffVitalSignRevisionForm,
} from "./staff-vital-sign-actions";
import styles from "./staff-vital-signs.module.css";

const valueStatusLabels = {
  measured: "已量", missing: "缺值", not_applicable: "不適用",
};

function formatTaipei(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

function displayValue(record: Pick<StaffVitalSignRecord,
  "valueStatus" | "valueDecimalText" | "unit" | "statusReason">) {
  if (record.valueStatus === "measured") {
    return `${record.valueDecimalText ?? ""} ${record.unit ?? ""}`.trim();
  }
  return `${valueStatusLabels[record.valueStatus]}：${record.statusReason ?? "未提供原因"}`;
}

export function StaffVitalSignsWorkspace({
  canManage, filters, hasRecentAal2, loadError, page, snapshot,
}: {
  canManage: boolean;
  filters: StaffVitalSignFilters;
  hasRecentAal2: boolean;
  loadError: boolean;
  page: PageCatalogEntry;
  snapshot: StaffVitalSignSnapshot | null;
}) {
  if (!hasRecentAal2) return <section className="empty-card"
    aria-labelledby="staff-vital-sign-reauth">
    <span className="empty-card__icon empty-card__icon--warning">
      <ShieldCheck aria-hidden="true" />
    </span>
    <p className="eyebrow">敏感員工健康資料</p>
    <h1 id="staff-vital-sign-reauth">需要重新完成雙重驗證</h1>
    <p>為保護員工健康量測，每次查閱與保存都必須使用同一工作階段最近 15 分鐘內的雙重驗證。此狀態下不會載入量測值、備註或搜尋結果。</p>
    <Link className="button button--primary" href="/mfa?audience=staff&purpose=sensitive-action">
      前往雙重驗證
    </Link>
  </section>;

  if (loadError || !snapshot) return <section className="empty-card"
    aria-labelledby="staff-vital-sign-load-error">
    <span className="empty-card__icon empty-card__icon--warning">
      <AlertTriangle aria-hidden="true" />
    </span>
    <p className="eyebrow">載入失敗、無權限或篩選有誤</p>
    <h1 id="staff-vital-sign-load-error">無法取得員工生命徵象快照</h1>
    <p>系統不顯示未經完整核對的局部健康資料。請確認網路、分支、人員範圍與獨立員工健康權限後重試。</p>
    <Link className="button button--secondary"
      href="/app/staff/operations/staff-vital-signs">重新載入</Link>
  </section>;

  return <div className={styles.workspace}>
    <header className={styles.hero}><div>
      <p className="eyebrow">第 {page.number} 頁 · 機構營運管理</p>
      <h1>{page.title}</h1>
      <p>{page.description} 原始版本、更正與作廢均保留不可變歷程。</p>
    </div><div className={styles.snapshotMeta}>
      <span>台北快照日 {snapshot.snapshotDate}</span>
      <time dateTime={snapshot.generatedAt}>更新 {formatTaipei(snapshot.generatedAt)}</time>
      <span>趨勢與清單來自同一快照；超過 5 分鐘請重新載入</span>
    </div></header>

    {snapshot.demo ? <div className={styles.notice} role="status">
      展示模式：以下均為合成資料，只能檢視，不會保存員工健康內容。
    </div> : null}
    <div className={styles.warning} role="alert">
      機構尚未發布員工生命徵象警示門檻版本，因此警示數與待確認數皆為「未設定」。系統不自行套用數值範圍、不判定異常，也不提供診斷或處置建議。
    </div>
    <div className={styles.notice} role="note">
      精確 decimal 文字會保留輸入格式，例如 120.00 不會被改成 120。「缺值」與「不適用」分開保存。附件、匯出與離線功能未啟用，所有瀏覽器寫入均會拒絕這些欄位。
    </div>

    <section className={styles.metrics} aria-label="員工生命徵象統計">
      <article><Gauge aria-hidden="true" /><span>已量紀錄</span>
        <strong>{snapshot.measuredTotal}</strong></article>
      <article><Ban aria-hidden="true" /><span>缺值紀錄</span>
        <strong>{snapshot.missingTotal}</strong></article>
      <article><CircleSlash2 aria-hidden="true" /><span>不適用</span>
        <strong>{snapshot.notApplicableTotal}</strong></article>
      <article><AlertTriangle aria-hidden="true" /><span>門檻警示／待確認</span>
        <strong>未設定</strong></article>
    </section>
    <p className={styles.metricNote}>目前篩選結果另有 {snapshot.voidedTotal} 筆作廢終端；排程缺測人數也因規則未發布而未設定。</p>

    <StaffVitalSignCreateForm canManage={canManage && !snapshot.demo}
      snapshot={snapshot} />
    <StaffVitalSignRevisionForm canManage={canManage && !snapshot.demo}
      snapshot={snapshot} />

    <form className={styles.filters} method="get" aria-label="篩選員工生命徵象">
      <label><span>員工</span><select name="staff"
        defaultValue={filters.staffMembershipId ?? "all"}>
        <option value="all">全部可見員工</option>{snapshot.staffOptions.map((staff) =>
          <option key={staff.staffMembershipId} value={staff.staffMembershipId}>
            {staff.employeeCode ? `${staff.employeeCode} · ` : ""}{staff.displayName}
            {staff.isCurrent ? "" : "（歷史人員）"}
          </option>)}</select></label>
      <label><span>量測種類</span><select name="type"
        defaultValue={filters.measurementType ?? "all"}>
        <option value="all">全部類型</option>{snapshot.typeOptions.map((option) =>
          <option key={option.measurementType} value={option.measurementType}>
            {option.measurementType}（{option.recordCount}）
          </option>)}</select></label>
      <label><span>值狀態</span><select name="state"
        defaultValue={filters.stateStatus}>
        <option value="all">全部</option><option value="measured">已量</option>
        <option value="missing">缺值</option>
        <option value="not_applicable">不適用</option>
        <option value="voided">已作廢</option>
      </select></label>
      <label><span>發生日起</span><input name="from" type="date"
        defaultValue={filters.dateFrom ?? ""} /></label>
      <label><span>發生日至</span><input name="to" type="date"
        defaultValue={filters.dateTo ?? ""} /></label>
      <label><span>搜尋</span><input name="q" defaultValue={filters.query}
        maxLength={120} placeholder="員工、類型、來源、原因或備註" /></label>
      <button className="button button--secondary" type="submit">套用篩選</button>
      <Link className="button button--ghost"
        href="/app/staff/operations/staff-vital-signs">清除</Link>
    </form>

    <div className={styles.resultHeader}>
      <p>顯示 {snapshot.records.length} / {snapshot.recordTotal} 筆終端版本。</p>
      {snapshot.recordsTruncated ? <p role="status">清單上限 200 筆；趨勢只使用同一快照內可見的已量紀錄。</p> : null}
    </div>

    <section className={styles.trends} aria-labelledby="staff-vital-trends-heading">
      <h2 id="staff-vital-trends-heading">同快照量測趨勢</h2>
      <p>依員工、量測種類與單位分組，共 {snapshot.trendPointTotal} 個已量點。只排列原始值與時間，不推論上升、下降或異常。</p>
      {snapshot.trendSeries.length === 0 ? <p>目前篩選結果沒有可呈現的已量趨勢點；缺值與不適用仍保留在清單。</p> :
        <div className={styles.trendGrid}>{snapshot.trendSeries.map((series) =>
          <article key={JSON.stringify([
            series.staffMembershipId, series.measurementType, series.unit,
          ])}>
            <h3>{series.staffDisplayName} · {series.measurementType}</h3>
            <p>單位：{series.unit}</p>
            <ol className={styles.trendList}>{series.points.map((point) =>
              <li key={point.recordVersionId}>
                <time dateTime={point.occurredAt}>{formatTaipei(point.occurredAt)}</time>
                <strong>{point.valueDecimalText}</strong>
              </li>)}</ol>
          </article>)}</div>}
    </section>

    <section className={styles.records} aria-labelledby="staff-vital-records-heading">
      <h2 id="staff-vital-records-heading">生命徵象終端版本</h2>
      {snapshot.records.length === 0 ? <div className="empty-card">
        <span className="empty-card__icon"><ShieldCheck aria-hidden="true" /></span>
        <h3>沒有符合條件的生命徵象</h3>
        <p>請調整員工、量測種類、值狀態、日期或搜尋條件。</p>
      </div> : <>
        <div className={styles.tableWrap} role="region" tabIndex={0}
          aria-label="可水平捲動的員工生命徵象表格">
          <table className={styles.table}><thead><tr><th>員工</th><th>發生時間</th>
            <th>量測種類</th><th>值／單位</th><th>來源／備註</th>
            <th>規則／版本</th></tr></thead>
          <tbody>{snapshot.records.map((record) => <tr key={record.recordVersionId}>
            <td>{record.staffEmployeeCode ? `${record.staffEmployeeCode} · ` : ""}
              {record.staffDisplayName}</td>
            <td>{formatTaipei(record.occurredAt)}</td>
            <td>{record.measurementType}</td>
            <td>{displayValue(record)}</td>
            <td>{record.source}<br /><small>{record.note ?? "無備註"}</small></td>
            <td>門檻未設定<br /><small>v{record.version} · {record.recordStatus === "voided" ? "已作廢" : "有效終端"}</small></td>
          </tr>)}</tbody></table>
        </div>
        <div className={styles.mobileCards}>{snapshot.records.map((record) => <article
          key={record.recordVersionId}><h3>{record.staffDisplayName}</h3>
          <p>{record.staffEmployeeCode ?? "無員工代碼"} · v{record.version}</p>
          <dl><div><dt>發生時間</dt><dd>{formatTaipei(record.occurredAt)}</dd></div>
            <div><dt>量測種類</dt><dd>{record.measurementType}</dd></div>
            <div><dt>值／狀態</dt><dd>{displayValue(record)}</dd></div>
            <div><dt>來源</dt><dd>{record.source}</dd></div>
            <div><dt>備註</dt><dd>{record.note ?? "無"}</dd></div>
            <div><dt>門檻</dt><dd>未設定；未作醫療判定</dd></div>
            <div><dt>紀錄狀態</dt><dd>{record.recordStatus === "voided"
              ? "已作廢" : "有效終端"}</dd></div></dl>
        </article>)}</div>
      </>}
    </section>

    <section className={styles.history} aria-labelledby="staff-vital-history-heading">
      <h2 id="staff-vital-history-heading">不可變版本歷程</h2>
      <p>顯示 {snapshot.history.length} / {snapshot.historyTotal} 個版本；已完成版本不能直接修改或刪除。</p>
      {snapshot.historyTruncated ? <p role="status">歷程上限 500 筆，請縮小篩選範圍。</p> : null}
      <div className={styles.historyGrid}>{snapshot.history.map((record) => <article
        key={record.recordVersionId}><h3>{record.measurementType} · v{record.version}</h3>
        <dl><div><dt>發生時間</dt><dd>{formatTaipei(record.occurredAt)}</dd></div>
          <div><dt>值／狀態</dt><dd>{displayValue(record)}</dd></div>
          <div><dt>來源</dt><dd>{record.source}</dd></div>
          <div><dt>備註</dt><dd>{record.note ?? "無"}</dd></div>
          <div><dt>紀錄狀態</dt><dd>{record.recordStatus === "voided"
            ? "作廢終端" : "有效於當時"}</dd></div>
          <div><dt>保存時間</dt><dd>{formatTaipei(record.recordedAt)}</dd></div>
          <div><dt>保存人</dt><dd>{record.recordedByDisplayName}</dd></div>
          <div><dt>更正理由</dt><dd>{record.correctionReason ?? "原始版本"}</dd></div></dl>
      </article>)}</div>
    </section>
  </div>;
}
