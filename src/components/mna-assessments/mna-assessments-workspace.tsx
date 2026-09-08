import {
  Ban,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  FileQuestion,
  Link2,
  Search,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog/types";
import type {
  MnaAssessmentFilters,
  MnaAssessmentListItem,
  MnaAssessmentSnapshot,
  MnaFollowUpStatus,
  MnaRiskState,
  MnaVersionHistoryItem,
} from "@/lib/mna-assessments/types";

import { MnaAssessmentActions } from "./mna-assessment-actions";
import styles from "./mna-assessments.module.css";

function formatDate(value: string | null) {
  if (!value) return "尚無";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(`${value}T12:00:00+08:00`));
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}

function serviceStatus(value: MnaAssessmentListItem["serviceStatus"]) {
  return {
    active: "服務中", suspended: "暫停", transferred: "已轉出",
    closed: "已結案", deceased: "已死亡",
  }[value];
}

function riskText(value: MnaRiskState | null) {
  if (value === null) return "尚無資料";
  return { normal: "正常", at_risk: "有風險", malnourished: "營養不良" }[value];
}

function followUpText(value: MnaFollowUpStatus | null) {
  if (value === null) return "尚無資料";
  return {
    not_started: "尚未開始", planned: "已規劃", in_progress: "追蹤中",
    completed: "已完成", not_required: "人工標記不需追蹤",
  }[value];
}

function ScoreSummary({ item }: { item: MnaAssessmentListItem }) {
  if (!item.versionId) return <span>尚無正式評估資料</span>;
  return <div className={styles.scoreStack}>
    <strong>篩檢 {item.shortFormScore}・{riskText(item.shortFormRisk)}</strong>
    <span>完整評估 {item.fullScore ?? "未執行"}・{riskText(item.fullRisk)}</span>
    <small>合成展示值；正式版不在本系統內重算。</small>
  </div>;
}

function FollowUpSummary({ item }: { item: MnaAssessmentListItem }) {
  if (!item.versionId) return <span>尚無追蹤資料</span>;
  return <div className={styles.followUp}>
    <strong>{followUpText(item.followUpStatus)}</strong>
    <span>人工複評期限：{formatDate(item.reassessmentDueOn)}</span>
    <small>{item.reassessmentBasis ?? "沒有人工期限依據"}</small>
    <small>{item.followUpPlan ?? "沒有人工後續處置內容"}</small>
  </div>;
}

function HistoryVersion({ version }: { version: MnaVersionHistoryItem }) {
  return <li>
    <strong>v{version.assessmentVersion}・{version.recordState ===
      "synthetic_demo_corrected" ? "合成更正版" : "合成簽署版"}</strong>
    <span>評估日 {formatDate(version.assessedOn)}・作者 {version.authorDisplayName}</span>
    <span>篩檢 {version.shortFormScore}・{riskText(version.shortFormRisk)}；完整評估 {version.fullScore ?? "未執行"}・{riskText(version.fullRisk)}</span>
    <span>追蹤 {followUpText(version.followUpStatus)}・人工期限 {formatDate(version.reassessmentDueOn)}</span>
    {version.correctionReason ? <span>更正理由：{version.correctionReason}</span> : null}
    <small>表單參照：{version.sourceFormVersionReference}</small>
    <small>治理快照 <code>{version.governanceSnapshotHash.slice(0, 12)}…</code>・內容 <code>{version.contentHash.slice(0, 12)}…</code></small>
  </li>;
}

function History({ item }: { item: MnaAssessmentListItem }) {
  if (!item.versionHistory.length) return null;
  return <details className={styles.history}>
    <summary>查看不可變歷程（{item.versionHistoryTotal} 版）</summary>
    {item.versionHistoryTruncated ? <p>只顯示最近 50 版；統計仍使用完整集合。</p> : null}
    <ol>{item.versionHistory.map((version) =>
      <HistoryVersion key={version.versionId} version={version} />)}</ol>
  </details>;
}

