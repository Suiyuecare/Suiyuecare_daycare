import {
  AlertTriangle,
  CalendarDays,
  FileWarning,
  ShieldCheck,
  Siren,
} from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  StaffVaccinationFilters,
  StaffVaccinationSnapshot,
} from "@/lib/staff-vaccinations/types";

import {
  StaffVaccinationCreateForm,
  StaffVaccinationRevisionForm,
} from "./staff-vaccination-actions";
import styles from "./staff-vaccinations.module.css";

const evidenceLabels = {
  provided: "已提供可信參照", missing: "缺證明", not_applicable: "不適用",
};

function formatTaipei(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

export function StaffVaccinationsWorkspace({
  canManage,
  filters,
  loadError,
  page,
  snapshot,
}: {
  canManage: boolean;
  filters: StaffVaccinationFilters;
  loadError: boolean;
  page: PageCatalogEntry;
  snapshot: StaffVaccinationSnapshot | null;
}) {
  if (loadError || !snapshot) return <section className="empty-card"
    aria-labelledby="vaccination-load-error">
    <span className="empty-card__icon empty-card__icon--warning">
      <AlertTriangle aria-hidden="true" />
    </span>
    <p className="eyebrow">載入失敗或逾時</p>
    <h1 id="vaccination-load-error">無法取得員工疫苗快照</h1>
    <p>系統不顯示未經完整核對的局部健康資料。請確認網路、分支、AAL2 與獨立員工健康權限後重試。</p>
    <Link className="button button--secondary"
      href="/app/staff/operations/staff-vaccinations">重新載入</Link>
  </section>;

  const duplicateRecords = snapshot.records.filter((record) => record.duplicateWarning);
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
      展示模式：以下均為合成資料，只能檢視，不會寫入員工疫苗或證明。
    </div> : null}
    <div className={styles.warning} role="alert">
      重複警示只比對「同一員工＋疫苗名稱與劑次經去除前後空白、忽略大小寫後相同」，並列出其他紀錄供人工核對；系統不自動合併，也不代表重複接種或任何醫療判斷。
    </div>
    <div className={styles.notice} role="note">
      機構尚未發布正式提醒排程，因此提醒天數與人數顯示未設定，不推測下一劑。附件上傳、掃毒與可信伺服器參照也尚未配置，本頁拒絕瀏覽器路徑；此頁不提供離線快取。
    </div>

    <section className={styles.metrics} aria-label="員工疫苗統計">
      <article><ShieldCheck aria-hidden="true" /><span>接種終端紀錄</span>
        <strong>{snapshot.recordTotal}</strong></article>
      <article><FileWarning aria-hidden="true" /><span>缺證明</span>
        <strong>{snapshot.missingEvidenceTotal}</strong></article>
      <article><Siren aria-hidden="true" /><span>重複警示</span>
        <strong>{snapshot.duplicateWarningTotal}</strong></article>
      <article><CalendarDays aria-hidden="true" /><span>本月接種日期</span>
        <strong>{snapshot.currentMonthTotal}</strong></article>
    </section>

    <StaffVaccinationCreateForm canManage={canManage && !snapshot.demo} snapshot={snapshot} />
    <StaffVaccinationRevisionForm canManage={canManage && !snapshot.demo} snapshot={snapshot} />

    <form className={styles.filters} method="get" aria-label="篩選員工疫苗">
      <label><span>員工</span><select name="staff" defaultValue={filters.staffMembershipId ?? "all"}>
        <option value="all">全部可見員工</option>{snapshot.staffOptions.map((staff) =>
          <option key={staff.staffMembershipId} value={staff.staffMembershipId}>
            {staff.employeeCode ? `${staff.employeeCode} · ` : ""}{staff.displayName}
            {staff.isCurrent ? "" : "（歷史人員）"}
          </option>)}</select></label>
      <label><span>疫苗名稱</span><select name="vaccine" defaultValue={filters.vaccineName ?? "all"}>
        <option value="all">全部名稱</option>{snapshot.vaccineOptions.map((option) =>
          <option key={option.value} value={option.value}>{option.value}（{option.recordCount}）</option>)}
      </select></label>
      <label><span>劑次</span><select name="dose" defaultValue={filters.doseNumber ?? "all"}>
        <option value="all">全部劑次</option>{snapshot.doseOptions.map((option) =>
          <option key={option.value} value={option.value}>{option.value}（{option.recordCount}）</option>)}
      </select></label>
      <label><span>接種日起</span><input name="from" type="date"
        defaultValue={filters.dateFrom ?? ""} /></label>
      <label><span>接種日至</span><input name="to" type="date"
        defaultValue={filters.dateTo ?? ""} /></label>
      <label><span>狀態</span><select name="status" defaultValue={filters.status}>
        <option value="all">全部</option><option value="active">有效終端版本</option>
        <option value="voided">作廢終端版本</option>
        <option value="missing_evidence">缺證明</option>
        <option value="duplicate_warning">重複警示</option>
      </select></label>
      <label><span>搜尋</span><input name="q" defaultValue={filters.query}
        maxLength={120} placeholder="員工、疫苗、劑次、批號或院所" /></label>
      <button className="button button--secondary" type="submit">套用篩選</button>
      <Link className="button button--ghost"
        href="/app/staff/operations/staff-vaccinations">清除</Link>
    </form>

    <div className={styles.resultHeader}>
      <p>顯示 {snapshot.records.length} / {snapshot.recordTotal} 筆終端版本。</p>
      {snapshot.recordsTruncated ? <p role="status">紀錄上限 200 筆；統計仍涵蓋全部符合資料。</p> : null}
    </div>

    <section className={styles.records} aria-labelledby="vaccination-records-heading">
      <h2 id="vaccination-records-heading">員工疫苗終端版本</h2>
      {snapshot.records.length === 0 ? <div className="empty-card">
        <span className="empty-card__icon"><ShieldCheck aria-hidden="true" /></span>
        <h3>沒有符合條件的疫苗紀錄</h3>
        <p>請調整員工、疫苗、劑次、日期、狀態或搜尋；具管理權限者也可新增紀錄。</p>
      </div> : <>
        <div className={styles.tableWrap} role="region" tabIndex={0}
          aria-label="可水平捲動的員工疫苗終端版本表格"><table className={styles.table}>
          <thead><tr><th>員工</th><th>疫苗／劑次</th><th>日期／批號</th>
            <th>院所／證明</th><th>重複比對</th><th>版本／狀態</th></tr></thead>
          <tbody>{snapshot.records.map((record) => <tr key={record.recordVersionId}>
            <td>{record.staffEmployeeCode ? `${record.staffEmployeeCode} · ` : ""}{record.staffDisplayName}</td>
            <td>{record.vaccineName}<br /><small>{record.doseNumber}</small></td>
            <td>{record.vaccinatedOn}<br /><small>{record.lotNumber ?? "批號未提供"}</small></td>
            <td>{record.providerName}<br /><small>{evidenceLabels[record.evidenceStatus]}</small></td>
            <td>{record.duplicateWarning ? `另有 ${record.duplicateCount} 筆，未合併` : "未找到同鍵其他紀錄"}</td>
            <td>v{record.version} · {record.recordStatus === "voided" ? "已作廢" : "有效終端"}<br />
              <small>醫療判定：未評估</small></td>
          </tr>)}</tbody>
        </table></div>
        <div className={styles.mobileCards}>{snapshot.records.map((record) => <article
          key={record.recordVersionId}><h3>{record.vaccineName}</h3>
          <p>{record.staffEmployeeCode ? `${record.staffEmployeeCode} · ` : ""}{record.staffDisplayName}</p>
          <dl><div><dt>劑次</dt><dd>{record.doseNumber}</dd></div>
            <div><dt>日期／批號</dt><dd>{record.vaccinatedOn}<br />{record.lotNumber ?? "未提供"}</dd></div>
            <div><dt>院所／證明</dt><dd>{record.providerName}<br />{evidenceLabels[record.evidenceStatus]}</dd></div>
            <div><dt>重複比對</dt><dd>{record.duplicateWarning ? `另有 ${record.duplicateCount} 筆，未合併` : "未找到同鍵其他紀錄"}</dd></div>
            <div><dt>版本／狀態</dt><dd>v{record.version} · {record.recordStatus === "voided" ? "已作廢" : "有效終端"}</dd></div></dl>
        </article>)}</div>
      </>}
    </section>

    <section className={styles.duplicates} aria-labelledby="vaccination-duplicates-heading">
      <h2 id="vaccination-duplicates-heading">重複警示人工核對</h2>
      <p>比對依據固定為同一員工，且疫苗名稱與劑次經去除前後空白、忽略大小寫後相同。不同日期、批號或院所仍保留為不同紀錄。</p>
      {duplicateRecords.length === 0 ? <p>目前篩選結果沒有重複警示。</p> :
        <div className={styles.duplicateGrid}>{duplicateRecords.map((record) => <article
          key={record.recordVersionId}><h3>{record.staffDisplayName} · {record.vaccineName}</h3>
          <dl><div><dt>劑次</dt><dd>{record.doseNumber}</dd></div>
            <div><dt>本筆日期</dt><dd>{record.vaccinatedOn}</dd></div>
            <div><dt>其他筆數</dt><dd>{record.duplicateCount}</dd></div></dl>
          <ul>{record.duplicateMatches.map((match) => <li key={match.vaccinationKey}>
            另一筆接種日期 {match.vaccinatedOn}（保持獨立）
          </li>)}</ul>
          {record.duplicateMatchesTruncated ? <p role="status">
            僅列前 200 筆其他紀錄；總數仍為 {record.duplicateCount} 筆。
          </p> : null}
        </article>)}</div>}
    </section>

    <section className={styles.history} aria-labelledby="vaccination-history-heading">
      <h2 id="vaccination-history-heading">不可變版本歷程</h2>
      <p>顯示 {snapshot.history.length} / {snapshot.historyTotal} 個版本；已保存版本不能直接修改或刪除。</p>
      {snapshot.historyTruncated ? <p role="status">歷程上限 500 筆，請用員工、疫苗、劑次或日期篩選縮小範圍。</p> : null}
      <div className={styles.historyGrid}>{snapshot.history.map((record) => <article
        key={record.recordVersionId}><h3>{record.vaccineName} · {record.doseNumber} · v{record.version}</h3>
        <p>{record.vaccinatedOn} · {record.providerName}</p>
        <dl><div><dt>批號</dt><dd>{record.lotNumber ?? "未提供"}</dd></div>
          <div><dt>紀錄狀態</dt><dd>{record.recordStatus === "voided" ? "作廢終端" : "有效於當時"}</dd></div>
          <div><dt>保存時間</dt><dd>{formatTaipei(record.recordedAt)}</dd></div>
          <div><dt>保存人</dt><dd>{record.recordedByDisplayName}</dd></div>
          <div><dt>更正理由</dt><dd>{record.correctionReason ?? "原始版本"}</dd></div></dl>
      </article>)}</div>
    </section>
  </div>;
}
