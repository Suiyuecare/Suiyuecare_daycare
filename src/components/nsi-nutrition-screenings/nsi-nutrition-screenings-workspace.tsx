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
  NSI_NUTRITION_OBSERVATION_LABELS,
  type NsiNutritionAnswer,
  type NsiNutritionScreeningFilters,
  type NsiNutritionScreeningListItem,
  type NsiNutritionScreeningSnapshot,
  type NsiNutritionVersionHistoryItem,
} from "@/lib/nsi-nutrition-screenings/types";

import { NsiNutritionScreeningActions } from "./nsi-nutrition-screening-actions";
import styles from "./nsi-nutrition-screenings.module.css";

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

function serviceStatusText(value: NsiNutritionScreeningListItem["serviceStatus"]) {
  return {
    active: "服務中",
    suspended: "暫停",
    transferred: "已轉出",
    closed: "已結案",
    deceased: "已死亡",
  }[value];
}

function answerText(answer: NsiNutritionAnswer) {
  if (answer.state === "answered") {
    return answer.value === "present" ? "已出現" : "未出現";
  }
  if (answer.state === "missing") return "缺值";
  return `不適用：${answer.reason}`;
}

function answerSummary(item: Pick<NsiNutritionScreeningListItem, "answers">) {
  const values = Object.values(item.answers ?? {});
  return {
    answered: values.filter((answer) => answer.state === "answered").length,
    missing: values.filter((answer) => answer.state === "missing").length,
    notApplicable: values.filter((answer) =>
      answer.state === "not_applicable").length,
  };
}

function StatusPill({ status }: { status: string }) {
  return <span className="status-pill status-pill--neutral">{status}</span>;
}

function PreviewSummary({ item }: { item: NsiNutritionScreeningListItem }) {
  if (!item.versionId) return <span>尚未建立人工觀察草稿</span>;
  if (item.previewStatus === "incomplete") {
    return <div className={styles.statuses}>
      <StatusPill status="重播不完整" />
      <small>任一缺值或不適用均不產生「已出現」項目數；缺值不會當作 0。</small>
    </div>;
  }
  return <div className={styles.statuses}>
    <StatusPill status="人工觀察可重播" />
    <strong>{item.previewObservedCount} 項已出現（非分數）</strong>
    <small>只重播逐欄狀態，不是正式 NSI 分數或風險分類。</small>
    <small>未建立、自動生效或通知任何營養追蹤與轉介。</small>
  </div>;
}

function VersionDetails({ version }: { version: NsiNutritionVersionHistoryItem }) {
  return <li>
    <strong>v{version.assessmentVersion}・{formatDate(version.assessedOn)}</strong>
    <span>{version.authorDisplayName}・不可變候選草稿</span>
    <ul className={styles.answerList}>
      {Object.entries(version.answers).map(([id, answer]) =>
        <li key={id}>
          <span>{NSI_NUTRITION_OBSERVATION_LABELS[id as keyof typeof NSI_NUTRITION_OBSERVATION_LABELS]}</span>
          <span>{answerText(answer)}</span>
        </li>)}
    </ul>
    <p><strong>人工觀察重播：</strong>{version.previewStatus === "incomplete"
      ? "不完整，不產生項目數"
      : `${version.previewObservedCount} 項已出現；非分數、無風險分類`}</p>
    <p><strong>候選欄位快照：</strong><code>{version.ruleVersionId}</code>・規則雜湊 {version.ruleSnapshotHash.slice(0, 12)}…</p>
    <p><strong>內容雜湊：</strong><code>{version.contentHash.slice(0, 12)}…</code></p>
  </li>;
}

function AssessmentHistory({ item }: { item: NsiNutritionScreeningListItem }) {
  if (!item.versionHistory.length) return null;
  return <details className={styles.history}>
    <summary>查看不可變歷程（{item.versionHistoryTotal} 版）</summary>
    {item.versionHistoryTruncated ? <p>只顯示最近 50 版；總數仍由完整集合計算。</p> : null}
    <ol>{item.versionHistory.map((version) =>
      <VersionDetails key={version.versionId} version={version} />)}</ol>
  </details>;
}

