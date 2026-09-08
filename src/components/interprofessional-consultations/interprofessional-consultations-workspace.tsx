import {
  AlertTriangle, BellRing, CheckCircle2, Clock3, UserRoundSearch, UsersRound,
} from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  ConsultationDeadlineState,
  ConsultationStatus,
  ConsultationUrgency,
  InterprofessionalConsultationFilters,
  InterprofessionalConsultationItem,
  InterprofessionalConsultationSnapshot,
} from "@/lib/interprofessional-consultations/types";

import {
  ConsultationAssignmentForm,
  ConsultationCloseForm,
  ConsultationCorrectionForm,
  ConsultationCreateForm,
  ConsultationResponseForm,
} from "./interprofessional-consultation-actions";
import styles from "./interprofessional-consultations.module.css";

const urgencyLabel: Record<ConsultationUrgency, string> = {
  routine: "一般", soon: "儘速", urgent: "緊急",
};
const statusLabel: Record<ConsultationStatus, string> = {
  unassigned: "待指派", assigned: "已指派", answered: "已回覆", closed: "已結案",
};
const deadlineLabel: Record<ConsultationDeadlineState, string> = {
  dated: "有期限", missing: "缺值", not_applicable: "不適用",
};
const eventLabel: Record<InterprofessionalConsultationItem["eventKind"], string> = {
  created: "提出", assigned: "指派", reassigned: "改派", reply: "回覆",
  supplement: "補充", closed: "結案", reopened: "重開", corrected: "更正",
};

