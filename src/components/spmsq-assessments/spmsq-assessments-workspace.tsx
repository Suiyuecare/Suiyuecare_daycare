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

import { StatusPill } from "@/components/ui/status-pill";
import type { PageCatalogEntry } from "@/lib/catalog";
import {
  SPMSQ_QUESTIONS,
  type SpmsqAnswer,
  type SpmsqAssessmentFilters,
  type SpmsqAssessmentListItem,
  type SpmsqAssessmentSnapshot,
  type SpmsqEducationContext,
} from "@/lib/spmsq-assessments/types";

import {
  SpmsqAssessmentActions,
  SpmsqAssessmentFreshness,
} from "./spmsq-assessment-actions";
import styles from "./spmsq-assessments.module.css";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(`${value}T12:00:00+08:00`));
}

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

function serviceStatusText(value: SpmsqAssessmentListItem["serviceStatus"]) {
  return {
    active: "服務中",
    suspended: "暫停服務",
    transferred: "已轉出",
    closed: "已結案",
    deceased: "死亡結案",
  }[value];
}

function answerText(answer: SpmsqAnswer) {
  if (answer.state === "answered") {
    return answer.value === "correct" ? "正確" : "錯誤";
  }
  if (answer.state === "missing") return "缺值／未答";
  return `不適用：${answer.reason}`;
}

function answerSummary(item: SpmsqAssessmentListItem) {
  if (!item.answers) return { answered: 0, missing: 10, notApplicable: 0 };
  const values = Object.values(item.answers);
  return {
    answered: values.filter((answer) => answer.state === "answered").length,
    missing: values.filter((answer) => answer.state === "missing").length,
    notApplicable: values.filter((answer) =>
      answer.state === "not_applicable").length,
  };
}

function educationText(context: SpmsqEducationContext | null) {
  if (!context) return "尚無";
  if (context.state === "missing") return "缺值／尚未確認";
  if (context.state === "not_applicable") {
    return `不適用：${context.reason}`;
  }
  return {
    grade_school_or_less: "小學或以下（候選 -1）",
    middle_or_high_school: "國高中（候選不調整）",
    beyond_high_school: "高中以上（候選 +1）",
  }[context.value];
}

function culturalText(item: SpmsqAssessmentListItem) {
  const context = item.culturalContext;
  if (!context || context.state === "missing") return "缺值／尚未記錄";
  if (context.state === "not_applicable") return `不適用：${context.reason}`;
  return context.note;
}

function previewBandText(key: string | null) {
  if (!key) return "無候選區間";
  return {
    reference_0_2_errors: "候選 0–2 錯誤參考區間",
    mild_3_4_errors: "候選 3–4 錯誤參考區間",
    moderate_5_7_errors: "候選 5–7 錯誤參考區間",
    high_8_10_errors: "候選 8–10 錯誤參考區間",
  }[key] ?? "未知候選區間";
}

function PreviewSummary({ item }: { item: SpmsqAssessmentListItem }) {
  if (!item.versionId) return <span>尚未建立候選草稿</span>;
  if (item.previewStatus === "incomplete") {
    return <div className={styles.statuses}>
      <StatusPill status="候選試算不完整" />
      <small>缺值與不適用不當作 0，也不推估結果。</small>
    </div>;
  }
  return <div className={styles.statuses}>
    <StatusPill status="候選試算可重現" />
    <span>原始錯誤 {item.previewRawErrors}・教育調整後 {item.previewAdjustedErrors}</span>
    <small>{previewBandText(item.previewBandKey)}</small>
    <small>非正式分數／非官方結果</small>
  </div>;
}

function AssessmentHistory({ item }: { item: SpmsqAssessmentListItem }) {
  if (!item.versionHistoryTotal) return null;
  return <details className={styles.history}>
    <summary>不可變候選版本歷程（{item.versionHistoryTotal} 筆）</summary>
    {item.versionHistoryTruncated ? <p role="status">
      單鏈超過 50 筆，畫面只顯示最新 50 筆；資料庫仍保留完整版本鏈。
    </p> : null}
    <ol>
      {item.versionHistory.map((version) => <li key={version.versionId}>
        <strong>v{version.assessmentVersion}・候選草稿</strong>
        <span>{formatTimestamp(version.createdAt)}・{version.authorDisplayName}</span>
        <p><strong>評估日：</strong>{formatDate(version.assessedOn)}</p>
        <p><strong>教育脈絡：</strong>{educationText(version.educationContext)}</p>
        <p><strong>文化脈絡：</strong>{
          version.culturalContext.state === "recorded"
            ? version.culturalContext.note
            : version.culturalContext.state === "not_applicable"
              ? `不適用：${version.culturalContext.reason}`
              : "缺值／尚未記錄"
        }</p>
        <ol aria-label={`v${version.assessmentVersion} 十題答案`} className={styles.answerList}>
          {SPMSQ_QUESTIONS.map(({ id, prompt }, index) => <li key={id}>
            <span>{index + 1}. {prompt}</span>
            <strong>{answerText(version.answers[id])}</strong>
          </li>)}
        </ol>
        <p><strong>候選試算：</strong>{version.previewStatus === "incomplete"
          ? "不完整，不產生數值"
          : `原始錯誤 ${version.previewRawErrors}、教育調整後 ${version.previewAdjustedErrors}；${previewBandText(version.previewBandKey)}`}</p>
        <p><strong>規則快照：</strong><code>{version.ruleVersionId}</code>・雜湊 {version.ruleSnapshotHash.slice(0, 12)}…</p>
      </li>)}
    </ol>
  </details>;
}

