import {
  AlertTriangle,
  Award,
  BookOpenCheck,
  CalendarClock,
  FileWarning,
} from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  StaffTrainingFilters,
  StaffTrainingSnapshot,
} from "@/lib/staff-training/types";

import {
  StaffTrainingRecordCreateForm,
  StaffTrainingRecordRevisionForm,
  StaffTrainingRuleForms,
} from "./staff-training-actions";
import styles from "./staff-training.module.css";

const evidenceLabels = {
  provided: "已提供可信參照",
  missing: "缺證明",
  not_applicable: "不適用",
};
const statusLabels = { active: "有效版本", voided: "已作廢" };
const progressLabels = {
  not_configured: "規則未設定",
  indeterminate: "資料不足，無法判定",
  complete: "已達機構規則",
  incomplete: "尚有缺口",
};

function formatTaipei(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

export function StaffTrainingWorkspace({
  canManage, canRules, filters, hasRecentAal2, loadError, page, snapshot,
}: {
  canManage: boolean;
  canRules: boolean;
  filters: StaffTrainingFilters;
  hasRecentAal2: boolean;
  loadError: boolean;
  page: PageCatalogEntry;
  snapshot: StaffTrainingSnapshot | null;
}) {
  if (loadError || !snapshot) return <section className="empty-card"
    aria-labelledby="training-load-error">
    <span className="empty-card__icon empty-card__icon--warning">
      <AlertTriangle aria-hidden="true" />
    </span>
    <p className="eyebrow">載入失敗或逾時</p>
    <h1 id="training-load-error">無法取得教育訓練快照</h1>
    <p>系統沒有顯示未經完整核對的局部資料。請確認網路、分支與權限後重試。</p>
    <Link className="button button--secondary" href="/app/staff/operations/training">
      重新載入
    </Link>
  </section>;

  return <div className={styles.workspace}>
    <header className={styles.hero}><div>
      <p className="eyebrow">第 {page.number} 頁 · 機構營運管理</p>
      <h1>{page.title}</h1>
      <p>{page.description} 原始版本、更正與作廢都保留於不可變紀錄鏈。</p>
    </div><div className={styles.snapshotMeta}>
      <span>台北快照日 {snapshot.snapshotDate}</span>
      <time dateTime={snapshot.generatedAt}>更新 {formatTaipei(snapshot.generatedAt)}</time>
      <span>正式資料超過 5 分鐘時請重新載入</span>
    </div></header>

    {snapshot.demo ? <div className={styles.notice} role="status">
      展示模式：以下為合成資料，只能檢視，不會寫入員工、規則或證明。
    </div> : null}
    <div className={styles.notice} role="note">
      本頁不提供離線快取。附件上傳／掃毒與外部訓練申報尚未配置，因此不會把本機檔案標示為已提供，也不會宣稱已外送。
    </div>
    <div className={snapshot.policyStatus === "not_configured" ? styles.warning : styles.notice}
      role={snapshot.policyStatus === "not_configured" ? "alert" : "status"}>
      {snapshot.policyStatus === "not_configured"
        ? "機構尚未雙人發布教育訓練規則；系統不會預設六年 120 點，也不會虛構缺口或即將到期數。"
        : `目前採機構規則 v${snapshot.ruleVersion}：${snapshot.windowYears} 年滾動視窗、${snapshot.requiredCredits} 點、到期前 ${snapshot.expiryNoticeDays} 日提示；生效日 ${snapshot.ruleEffectiveFrom}。`}
    </div>

    <section className={styles.metrics} aria-label="教育訓練統計">
      <article><BookOpenCheck aria-hidden="true" /><span>符合紀錄</span>
        <strong>{snapshot.recordTotal}</strong></article>
      <article><Award aria-hidden="true" /><span>時數／已知積分</span>
        <strong>{snapshot.hoursTotal}／{snapshot.creditsTotal ?? "無已知值"}</strong></article>
      <article><FileWarning aria-hidden="true" /><span>缺證明／缺積分</span>
        <strong>{snapshot.missingEvidenceTotal}／{snapshot.missingCreditTotal}</strong></article>
      <article><CalendarClock aria-hidden="true" /><span>將到期／缺口／待判定</span>
        <strong>{snapshot.policyStatus === "published"
          ? `${snapshot.expiringTotal}/${snapshot.gapStaffTotal}/${snapshot.indeterminateStaffTotal}`
          : "未設定"}</strong></article>
    </section>

    <StaffTrainingRecordCreateForm canManage={canManage && !snapshot.demo} snapshot={snapshot} />
    <StaffTrainingRecordRevisionForm canManage={canManage && !snapshot.demo} snapshot={snapshot} />
    <StaffTrainingRuleForms canRules={canRules && !snapshot.demo}
      hasRecentAal2={hasRecentAal2} snapshot={snapshot} />

    <form className={styles.filters} method="get" aria-label="篩選教育訓練">
      <label><span>起始日</span><input name="from" type="date"
        defaultValue={filters.dateFrom ?? ""} /></label>
      <label><span>截止日</span><input name="to" type="date"
        defaultValue={filters.dateTo ?? ""} /></label>
      <label><span>員工</span><select name="staff" defaultValue={filters.staffMembershipId ?? "all"}>
        <option value="all">全部可見員工</option>{snapshot.staffOptions.map((staff) =>
          <option key={staff.staffMembershipId} value={staff.staffMembershipId}>
            {staff.employeeCode ? `${staff.employeeCode} · ` : ""}{staff.displayName}
            {staff.isCurrent ? "" : "（已離職歷史）"}
          </option>)}</select></label>
      <label><span>課程類型</span><select name="type" defaultValue={filters.courseType ?? "all"}>
        <option value="all">全部類型</option>{snapshot.courseTypeOptions.map((option) =>
          <option key={option.courseType} value={option.courseType}>
            {option.courseType}（{option.recordCount}）
          </option>)}</select></label>
      <label><span>狀態</span><select name="status" defaultValue={filters.status}>
        <option value="all">全部</option><option value="active">有效版本</option>
        <option value="voided">已作廢</option><option value="missing_evidence">缺證明</option>
        {snapshot.policyStatus === "published" ? <option value="expiring">即將到期</option> : null}
      </select></label>
      <label><span>搜尋</span><input name="q" defaultValue={filters.query}
        maxLength={120} placeholder="員工、課程、類型或單位" /></label>
      <button className="button button--secondary" type="submit">套用篩選</button>
      <Link className="button button--ghost" href="/app/staff/operations/training">清除</Link>
    </form>

    <div className={styles.resultHeader}>
      <p>顯示 {snapshot.records.length} / {snapshot.recordTotal} 筆終端版本。</p>
      {snapshot.recordsTruncated ? <p role="status">紀錄上限 200 筆；統計仍涵蓋全部符合資料。</p> : null}
      {snapshot.staffTruncated ? <p role="status">員工選項顯示 {snapshot.staffOptions.length} / {snapshot.staffTotal}。</p> : null}
    </div>

    <section className={styles.records} aria-labelledby="training-records-heading">
      <h2 id="training-records-heading">訓練紀錄</h2>
      {snapshot.records.length === 0 ? <div className="empty-card">
        <span className="empty-card__icon"><BookOpenCheck aria-hidden="true" /></span>
        <h3>沒有符合條件的訓練紀錄</h3>
        <p>請調整日期、員工、類型、狀態或搜尋；具管理權限者也可新增紀錄。</p>
      </div> : <>
        <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th>員工</th><th>課程／辦理單位</th><th>日期／類型</th>
            <th>時數／積分</th><th>證明</th><th>版本／狀態</th></tr></thead>
          <tbody>{snapshot.records.map((record) => <tr key={record.recordVersionId}>
            <td>{record.staffEmployeeCode ? `${record.staffEmployeeCode} · ` : ""}{record.staffDisplayName}</td>
            <td>{record.courseTitle}<br /><small>{record.providerName}</small></td>
            <td>{record.trainingDate}<br /><small>{record.courseType}</small></td>
            <td>{record.hours} 小時<br /><small>{record.credits === null ? "積分未提供" : `${record.credits} 點`}</small></td>
            <td>{evidenceLabels[record.evidenceStatus]}</td>
            <td>v{record.version} · {statusLabels[record.recordStatus]}
              {record.correctionReason ? <><br /><small>{record.correctionReason}</small></> : null}</td>
          </tr>)}</tbody>
        </table></div>
        <div className={styles.mobileCards}>{snapshot.records.map((record) => <article
          key={record.recordVersionId}><h3>{record.courseTitle}</h3>
          <p>{record.staffEmployeeCode ? `${record.staffEmployeeCode} · ` : ""}{record.staffDisplayName}</p>
          <dl><div><dt>日期／類型</dt><dd>{record.trainingDate}<br />{record.courseType}</dd></div>
            <div><dt>時數／積分</dt><dd>{record.hours}／{record.credits ?? "未提供"}</dd></div>
            <div><dt>證明</dt><dd>{evidenceLabels[record.evidenceStatus]}</dd></div>
            <div><dt>版本</dt><dd>v{record.version} · {statusLabels[record.recordStatus]}</dd></div></dl>
        </article>)}</div>
      </>}
    </section>

    <section className={styles.progress} aria-labelledby="training-progress-heading">
      <h2 id="training-progress-heading">員工規則進度</h2>
      <p>顯示 {snapshot.staffProgress.length} / {snapshot.progressTotal} 人；每筆凍結至規則版本與快照日，缺值不當作 0。</p>
      {snapshot.progressTruncated ? <p role="status">進度明細上限 200 人，請用員工篩選縮小範圍。</p> : null}
      <div className={styles.progressGrid}>{snapshot.staffProgress.map((progress) => <article
        key={progress.staffMembershipId}><h3>{progress.employeeCode ? `${progress.employeeCode} · ` : ""}{progress.displayName}</h3>
        <p>{progressLabels[progress.progressStatus]}</p><dl>
          <div><dt>已知積分</dt><dd>{progress.knownCredits ?? "不可判定"}</dd></div>
          <div><dt>缺積分紀錄</dt><dd>{progress.missingCreditCount ?? "規則未設定"}</dd></div>
          <div><dt>缺口</dt><dd>{progress.creditGap ?? "不可判定"}</dd></div>
          <div><dt>規則／視窗</dt><dd>{progress.ruleVersion ? `v${progress.ruleVersion}` : "未設定"}<br />
            {progress.windowStart && progress.windowEnd ? `${progress.windowStart}–${progress.windowEnd}` : "—"}</dd></div>
        </dl></article>)}</div>
    </section>
  </div>;
}
