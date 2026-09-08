import {
  AlertTriangle, ChevronRight, CircleAlert, Clock3,
  Download, FileWarning, LockKeyhole, MessageSquareText, Search, ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  FeedbackComplaintFilters,
  FeedbackComplaintItem,
  FeedbackComplaintSnapshot,
  FeedbackEventType,
  FeedbackState,
} from "@/lib/feedback-complaints/types";

import { FeedbackComplaintAction } from "./feedback-complaint-action";
import styles from "./feedback-complaints.module.css";

const SOURCE_LABELS = {
  client: "本人", family: "家屬", staff: "員工", anonymous: "匿名", external: "外部",
} as const;
const TYPE_LABELS = {
  feedback: "一般意見", service: "服務", rights: "權益", safety: "安全",
  privacy: "隱私", billing: "費用", other: "其他",
} as const;
const STATUS_LABELS: Record<FeedbackState, string> = {
  received: "待指派", assigned: "已指派", in_progress: "處理中",
  escalated: "已升級", closed: "已結案",
};
const EVENT_LABELS: Record<FeedbackEventType, string> = {
  created: "建立案件", assignment: "指派承辦", progress: "更新處理",
  correction: "追加更正", closure: "完成結案",
};

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

function statusClass(record: FeedbackComplaintItem) {
  if (record.status === "closed") return "status-pill--success";
  if (record.status === "escalated" || record.overdue) return "status-pill--danger";
  if (record.status === "in_progress") return "status-pill--warning";
  return "status-pill--neutral";
}

function Escalation({ record }: { record: FeedbackComplaintItem }) {
  if (!record.escalationReason) return <span className="status-pill">一般</span>;
  const label = record.escalationReason === "high_risk_and_overdue"
    ? "高風險且逾期" : record.escalationReason === "high_risk" ? "高風險" : "已逾期";
  return <span className="status-pill status-pill--danger">{label}</span>;
}

function SensitiveDetails({ record }: { record: FeedbackComplaintItem }) {
  if (record.sensitiveMasked) return <div className={styles.masked} role="note">
    <LockKeyhole aria-hidden="true" />
    <span><strong>敏感內容已遮蔽</strong>此工作階段只能看案件中繼資料；查閱權限不會由前端放寬。</span>
  </div>;
  return <dl className={styles.sensitiveDetails}>
    <div><dt>陳述人</dt><dd>{record.reporterName ?? "未提供"}</dd></div>
    <div><dt>聯絡方式</dt><dd>{record.reporterContact ?? "未提供"}</dd></div>
    <div className={styles.full}><dt>主旨</dt><dd>{record.subject}</dd></div>
    <div className={styles.full}><dt>內容</dt><dd>{record.description}</dd></div>
  </dl>;
}

function Timeline({ record }: { record: FeedbackComplaintItem }) {
  return <details className={styles.timeline}>
    <summary><span>案件內容與 {record.timelineTotal} 筆事件</span>
      <span>鏈 v{record.chainVersion}</span></summary>
    <SensitiveDetails record={record} />
    <ol>{record.timeline.map((event) => <li key={event.id}>
      <span aria-hidden="true" className={styles.timelineMarker} />
      <div><div className={styles.timelineHeading}>
        <strong>{EVENT_LABELS[event.eventType]}・v{event.version}</strong>
        <time dateTime={event.occurredAt}>{formatTimestamp(event.occurredAt)}</time>
      </div>
      {event.sensitiveMasked && event.eventType !== "created"
        ? <p className={styles.redacted}>本事件敘述已依權限遮蔽。</p>
        : event.note ? <p>{event.note}</p> : null}
      {event.correctedEventId ? <small>更正目標：{event.correctedEventId}</small> : null}
      {event.assigneeDisplayName ? <small>承辦：{event.assigneeDisplayName}</small> : null}
      {event.automaticReason ? <small className={styles.escalated}>
        資料庫升級依據：{event.automaticReason === "high_risk_and_overdue"
          ? "高風險與期限" : event.automaticReason === "high_risk" ? "高風險" : "期限"}
      </small> : null}
      <small>{event.actorDisplayName}・提交 {formatTimestamp(event.committedAt)}</small>
      </div>
    </li>)}</ol>
    {record.timelineTruncated ? <p className={styles.warning} role="status">
      事件超過 50 筆；目前狀態與總數仍由完整不可變鏈計算。
    </p> : null}
  </details>;
}