function formatTaipei(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

function Due({ item, now }: { item: InterprofessionalConsultationItem; now: string }) {
  if (item.deadlineState !== "dated") return <span className={styles.deadlineState}>{deadlineLabel[item.deadlineState]}</span>;
  const overdue = item.status !== "closed" && item.dueAt! < now;
  return <span className={overdue ? styles.overdue : styles.deadlineState}>
    {overdue ? "逾期 · " : ""}{formatTaipei(item.dueAt!)}
  </span>;
}

function ActionPanel({ item, snapshot }: {
  item: InterprofessionalConsultationItem;
  snapshot: InterprofessionalConsultationSnapshot;
}) {
  if (snapshot.demo) return null;
  return <div className={styles.actions}>
    {item.status !== "closed" ? <ConsultationAssignmentForm
      branchId={snapshot.branchId} canAssign={snapshot.canAssign} item={item}
      organizationId={snapshot.organizationId} staff={snapshot.assigneeOptions} /> : null}
    {item.status !== "closed" ? <ConsultationResponseForm
      branchId={snapshot.branchId} canRespond={snapshot.canRespond} item={item}
      organizationId={snapshot.organizationId} /> : null}
    <ConsultationCloseForm branchId={snapshot.branchId} canClose={snapshot.canClose}
      item={item} organizationId={snapshot.organizationId} />
    <ConsultationCorrectionForm branchId={snapshot.branchId}
      canRespond={snapshot.canCorrect} item={item}
      organizationId={snapshot.organizationId} />
  </div>;
}

function History({ item }: { item: InterprofessionalConsultationItem }) {
  return <details className={styles.history}><summary>不可變事件歷程（{item.history.length}）</summary>
    <ol>{item.history.map((entry) => <li key={entry.eventId}>
      <strong>#{entry.sequence} · {eventLabel[entry.eventKind]}</strong>
      <span>{formatTaipei(entry.occurredAt)} · {entry.actorDisplayName}</span>
      <span>狀態：{statusLabel[entry.status]} · 站內通知 queued × {entry.notificationRecipientCount}</span>
      {entry.entryContent ? <p>{entry.entryContent}</p> : null}
      {entry.correctsEventId ? <span>更正來源：{entry.correctsEventId.slice(0, 8)}…</span> : null}
      <code>{entry.contentHash.slice(0, 12)}…</code>
    </li>)}</ol>
  </details>;
}

function MobileCard({ item, snapshot }: {
  item: InterprofessionalConsultationItem;
  snapshot: InterprofessionalConsultationSnapshot;
}) {
  return <article className={styles.card} data-consultation-card={item.consultationKey}>
    <header><div><p className="eyebrow">{item.clientCode} · #{item.sequence}</p>
      <h2>{item.clientDisplayName}</h2></div><span className={styles.status}>{statusLabel[item.status]}</span></header>
    <p className={styles.summary}>{item.problemSummary}</p>
    <dl><div><dt>專業別</dt><dd>{item.disciplineLabel} <small>{item.disciplineCode}</small></dd></div>
      <div><dt>急迫性</dt><dd>{urgencyLabel[item.urgency]}（人工）</dd></div>
      <div><dt>提出人</dt><dd>{item.requesterDisplayName}</dd></div>
      <div><dt>承辦人</dt><dd>{item.assigneeDisplayName ?? "待指派"}</dd></div>
      <div><dt>期限</dt><dd><Due item={item} now={snapshot.generatedAt} /></dd></div></dl>
    <div className={styles.queueEvidence}>站內通知 <strong>queued</strong> × {item.notification.recipientCount}；外部 provider <strong>not_configured</strong></div>
    <ActionPanel item={item} snapshot={snapshot} /><History item={item} />
  </article>;
}

export function InterprofessionalConsultationsWorkspace({
  filters, loadError, page, snapshot,
}: {
  filters: InterprofessionalConsultationFilters;
  loadError: boolean;
  page: PageCatalogEntry;
  snapshot: InterprofessionalConsultationSnapshot | null;
}) {
  if (loadError || !snapshot) return <section className="empty-card" aria-labelledby="consultation-load-error">
    <span className="empty-card__icon empty-card__icon--warning"><AlertTriangle aria-hidden="true" /></span>
    <p className="eyebrow">載入失敗、反向日期、逾時或無權限</p>
    <h1 id="consultation-load-error">無法取得跨專業照會快照</h1>
    <p>系統沒有顯示未通過機構、分支、個案指派與角色驗證的局部資料。</p>
    <Link className="button button--secondary" href="/app/staff/professional-care/consultations">重新載入</Link>
  </section>;
  return <div className={styles.workspace}>
    <header className={styles.hero}><div><p className="eyebrow">第 {page.number} 頁 · 專業服務</p>
      <h1>{page.title}</h1><p>{page.description} 所有操作只新增事件，不覆寫既有內容。</p></div>
      <div className={styles.snapshotMeta}><time dateTime={snapshot.generatedAt}>更新 {formatTaipei(snapshot.generatedAt)}</time>
        <span>{snapshot.branchName}</span><span>快照 {snapshot.snapshotToken.slice(0, 12)}…</span></div></header>
    {snapshot.demo ? <div className={styles.notice} role="status">展示模式：全部為合成資料，建立、改派、回覆、更正與結案均唯讀。</div> : null}
    <div className={styles.notice} role="note">專業別治理字典尚未發布，目前只能保存人工代碼／名稱並標記 <strong>manual_unstandardized</strong>。每次狀態轉換只建立站內 <strong>queued</strong> 證據；LINE、SMS 與外部 provider 為 <strong>not_configured</strong>，不宣稱送達。</div>
    <section className={styles.metrics} aria-label="照會統計">
      <article><UserRoundSearch aria-hidden="true" /><span>符合照會</span><strong>{snapshot.metrics.matching}</strong></article>
      <article><UsersRound aria-hidden="true" /><span>待指派</span><strong>{snapshot.metrics.unassigned}</strong></article>
      <article><Clock3 aria-hidden="true" /><span>進行中</span><strong>{snapshot.metrics.inProgress}</strong></article>
      <article><AlertTriangle aria-hidden="true" /><span>逾期</span><strong>{snapshot.metrics.overdue}</strong></article>
      <article><CheckCircle2 aria-hidden="true" /><span>已結案</span><strong>{snapshot.metrics.closed}</strong></article>
      <article><BellRing aria-hidden="true" /><span>期限缺值／不適用</span><strong>{snapshot.metrics.deadlineMissing}／{snapshot.metrics.deadlineNotApplicable}</strong></article>
    </section>
    <ConsultationCreateForm canCreate={snapshot.canCreate && !snapshot.demo}
      branchId={snapshot.branchId} clients={snapshot.clientOptions}
      organizationId={snapshot.organizationId} referenceTime={snapshot.generatedAt}
      staff={snapshot.assigneeOptions} />
    <form className={styles.filters} method="get" aria-label="篩選跨專業照會">
      <label><span>個案</span><select name="client" defaultValue={filters.clientId ?? "all"}><option value="all">全部個案</option>
        {snapshot.clientOptions.map((option) => <option key={option.clientId} value={option.clientId}>{option.displayName}</option>)}</select></label>
      <label><span>提出人</span><select name="requester" defaultValue={filters.requesterUserId ?? "all"}><option value="all">全部提出人</option>
        {snapshot.requesterOptions.map((option) => <option key={option.userId} value={option.userId}>{option.displayName}</option>)}</select></label>
      <label><span>承辦人</span><select name="assignee" defaultValue={filters.assigneeMode === "specific" ? filters.assigneeUserId! : filters.assigneeMode}>
        <option value="all">全部</option><option value="assigned">已指派</option><option value="unassigned">待指派</option>
        {snapshot.assigneeOptions.map((option) => <option key={option.userId} value={option.userId}>{option.displayName}</option>)}</select></label>
      <label><span>專業別</span><select name="discipline" defaultValue={filters.disciplineCode ?? "all"}><option value="all">全部人工專業別</option>
        {snapshot.disciplineOptions.map((option) => <option key={option.code} value={option.code}>{option.label} · {option.code}</option>)}</select></label>
      <label><span>人工急迫性</span><select name="urgency" defaultValue={filters.urgency}><option value="all">全部</option>
        <option value="routine">一般</option><option value="soon">儘速</option><option value="urgent">緊急</option></select></label>
      <label><span>狀態</span><select name="status" defaultValue={filters.status}><option value="all">全部</option>
        <option value="unassigned">待指派</option><option value="assigned">已指派</option><option value="answered">已回覆</option><option value="closed">已結案</option></select></label>
      <label><span>期限分類</span><select name="deadline" defaultValue={filters.deadlineFilter}><option value="all">全部</option>
        <option value="dated">有期限</option><option value="overdue">已逾期</option><option value="missing">缺值</option><option value="not_applicable">不適用</option></select></label>
      <label><span>期限起日</span><input type="date" name="from" defaultValue={filters.dueFrom ?? ""} /></label>
      <label><span>期限迄日</span><input type="date" name="to" defaultValue={filters.dueTo ?? ""} /></label>
      <label className={styles.wide}><span>關鍵字</span><input name="q" maxLength={120} defaultValue={filters.query} placeholder="搜尋問題摘要" /></label>
      <button className="button button--secondary" type="submit">套用篩選</button>
      <Link className="button button--ghost" href="/app/staff/professional-care/consultations">清除</Link>
    </form>
    {snapshot.itemsTruncated ? <p className={styles.warning} role="status">明細只顯示前 200 筆；上方統計仍由完整結果集合計算。</p> : null}
    {snapshot.items.length === 0 ? <section className="empty-card"><span className="empty-card__icon"><UsersRound aria-hidden="true" /></span>
      <h2>沒有符合條件的照會</h2><p>可調整個案、人員、專業別、狀態、期限或關鍵字篩選。</p></section> : <>
      <div className={styles.tableWrap}><table><caption>跨專業照會完整快照</caption><thead><tr>
        <th>個案／專業別</th><th>問題摘要</th><th>提出／承辦</th><th>急迫性／期限</th><th>狀態</th><th>事件與通知</th>
      </tr></thead><tbody>{snapshot.items.map((item) => <tr key={item.consultationKey} data-consultation-row={item.consultationKey}>
        <td><strong>{item.clientDisplayName}</strong><span>{item.clientCode}</span><span>{item.disciplineLabel} · {item.disciplineCode}</span></td>
        <td><p>{item.problemSummary}</p></td><td><span>提出：{item.requesterDisplayName}</span><span>承辦：{item.assigneeDisplayName ?? "待指派"}</span></td>
        <td><span>{urgencyLabel[item.urgency]}（人工）</span><Due item={item} now={snapshot.generatedAt} /></td>
        <td><span className={styles.status}>{statusLabel[item.status]}</span></td>
        <td><span>#{item.sequence} · {eventLabel[item.eventKind]}</span><span>queued × {item.notification.recipientCount}</span>
          <details><summary>操作與歷程</summary><ActionPanel item={item} snapshot={snapshot} /><History item={item} /></details></td>
      </tr>)}</tbody></table></div>
      <div className={styles.cards}>{snapshot.items.map((item) => <MobileCard key={item.consultationKey} item={item} snapshot={snapshot} />)}</div>
    </>}
  </div>;
}