function NsiNutritionScreeningFreshness({ demo, staleAfter }: {
  demo: boolean;
  staleAfter: string;
}) {
  return <span>{demo ? "合成快照" : `資料過期時間 ${formatTimestamp(staleAfter)}`}</span>;
}

export function NsiNutritionScreeningsWorkspace({
  canManage,
  filters,
  loadError = false,
  page,
  snapshot,
}: {
  canManage: boolean;
  filters: NsiNutritionScreeningFilters;
  loadError?: boolean;
  page: PageCatalogEntry;
  snapshot: NsiNutritionScreeningSnapshot | null;
}) {
  if (loadError || !snapshot) {
    return <section className="empty-card core-care-state" role="alert">
      <span className="empty-card__icon empty-card__icon--warning">
        <CircleAlert aria-hidden="true" />
      </span>
      <h1>NSI 人工營養觀察暫時無法載入</h1>
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
          正式 NSI 題本尚未提供；本頁只保存六項中性人工營養觀察的四種明確狀態、不可變候選欄位快照與新版修訂。
        </p>
      </div>
    </header>

    <div className={`callout ${styles.candidate}`} role="note">
      <FlaskConical aria-hidden="true" />
      <span><strong>這不是正式 NSI：</strong><code>{snapshot.ruleVersionId}</code> 只保存人工未標準化候選欄位。正式題目文字、授權來源、權重、分數與風險分類均未配置。</span>
    </div>
    <div className={`callout ${styles.blocked}`} role="status">
      <Ban aria-hidden="true" />
      <span><strong>正式用途已封鎖：</strong>正式題本與規則雙人發布前，API 與資料庫拒絕正式簽署、分數、風險分類、診斷、照顧決策、營養追蹤與轉介。</span>
    </div>
    {snapshot.demo ? <div className={`callout ${styles.demo}`} role="status">
      <CircleAlert aria-hidden="true" />
      <span><strong>展示模式：</strong>個案、作者、觀察狀態與項目數皆為合成示例；正式按鈕維持唯讀。</span>
    </div> : <div className={`callout ${styles.security}`}>
      <ShieldCheck aria-hidden="true" />
      <span>只載入目前機構、分支與指派個案；草稿寫入需 clients.read、nsi_nutrition_screenings.read/manage 與最近 15 分鐘 AAL2，且在讀取內容前驗證。</span>
    </div>}
    <div className={`callout ${styles.offline}`} role="status">
      <ClipboardCheck aria-hidden="true" />
      <span><strong>尚未設定：</strong>正式題本、授權來源、權重、簽署、分數／風險、診斷、照顧決策、營養追蹤／轉介、附件、匯出、離線同步與通知均 fail closed。</span>
    </div>
    {!snapshot.demo && !canManage ? <div className="callout" role="status">
      <ShieldCheck aria-hidden="true" />
      <span>目前只有查看權限；新增、修訂與任何正式操作都會由 API 與資料庫拒絕。</span>
    </div> : null}

    <section aria-label="人工營養觀察草稿摘要" className="metric-grid">
      {[
        ["人工觀察可重播", snapshot.metrics.candidateComplete, "份", "項目數不是正式分數", <CheckCircle2 aria-hidden="true" key="complete" />],
        ["重播不完整", snapshot.metrics.incomplete, "份", "缺值／不適用不當作 0", <FileQuestion aria-hidden="true" key="incomplete" />],
        ["尚未建立", snapshot.metrics.notAssessed, "人", "每位指派個案只計一次", <FileQuestion aria-hidden="true" key="missing" />],
        ["人工觀察草稿", snapshot.metrics.drafts, "份", "正式簽署一律封鎖", <ClipboardCheck aria-hidden="true" key="draft" />],
      ].map(([label, value, unit, foot, icon]) => <article className="metric-card" key={String(label)}>
        <div className="metric-card__top"><span>{label}</span><span className="metric-card__icon">{icon}</span></div>
        <div className="metric-card__value"><strong>{value}</strong><span>{unit}</span></div>
        <p className="metric-card__foot">{foot}</p>
      </article>)}
    </section>

    <section className="panel">
      <div className="panel__header"><div className="panel__title">
        <h2>個案人工營養觀察草稿清單</h2>
        <p>{snapshot.matchingTotal} 位符合條件・快照 {formatTimestamp(snapshot.generatedAt)}・<NsiNutritionScreeningFreshness demo={snapshot.demo} staleAfter={snapshot.staleAfter} /></p>
      </div></div>
      <form className={`filter-bar ${styles.filters}`} method="get">
        <label className="field field--compact"><span>個案</span>
          <select defaultValue={filters.clientId ?? ""} name="client">
            <option value="">全部指派個案</option>
            {snapshot.clientOptions.map((client) => <option key={client.clientId} value={client.clientId}>{client.displayName}</option>)}
          </select>
        </label>
        <label className="field field--compact"><span>人工觀察重播狀態</span>
          <select defaultValue={filters.previewStatus} name="preview">
            <option value="all">全部</option>
            <option value="candidate_complete">人工觀察可重播</option>
            <option value="incomplete">不完整</option>
            <option value="not_assessed">尚未建立</option>
          </select>
        </label>
        <label className="field field--compact"><span>答案狀態</span>
          <select defaultValue={filters.answerState} name="answers">
            <option value="all">全部</option>
            <option value="all_answered">六項觀察皆已回答</option>
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
        <div aria-label="人工營養觀察草稿清單，可左右捲動" className={`table-wrap ${styles.table}`} role="region" tabIndex={0}>
          <table className="data-table"><thead><tr>{[
            "個案／服務狀態", "最近人工觀察草稿", "答案完整度",
            "人工觀察重播（非正式）", "操作",
          ].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
          <tbody>{snapshot.items.map((item) => {
            const counts = answerSummary(item);
            return <tr key={item.clientId}>
              <td><span className="data-table__primary"><span className="avatar" aria-hidden="true">{item.clientDisplayName.slice(0, 1)}</span><span>{item.clientDisplayName}<small className="data-table__secondary">{serviceStatusText(item.serviceStatus)}</small></span></span></td>
              <td><div className={styles.statuses}><StatusPill status={item.versionId ? "人工觀察草稿" : "尚未建立"} /><span>{formatDate(item.assessedOn)}</span>{item.authorDisplayName ? <small>{item.authorDisplayName}・v{item.assessmentVersion}</small> : null}<AssessmentHistory item={item} /></div></td>
              <td><div className={styles.statuses}><span>已答 {counts.answered}／6</span><small>缺值 {counts.missing}・不適用 {counts.notApplicable}</small></div></td>
              <td><PreviewSummary item={item} /></td>
              <td><NsiNutritionScreeningActions canManage={canManage} item={item} snapshot={snapshot} /></td>
            </tr>;
          })}</tbody></table>
        </div>
        <div className="mobile-records core-care-mobile">
          {snapshot.items.map((item) => {
            const counts = answerSummary(item);
            return <article className={`record-card ${styles.card}`} key={item.clientId}>
              <div className="record-card__top"><div><h3>{item.clientDisplayName}</h3><span className="data-table__secondary">{serviceStatusText(item.serviceStatus)}</span></div><StatusPill status={item.versionId ? "人工觀察草稿" : "尚未建立"} /></div>
              <dl><div><dt>觀察日</dt><dd>{formatDate(item.assessedOn)}</dd></div><div><dt>作者</dt><dd>{item.authorDisplayName ?? "尚無"}</dd></div><div className={styles.cardWide}><dt>答案完整度</dt><dd>已答 {counts.answered}／6・缺值 {counts.missing}・不適用 {counts.notApplicable}</dd></div></dl>
              <PreviewSummary item={item} /><AssessmentHistory item={item} />
              <NsiNutritionScreeningActions canManage={canManage} item={item} snapshot={snapshot} />
            </article>;
          })}
        </div>
      </> : <div className="panel__body"><section className="empty-card core-care-state"><Search aria-hidden="true" /><h2>沒有符合條件的指派個案</h2><p>請調整個案、重播或答案狀態；系統不會擴大到其他分支或未指派個案。</p><Link className="button button--secondary" href="?">清除篩選</Link></section></div>}
    </section>
  </>;
}
