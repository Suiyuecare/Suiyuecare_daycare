import { AlertTriangle, ChevronRight, Database, FileClock, ShieldCheck } from "lucide-react";

import type { PageCatalogEntry } from "@/lib/catalog";
import { SnapshotFreshness } from "@/components/ui/snapshot-freshness";
import type {
  AuthorizedCarePlanFilters,
  AuthorizedCarePlanStream,
  AuthorizedCarePlanVersion,
  AuthorizedCarePlanViewSnapshot,
} from "@/lib/authorized-care-plan-view/types";

import styles from "./authorized-care-plan-view.module.css";

const changedFieldLabels: Record<AuthorizedCarePlanVersion["differencesFromPrevious"]["changedFields"][number], string> = {
  status: "狀態",
  effective_from: "生效起日",
  effective_to: "生效迄日",
  source_system: "來源系統",
  source_record_id: "來源紀錄",
  source_provenance: "來源追溯",
  authorized_on: "核定日期",
  authorization_reference: "核定參考",
  service_limits: "服務限制原始內容",
  plan_data: "核定照顧計畫原始內容",
  correction_reason: "更正理由",
  approved_at: "核准時間",
  signed_at: "簽署時間",
  content_hash: "內容雜湊",
};

function formatDate(value: string | null) {
  if (!value) return "未提供";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(`${value}T12:00:00+08:00`));
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

function statusText(value: AuthorizedCarePlanVersion["status"]) {
  return { draft: "草稿", approved: "已核准待簽", signed: "已簽署", voided: "已作廢" }[value];
}

function effectiveStateText(value: AuthorizedCarePlanStream["effectiveState"]) {
  return {
    current: "指定日期有效",
    future: "未來生效",
    expired: "已過期",
    voided: "無有效已簽版本／已作廢",
    not_published: "尚未發布",
  }[value];
}

function ContentEnvelope({
  label,
  value,
}: {
  label: string;
  value: AuthorizedCarePlanVersion["planData"];
}) {
  if (value.valueState === "missing") {
    return <section className={styles.contentBlock}>
      <h4>{label}</h4>
      <p className={styles.missing}>原始資料未提供；不以空白推定為 0 或不適用。</p>
    </section>;
  }
  return <section className={styles.contentBlock}>
    <h4>{label}</h4>
    <p className={styles.mappingWarning} role="status">
      未映射原始欄位，只以純文字呈現；尚未套用官方代碼、額度或公式。
    </p>
    <pre>{value.canonicalJson}</pre>
  </section>;
}

function Provenance({ version }: { version: AuthorizedCarePlanVersion }) {
  return <section className={styles.contentBlock}>
    <h4>來源追溯</h4>
    <dl className={styles.definitionList}>
      <div><dt>來源系統</dt><dd>{version.sourceSystem}</dd></div>
      <div><dt>來源紀錄</dt><dd>{version.sourceRecordId ?? "未提供"}</dd></div>
      <div><dt>來源狀態</dt><dd>{version.sourceProvenance.valueState === "recorded" ? "已記錄" : "未提供"}</dd></div>
    </dl>
    {version.sourceProvenance.valueState === "recorded"
      ? <pre>{version.sourceProvenance.canonicalJson}</pre>
      : <p className={styles.missing}>來源細節未提供。</p>}
  </section>;
}

function VersionDetails({ version }: { version: AuthorizedCarePlanVersion }) {
  return <div className={styles.versionDetails} data-version-id={version.versionId}>
    <dl className={styles.definitionList}>
      <div><dt>版本</dt><dd>v{version.version}・{statusText(version.status)}</dd></div>
      <div><dt>版本 ID</dt><dd><code>{version.versionId}</code></dd></div>
      <div><dt>生效期間</dt><dd>{formatDate(version.effectiveFrom)} 至 {formatDate(version.effectiveTo)}</dd></div>
      <div><dt>核定日期</dt><dd>{formatDate(version.authorizedOn)}</dd></div>
      <div><dt>核定參考</dt><dd>{version.authorizationReference ?? "未提供"}</dd></div>
      <div><dt>建立時間</dt><dd>{formatTimestamp(version.createdAt)}</dd></div>
      <div><dt>前版 ID</dt><dd>{version.previousVersionId ?? "第一版"}</dd></div>
      <div><dt>後版 ID</dt><dd>{version.nextVersionId ?? "目前鏈尾"}</dd></div>
    </dl>
    {version.correctionReason ? <p><strong>更正理由：</strong>{version.correctionReason}</p> : null}
    {version.differencesFromPrevious.changedFields.length > 0 ? <p>
      <strong>相較前版異動欄位：</strong>{version.differencesFromPrevious.changedFields.map(
        (field) => `${changedFieldLabels[field]}（${field}）`,
      ).join("、")}
    </p> : <p>第一版，無前版差異。</p>}
    <ContentEnvelope label="核定照顧計畫原始內容" value={version.planData} />
    <ContentEnvelope label="服務限制原始內容" value={version.serviceLimits} />
    <Provenance version={version} />
  </div>;
}