export function SpmsqAssessmentsWorkspace({
  canManage,
  filters,
  loadError = false,
  page,
  snapshot,
}: {
  canManage: boolean;
  filters: SpmsqAssessmentFilters;
  loadError?: boolean;
  page: PageCatalogEntry;
  snapshot: SpmsqAssessmentSnapshot | null;
}) {
  if (loadError || !snapshot) {
    return <section className="empty-card core-care-state" role="alert">
      <span className="empty-card__icon empty-card__icon--warning">
        <CircleAlert aria-hidden="true" />
      </span>
      <h1>SPMSQ 評估暫時無法載入</h1>
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
          保存十個明確答案狀態、教育與文化脈絡及不可變候選規則快照；目前只允許受治理的草稿與試算預覽。
        </p>
      </div>
    </header>

    <div className={`callout ${styles.candidate}`} role="note">
      <FlaskConical aria-hidden="true" />
      <span><strong>候選規則尚未生效：</strong><code>{snapshot.ruleVersionId}</code> 目前為 candidate_unactivated。畫面上的數值只供規則驗證，不是官方分數、診斷或照顧決策。</span>
    </div>
    <div className={`callout ${styles.blocked}`} role="status">
      <Ban aria-hidden="true" />
      <span><strong>正式簽署已封鎖：</strong>規則未經治理流程正式 activated 前，API 與資料庫都不會建立簽署紀錄或正式結果。</span>
    </div>
    {snapshot.demo ? <div className={`callout ${styles.demo}`} role="status">
      <CircleAlert aria-hidden="true" />
      <span><strong>展示模式：</strong>個案、作者、答案與試算皆為合成示例；正式按鈕維持唯讀。</span>
    </div> : <div className={`callout ${styles.security}`}>
      <ShieldCheck aria-hidden="true" />
      <span>只載入目前機構、分支與指派個案；每次草稿寫入都需 clients.read、assessments.read/manage 及最近 15 分鐘 AAL2，且在讀取表單內容前先驗證。</span>
    </div>}
    <div className={`callout ${styles.offline}`} role="status">
      <ClipboardCheck aria-hidden="true" />
      <span><strong>尚未設定：</strong>正式規則發布、正式分數、簽署、照顧決策、自動複評、附件、匯出與離線同步均 fail closed。</span>
    </div>
    {!snapshot.demo && !canManage ? <div className="callout" role="status">
      <ShieldCheck aria-hidden="true" />
      <span>目前只有查看權限；新增、修訂與任何正式操作都會由 API 與資料庫拒絕。</span>
    </div> : null}

    <section aria-label="SPMSQ 候選草稿摘要" className="metric-grid">
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
      <div className="panel__header">
        <div className="panel__title">
          <h2>個案 SPMSQ 候選草稿清單</h2>
          <p>{snapshot.matchingTotal} 位符合條件・快照 {formatTimestamp(snapshot.generatedAt)}・<SpmsqAssessmentFreshness demo={snapshot.demo} staleAfter={snapshot.staleAfter} /></p>
        </div>
      </div>
      <form className={`filter-bar ${styles.filters}`} method="get">
        <label className="field field--compact">
          <span>個案</span>
          <select defaultValue={filters.clientId ?? ""} name="client">
            <option value="">全部指派個案</option>
            {snapshot.clientOptions.map((client) => <option key={client.clientId} value={client.clientId}>{client.displayName}</option>)}
          </select>
        </label>
        <label className="field field--compact">
          <span>候選試算狀態</span>
          <select defaultValue={filters.previewStatus} name="preview">
            <option value="all">全部</option>
            <option value="candidate_complete">可重現候選試算</option>
            <option value="incomplete">不完整</option>
            <option value="not_assessed">尚未建立</option>
          </select>
        </label>
        <label className="field field--compact">
          <span>教育脈絡</span>
          <select defaultValue={filters.educationState} name="education">
            <option value="all">全部</option>
            <option value="answered">已確認</option>
            <option value="missing">缺值</option>
            <option value="not_applicable">不適用</option>
          </select>
        </label>
        <button className="button button--secondary" type="submit">套用篩選</button>
        <Link className="button button--quiet" href="?">清除</Link>
      </form>
      {snapshot.itemsTruncated ? <div className={`callout ${styles.truncated}`} role="status">
        <CircleAlert aria-hidden="true" />
        <span>結果超過 200 位，畫面顯示前 200 位；摘要仍先由完整集合計算。請縮小篩選。</span>
      </div> : null}
      {snapshot.clientOptionsTruncated ? <div className={`callout ${styles.truncated}`} role="status">
        <CircleAlert aria-hidden="true" />
        <span>指派個案選項超過 500 筆，畫面只呈現有界選項；未載入選項不會被誤判為不存在。</span>
      </div> : null}

      {snapshot.items.length ? <>
        <div aria-label="SPMSQ 候選草稿清單，可左右捲動" className={`table-wrap ${styles.table}`} role="region" tabIndex={0}>
          <table className="data-table">
            <thead><tr>{[
              "個案／服務狀態", "最近候選草稿", "答案完整度",
              "教育／文化脈絡", "候選試算（非正式）", "操作",
            ].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
            <tbody>{snapshot.items.map((item) => {
              const counts = answerSummary(item);
              return <tr key={item.clientId}>
                <td><span className="data-table__primary">
                  <span className="avatar" aria-hidden="true">{item.clientDisplayName.slice(0, 1)}</span>
                  <span>{item.clientDisplayName}<small className="data-table__secondary">{serviceStatusText(item.serviceStatus)}</small></span>
                </span></td>
                <td><div className={styles.statuses}>
                  <StatusPill status={item.versionId ? "候選草稿" : "尚未建立"} />
                  <span>{formatDate(item.assessedOn)}</span>
                  {item.authorDisplayName ? <small>{item.authorDisplayName}・v{item.assessmentVersion}</small> : null}
                  <AssessmentHistory item={item} />
                </div></td>
                <td><div className={styles.statuses}>
                  <span>已答 {counts.answered}／10</span>
                  <small>缺值 {counts.missing}・不適用 {counts.notApplicable}</small>
                </div></td>
                <td className={styles.contextCell}>
                  <p><strong>教育：</strong>{educationText(item.educationContext)}</p>
                  <p><strong>文化：</strong>{culturalText(item)}</p>
                  <small>文化欄不做數值修正</small>
                </td>
                <td><PreviewSummary item={item} /></td>
                <td><SpmsqAssessmentActions canManage={canManage} item={item} snapshot={snapshot} /></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <div className="mobile-records core-care-mobile">
          {snapshot.items.map((item) => {
            const counts = answerSummary(item);
            return <article className={`record-card ${styles.card}`} key={item.clientId}>
              <div className="record-card__top">
                <div><h3>{item.clientDisplayName}</h3><span className="data-table__secondary">{serviceStatusText(item.serviceStatus)}</span></div>
                <StatusPill status={item.versionId ? "候選草稿" : "尚未建立"} />
              </div>
              <dl>
                <div><dt>評估日</dt><dd>{formatDate(item.assessedOn)}</dd></div>
                <div><dt>作者</dt><dd>{item.authorDisplayName ?? "尚無"}</dd></div>
                <div><dt>答案完整度</dt><dd>已答 {counts.answered}／10・缺值 {counts.missing}・不適用 {counts.notApplicable}</dd></div>
                <div><dt>教育脈絡</dt><dd>{educationText(item.educationContext)}</dd></div>
                <div className={styles.cardWide}><dt>文化／語言脈絡</dt><dd>{culturalText(item)}</dd></div>
              </dl>
              <PreviewSummary item={item} />
              <AssessmentHistory item={item} />
              <SpmsqAssessmentActions canManage={canManage} item={item} snapshot={snapshot} />
            </article>;
          })}
        </div>
      </> : <div className="panel__body">
        <section className="empty-card core-care-state">
          <Search aria-hidden="true" />
          <h2>沒有符合條件的指派個案</h2>
          <p>請調整個案、候選試算狀態或教育脈絡；系統不會擴大到其他分支或未指派個案。</p>
          <Link className="button button--secondary" href="?">清除篩選</Link>
        </section>
      </div>}
    </section>
  </>;
}
