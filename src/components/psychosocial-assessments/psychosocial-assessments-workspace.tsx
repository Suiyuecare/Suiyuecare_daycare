import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  FilePenLine,
  Search,
  ShieldCheck,
  UserRoundSearch,
} from "lucide-react";
import Link from "next/link";

import { StatusPill } from "@/components/ui/status-pill";
import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  PsychosocialAssessmentFilters,
  PsychosocialAssessmentListItem,
  PsychosocialAssessmentSnapshot,
  PsychosocialDomainKey,
} from "@/lib/psychosocial-assessments/types";

import {
  PsychosocialAssessmentActions,
  PsychosocialAssessmentFreshness,
} from "./psychosocial-assessment-actions";
import styles from "./psychosocial-assessments.module.css";

const domainLabels: Record<PsychosocialDomainKey, string> = {
  family_relationships: "家庭／關係人互動",
  social_support: "社會支持",
  social_participation: "社交／活動參與",
  communication_context: "溝通情境與偏好",
  resource_access: "資源取得情形",
};

function formatTimestamp(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(`${value}T12:00:00+08:00`));
}

function serviceStatusText(value: PsychosocialAssessmentListItem["serviceStatus"]) {
  return {
    active: "服務中",
    suspended: "暫停服務",
    transferred: "已轉出",
    closed: "已結案",
    deceased: "死亡結案",
  }[value];
}

function assessmentStateText(item: PsychosocialAssessmentListItem) {
  if (item.recordState === null) return "尚未評估";
  if (item.recordState === "draft") return "草稿待簽";
  if (item.recordState === "corrected") return "已簽更正版";
  return "已簽署";
}

function domainStateText(
  value: NonNullable<PsychosocialAssessmentListItem["dimensions"]>[
    PsychosocialDomainKey
  ],
) {
  if (value.state === "provided") return "已記錄";
  if (value.state === "missing") return "未知／尚未取得";
  return "不適用";
}

function DomainSummary({ item }: { item: PsychosocialAssessmentListItem }) {
  if (!item.dimensions) return <span>尚無結構化面向</span>;
  return <dl className={styles.domainSummary}>
    {(Object.keys(domainLabels) as PsychosocialDomainKey[]).map((key) => <div key={key}>
      <dt>{domainLabels[key]}</dt>
      <dd>
        <strong>{domainStateText(item.dimensions![key])}</strong>
        {item.dimensions![key].detail ? <span>{item.dimensions![key].detail}</span> : null}
      </dd>
    </div>)}
  </dl>;
}

function AssessmentHistory({ item }: { item: PsychosocialAssessmentListItem }) {
  if (item.versionHistoryTotal === 0) return null;
  return <details className={styles.history}>
    <summary>不可變版本歷程（{item.versionHistoryTotal} 筆）</summary>
    {item.versionHistoryTruncated ? <p role="status">
      單鏈超過 50 筆，畫面只呈現有界內容；正式版本鏈仍完整保留。
    </p> : null}
    <ol>
      {item.versionHistory.map((version) => <li key={version.versionId}>
        <strong>v{version.assessmentVersion}・{
          version.recordState === "draft" ? "草稿"
            : version.recordState === "signed" ? "簽署" : "更正"
        }</strong>
        <span>{formatTimestamp(version.createdAt)}・{version.responsibleDisplayName}</span>
        <p>{version.assessmentSummary}</p>
        <p><strong>人工複評期限：</strong>{formatDate(version.reassessmentDueOn)}</p>
        <p><strong>期限依據：</strong>{version.dueBasis}</p>
        {version.correctionReason ? <p>
          <strong>更正理由：</strong>{version.correctionReason}
        </p> : null}
      </li>)}
    </ol>
  </details>;
}