function CaseActions({
  canClose, canCorrect, canManage, complaint, hasRecentAal2, snapshot, surface,
}: {
  canClose: boolean;
  canCorrect: boolean;
  canManage: boolean;
  complaint: FeedbackComplaintItem;
  hasRecentAal2: boolean;
  snapshot: FeedbackComplaintSnapshot;
  surface: "desktop" | "mobile";
}) {
  if (complaint.status === "closed") return <span className={styles.locked}>
    <LockKeyhole aria-hidden="true" />已結案，事件鏈鎖定
  </span>;
  const common = { assignees: snapshot.assignees, canClose, canCorrect, canManage,
    complaint, deadlineRules: snapshot.deadlineRules, demo: snapshot.demo,
    hasRecentAal2 };
  return <div className={styles.rowActions}>
    <FeedbackComplaintAction {...common} action="assign"
      instance={`${surface}-${complaint.id}-assign`} />
    <FeedbackComplaintAction {...common} action="progress"
      instance={`${surface}-${complaint.id}-progress`} />
    <FeedbackComplaintAction {...common} action="correct"
      instance={`${surface}-${complaint.id}-correct`} />
    <FeedbackComplaintAction {...common} action="close"
      instance={`${surface}-${complaint.id}-close`} />
  </div>;
}