function PlanHistory({ plan }: { plan: AuthorizedCarePlanStream }) {
  return <details className={styles.history}>
    <summary>不可變版本歷程（{plan.historyCount} 筆）</summary>
    <ol>
      {plan.history.map((version) => <li key={version.versionId}>
        <details>
          <summary>
            v{version.version}・{statusText(version.status)}
            {version.isWorkflowHead ? "・流程鏈尾" : ""}
            {version.isPublishedHead ? "・發布鏈尾" : ""}
            {version.isCurrentPublished ? "・指定日期有效" : ""}
          </summary>
          <VersionDetails version={version} />
        </details>
      </li>)}
    </ol>
  </details>;
}

function PlanSummary({ plan }: { plan: AuthorizedCarePlanStream }) {
  return <div className={styles.planSummary} data-plan-key={plan.planKey}>
    <dl className={styles.definitionList}>
      <div><dt>指定日期狀態</dt><dd>{effectiveStateText(plan.effectiveState)}</dd></div>
      <div><dt>顯示版本 ID</dt><dd><code>{plan.displayVersionId}</code></dd></div>
      <div><dt>核定日期</dt><dd>{formatDate(plan.displayAuthorizedOn)}</dd></div>
      <div><dt>核定參考</dt><dd>{plan.displayAuthorizationReference ?? "未提供"}</dd></div>
      <div><dt>來源</dt><dd>{plan.displaySourceSystem}</dd></div>
      <div><dt>來源紀錄</dt><dd>{plan.displaySourceRecordId ?? "未提供"}</dd></div>
      <div><dt>生效期間</dt><dd>{formatDate(plan.displayEffectiveFrom)} 至 {formatDate(plan.displayEffectiveTo)}</dd></div>
      <div><dt>流程鏈尾</dt><dd>v{plan.workflowHead.version}・{statusText(plan.workflowHead.status)}</dd></div>
      <div><dt>發布鏈尾</dt><dd>{plan.publishedHead
        ? `v${plan.publishedHead.version}・${statusText(plan.publishedHead.status)}`
        : "尚無已簽／已作廢版本"}</dd></div>
    </dl>
    {plan.effectiveConflict ? <p className={styles.conflict} role="alert">
      同一個案在指定日期有多個有效計畫流，需人工查核；本頁不自動判定優先順序。
    </p> : null}
    {plan.displayNeedsMapping ? <p className={styles.mappingWarning} role="status">
      顯示版本含未映射原始欄位。
    </p> : null}
    <PlanHistory plan={plan} />
  </div>;
}

function Filters({
  filters,
  snapshot,
}: {
  filters: AuthorizedCarePlanFilters;
  snapshot: AuthorizedCarePlanViewSnapshot;
}) {
  return <form className={styles.filters} method="get">
    <label>指定日期<input defaultValue={filters.asOf} name="as_of" type="date" /></label>
    <label>個案<select defaultValue={filters.clientId ?? ""} name="client">
      <option value="">全部可見個案</option>
      {snapshot.clientOptions.map((option) => <option key={option.clientId} value={option.clientId}>
        {option.clientCode}・{option.displayName}
      </option>)}
    </select></label>
    <label>核定日起<input defaultValue={filters.authorizedFrom ?? ""} name="authorized_from" type="date" /></label>
    <label>核定日迄<input defaultValue={filters.authorizedTo ?? ""} name="authorized_to" type="date" /></label>
    <label>生效狀態<select defaultValue={filters.effectiveState} name="effective">
      <option value="all">全部</option>
      <option value="current">指定日期有效</option>
      <option value="future">未來生效</option>
      <option value="expired">已過期</option>
      <option value="voided">無有效已簽版本／已作廢</option>
      <option value="not_published">尚未發布</option>
    </select></label>
    <label>來源<select defaultValue={filters.sourceSystem ?? ""} name="source">
      <option value="">全部來源</option>
      {snapshot.sourceOptions.map((option) => <option key={option.sourceSystem} value={option.sourceSystem}>
        {option.sourceSystem}（{option.recordCount}）
      </option>)}
    </select></label>
    <input name="page_size" type="hidden" value={filters.pageSize} />
    <button className="button button--primary" type="submit">套用篩選</button>
    <a className="button button--secondary" href="?">清除</a>
  </form>;
}

