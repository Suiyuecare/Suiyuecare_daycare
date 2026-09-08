import {
  AlertTriangle, CalendarClock, CheckCircle2, ClipboardList, Clock3,
  FileSignature, UsersRound,
} from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  CaseConferenceActionItem,
  CaseConferenceActionStatus,
  CaseConferenceAttendanceStatus,
  CaseConferenceDeadlineState,
  CaseConferenceFilters,
  CaseConferenceItem,
  CaseConferenceSnapshot,
  CaseConferenceStatus,
  CaseConferenceVersionKind,
} from "@/lib/case-conferences/types";

import { CaseConferenceActions, CaseConferenceCreateForm } from "./case-conference-actions";
import styles from "./case-conferences.module.css";

const statusLabel: Record<CaseConferenceStatus, string> = { draft: "草稿", signed: "已簽署" };
const versionLabel: Record<CaseConferenceVersionKind, string> = {
  created: "建立草稿", revised: "修訂草稿", signed: "簽署", corrected: "有理由更正",
};
const attendanceLabel: Record<CaseConferenceAttendanceStatus, string> = {
  attended: "出席", remote: "遠距", absent: "缺席", excused: "請假",
};
const actionStatusLabel: Record<CaseConferenceActionStatus, string> = {
  open: "待辦", completed: "完成", cancelled: "取消",
};
const deadlineLabel: Record<CaseConferenceDeadlineState, string> = {
  dated: "指定日期", missing: "缺值", not_applicable: "不適用",
};