export function FeedbackComplaintsWorkspace({
  canClose,
  canCorrect,
  canManage,
  filters,
  hasRecentAal2,
  loadError = false,
  page,
  snapshot,
}: {
  canClose: boolean;
  canCorrect: boolean;
  canManage: boolean;
  filters: FeedbackComplaintFilters;
  hasRecentAal2: boolean;
  loadError?: boolean;
  page: PageCatalogEntry;
  snapshot: FeedbackComplaintSnapshot | null;
}) {
  if (loadError || !snapshot) return <section
    className="empty-card core-care-state" role="alert">
    <span className="empty-card__icon empty-card__icon--warning">
      <CircleAlert aria-hidden="true" />
    </span>
    <h1>意見與申訴暫時無法載入</h1>
    <p>正式快照採失敗即關閉；系統沒有擴大機構、分支、案件或敏感欄位權限，也沒有改用展示資料。</p>
    <a className="button button--secondary" href="?status=all">重新載入</a>
  </section>;

  const createProps = { assignees: snapshot.assignees, canClose, canCorrect,
    canManage, deadlineRules: snapshot.deadlineRules, demo: snapshot.demo,
    hasRecentAal2, instance: "header", action: "create" as const };
  return <>
    <nav aria-label="所在位置" className="context-bar">
      <span>工作台</span><ChevronRight aria-hidden="true" />
      <span>服務管理</span><ChevronRight aria-hidden="true" />
      <span aria-current="page" className="context-bar__crumb">{page.title}</span>
    </nav>
    <header className="page-heading core-care-heading"><div>
      <p className="eyebrow">受理、期限與不可變處理鏈・頁面 {page.number}</p>
      <h1>{page.title}</h1>
      <p className="page-heading__description">
        以伺服器案件編號、已發布期限規則與預期版本受理、指派、處理、更正及結案；高風險或逾期案件由資料庫時鐘升級。
      </p></div><div className="page-heading__actions">
        <button aria-label="匯出案件：正式匯出格式尚未設定" className="button button--secondary"
          disabled title="正式匯出格式尚未設定" type="button">
          <Download aria-hidden="true" />匯出案件
        </button>
        <FeedbackComplaintAction {...createProps} />
      </div></header>

    {snapshot.demo ? <div className={`callout ${styles.demo}`} role="status">
      <CircleAlert aria-hidden="true" /><span><strong>展示模式：</strong>
        案件、陳述人、聯絡方式、承辦人與期限規則全是合成示例；所有寫入按鈕維持唯讀。</span>
    </div> : <div className={`callout ${styles.security}`} role="status">
      <ShieldCheck aria-hidden="true" /><span>只載入目前機構與分支；敏感內容由資料庫依
        <code> complaints.sensitive </code>決定是否回傳，所有查閱均寫入稽核。</span>
    </div>}
    <div className={`callout ${styles.rule}`} role="note">
      <FileWarning aria-hidden="true" /><span><strong>期限規則：</strong>{snapshot.deadlineRuleStatus === "configured"
        ? `目前有 ${snapshot.deadlineRules.length} 個可選的已發布精確規則；受理時鎖定版本與期限。`
        : "尚未發布正式規則，建立案件在 UI、API 與資料庫全面失敗即關閉，不接受人工自填期限。"}</span>
    </div>
    <div className={`callout ${styles.boundary}`} role="status">
      <AlertTriangle aria-hidden="true" /><span><strong>外部缺口：</strong>
        外部升級通知 worker 與正式匯出格式尚未配置。頁面仍以資料庫時鐘立即顯示逾期升級，但不宣稱已對外通知或完成匯出。</span>
    </div>
    {!snapshot.demo && (!canManage || !canCorrect || !canClose || !hasRecentAal2)
      ? <div className="callout" role="status"><ShieldCheck aria-hidden="true" />
        <span>{!canManage ? "目前角色只有案件查閱權限。"
          : !canCorrect ? "目前角色可處理案件，但敏感內容與更正維持遮蔽。"
            : !canClose ? "目前角色可處理與更正，但沒有結案權限。"
              : "更正與結案前仍需同一工作階段最近 15 分鐘 AAL2。"}</span></div> : null}

    <section aria-label="意見與申訴摘要" className="metric-grid">
      {[
        ["符合案件", snapshot.metrics.cases, "目前篩選集合", <MessageSquareText key="all" aria-hidden="true" />],
        ["高風險", snapshot.metrics.highRisk, "含伺服器自動升級", <AlertTriangle key="risk" aria-hidden="true" />],
        ["未結案", snapshot.metrics.inProgress, "待指派、處理或升級中", <Clock3 key="progress" aria-hidden="true" />],
        ["已逾期", snapshot.metrics.overdue, "只計尚未結案案件", <FileWarning key="overdue" aria-hidden="true" />],
      ].map(([label, value, foot, metricIcon]) => <article className="metric-card" key={String(label)}>
        <div className="metric-card__top"><span>{label}</span>
          <span className="metric-card__icon">{metricIcon}</span></div>
        <div className="metric-card__value"><strong>{value}</strong><span>件</span></div>
        <p className="metric-card__foot">{foot}</p>
      </article>)}
    </section>

    <section className="panel"><div className="panel__header"><div className="panel__title">
      <h2>案件篩選</h2><p>快照 {formatTimestamp(snapshot.generatedAt)}・逾時點 {formatTimestamp(snapshot.staleAfter)}</p>
    </div></div><form className={`filter-bar ${styles.filters}`} method="get">
      <label className="field field--compact"><span>受理起日</span>
        <input defaultValue={filters.receivedFrom ?? ""} name="from" type="date" /></label>
      <label className="field field--compact"><span>受理迄日</span>
        <input defaultValue={filters.receivedTo ?? ""} name="to" type="date" /></label>
      <label className="field field--compact"><span>來源</span><select
        defaultValue={filters.source} name="source"><option value="all">全部</option>
        {Object.entries(SOURCE_LABELS).map(([value, label]) =>
          <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field field--compact"><span>類型</span><select
        defaultValue={filters.caseType} name="type"><option value="all">全部</option>
        {Object.entries(TYPE_LABELS).map(([value, label]) =>
          <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field field--compact"><span>風險</span><select
        defaultValue={filters.risk} name="risk"><option value="all">全部</option>
        <option value="standard">一般</option><option value="high">高風險</option>
      </select></label>
      <label className="field field--compact"><span>承辦人</span><select
        defaultValue={filters.assignee} name="assignee"><option value="all">全部</option>
        <option value="unassigned">尚未指派</option>{snapshot.assignees.map((person) =>
          <option key={person.membershipId} value={person.membershipId}>{person.displayName}</option>)}
      </select></label>
      <label className="field field--compact"><span>狀態</span><select
        defaultValue={filters.status} name="status"><option value="all">全部</option>
        {Object.entries(STATUS_LABELS).map(([value, label]) =>
          <option key={value} value={value}>{label}</option>)}
        <option value="overdue">已逾期</option></select></label>
      <label className={`field field--compact ${styles.search}`}><span>案件搜尋</span>
        <input defaultValue={filters.query} maxLength={120} name="q"
          placeholder={snapshot.canViewSensitive ? "案件編號、主旨或陳述人" : "案件編號"} /></label>
      <button className="button button--secondary" type="submit">套用篩選</button>
      <Link className="button button--quiet" href="?status=all">清除</Link>
    </form></section>

    <section className="panel"><div className="panel__header"><div className="panel__title">
      <h2>案件與處理期限</h2><p>{snapshot.matchingTotal} 件符合條件；敏感內容與事件敘述依權限回傳</p>
    </div></div>
    {snapshot.itemsTruncated ? <div className={`callout ${styles.truncated}`} role="status">
      <CircleAlert aria-hidden="true" /><span>結果超過 100 件；摘要依完整集合計算，畫面只顯示優先前 100 件。</span>
    </div> : null}
    {snapshot.items.length ? <>
      <div aria-label="意見與申訴案件清單，可左右捲動" className={`table-wrap ${styles.table}`}
        role="region" tabIndex={0}><table className="data-table"><thead><tr>{[
          "案件編號／來源", "類型", "風險", "承辦人", "期限", "狀態", "內容與歷程", "操作",
        ].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
        <tbody>{snapshot.items.map((record) => <tr key={record.id}>
          <td><strong>{record.caseNumber}</strong><small className="data-table__secondary">
            {SOURCE_LABELS[record.source]}・受理 {formatTimestamp(record.receivedAt)}</small></td>
          <td>{TYPE_LABELS[record.caseType]}</td><td><Escalation record={record} /></td>
          <td>{record.assigneeDisplayName ?? "尚未指派"}</td>
          <td className={record.overdue ? styles.overdue : undefined}>
            {formatTimestamp(record.dueAt)}{record.overdue ? <small>已逾期</small> : null}</td>
          <td><span className={`status-pill ${statusClass(record)}`}>{STATUS_LABELS[record.status]}</span></td>
          <td><Timeline record={record} /></td>
          <td><CaseActions canClose={canClose} canCorrect={canCorrect} canManage={canManage}
            complaint={record} hasRecentAal2={hasRecentAal2} snapshot={snapshot}
            surface="desktop" /></td>
        </tr>)}</tbody></table></div>
      <div className={`mobile-records ${styles.mobile}`}>{snapshot.items.map((record) =>
        <article className="record-card" key={record.id}>
          <div className="record-card__top"><div><h3>{record.caseNumber}</h3>
            <span>{SOURCE_LABELS[record.source]}・{TYPE_LABELS[record.caseType]}</span></div>
            <span className={`status-pill ${statusClass(record)}`}>{STATUS_LABELS[record.status]}</span>
          </div><dl className={styles.cardGrid}>
            <div><dt>風險</dt><dd><Escalation record={record} /></dd></div>
            <div><dt>承辦人</dt><dd>{record.assigneeDisplayName ?? "尚未指派"}</dd></div>
            <div className={styles.full}><dt>期限</dt><dd className={record.overdue ? styles.overdue : undefined}>
              {formatTimestamp(record.dueAt)}{record.overdue ? "・已逾期" : ""}</dd></div>
          </dl><Timeline record={record} />
          <CaseActions canClose={canClose} canCorrect={canCorrect} canManage={canManage}
            complaint={record} hasRecentAal2={hasRecentAal2} snapshot={snapshot}
            surface="mobile" />
        </article>)}</div>
    </> : <div className="panel__body"><section className="empty-card">
      <Search aria-hidden="true" /><h2>沒有符合條件的案件</h2>
      <p>請調整日期、來源、類型、風險、承辦、狀態或案件搜尋；系統不會擴大至其他分支。</p>
      <Link className="button button--secondary" href="?status=all">清除篩選</Link>
    </section></div>}
    </section>
  </>;
}