export function AuthorizedCarePlanViewWorkspace({
  filters,
  loadError = false,
  page,
  snapshot,
}: {
  filters: AuthorizedCarePlanFilters;
  loadError?: boolean;
  page: PageCatalogEntry;
  snapshot: AuthorizedCarePlanViewSnapshot | null;
}) {
  if (loadError || !snapshot) {
    return <section className="empty-card core-care-state" role="alert">
      <span className="empty-card__icon empty-card__icon--warning"><AlertTriangle aria-hidden="true" /></span>
      <h1>核定照顧計畫暫時無法載入</h1>
      <p>正式快照採失敗即關閉；系統不會改用展示資料，也不會擴大機構、分支或個案指派範圍。</p>
      <a className="button button--secondary" href="?">重新載入</a>
    </section>;
  }

  return <>
    <nav aria-label="所在位置" className="context-bar">
      <span>工作台</span><ChevronRight aria-hidden="true" />
      <span>服務管理</span><ChevronRight aria-hidden="true" />
      <span aria-current="page" className="context-bar__crumb">{page.title}</span>
    </nav>
    <header className="page-heading core-care-heading">
      <div>
        <p className="eyebrow">唯讀中央資料檢視・頁面 {page.number}</p>
        <h1>{page.title}</h1>
        <p className="page-heading__description">
          依指定日期分開呈現流程鏈尾、發布鏈尾與真正有效版本，並保留完整不可變版本及來源差異。
        </p>
      </div>
    </header>

    {snapshot.demo ? <div className={`callout ${styles.demo}`} role="status">
      <Database aria-hidden="true" />
      <span><strong>展示模式：</strong>所有個案、核定編號與原始欄位均為合成資料。</span>
    </div> : <div className={`callout ${styles.security}`} role="status">
      <ShieldCheck aria-hidden="true" />
      <span>這一頁只讀取目前機構、分支與已指派個案，並由單一資料庫陳述式建立短效不可變快照；每次讀取均留稽核紀錄。</span>
    </div>}
    <div className={`callout ${styles.limitations}`} role="note">
      <AlertTriangle aria-hidden="true" />
      <span><strong>仍未配置：</strong>中央資料發布／核准流程、官方服務限制規則與欄位映射登錄。這些原始值不代表可申報資格，本頁不提供建立、編輯、簽署或申報操作。</span>
    </div>

    <SnapshotFreshness expiresAt={snapshot.expiresAt} demo={snapshot.demo} />
    <section aria-label="核定照顧計畫摘要" className="metric-grid">
      {[
        ["符合條件計畫流", snapshot.metrics.matchingStreamTotal, "筆"],
        ["指定日期有效", snapshot.metrics.currentTotal, "筆"],
        ["未映射內容", snapshot.metrics.needsMappingTotal, "筆"],
        ["有效期間衝突", snapshot.metrics.effectiveConflictTotal, "筆"],
      ].map(([label, value, unit]) => <article className="metric-card" key={String(label)}>
        <div className="metric-card__top"><span>{label}</span><FileClock aria-hidden="true" /></div>
        <div className="metric-card__value"><strong>{value}</strong><span>{unit}</span></div>
      </article>)}
    </section>

    <section className="panel">
      <div className="panel__header"><div className="panel__title">
        <h2>查詢條件</h2>
        <p>資料時間 {formatTimestamp(snapshot.generatedAt)}・快照 ID <code>{snapshot.snapshotId}</code></p>
      </div></div>
      <div className="panel__body"><Filters filters={filters} snapshot={snapshot} /></div>
    </section>

    <section className="panel">
      <div className="panel__header"><div className="panel__title">
        <h2>核定照顧計畫</h2>
        <p>本頁 {snapshot.metrics.pageStreamCount} 筆・版本 {snapshot.metrics.historyVersionCount} 筆</p>
      </div></div>
      {snapshot.plans.length === 0 ? <div className="panel__body">
        <p className={styles.empty}>目前條件沒有可顯示的核定照顧計畫。可調整日期或清除篩選。</p>
      </div> : <>
        <div className={styles.desktopTable}>
          <table>
            <thead><tr><th>個案</th><th>核定／來源</th><th>生效與版本</th><th>完整內容</th></tr></thead>
            <tbody>{snapshot.plans.map((plan) => <tr key={plan.planKey} data-plan-key={plan.planKey}>
              <td><strong>{plan.displayName}</strong><br /><span>{plan.clientCode}</span></td>
              <td>{formatDate(plan.displayAuthorizedOn)}<br />{plan.displaySourceSystem}</td>
              <td>{effectiveStateText(plan.effectiveState)}<br />v{plan.publishedHead?.version ?? plan.workflowHead.version}</td>
              <td><PlanSummary plan={plan} /></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className={styles.mobileCards}>
          {snapshot.plans.map((plan) => <article className={styles.card} key={plan.planKey} data-plan-key={plan.planKey}>
            <h3>{plan.displayName}</h3><p>{plan.clientCode}</p><PlanSummary plan={plan} />
          </article>)}
        </div>
      </>}
    </section>
  </>;
}
