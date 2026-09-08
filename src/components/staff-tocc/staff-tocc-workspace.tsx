import {
  AlertTriangle,
  CalendarClock,
  CircleAlert,
  ClipboardCheck,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type { StaffToccFilters, StaffToccSnapshot } from "@/lib/staff-tocc/types";

import { StaffToccCreateForm, StaffToccRevisionForm } from "./staff-tocc-actions";
import styles from "./staff-tocc.module.css";

const evidenceLabels = {
  provided: "已提供可信參照", missing: "缺證明", not_applicable: "不適用",
};
const dispositionLabels = {
  not_recorded: "尚未登記", pending: "待處置",
  in_progress: "處置中", completed: "已完成",
};
const validityLabels = { active: "人工效期內", expired: "人工效期已過", voided: "已作廢" };

function formatTaipei(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

function WarningText({ reason }: {
  reason: "expired_manual_valid_through" | "manual_attention_flag";
}) {
  return reason === "expired_manual_valid_through"
    ? <>人工輸入的有效至早於台北快照日</>
    : <>授權人員已人工勾選異常／positive-like 提示</>;
}

export function StaffToccWorkspace({
  canManage, filters, loadError, page, snapshot,
}: {
  canManage: boolean;
  filters: StaffToccFilters;
  loadError: boolean;
  page: PageCatalogEntry;
  snapshot: StaffToccSnapshot | null;
}) {
  if (loadError || !snapshot) return <section className="empty-card"
    aria-labelledby="staff-tocc-load-error">
    <span className="empty-card__icon empty-card__icon--warning">
      <AlertTriangle aria-hidden="true" />
    </span>
    <p className="eyebrow">載入失敗或逾時</p>
    <h1 id="staff-tocc-load-error">無法取得員工 TOCC 快照</h1>
    <p>系統不顯示未經完整核對的局部健康資料。請確認網路、分支、AAL2 與獨立員工 TOCC 權限後重試。</p>
    <Link className="button button--secondary"
      href="/app/staff/operations/staff-tocc">重新載入</Link>
  </section>;

  const warnings = snapshot.records.filter((record) =>
    record.expiryWarning || record.manualAttentionWarning);
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
      展示模式：以下均為合成資料，只能檢視，不會寫入員工 TOCC 或證明。
    </div> : null}
    <div className={styles.warning} role="alert">
      逾期只表示「人工輸入的有效至」早於本頁台北快照日；異常／positive-like 只在授權人員明確勾選後提示。系統不解析結果文字、不自行分類，也不提供診斷。
    </div>
    <div className={styles.notice} role="note">
      機構效期規則與到期提醒排程尚未發布，故即將到期天數與人數顯示未設定。附件上傳、掃毒與可信伺服器參照亦未配置，本頁拒絕瀏覽器路徑；此頁不提供離線快取。
    </div>

    <section className={styles.metrics} aria-label="員工 TOCC 統計">
      <article><ShieldCheck aria-hidden="true" /><span>人工效期內</span>
        <strong>{snapshot.activeTotal}</strong></article>
      <article><CalendarClock aria-hidden="true" /><span>即將到期</span>
        <strong>未設定</strong></article>
      <article><CircleAlert aria-hidden="true" /><span>人工效期已過</span>
        <strong>{snapshot.expiredTotal}</strong></article>
      <article><ClipboardCheck aria-hidden="true" /><span>人工標記待處置</span>
        <strong>{snapshot.actionRequiredTotal}</strong></article>
    </section>
    <p className={styles.metricNote}>目前篩選結果另有 {snapshot.manualAttentionTotal} 筆由人員人工標記需注意；已完成處置者不計入待處置。</p>

    <StaffToccCreateForm canManage={canManage && !snapshot.demo} snapshot={snapshot} />
    <StaffToccRevisionForm canManage={canManage && !snapshot.demo} snapshot={snapshot} />

    <form className={styles.filters} method="get" aria-label="篩選員工 TOCC">
      <label><span>員工</span><select name="staff"
        defaultValue={filters.staffMembershipId ?? "all"}>
        <option value="all">全部可見員工</option>{snapshot.staffOptions.map((staff) =>
          <option key={staff.staffMembershipId} value={staff.staffMembershipId}>
            {staff.employeeCode ? `${staff.employeeCode} · ` : ""}{staff.displayName}
            {staff.isCurrent ? "" : "（歷史人員）"}
          </option>)}</select></label>
      <label><span>人工效期狀態</span><select name="validity"
        defaultValue={filters.validityStatus}>
        <option value="all">全部</option><option value="active">人工效期內</option>
        <option value="expired">人工效期已過</option><option value="voided">已作廢</option>
      </select></label>
      <label><span>人工異常標記</span><select name="attention"
        defaultValue={filters.attentionStatus}>
        <option value="all">全部</option><option value="flagged">已人工標記</option>
        <option value="not_flagged">未人工標記</option>
      </select></label>
      <label><span>處置狀態</span><select name="disposition"
        defaultValue={filters.dispositionStatus}>
        <option value="all">全部</option><option value="not_recorded">尚未登記</option>
        <option value="pending">待處置</option><option value="in_progress">處置中</option>
        <option value="completed">已完成</option>
      </select></label>
      <label><span>評估日起</span><input name="from" type="date"
        defaultValue={filters.dateFrom ?? ""} /></label>
      <label><span>評估日至</span><input name="to" type="date"
        defaultValue={filters.dateTo ?? ""} /></label>
      <label><span>搜尋</span><input name="q" defaultValue={filters.query}
        maxLength={120} placeholder="員工、結果、效期來源或處置" /></label>
      <button className="button button--secondary" type="submit">套用篩選</button>
      <Link className="button button--ghost"
        href="/app/staff/operations/staff-tocc">清除</Link>
    </form>

    <div className={styles.resultHeader}>
      <p>顯示 {snapshot.records.length} / {snapshot.recordTotal} 筆終端版本。</p>
      {snapshot.recordsTruncated ? <p role="status">紀錄上限 200 筆；統計仍涵蓋全部符合資料。</p> : null}
    </div>

    <section className={styles.records} aria-labelledby="staff-tocc-records-heading">
      <h2 id="staff-tocc-records-heading">員工 TOCC 終端版本</h2>
      {snapshot.records.length === 0 ? <div className="empty-card">
        <span className="empty-card__icon"><ShieldCheck aria-hidden="true" /></span>
        <h3>沒有符合條件的 TOCC 紀錄</h3>
        <p>請調整員工、人工效期、人工標記、處置、日期或搜尋條件。</p>
      </div> : <>
        <div className={styles.tableWrap} role="region" tabIndex={0}
          aria-label="可水平捲動的員工 TOCC 終端版本表格">
          <table className={styles.table}><thead><tr><th>員工</th>
            <th>評估／人工效期</th><th>結果</th><th>提示／證明</th>
            <th>處置</th><th>版本／狀態</th></tr></thead>
          <tbody>{snapshot.records.map((record) => <tr key={record.recordVersionId}>
            <td>{record.staffEmployeeCode ? `${record.staffEmployeeCode} · ` : ""}
              {record.staffDisplayName}</td>
            <td>{record.assessedOn}<br /><small>有效至 {record.validThrough}</small><br />
              <small>{record.validitySource}</small></td>
            <td>{record.resultText}</td>
            <td>{record.warningReasons.length ? <ul className={styles.compactList}>
              {record.warningReasons.map((reason) => <li key={reason}>
                <WarningText reason={reason} />
              </li>)}</ul> : "無人工／逾期提示"}<br />
              <small>證明：{evidenceLabels[record.evidenceStatus]}</small></td>
            <td>{dispositionLabels[record.dispositionStatus]}<br />
              <small>{record.dispositionNote ?? "未登記處置內容"}</small></td>
            <td>v{record.version} · {validityLabels[record.validityStatus]}<br />
              <small>醫療判定：未評估</small></td>
          </tr>)}</tbody></table>
        </div>
        <div className={styles.mobileCards}>{snapshot.records.map((record) => <article
          key={record.recordVersionId}><h3>{record.staffDisplayName}</h3>
          <p>{record.staffEmployeeCode ?? "無員工代碼"} · v{record.version}</p>
          <dl><div><dt>評估／有效至</dt><dd>{record.assessedOn}<br />{record.validThrough}</dd></div>
            <div><dt>效期來源</dt><dd>{record.validitySource}</dd></div>
            <div><dt>結果</dt><dd>{record.resultText}</dd></div>
            <div><dt>提示</dt><dd>{record.warningReasons.length
              ? record.warningReasons.map((reason) => <span key={reason}>
                <WarningText reason={reason} /><br /></span>) : "無人工／逾期提示"}</dd></div>
            <div><dt>證明</dt><dd>{evidenceLabels[record.evidenceStatus]}</dd></div>
            <div><dt>處置</dt><dd>{dispositionLabels[record.dispositionStatus]}<br />
              {record.dispositionNote ?? "未登記內容"}</dd></div>
            <div><dt>狀態</dt><dd>{validityLabels[record.validityStatus]}</dd></div></dl>
        </article>)}</div>
      </>}
    </section>

    <section className={styles.warnings} aria-labelledby="staff-tocc-warnings-heading">
      <h2 id="staff-tocc-warnings-heading">提示依據與人工處置</h2>
      <p>提示只來自人工輸入的有效至與明確人工勾選；結果文字即使含有特定字樣也不會自行觸發。</p>
      {warnings.length === 0 ? <p>目前篩選結果沒有逾期或人工標記提示。</p> :
        <div className={styles.warningGrid}>{warnings.map((record) => <article
          key={record.recordVersionId}><h3>{record.staffDisplayName} · {record.assessedOn}</h3>
          <ul>{record.warningReasons.map((reason) => <li key={reason}>
            <WarningText reason={reason} />
          </li>)}</ul>
          {record.attentionNote ? <p>人工標記理由：{record.attentionNote}</p> : null}
          <p>處置：{dispositionLabels[record.dispositionStatus]}；
            {record.dispositionNote ?? "尚未登記內容"}</p>
        </article>)}</div>}
    </section>

    <section className={styles.history} aria-labelledby="staff-tocc-history-heading">
      <h2 id="staff-tocc-history-heading">不可變版本歷程</h2>
      <p>顯示 {snapshot.history.length} / {snapshot.historyTotal} 個版本；已保存版本不能直接修改或刪除。</p>
      {snapshot.historyTruncated ? <p role="status">歷程上限 500 筆，請用員工或評估日期縮小範圍。</p> : null}
      <div className={styles.historyGrid}>{snapshot.history.map((record) => <article
        key={record.recordVersionId}><h3>{record.assessedOn} · v{record.version}</h3>
        <p>人工有效至 {record.validThrough} · {record.validitySource}</p>
        <dl><div><dt>結果</dt><dd>{record.resultText}</dd></div>
          <div><dt>人工標記</dt><dd>{record.manualAttentionFlag
            ? record.attentionNote : "未標記"}</dd></div>
          <div><dt>處置</dt><dd>{dispositionLabels[record.dispositionStatus]}<br />
            {record.dispositionNote ?? "未登記內容"}</dd></div>
          <div><dt>紀錄狀態</dt><dd>{record.recordStatus === "voided"
            ? "作廢終端" : "有效於當時"}</dd></div>
          <div><dt>保存時間</dt><dd>{formatTaipei(record.recordedAt)}</dd></div>
          <div><dt>保存人</dt><dd>{record.recordedByDisplayName}</dd></div>
          <div><dt>更正理由</dt><dd>{record.correctionReason ?? "原始版本"}</dd></div></dl>
      </article>)}</div>
    </section>
  </div>;
}
