import {
  Ban,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  FileQuestion,
  FlaskConical,
  Search,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog/types";
import {
  FALL_RISK_FACTOR_LABELS,
  type FallRiskAnswer,
  type FallRiskAssessmentFilters,
  type FallRiskAssessmentListItem,
  type FallRiskAssessmentSnapshot,
  type FallRiskVersionHistoryItem,
} from "@/lib/fall-risk-assessments/types";

import { FallRiskAssessmentActions } from "./fall-risk-assessment-actions";
import styles from "./fall-risk-assessments.module.css";

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

function serviceStatusText(value: FallRiskAssessmentListItem["serviceStatus"]) {
  return {
    active: "服務中",
    suspended: "暫停",
    transferred: "已轉出",
    closed: "已結案",
    deceased: "已死亡",
  }[value];
}

function answerText(answer: FallRiskAnswer) {
  if (answer.state === "answered") {
    return answer.value === "present" ? "觀察到" : "未觀察到";
  }
  if (answer.state === "missing") return "缺值";
  return `不適用：${answer.reason}`;
}

function answerSummary(item: Pick<FallRiskAssessmentListItem, "answers">) {
  const values = Object.values(item.answers ?? {});
  return {
    answered: values.filter((answer) => answer.state === "answered").length,
    missing: values.filter((answer) => answer.state === "missing").length,
    notApplicable: values.filter((answer) =>
      answer.state === "not_applicable").length,
  };
}

function previewBandText(value: string | null) {
  return {
    candidate_observation_0_1: "候選觀察區間（0–1 點）",
    candidate_review_2_3: "候選覆核區間（2–3 點）",
    candidate_high_review_4_6: "候選高檢視區間（4–6 點）",
  }[value ?? ""] ?? "尚無候選區間";
}

function StatusPill({ status }: { status: string }) {
  return <span className="status-pill status-pill--neutral">{status}</span>;
}

function PreviewSummary({ item }: { item: FallRiskAssessmentListItem }) {
  if (!item.versionId) return <span>尚未建立候選草稿</span>;
  if (item.previewStatus === "incomplete") {
    return <div className={styles.statuses}>
      <StatusPill status="試算不完整" />
      <small>任一缺值或不適用均不產生點數與區間。</small>
    </div>;
  }
  return <div className={styles.statuses}>
    <StatusPill status="候選試算可重現" />
    <strong>{item.previewCandidatePoints} 點（非正式）</strong>
    <small>{previewBandText(item.previewBandKey)}；不是正式風險分級。</small>
    {item.previewBandKey === "candidate_high_review_4_6" ? <small>
      待辦建議規則未發布；未建立、自動生效或通知任何待辦。
    </small> : null}
  </div>;
}

function VersionDetails({ version }: { version: FallRiskVersionHistoryItem }) {
  return <li>
    <strong>v{version.assessmentVersion}・{formatDate(version.assessedOn)}</strong>
    <span>{version.authorDisplayName}・不可變候選草稿</span>
    <ul className={styles.answerList}>
      {Object.entries(version.answers).map(([id, answer]) =>
        <li key={id}>
          <span>{FALL_RISK_FACTOR_LABELS[id as keyof typeof FALL_RISK_FACTOR_LABELS]}</span>
          <span>{answerText(answer)}</span>
        </li>)}
    </ul>
    <p><strong>候選試算：</strong>{version.previewStatus === "incomplete"
      ? "不完整，不產生數值"
      : `${version.previewCandidatePoints} 點；${previewBandText(version.previewBandKey)}`}</p>
    <p><strong>規則快照：</strong><code>{version.ruleVersionId}</code>・規則雜湊 {version.ruleSnapshotHash.slice(0, 12)}…</p>
    <p><strong>內容雜湊：</strong><code>{version.contentHash.slice(0, 12)}…</code></p>
  </li>;
}

function AssessmentHistory({ item }: { item: FallRiskAssessmentListItem }) {
  if (!item.versionHistory.length) return null;
  return <details className={styles.history}>
    <summary>查看不可變歷程（{item.versionHistoryTotal} 版）</summary>
    {item.versionHistoryTruncated ? <p>只顯示最近 50 版；總數仍由完整集合計算。</p> : null}
    <ol>{item.versionHistory.map((version) =>
      <VersionDetails key={version.versionId} version={version} />)}</ol>
  </details>;
}

function FallRiskAssessmentFreshness({ demo, staleAfter }: {
  demo: boolean;
  staleAfter: string;
}) {
  return <span>{demo ? "合成快照" : `資料過期時間 ${formatTimestamp(staleAfter)}`}</span>;
}

export function FallRiskAssessmentsWorkspace({
  canManage,
  filters,
  hasRecentAal2,
  loadError = false,
  page,
  snapshot,
}: {
  canManage: boolean;
  filters: FallRiskAssessmentFilters;
  hasRecentAal2: boolean;
  loadError?: boolean;
  page: PageCatalogEntry;
  snapshot: FallRiskAssessmentSnapshot | null;
}) {
  if (loadError || !snapshot) {
    return <section className="empty-card core-care-state" role="alert">
      <span className="empty-card__icon empty-card__icon--warning">
        <CircleAlert aria-hidden="true" />
      </span>
      <h1>跌倒風險候選評估暫時無法載入</h1>
      <p>正式快照採失敗即關閉；系統沒有擴大機構、分支或個案指派範圍，也沒有改用展示資料。</p>
      <a className="button button--secondary" href="?">重新載入</a>
    </section>;
  }

  return <>
    <nav aria-label="所在位置" className="context-bar">
      <span>工作台</span><ChevronRight aria-hidden="true" />
      <span>評估量表</span><ChevronRight aria-hidden="true" />
      <span aria-current="page" className="context-bar__crumb">{page.title}</span>
    </nav>
    <header className="page-heading core-care-heading">
      <div>
        <p className="eyebrow">指派個案清單・頁面 {page.number}</p>
        <h1>{page.title}</h1>
        <p className="page-heading__description">
          保存六項人工觀察因子的明確三態答案與不可變候選規則快照；目前只允許受治理的草稿、新版修訂與可重現候選試算。
        </p>
      </div>
    </header>

    <div className={`callout ${styles.candidate}`} role="note">
      <FlaskConical aria-hidden="true" />
      <span><strong>人工候選規則尚未生效：</strong><code>{snapshot.ruleVersionId}</code> 仍待雙人核准。因子、點數與區間只供規則覆核，不是官方量表、正式分級、建議處置或診斷。</span>
    </div>
    <div className={`callout ${styles.blocked}`} role="status">
      <Ban aria-hidden="true" />
      <span><strong>正式用途已封鎖：</strong>規則 activated 前，API 與資料庫均拒絕正式簽署、風險分類與照顧決策。</span>
    </div>
    {snapshot.demo ? <div className={`callout ${styles.demo}`} role="status">
      <CircleAlert aria-hidden="true" />
      <span><strong>展示模式：</strong>個案、作者、答案與試算皆為合成示例；正式按鈕維持唯讀。</span>
    </div> : <div className={`callout ${styles.security}`}>
      <ShieldCheck aria-hidden="true" />
      <span>只載入目前機構、分支與指派個案；草稿寫入需 clients.read、fall_risk_assessments.read/manage 與最近 15 分鐘 AAL2，且在讀取內容前驗證。</span>
    </div>}
    <div className={`callout ${styles.offline}`} role="status">
      <ClipboardCheck aria-hidden="true" />
      <span><strong>尚未設定：</strong>正式規則、簽署、正式分數／風險、照顧決策、待辦建議規則、附件、匯出、離線同步與通知均 fail closed。</span>
    </div>
    {!snapshot.demo && !canManage ? <div className="callout" role="status">
      <ShieldCheck aria-hidden="true" />
      <span>目前只有查看權限；新增、修訂與任何正式操作都會由 API 與資料庫拒絕。</span>
    </div> : null}

    <section aria-label="跌倒風險候選草稿摘要" className="metric-grid">
      {[
        ["候選試算可重現", snapshot.metrics.candidateComplete, "份", "仍不是正式分數", <CheckCircle2 aria-hidden="true" key="complete" />],
        ["試算不完整", snapshot.metrics.incomplete, "份", "缺值／不適用不當作 0", <FileQuestion aria-hidden="true" key="incomplete" />],
        ["尚未建立", snapshot.metrics.notAssessed, "人", "每位指派個案只計一次", <FileQuestion aria-hidden="true" key="missing" />],
        ["候選草稿", snapshot.metrics.drafts, "份", "正式簽署一律封鎖", <ClipboardCheck aria-hidden="true" key="draft" />],
      ].map(([label, value, unit, foot, icon]) => <article className="metric-card" key={String(label)}>
        <div className="metric-card__top"><span>{label}</span><span className="metric-card__icon">{icon}</span></div>
        <div className="metric-card__value"><strong>{value}</strong><span>{unit}</span></div>
        <p className="metric-card__foot">{foot}</p>
      </article>)}
    </section>

    <section className="panel">
      <div className="panel__header"><div className="panel__title">
        <h2>個案跌倒風險候選草稿清單</h2>
        <p>{snapshot.matchingTotal} 位符合條件・快照 {formatTimestamp(snapshot.generatedAt)}・<FallRiskAssessmentFreshness demo={snapshot.demo} staleAfter={snapshot.staleAfter} /></p>
      </div></div>
      <form className={`filter-bar ${styles.filters}`} method="get">
        <label className="field field--compact"><span>個案</span>
          <select defaultValue={filters.clientId ?? ""} name="client">
            <option value="">全部指派個案</option>
            {snapshot.clientOptions.map((client) => <option key={client.clientId} value={client.clientId}>{client.displayName}</option>)}
          </select>
        </label>
        <label className="field field--compact"><span>候選試算狀態</span>
          <select defaultValue={filters.previewStatus} name="preview">
            <option value="all">全部</option>
            <option value="candidate_complete">可重現候選試算</option>
            <option value="incomplete">不完整</option>
            <option value="not_assessed">尚未建立</option>
          </select>
        </label>
        <label className="field field--compact"><span>答案狀態</span>
          <select defaultValue={filters.answerState} name="answers">
            <option value="all">全部</option>
            <option value="all_answered">六項因子皆已回答</option>
            <option value="has_missing">含缺值</option>
            <option value="has_not_applicable">含不適用</option>
          </select>
        </label>
        <button className="button button--secondary" type="submit">套用篩選</button>
        <Link className="button button--quiet" href="?">清除</Link>
      </form>
      {snapshot.itemsTruncated ? <div className={`callout ${styles.truncated}`} role="status"><CircleAlert aria-hidden="true" /><span>結果超過 200 位，畫面顯示前 200 位；摘要仍由完整集合計算。</span></div> : null}
      {snapshot.clientOptionsTruncated ? <div className={`callout ${styles.truncated}`} role="status"><CircleAlert aria-hidden="true" /><span>指派個案選項超過 500 筆，只呈現有界選項。</span></div> : null}

      {snapshot.items.length ? <>
        <div aria-label="跌倒風險候選草稿清單，可左右捲動" className={`table-wrap ${styles.table}`} role="region" tabIndex={0}>
          <table className="data-table"><thead><tr>{[
            "個案／服務狀態", "最近候選草稿", "答案完整度",
            "候選試算（非正式）", "操作",
          ].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
          <tbody>{snapshot.items.map((item) => {
            const counts = answerSummary(item);
            return <tr key={item.clientId}>
              <td><span className="data-table__primary"><span className="avatar" aria-hidden="true">{item.clientDisplayName.slice(0, 1)}</span><span>{item.clientDisplayName}<small className="data-table__secondary">{serviceStatusText(item.serviceStatus)}</small></span></span></td>
              <td><div className={styles.statuses}><StatusPill status={item.versionId ? "候選草稿" : "尚未建立"} /><span>{formatDate(item.assessedOn)}</span>{item.authorDisplayName ? <small>{item.authorDisplayName}・v{item.assessmentVersion}</small> : null}<AssessmentHistory item={item} /></div></td>
              <td><div className={styles.statuses}><span>已答 {counts.answered}／6</span><small>缺值 {counts.missing}・不適用 {counts.notApplicable}</small></div></td>
              <td><PreviewSummary item={item} /></td>
              <td><FallRiskAssessmentActions canManage={canManage} hasRecentAal2={hasRecentAal2} item={item} snapshot={snapshot} /></td>
            </tr>;
          })}</tbody></table>
        </div>
        <div className="mobile-records core-care-mobile">
          {snapshot.items.map((item) => {
            const counts = answerSummary(item);
            return <article className={`record-card ${styles.card}`} key={item.clientId}>
              <div className="record-card__top"><div><h3>{item.clientDisplayName}</h3><span className="data-table__secondary">{serviceStatusText(item.serviceStatus)}</span></div><StatusPill status={item.versionId ? "候選草稿" : "尚未建立"} /></div>
              <dl><div><dt>評估日</dt><dd>{formatDate(item.assessedOn)}</dd></div><div><dt>作者</dt><dd>{item.authorDisplayName ?? "尚無"}</dd></div><div className={styles.cardWide}><dt>答案完整度</dt><dd>已答 {counts.answered}／6・缺值 {counts.missing}・不適用 {counts.notApplicable}</dd></div></dl>
              <PreviewSummary item={item} /><AssessmentHistory item={item} />
              <FallRiskAssessmentActions canManage={canManage} hasRecentAal2={hasRecentAal2} item={item} snapshot={snapshot} />
            </article>;
          })}
        </div>
      </> : <div className="panel__body"><section className="empty-card core-care-state"><Search aria-hidden="true" /><h2>沒有符合條件的指派個案</h2><p>請調整個案、候選試算或答案狀態；系統不會擴大到其他分支或未指派個案。</p><Link className="button button--secondary" href="?">清除篩選</Link></section></div>}
    </section>
  </>;
}