export function MnaAssessmentsWorkspace({
  canManage,
  filters,
  hasRecentAal2,
  loadError = false,
  page,
  snapshot,
}: {
  canManage: boolean;
  filters: MnaAssessmentFilters;
  hasRecentAal2: boolean;
  loadError?: boolean;
  page: PageCatalogEntry;
  snapshot: MnaAssessmentSnapshot | null;
}) {
  if (loadError || !snapshot) {
    return <section className="empty-card core-care-state" role="alert">
      <span className="empty-card__icon empty-card__icon--warning">
        <CircleAlert aria-hidden="true" />
      </span>
      <h1>MNA 營養評估暫時無法載入</h1>
      <p>正式快照採失敗即關閉；非法篩選不會被降級成全部個案，系統也不會改用展示資料。</p>
      <a className="button button--secondary" href="?">重新載入</a>
    </section>;
  }

  return <>
    <nav aria-label="所在位置" className="context-bar">
      <span>工作台</span><ChevronRight aria-hidden="true" />
      <span>專業服務</span><ChevronRight aria-hidden="true" />
      <span aria-current="page" className="context-bar__crumb">{page.title}</span>
    </nav>
    <header className="page-heading core-care-heading">
      <div>
        <p className="eyebrow">指派個案清單・頁面 {page.number}</p>
        <h1>{page.title}</h1>
        <p className="page-heading__description">
          本頁已建好分數、風險、人工複評期限、後續處置與不可變版本的追蹤版型；取得指定台灣中文版本與電子實作授權前，正式建立、計分與簽署全部封鎖。
        </p>
      </div>
    </header>

    <div className={`callout ${styles.notice}`} role="alert">
      <Ban aria-hidden="true" />
      <div><strong>授權未配置，不等於沒有資料：</strong>目前缺少 Mapi Research Trust 授權、台灣中文版本確認、電子實作核准與必要畫面審查。本系統沒有重打或近似重建題目、答案選項、公式或譯文。</div>
    </div>
    <div className={`callout ${styles.notice}`} role="note">
      <Link2 aria-hidden="true" />
      <div>
        <strong>版本治理來源（僅連結與短摘要）：</strong>官方資料說明 MNA-SF 是建議臨床版本、完整 MNA 是原始長版；組織、商業與電子實作須依使用情境取得授權。
        <ul className={styles.sourceList}>
          <li><a href="https://www.mna-elderly.com/mna-forms" rel="noreferrer" target="_blank">官方 MNA 表單與使用條件</a></li>
          <li><a href="https://eprovide.mapi-trust.org/instruments/mini-nutritional-assessment3" rel="noreferrer" target="_blank">MNA-SF 授權與電子版條件</a></li>
          <li><a href="https://eprovide.mapi-trust.org/instruments/mini-nutritional-assessment2" rel="noreferrer" target="_blank">完整 MNA 授權資料</a></li>
        </ul>
      </div>
    </div>
    {snapshot.demo ? <div className={`callout ${styles.notice}`} role="status">
      <CircleAlert aria-hidden="true" />
      <span><strong>合成唯讀展示：</strong>個案、分數、風險、期限、追蹤、簽署與更正歷程都是 UI 驗收用合成資料，不是臨床結果，也不會寫入。</span>
    </div> : <div className={`callout ${styles.notice}`} role="status">
      <ShieldCheck aria-hidden="true" />
      <span>正式清單只讀取目前機構、分支與指派個案。即使具 professional 專頁權限及最近 15 分鐘 AAL2，授權未配置前 API 與資料庫仍拒絕所有寫入。</span>
    </div>}
    <div className={`callout ${styles.notice}`} role="status">
      <ClipboardCheck aria-hidden="true" />
      <span><strong>尚未設定：</strong>正式題本、答案、計分、風險分類、自動複評期限、自動後續處置、附件、匯出、離線同步與通知均 fail closed；人工期限與計畫也不會被當成系統建議。</span>
    </div>

    <section aria-label="MNA 合成展示摘要" className="metric-grid">
      {[
        ["尚未評估", snapshot.metrics.notAssessed, "人", "授權未配置與無資料分開顯示", <FileQuestion aria-hidden="true" key="none" />],
        ["合成正常", snapshot.metrics.normal, "人", "只供介面驗收", <ClipboardCheck aria-hidden="true" key="normal" />],
        ["合成有風險", snapshot.metrics.atRisk, "人", "不是正式風險分類", <CircleAlert aria-hidden="true" key="risk" />],
        ["合成待追蹤", snapshot.metrics.followUpPending, "人", "人工計畫、不自動通知", <ClipboardCheck aria-hidden="true" key="follow" />],
      ].map(([label, value, unit, foot, icon]) => <article className="metric-card" key={String(label)}>
        <div className="metric-card__top"><span>{label}</span><span className="metric-card__icon">{icon}</span></div>
        <div className="metric-card__value"><strong>{value}</strong><span>{unit}</span></div>
        <p className="metric-card__foot">{foot}</p>
      </article>)}
    </section>

    <section className="panel">
      <div className="panel__header"><div className="panel__title">
        <h2>指派個案 MNA 追蹤清單</h2>
        <p>{snapshot.matchingTotal} 位符合條件・快照 {formatTimestamp(snapshot.generatedAt)}・{snapshot.demo ? "合成" : `過期時間 ${formatTimestamp(snapshot.staleAfter)}`}</p>
      </div></div>
      <form className={`filter-bar ${styles.filters}`} method="get">
        <label className="field field--compact"><span>個案</span>
          <select defaultValue={filters.clientId ?? ""} name="client">
            <option value="">全部指派個案</option>
            {snapshot.clientOptions.map((client) => <option key={client.clientId} value={client.clientId}>{client.displayName}・{serviceStatus(client.serviceStatus)}</option>)}
          </select>
        </label>
        <label className="field field--compact"><span>風險</span>
          <select defaultValue={filters.risk} name="risk">
            <option value="all">全部</option><option value="normal">正常</option>
            <option value="at_risk">有風險</option><option value="malnourished">營養不良</option>
            <option value="not_assessed">尚未評估</option>
          </select>
        </label>
        <label className="field field--compact"><span>後續追蹤</span>
          <select defaultValue={filters.followUp} name="follow_up">
            <option value="all">全部</option><option value="pending">待追蹤</option>
            <option value="completed">已完成／不需追蹤</option>
            <option value="not_assessed">尚未評估</option>
          </select>
        </label>
        <button className="button button--secondary" type="submit">套用篩選</button>
      </form>
      {snapshot.items.length ? <>
        <div className={`table-wrap ${styles.desktop}`}>
          <table className={styles.table}>
            <thead><tr><th>個案</th><th>最近結果</th><th>評估日期</th><th>人工期限與後續</th><th>版本／操作</th></tr></thead>
            <tbody>{snapshot.items.map((item) => <tr key={item.clientId}>
              <td><strong>{item.clientDisplayName}</strong><br /><small>{serviceStatus(item.serviceStatus)}</small></td>
              <td><ScoreSummary item={item} /></td>
              <td><span>{formatDate(item.assessedOn)}</span><br /><small>完整評估 {formatDate(item.fullAssessmentOn)}</small></td>
              <td><FollowUpSummary item={item} /></td>
              <td><History item={item} /><MnaAssessmentActions canManage={canManage} hasRecentAal2={hasRecentAal2} item={item} snapshot={snapshot} /></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className={styles.cards}>{snapshot.items.map((item) => <article className={styles.card} key={item.clientId}>
          <header><strong>{item.clientDisplayName}</strong><br /><small>{serviceStatus(item.serviceStatus)}</small></header>
          <dl>
            <div><dt>最近結果</dt><dd><ScoreSummary item={item} /></dd></div>
            <div><dt>評估日期</dt><dd>{formatDate(item.assessedOn)}・完整 {formatDate(item.fullAssessmentOn)}</dd></div>
            <div><dt>人工期限與後續</dt><dd><FollowUpSummary item={item} /></dd></div>
          </dl>
          <History item={item} />
          <MnaAssessmentActions canManage={canManage} hasRecentAal2={hasRecentAal2} item={item} snapshot={snapshot} />
        </article>)}</div>
      </> : <div className="panel__body"><section className="empty-card core-care-state">
        <Search aria-hidden="true" /><h2>沒有符合條件的個案資料</h2>
        <p>這代表目前篩選下沒有資料；MNA 授權仍是另一個獨立且持續封鎖的狀態。</p>
        <Link className="button button--secondary" href="?">清除篩選</Link>
      </section></div>}
    </section>
  </>;
}

