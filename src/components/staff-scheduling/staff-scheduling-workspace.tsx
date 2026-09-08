import {
  AlertTriangle,
  CalendarClock,
  CircleAlert,
  ListChecks,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  StaffScheduleRecord,
  StaffSchedulingFilters,
  StaffSchedulingSnapshot,
} from "@/lib/staff-scheduling/types";

import {
  StaffScheduleDecisionForm,
  StaffScheduleDraftForm,
} from "./staff-scheduling-actions";
import styles from "./staff-scheduling.module.css";

const STATUS = {
  draft_ready: "待審／無衝突", draft_conflicted: "待審／有衝突",
  published: "已發布", voided: "已駁回作廢",
};
const FILTER_STATUS = {
  all: "全部", ready: "待審／無衝突", conflicted: "待審／有衝突",
  published: "一般發布", overridden: "衝突覆核發布", rejected: "已駁回",
};

function formatTaipei(value: string) {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

function reviewLabel(record: StaffScheduleRecord) {
  if (record.reviewMode === "standard") return "獨立核准發布";
  if (record.reviewMode === "override") return "有理由覆核衝突後發布";
  if (record.reviewMode === "rejected") return "獨立駁回";
  return "尚未審核";
}

function RecordDetails({ record }: { record: StaffScheduleRecord }) {
  return <div className={styles.recordDetails}>
    <dl><div><dt>服務需求</dt><dd>{record.serviceNeedText}</dd></div>
      <div><dt>場地／車輛</dt><dd>{record.facilityCode} ／ {record.vehicleCode}</dd></div>
      <div><dt>建立理由</dt><dd>{record.revisionReason}</dd></div>
      <div><dt>規則版本</dt><dd>{record.ruleVersionId.slice(0, 8)}…</dd></div>
      <div><dt>資格證據</dt><dd>{record.qualificationEvidence.length
        ? record.qualificationEvidence.map((item) =>
          `${item.certificateType} · Page 72 v${item.version}${item.hasActiveException ? "（具有效雙人例外）" : ""}`).join("、")
        : "無符合 Page 72 終端證照證據"}</dd></div>
      <div><dt>審核</dt><dd>{reviewLabel(record)}</dd></div></dl>
    {record.conflicts.length ? <div className={styles.conflicts}><h4>可解釋衝突</h4>
      <ul>{record.conflicts.map((conflict, index) => <li
        key={`${conflict.code}-${index}`}><strong>{conflict.code}</strong>
        <span>{conflict.message}</span></li>)}</ul></div> : <p className={styles.noConflict}>
      此快照依已選人工規則版本未偵測到衝突；仍須獨立核准，不代表自動合規。
    </p>}
  </div>;
}

export function StaffSchedulingWorkspace({
  canApprove, canManage, canOverride, currentUserId, filters,
  hasRecentAal2, loadError, page, snapshot,
}: {
  canApprove: boolean;
  canManage: boolean;
  canOverride: boolean;
  currentUserId: string;
  filters: StaffSchedulingFilters;
  hasRecentAal2: boolean;
  loadError: boolean;
  page: PageCatalogEntry;
  snapshot: StaffSchedulingSnapshot | null;
}) {
  const basePath = "/app/staff/operations/smart-scheduling";
  if (loadError || !snapshot) return <section className="empty-card"
    aria-labelledby="staff-scheduling-load-error">
    <span className="empty-card__icon empty-card__icon--warning">
      <AlertTriangle aria-hidden="true" />
    </span><p className="eyebrow">載入失敗、無權限或篩選有誤</p>
    <h1 id="staff-scheduling-load-error">無法取得排班快照</h1>
    <p>系統不會顯示未完成機構、分支、人員與第 72 頁資格權限核對的局部資料。</p>
    <Link className="button button--secondary" href={basePath}>重新載入</Link>
  </section>;

  return <div className={styles.workspace}>
    <header className={styles.hero}><div><p className="eyebrow">
      第 {page.number} 頁 · 機構營運管理</p><h1>{page.title}</h1>
      <p>這是規則輔助排班，不是 AI。系統依機構已發布的人工規則逐項檢查，保留衝突依據；任何班表都不會自動發布。</p>
    </div><div className={styles.snapshotMeta}>
      <span>期間 {filters.periodStart} ～ {filters.periodEnd}</span>
      <time dateTime={snapshot.generatedAt}>更新 {formatTaipei(snapshot.generatedAt)}</time>
      <span>快照 60 秒後視為過期</span>
    </div></header>

    {snapshot.demo ? <div className={styles.notice} role="status">
      展示模式：以下員工、規則、證照與班表均為合成資料，只能檢視。
    </div> : null}
    <div className={styles.notice} role="note">
      人員資格只讀取第 72 頁終端證照投影；本頁不複製、不改寫證照，也不自行推測法定職類或醫療資格。
    </div>
    {snapshot.ruleConfigurationStatus === "not_configured" ? <div
      className={styles.warning} role="alert">
      所選期間沒有唯一且完整的機構人工規則版本。資格、工時、休息、場地、車輛與容量全部標示 not_configured，建立與發布皆維持 fail closed。
    </div> : <div className={styles.notice} role="note">
      已載入機構人工未標準化規則 v{snapshot.ruleVersion?.version}；這不是官方規則認證，規則來源狀態為 manual_unstandardized。
    </div>}
    <div className={styles.warning} role="note">
      AI：未使用；自動發布：停用；匯出與離線：停用。衝突例外只有另一位具權限人員在近期 AAL2 下寫明理由後才能發布。
    </div>

    <section className={styles.metrics} aria-label="排班快照統計">
      <article><ListChecks aria-hidden="true" /><span>待審無衝突</span>
        <strong>{snapshot.readyTotal}</strong></article>
      <article><CircleAlert aria-hidden="true" /><span>待審有衝突</span>
        <strong>{snapshot.conflictedTotal}</strong></article>
      <article><CalendarClock aria-hidden="true" /><span>已發布</span>
        <strong>{snapshot.publishedTotal}</strong></article>
      <article><ShieldCheck aria-hidden="true" /><span>其中衝突覆核</span>
        <strong>{snapshot.overriddenTotal}</strong></article>
    </section>

    {!snapshot.demo ? <section className={styles.actions} aria-label="受治理排班操作">
      <StaffScheduleDraftForm canManage={canManage}
        hasRecentAal2={hasRecentAal2} snapshot={snapshot} />
      <StaffScheduleDecisionForm canApprove={canApprove} canOverride={canOverride}
        currentUserId={currentUserId} hasRecentAal2={hasRecentAal2}
        snapshot={snapshot} />
    </section> : null}

    <form className={styles.filters} method="get" aria-label="篩選班表">
      <label><span>起日</span><input name="from" type="date"
        defaultValue={filters.periodStart} required /></label>
      <label><span>迄日（最多 63 日）</span><input name="to" type="date"
        defaultValue={filters.periodEnd} required /></label>
      <label><span>員工</span><select name="staff"
        defaultValue={filters.staffMembershipId ?? "all"}><option value="all">全部員工</option>
        {snapshot.staffOptions.map((staff) => <option key={staff.staffMembershipId}
          value={staff.staffMembershipId}>{staff.displayName}</option>)}</select></label>
      <label><span>狀態</span><select name="status" defaultValue={filters.status}>
        {Object.entries(FILTER_STATUS).map(([value, label]) =>
          <option key={value} value={value}>{label}</option>)}</select></label>
      <button className="button button--secondary" type="submit">套用篩選</button>
      <Link className="button button--ghost" href={basePath}>清除</Link>
    </form>

    {snapshot.ruleVersion ? <section className={styles.rulePanel}
      aria-labelledby="staff-scheduling-rule-heading"><div className={styles.sectionHeading}>
      <div><p className="eyebrow">生效規則</p><h2 id="staff-scheduling-rule-heading">
        機構人工規則 v{snapshot.ruleVersion.version}</h2></div>
      <p>{snapshot.ruleVersion.effectiveFrom} ～ {snapshot.ruleVersion.effectiveTo ?? "持續有效"}</p>
    </div><dl className={styles.ruleGrid}>
      <div><dt>最長班次</dt><dd>{snapshot.ruleVersion.maxShiftMinutes} 分鐘</dd></div>
      <div><dt>最短休息</dt><dd>{snapshot.ruleVersion.minRestMinutes} 分鐘</dd></div>
      <div><dt>分支容量</dt><dd>{snapshot.ruleVersion.branchCapacity} 人</dd></div>
      <div><dt>資格規則</dt><dd>{snapshot.ruleVersion.qualificationRules.map((item) =>
        `${item.roleText} → ${item.requiredCertificateType}`).join("；")}</dd></div>
      <div><dt>場地</dt><dd>{snapshot.ruleVersion.facilities.map((item) =>
        `${item.name}（${item.capacity}）`).join("、")}</dd></div>
      <div><dt>車輛</dt><dd>{snapshot.ruleVersion.vehicles.map((item) =>
        `${item.name}（${item.capacity}）`).join("、")}</dd></div>
    </dl></section> : null}

    <section className={styles.records} aria-labelledby="staff-schedule-records-heading">
      <div className={styles.sectionHeading}><div><p className="eyebrow">同一快照</p>
        <h2 id="staff-schedule-records-heading">班表與衝突依據</h2></div>
        <p>{snapshot.records.length} / {snapshot.recordTotal} 筆</p></div>
      {snapshot.recordsTruncated ? <p role="status">清單上限 200 筆，請縮小期間或員工範圍。</p> : null}
      {snapshot.records.length === 0 ? <div className="empty-card">
        <span className="empty-card__icon"><CalendarClock aria-hidden="true" /></span>
        <h3>沒有符合條件的班表</h3><p>可清除狀態與員工篩選，或建立新的規則檢查草稿。</p>
      </div> : <><div className={styles.tableWrap} role="region" tabIndex={0}
        aria-label="可水平捲動的班表與衝突表格"><table className={styles.table}>
        <thead><tr><th>員工／職務</th><th>時間</th><th>人數／資源</th>
          <th>狀態</th><th>衝突</th><th>完整依據</th></tr></thead>
        <tbody>{snapshot.records.map((record) => <tr key={record.scheduleVersionId}>
          <td><strong>{record.staffDisplayName}</strong><br /><small>
            {record.staffEmployeeCode ?? "未提供員編"} · {record.roleText} · v{record.version}</small></td>
          <td>{formatTaipei(record.startsAt)}<br /><small>至 {formatTaipei(record.endsAt)}</small></td>
          <td>{record.plannedClients} 人<br /><small>{record.facilityCode} ／ {record.vehicleCode}</small></td>
          <td><span className={`${styles.pill} ${styles[`pill_${record.status}`]}`}>
            {STATUS[record.status]}</span><br /><small>{reviewLabel(record)}</small></td>
          <td>{record.conflictCount ? `${record.conflictCount} 項` : "0 項"}</td>
          <td><details className={styles.inlineDetails}><summary>展開依據</summary>
            <RecordDetails record={record} /></details></td>
        </tr>)}</tbody></table></div>
        <div className={styles.mobileCards}>{snapshot.records.map((record) =>
          <article key={record.scheduleVersionId}><div className={styles.cardHeading}><div>
            <h3>{record.staffDisplayName}</h3><small>{record.roleText} · v{record.version}</small>
          </div><span className={`${styles.pill} ${styles[`pill_${record.status}`]}`}>
            {STATUS[record.status]}</span></div>
            <p><strong>時間：</strong>{formatTaipei(record.startsAt)} ～ {formatTaipei(record.endsAt)}</p>
            <p><strong>服務：</strong>{record.plannedClients} 人 · {record.facilityCode} ／ {record.vehicleCode}</p>
            <RecordDetails record={record} />
          </article>)}</div></>}
    </section>

    <section className={styles.records} aria-labelledby="staff-schedule-history-heading">
      <div className={styles.sectionHeading}><div><p className="eyebrow">不可覆寫</p>
        <h2 id="staff-schedule-history-heading">版本歷程</h2></div>
        <p>{snapshot.history.length} / {snapshot.historyTotal} 筆</p></div>
      {snapshot.historyTruncated ? <p role="status">歷程上限 500 筆，請縮小篩選。</p> : null}
      {snapshot.history.length === 0 ? <p>所選期間尚無班表版本。</p> :
        <ol className={styles.timeline}>{snapshot.history.map((item) =>
          <li key={item.scheduleVersionId}><div><strong>v{item.version} · {STATUS[item.status]}</strong>
            <span>{item.conflictCount} 項衝突</span></div>
            <p>{item.creatorDisplayName} 建立 · {formatTaipei(item.createdAt)}</p>
            <small>{item.reviewerDisplayName ? `${item.reviewerDisplayName} 審核 · ${formatTaipei(item.reviewedAt!)}` : "尚未獨立審核"} · 雜湊 {item.contentHash.slice(0, 12)}…</small>
          </li>)}</ol>}
    </section>
  </div>;
}
