import {
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  FileWarning,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  StaffCertificateFilters,
  StaffCertificateSnapshot,
} from "@/lib/staff-certificates/types";

import {
  StaffCertificateCreateForm,
  StaffCertificateExceptionForms,
  StaffCertificateRevisionForm,
} from "./staff-certificate-actions";
import styles from "./staff-certificates.module.css";

const validityLabels = {
  active: "日期與核驗有效",
  upcoming: "尚未生效",
  expired: "已過期",
  pending_verification: "待核驗",
  registration_not_active: "登錄未生效",
  voided: "已作廢",
};
const registrationLabels = {
  pending: "待登錄", registered: "已登錄", not_required: "不適用", suspended: "暫停",
};
const verificationLabels = { pending: "待核驗", verified: "已核驗", rejected: "核驗不通過" };
const evidenceLabels = { provided: "已提供可信參照", missing: "缺證明", not_applicable: "不適用" };

function formatTaipei(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

export function StaffCertificatesWorkspace({
  canExceptions, canManage, filters, hasRecentAal2, loadError, page, snapshot,
}: {
  canExceptions: boolean;
  canManage: boolean;
  filters: StaffCertificateFilters;
  hasRecentAal2: boolean;
  loadError: boolean;
  page: PageCatalogEntry;
  snapshot: StaffCertificateSnapshot | null;
}) {
  if (loadError || !snapshot) return <section className="empty-card"
    aria-labelledby="certificate-load-error">
    <span className="empty-card__icon empty-card__icon--warning">
      <AlertTriangle aria-hidden="true" />
    </span>
    <p className="eyebrow">載入失敗或逾時</p>
    <h1 id="certificate-load-error">無法取得員工證照快照</h1>
    <p>系統不顯示未經完整核對的局部資料。請確認網路、分支、AAL2 與權限後重試。</p>
    <Link className="button button--secondary" href="/app/staff/operations/staff-certificates">
      重新載入
    </Link>
  </section>;

  return <div className={styles.workspace}>
    <header className={styles.hero}><div>
      <p className="eyebrow">第 {page.number} 頁 · 機構營運管理</p>
      <h1>{page.title}</h1>
      <p>{page.description} 原始版本、更正、作廢與例外核准均保留不可變歷程。</p>
    </div><div className={styles.snapshotMeta}>
      <span>台北快照日 {snapshot.snapshotDate}</span>
      <time dateTime={snapshot.generatedAt}>更新 {formatTaipei(snapshot.generatedAt)}</time>
      <span>正式資料超過 5 分鐘時請重新載入</span>
    </div></header>

    {snapshot.demo ? <div className={styles.notice} role="status">
      展示模式：以下均為合成資料，只能檢視，不會寫入證照、證明或例外核准。
    </div> : null}
    <div className={styles.warning} role="alert">
      機構尚未發布證照到期提醒天數，因此「即將到期」與提醒人數顯示未設定，不預設 30 日。受限制服務規則也尚未配置；本頁只提供日期、登錄、核驗與例外的精確投影，不宣稱已阻擋或允許任何服務。
    </div>
    <div className={styles.notice} role="note">
      附件上傳、掃毒與可信伺服器參照尚未配置；本頁拒絕瀏覽器路徑，不會把任意文字標記為證明。此頁不提供離線快取。
    </div>

    <section className={styles.metrics} aria-label="員工證照統計">
      <article><BadgeCheck aria-hidden="true" /><span>日期與核驗有效</span>
        <strong>{snapshot.validTotal}</strong></article>
      <article><CalendarClock aria-hidden="true" /><span>即將到期</span>
        <strong>未設定</strong></article>
      <article><ShieldAlert aria-hidden="true" /><span>已過期</span>
        <strong>{snapshot.expiredTotal}</strong></article>
      <article><FileWarning aria-hidden="true" /><span>待核驗</span>
        <strong>{snapshot.pendingVerificationTotal}</strong></article>
    </section>

    <StaffCertificateCreateForm canManage={canManage && !snapshot.demo} snapshot={snapshot} />
    <StaffCertificateRevisionForm canManage={canManage && !snapshot.demo} snapshot={snapshot} />
    <StaffCertificateExceptionForms canExceptions={canExceptions && !snapshot.demo}
      hasRecentAal2={hasRecentAal2} snapshot={snapshot} />

    <form className={styles.filters} method="get" aria-label="篩選員工證照">
      <label><span>員工</span><select name="staff" defaultValue={filters.staffMembershipId ?? "all"}>
        <option value="all">全部可見員工</option>{snapshot.staffOptions.map((staff) =>
          <option key={staff.staffMembershipId} value={staff.staffMembershipId}>
            {staff.employeeCode ? `${staff.employeeCode} · ` : ""}{staff.displayName}
            {staff.isCurrent ? "" : "（歷史人員）"}
          </option>)}</select></label>
      <label><span>證照類型</span><select name="type" defaultValue={filters.certificateType ?? "all"}>
        <option value="all">全部類型</option>{snapshot.certificateTypeOptions.map((option) =>
          <option key={option.certificateType} value={option.certificateType}>
            {option.certificateType}（{option.recordCount}）
          </option>)}</select></label>
      <label><span>效期／核驗狀態</span><select name="status" defaultValue={filters.status}>
        <option value="all">全部</option><option value="active">日期與核驗有效</option>
        <option value="upcoming">尚未生效</option><option value="expired">已過期</option>
        <option value="pending_verification">待核驗</option>
        <option value="registration_not_active">登錄未生效</option>
        <option value="voided">已作廢</option>
      </select></label>
      <label><span>搜尋</span><input name="q" defaultValue={filters.query}
        maxLength={120} placeholder="員工、證照類型或證號" /></label>
      <button className="button button--secondary" type="submit">套用篩選</button>
      <Link className="button button--ghost" href="/app/staff/operations/staff-certificates">清除</Link>
    </form>

    <div className={styles.resultHeader}>
      <p>顯示 {snapshot.records.length} / {snapshot.recordTotal} 筆終端版本。</p>
      {snapshot.recordsTruncated ? <p role="status">紀錄上限 200 筆；統計仍涵蓋全部符合資料。</p> : null}
    </div>

    <section className={styles.records} aria-labelledby="certificate-records-heading">
      <h2 id="certificate-records-heading">員工證照終端版本</h2>
      {snapshot.records.length === 0 ? <div className="empty-card">
        <span className="empty-card__icon"><BadgeCheck aria-hidden="true" /></span>
        <h3>沒有符合條件的證照</h3>
        <p>請調整員工、類型、狀態或搜尋；具管理權限者也可新增證照。</p>
      </div> : <>
        <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th>員工</th><th>證照／證號</th><th>生效／到期</th>
            <th>登錄／核驗</th><th>證明</th><th>版本／狀態</th></tr></thead>
          <tbody>{snapshot.records.map((record) => <tr key={record.recordVersionId}>
            <td>{record.staffEmployeeCode ? `${record.staffEmployeeCode} · ` : ""}{record.staffDisplayName}</td>
            <td>{record.certificateType}<br /><small>{record.certificateNumber}</small></td>
            <td>{record.effectiveOn}<br /><small>{record.expiresOn ?? "無明確到期日"}</small></td>
            <td>{registrationLabels[record.registrationStatus]}<br />
              <small>{verificationLabels[record.verificationStatus]}</small></td>
            <td>{evidenceLabels[record.evidenceStatus]}</td>
            <td>v{record.version} · {validityLabels[record.validityStatus]}<br />
              <small>{record.hasActiveException ? "有限例外已雙人核准；服務仍未評估" :
                record.approvalCount > 0 ? `例外核准 ${record.approvalCount}/2` : "服務資格未評估"}</small></td>
          </tr>)}</tbody>
        </table></div>
        <div className={styles.mobileCards}>{snapshot.records.map((record) => <article
          key={record.recordVersionId}><h3>{record.certificateType}</h3>
          <p>{record.staffEmployeeCode ? `${record.staffEmployeeCode} · ` : ""}{record.staffDisplayName}</p>
          <dl><div><dt>證號</dt><dd>{record.certificateNumber}</dd></div>
            <div><dt>生效／到期</dt><dd>{record.effectiveOn}<br />{record.expiresOn ?? "無明確到期日"}</dd></div>
            <div><dt>登錄／核驗</dt><dd>{registrationLabels[record.registrationStatus]}／{verificationLabels[record.verificationStatus]}</dd></div>
            <div><dt>版本／狀態</dt><dd>v{record.version} · {validityLabels[record.validityStatus]}</dd></div></dl>
        </article>)}</div>
      </>}
    </section>

    <section className={styles.exceptions} aria-labelledby="certificate-exceptions-list">
      <h2 id="certificate-exceptions-list">例外申請與獨立核准</h2>
      <p>顯示 {snapshot.exceptionRequests.length} / {snapshot.exceptionRequestTotal} 筆；理由僅向例外授權人顯示。</p>
      {snapshot.exceptionRequests.length === 0 ? <p>目前沒有可見例外申請。</p> :
        <div className={styles.exceptionGrid}>{snapshot.exceptionRequests.map((request) =>
          <article key={request.requestId}><h3>{request.exceptionStatus === "approved"
            ? "已完成雙人核准" : request.exceptionStatus === "expired" ? "例外已到期" : "待獨立核准"}</h3>
            <p>{request.validFrom}–{request.validThrough}</p>
            <p>{request.reason}</p><dl><div><dt>申請人</dt><dd>{request.requesterDisplayName}</dd></div>
              <div><dt>核准進度</dt><dd>{request.approvalCount}/2</dd></div></dl>
            {request.approvals.length ? <ol>{request.approvals.map((approval) =>
              <li key={approval.approvalNumber}>第 {approval.approvalNumber} 位：{approval.approverDisplayName}</li>)}</ol> : null}
          </article>)}</div>}
    </section>

    <section className={styles.history} aria-labelledby="certificate-history-heading">
      <h2 id="certificate-history-heading">不可變版本歷程</h2>
      <p>顯示 {snapshot.history.length} / {snapshot.historyTotal} 個版本；已保存版本不能直接修改或刪除。</p>
      {snapshot.historyTruncated ? <p role="status">歷程上限 500 筆，請用員工或類型篩選縮小範圍。</p> : null}
      <div className={styles.historyGrid}>{snapshot.history.map((record) => <article
        key={record.recordVersionId}><h3>{record.certificateType} · v{record.version}</h3>
        <p>{record.certificateNumber}</p><dl><div><dt>紀錄狀態</dt><dd>{record.recordStatus === "voided" ? "作廢終端" : "有效於當時"}</dd></div>
          <div><dt>保存時間</dt><dd>{formatTaipei(record.recordedAt)}</dd></div>
          <div><dt>保存人</dt><dd>{record.recordedByDisplayName}</dd></div>
          <div><dt>更正理由</dt><dd>{record.correctionReason ?? "原始版本"}</dd></div></dl>
      </article>)}</div>
    </section>
  </div>;
}