export function PsychosocialAssessmentsWorkspace({
  canManage,
  canSign,
  filters,
  hasRecentAal2,
  loadError = false,
  page,
  snapshot,
}: {
  canManage: boolean;
  canSign: boolean;
  filters: PsychosocialAssessmentFilters;
  hasRecentAal2: boolean;
  loadError?: boolean;
  page: PageCatalogEntry;
  snapshot: PsychosocialAssessmentSnapshot | null;
}) {
  if (loadError || !snapshot) {
    return <section className="empty-card core-care-state" role="alert">
      <span className="empty-card__icon empty-card__icon--warning">
        <CircleAlert aria-hidden="true" />
      </span>
      <h1>心理社會評估暫時無法載入</h1>
      <p>正式快照採失敗即關閉；系統沒有擴大機構、分支或個案指派範圍，也沒有改用展示資料。</p>
      <a className="button button--secondary" href="?">重新載入</a>
    </section>;
  }

  return <>
    <nav aria-label="所在位置" className="context-bar">
      <span>工作台</span><ChevronRight aria-hidden="true" />
      <span>社工服務</span><ChevronRight aria-hidden="true" />
      <span aria-current="page" className="context-bar__crumb">{page.title}</span>
    </nav>
    <header className="page-heading core-care-heading">
      <div>
        <p className="eyebrow">指派個案清單・頁面 {page.number}</p>
        <h1>{page.title}</h1>
        <p className="page-heading__description">
          依個案、負責人、目前服務狀態與人工到期日查詢；每列顯示最近評估並保留完整版本鏈。
        </p>
      </div>
    </header>

    <div className={`callout ${styles.manual}`} role="note">
      <UserRoundSearch aria-hidden="true" />
      <span><strong>人工、非標準化紀錄：</strong>使用 <code>manual-psychosocial-v1</code> 技術參照，逐面向區分已記錄、未知與不適用；不宣稱官方量表、不計分、不套診斷。</span>
    </div>
    {snapshot.demo ? <div className={`callout ${styles.demo}`} role="status">
      <CircleAlert aria-hidden="true" />
      <span><strong>展示模式：</strong>所有個案、工作人員與內容皆為合成示例；正式按鈕維持唯讀。</span>
    </div> : <div className={`callout ${styles.security}`}>
      <ShieldCheck aria-hidden="true" />
      <span>只載入目前機構、分支及指派個案。簽署與更正需最近 15 分鐘 AAL2；已簽內容只能追加帶理由且連回原版的更正版。</span>
    </div>}
    <div className={`callout ${styles.offline}`} role="status">
      <ClipboardList aria-hidden="true" />
      <span><strong>尚未設定：</strong>到期日自動規則、評分、診斷、附件、匯出與離線正式同步均不啟用；本頁不會冒充已完成。</span>
    </div>
    {!snapshot.demo && !canManage ? <div className="callout" role="status">
      <ShieldCheck aria-hidden="true" />
      <span>目前角色只有查看權限；新增、修訂、簽署與更正會由 API 及資料庫共同拒絕。</span>
    </div> : null}

    <section aria-label="心理社會評估摘要" className="metric-grid">
      {[
        ["已完成評估", snapshot.metrics.completed, "人", `另有 ${snapshot.metrics.drafts} 份草稿待簽`, <CheckCircle2 aria-hidden="true" key="complete" />],
        ["尚未評估", snapshot.metrics.notAssessed, "人", "每位指派個案只計一次", <FilePenLine aria-hidden="true" key="missing" />],
        ["今日以前到期", snapshot.metrics.due, "人", "依人工日期與台北時區", <CalendarClock aria-hidden="true" key="due" />],
        ["尚未到期", snapshot.metrics.upcoming, "人", "不套用未發布週期規則", <ClipboardList aria-hidden="true" key="upcoming" />],
      ].map(([label, value, unit, foot, icon]) => <article
        className="metric-card"
        key={String(label)}
      >
        <div className="metric-card__top">
          <span>{label}</span><span className="metric-card__icon">{icon}</span>
        </div>
        <div className="metric-card__value"><strong>{value}</strong><span>{unit}</span></div>
        <p className="metric-card__foot">{foot}</p>
      </article>)}
    </section>

    <section className="panel">
      <div className="panel__header">
        <div className="panel__title">
          <h2>個案心理社會評估清單</h2>
          <p>{snapshot.matchingTotal} 位符合條件・快照 {formatTimestamp(snapshot.generatedAt)}・<PsychosocialAssessmentFreshness demo={snapshot.demo} staleAfter={snapshot.staleAfter} /></p>
        </div>
      </div>
      <form className={`filter-bar ${styles.filters}`} method="get">
        <label className="field field--compact">
          <span>個案</span>
          <select defaultValue={filters.clientId ?? ""} name="client">
            <option value="">全部指派個案</option>
            {snapshot.clientOptions.map((client) => <option
              key={client.clientId}
              value={client.clientId}
            >{client.displayName}</option>)}
          </select>
        </label>
        <label className="field field--compact">
          <span>負責人</span>
          <select defaultValue={filters.responsibleUserId ?? ""} name="responsible">
            <option value="">全部負責人</option>
            {snapshot.responsibleOptions.map((worker) => <option
              key={worker.userId}
              value={worker.userId}
            >{worker.displayName}</option>)}
          </select>
        </label>
        <label className="field field--compact">
          <span>目前服務狀態</span>
          <select defaultValue={filters.serviceStatus ?? ""} name="service">
            <option value="">全部狀態</option>
            <option value="active">服務中</option>
            <option value="suspended">暫停服務</option>
            <option value="transferred">已轉出</option>
            <option value="closed">已結案</option>
            <option value="deceased">死亡結案</option>
          </select>
        </label>
        <label className="field field--compact">
          <span>人工複評期限</span>
          <select defaultValue={filters.dueStatus} name="due">
            <option value="all">全部</option>
            <option value="due">今日以前到期</option>
            <option value="upcoming">尚未到期</option>
            <option value="not_assessed">尚未評估</option>
          </select>
        </label>
        <button className="button button--secondary" type="submit">套用篩選</button>
        <Link className="button button--quiet" href="?">清除</Link>
      </form>
      {snapshot.itemsTruncated ? <div className={`callout ${styles.truncated}`} role="status">
        <CircleAlert aria-hidden="true" />
        <span>結果超過 200 位，畫面依個案名稱顯示前 200 位；摘要仍採相同完整快照。請縮小篩選。</span>
      </div> : null}
      {snapshot.clientOptionsTruncated || snapshot.responsibleOptionsTruncated
        ? <div className={`callout ${styles.truncated}`} role="status">
          <CircleAlert aria-hidden="true" />
          <span>篩選選項超過 200 筆，畫面只顯示前 200 筆；未載入項目不會被誤判為不存在。</span>
        </div>
        : null}

      {snapshot.items.length ? <>
        <div
          aria-label="心理社會評估清單，可左右捲動"
          className={`table-wrap ${styles.table}`}
          role="region"
          tabIndex={0}
        >
          <table className="data-table">
            <thead><tr>{[
              "個案／服務狀態", "最近評估", "人工摘要", "結構化面向", "人工期限", "操作",
            ].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
            <tbody>{snapshot.items.map((item) => <tr key={item.clientId}>
              <td>
                <span className="data-table__primary">
                  <span className="avatar" aria-hidden="true">{item.clientDisplayName.slice(0, 1)}</span>
                  <span>{item.clientDisplayName}<small className="data-table__secondary">{serviceStatusText(item.serviceStatus)}</small></span>
                </span>
              </td>
              <td><div className={styles.statuses}>
                <StatusPill status={assessmentStateText(item)} />
                <span>{formatDate(item.assessedOn)}</span>
                {item.responsibleDisplayName ? <small>負責人：{item.responsibleDisplayName}・v{item.assessmentVersion}</small> : null}
              </div></td>
              <td className={styles.narrative}>
                {item.assessmentSummary ?? "尚無人工評估摘要"}
                <AssessmentHistory item={item} />
              </td>
              <td className={styles.domains}><DomainSummary item={item} /></td>
              <td><div className={styles.statuses}>
                {item.reassessmentDue ? <StatusPill status="今日以前到期" /> : null}
                <span>{formatDate(item.reassessmentDueOn)}</span>
                {item.dueBasis ? <small>{item.dueBasis}</small> : null}
              </div></td>
              <td><PsychosocialAssessmentActions
                canManage={canManage}
                canSign={canSign}
                hasRecentAal2={hasRecentAal2}
                item={item}
                snapshot={snapshot}
              /></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="mobile-records core-care-mobile">
          {snapshot.items.map((item) => <article
            className={`record-card ${styles.card}`}
            key={item.clientId}
          >
            <div className="record-card__top">
              <div><h3>{item.clientDisplayName}</h3><span className="data-table__secondary">{serviceStatusText(item.serviceStatus)}</span></div>
              <StatusPill status={assessmentStateText(item)} />
            </div>
            <dl>
              <div><dt>評估日</dt><dd>{formatDate(item.assessedOn)}</dd></div>
              <div><dt>負責人</dt><dd>{item.responsibleDisplayName ?? "尚無"}</dd></div>
              <div><dt>人工複評期限</dt><dd>{formatDate(item.reassessmentDueOn)}{item.reassessmentDue ? "・已到期" : ""}</dd></div>
              <div><dt>期限依據</dt><dd>{item.dueBasis ?? "尚無"}</dd></div>
              <div className={styles.cardWide}><dt>人工評估摘要</dt><dd>{item.assessmentSummary ?? "尚無"}</dd></div>
            </dl>
            <DomainSummary item={item} />
            <AssessmentHistory item={item} />
            <PsychosocialAssessmentActions
              canManage={canManage}
              canSign={canSign}
              hasRecentAal2={hasRecentAal2}
              item={item}
              snapshot={snapshot}
            />
          </article>)}
        </div>
      </> : <div className="panel__body">
        <section className="empty-card core-care-state">
          <Search aria-hidden="true" />
          <h2>沒有符合條件的指派個案</h2>
          <p>請調整個案、負責人、服務狀態或人工期限；系統不會擴大到其他分支或未指派個案。</p>
          <Link className="button button--secondary" href="?">清除篩選</Link>
        </section>
      </div>}
    </section>
  </>;
}