function formatTaipei(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

function ActionDeadline({ action }: { action: CaseConferenceActionItem }) {
  return <span className={action.isOverdue ? styles.overdue : styles.deadline}>
    {action.deadlineState === "dated" ? action.dueDate : deadlineLabel[action.deadlineState]}
    {action.isOverdue ? " · 逾期" : ""}
  </span>;
}

function ActionList({ item }: { item: CaseConferenceItem }) {
  return <ol className={styles.actionList}>{item.actionItems.map((action) => <li
    key={action.actionId}>
    <div><strong>{action.itemOrder}. {action.actionText}</strong>
      <span>{action.responsibleDisplayName} · {actionStatusLabel[action.actionStatus]}</span></div>
    <ActionDeadline action={action} />
  </li>)}</ol>;
}

function History({ item }: { item: CaseConferenceItem }) {
  return <details className={styles.history}>
    <summary>不可變版本歷程（{item.history.length}）</summary>
    <ol>{item.history.map((entry) => <li key={entry.versionId}>
      <strong>v{entry.version} · {versionLabel[entry.versionKind]}</strong>
      <span>{formatTaipei(entry.occurredAt)} · {entry.authorDisplayName}</span>
      <p>問題：{entry.problemStatement}</p><p>決議：{entry.decisionSummary}</p>
      {entry.correctionReason ? <p>更正理由：{entry.correctionReason}</p> : null}
      {entry.signedAt ? <span>簽署：{entry.signerDisplayName} · {formatTaipei(entry.signedAt)}</span> : null}
      <code>{entry.contentHash.slice(0, 12)}…</code>
    </li>)}</ol>
  </details>;
}

function MeetingDetails({ item, snapshot }: {
  item: CaseConferenceItem;
  snapshot: CaseConferenceSnapshot;
}) {
  return <div className={styles.details}>
    <section><h3>問題與決議</h3><p><strong>問題：</strong>{item.problemStatement}</p>
      <p><strong>決議：</strong>{item.decisionSummary}</p></section>
    <section><h3>出席者快照</h3><ul className={styles.attendees}>{item.attendees.map((person) =>
      <li key={person.userId}><strong>{person.displayName}</strong>
        <span>{attendanceLabel[person.attendanceStatus]} · {person.roleKeys.join("、")}</span></li>)}</ul></section>
    <section><h3>逐項行動</h3><ActionList item={item} /></section>
    <CaseConferenceActions item={item} snapshot={snapshot} />
    <History item={item} />
  </div>;
}

function MobileCard({ item, snapshot }: {
  item: CaseConferenceItem;
  snapshot: CaseConferenceSnapshot;
}) {
  return <article className={styles.card} data-case-conference-card={item.meetingKey}>
    <header><div><p className="eyebrow">{item.clientCode} · v{item.version}</p>
      <h2>{item.clientDisplayName}</h2></div>
      <span className={styles.status}>{statusLabel[item.status]}</span></header>
    <p>{formatTaipei(item.meetingStartsAt)}–{formatTaipei(item.meetingEndsAt)}</p>
    <p className={styles.summary}>{item.problemStatement}</p>
    <dl><div><dt>出席快照</dt><dd>{item.attendees.length} 人</dd></div>
      <div><dt>行動</dt><dd>{item.actionItems.length} 項</dd></div>
      <div><dt>簽署／更正</dt><dd>{versionLabel[item.versionKind]}</dd></div></dl>
    <MeetingDetails item={item} snapshot={snapshot} />
  </article>;
}

export function CaseConferencesWorkspace({ filters, loadError, page, snapshot }: {
  filters: CaseConferenceFilters;
  loadError: boolean;
  page: PageCatalogEntry;
  snapshot: CaseConferenceSnapshot | null;
}) {
  if (loadError || !snapshot) return <section className="empty-card"
    aria-labelledby="case-conference-load-error">
    <span className="empty-card__icon empty-card__icon--warning"><AlertTriangle aria-hidden="true" /></span>
    <p className="eyebrow">載入失敗、反向日期、逾時或無權限</p>
    <h1 id="case-conference-load-error">無法取得個案研討快照</h1>
    <p>系統沒有顯示未通過機構、分支、個案指派與角色驗證的局部資料。</p>
    <Link className="button button--secondary"
      href="/app/staff/professional-care/case-conferences">重新載入</Link>
  </section>;

  return <div className={styles.workspace}>
    <header className={styles.hero}><div>
      <p className="eyebrow">第 {page.number} 頁 · 專業服務</p>
      <h1>{page.title}</h1>
      <p>{page.description} 草稿、修訂、簽署與更正都形成不可變線性版本。</p>
    </div><div className={styles.snapshotMeta}>
      <time dateTime={snapshot.generatedAt}>更新 {formatTaipei(snapshot.generatedAt)}</time>
      <span>{snapshot.branchName}</span><span>快照 {snapshot.snapshotToken.slice(0, 12)}…</span>
    </div></header>

    {snapshot.demo ? <div className={styles.notice} role="status">
      展示模式：全部為合成資料，會議、出席、決議、行動、簽署與更正均唯讀。
    </div> : null}
    <div className={styles.notice} role="note">
      附件、匯出、離線、通知及外部 provider 均為 <strong>not_configured</strong>；
      本頁不宣稱任何外部 delivered、read 或 confirmed。逾期只依人工指定日期判定。
    </div>

    <section className={styles.metrics} aria-label="個案研討統計">
      <article><CalendarClock aria-hidden="true" /><span>符合會議</span><strong>{snapshot.metrics.matching}</strong></article>
      <article><ClipboardList aria-hidden="true" /><span>草稿</span><strong>{snapshot.metrics.draft}</strong></article>
      <article><FileSignature aria-hidden="true" /><span>已簽署</span><strong>{snapshot.metrics.signed}</strong></article>
      <article><CheckCircle2 aria-hidden="true" /><span>已更正</span><strong>{snapshot.metrics.corrected}</strong></article>
      <article><Clock3 aria-hidden="true" /><span>待辦／逾期</span><strong>{snapshot.metrics.openAction}／{snapshot.metrics.overdueAction}</strong></article>
      <article><AlertTriangle aria-hidden="true" /><span>期限缺值／不適用</span>
        <strong>{snapshot.metrics.deadlineMissing}／{snapshot.metrics.deadlineNotApplicable}</strong></article>
    </section>

    {!snapshot.demo ? <CaseConferenceCreateForm snapshot={snapshot} /> : null}

    <form className={styles.filters} method="get" aria-label="篩選個案研討">
      <label><span>個案</span><select name="client" defaultValue={filters.clientId ?? "all"}>
        <option value="all">全部個案</option>{snapshot.clientOptions.map((option) =>
          <option key={option.clientId} value={option.clientId}>{option.displayName}</option>)}</select></label>
      <label><span>狀態</span><select name="status" defaultValue={filters.status}>
        <option value="all">全部</option><option value="draft">草稿</option><option value="signed">已簽署</option>
      </select></label>
      <label><span>行動負責人</span><select name="responsible"
        defaultValue={filters.responsibleUserId ?? "all"}><option value="all">全部</option>
        {snapshot.staffOptions.map((option) => <option key={option.userId}
          value={option.userId}>{option.displayName}</option>)}</select></label>
      <label><span>行動狀態</span><select name="action" defaultValue={filters.actionStatus}>
        <option value="all">全部</option><option value="open">待辦</option>
        <option value="completed">完成</option><option value="cancelled">取消</option>
        <option value="overdue">逾期</option></select></label>
      <label><span>會議起日</span><input type="date" name="from" defaultValue={filters.meetingFrom ?? ""} /></label>
      <label><span>會議迄日</span><input type="date" name="to" defaultValue={filters.meetingTo ?? ""} /></label>
      <label className={styles.wide}><span>關鍵字</span><input name="q" maxLength={120}
        defaultValue={filters.query} placeholder="搜尋問題或決議" /></label>
      <button className="button button--secondary" type="submit">套用篩選</button>
      <Link className="button button--ghost" href="/app/staff/professional-care/case-conferences">清除</Link>
    </form>

    {snapshot.itemsTruncated ? <p className={styles.warning} role="status">
      明細只顯示前 200 筆；上方統計仍由完整結果集合計算。
    </p> : null}
    {snapshot.items.length === 0 ? <section className="empty-card">
      <span className="empty-card__icon"><UsersRound aria-hidden="true" /></span>
      <h2>沒有符合條件的個案研討</h2><p>可調整個案、狀態、負責人、行動、會議日期或關鍵字。</p>
    </section> : <>
      <div className={styles.tableWrap}><table><caption>個案研討不可變快照</caption>
        <thead><tr><th>個案／會議</th><th>問題與決議</th><th>出席者</th>
          <th>逐項行動</th><th>狀態</th><th>操作與歷程</th></tr></thead>
        <tbody>{snapshot.items.map((item) => <tr key={item.meetingKey}
          data-case-conference-row={item.meetingKey}>
          <td><strong>{item.clientDisplayName}</strong><span>{item.clientCode}</span>
            <span>{formatTaipei(item.meetingStartsAt)}</span></td>
          <td><p><strong>問題：</strong>{item.problemStatement}</p>
            <p><strong>決議：</strong>{item.decisionSummary}</p></td>
          <td><span>{item.attendees.length} 人</span>{item.attendees.map((person) =>
            <span key={person.userId}>{person.displayName} · {attendanceLabel[person.attendanceStatus]}</span>)}</td>
          <td><ActionList item={item} /></td>
          <td><span className={styles.status}>{statusLabel[item.status]}</span>
            <span>v{item.version} · {versionLabel[item.versionKind]}</span></td>
          <td><details><summary>查看操作與完整歷程</summary>
            <MeetingDetails item={item} snapshot={snapshot} /></details></td>
        </tr>)}</tbody></table></div>
      <div className={styles.cards}>{snapshot.items.map((item) => <MobileCard
        key={item.meetingKey} item={item} snapshot={snapshot} />)}</div>
    </>}
  </div>;
}
