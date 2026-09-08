import { AlertTriangle, CalendarClock, Clock3, FileWarning, ShieldCheck } from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import { SnapshotFreshness } from "@/components/ui/snapshot-freshness";
import type { ClientServicePlan, ClientServicePlanFilters,
  ClientServicePlanSnapshot, ClientServicePlanVersion } from
  "@/lib/client-service-plan-workflow/types";

import { ClientServicePlanActions, CreateClientServicePlan } from "./client-service-plan-actions";
import styles from "./client-service-plans.module.css";

const STATUS = { draft: "草稿", approved: "已核准", signed: "已簽署", voided: "已作廢" } as const;
const SOURCE = { current: "核定來源有效", outdated: "核定來源已被取代", voided: "核定來源已作廢",
  period_mismatch: "核定期間不涵蓋" } as const;

function taipei(value: string) {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", year: "numeric",
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    hour12: false }).format(new Date(value));
}

function differences(previous: ClientServicePlanVersion | undefined, current: ClientServicePlanVersion) {
  if (!previous) return ["建立版本鏈"];
  const changed = [
    previous.status !== current.status && "狀態",
    previous.authorizedCarePlanId !== current.authorizedCarePlanId && "核定來源",
    previous.effectiveFrom !== current.effectiveFrom || previous.effectiveTo !== current.effectiveTo ? "生效期間" : false,
    previous.reviewDueOn !== current.reviewDueOn && "檢討日",
    previous.responsibleUserId !== current.responsibleUserId && "主要負責人",
    JSON.stringify(previous.goals) !== JSON.stringify(current.goals) && "目標",
    JSON.stringify(previous.plannedServices) !== JSON.stringify(current.plannedServices) && "措施／頻率／負責人",
    previous.contentMappingStatus !== current.contentMappingStatus && "資料映射狀態",
  ].filter((value): value is string => Boolean(value));
  return changed.length ? changed : ["內容凍結，僅新增治理證據"];
}

function PlanContent({ plan }: { plan: ClientServicePlanVersion }) {
  if (plan.contentMappingStatus === "needs_mapping") return <section className={styles.legacy}>
    <strong>舊格式內容待人工映射</strong><p>系統沒有捨棄或猜測轉換原資料；核准與簽署已關閉，請建立完整修訂草稿。</p>
    <details><summary>查看唯讀原始內容</summary><pre>{JSON.stringify(plan.unmappedContent, null, 2)}</pre></details>
  </section>;
  return <div className={styles.goals}>{plan.goals.map((goal) => <section className={styles.goal} key={goal.goalId}>
    <strong>{goal.itemOrder}. {goal.goal}</strong><p>預期成果：{goal.targetOutcome}</p>
    {plan.plannedServices.filter((measure) => measure.goalId === goal.goalId).map((measure) =>
      <p key={measure.measureId}>措施 {measure.itemOrder}：{measure.measure}・頻率：{measure.frequency}・
        負責：{measure.responsibleDisplayName}</p>)}</section>)}</div>;
}

function History({ plan }: { plan: ClientServicePlan }) {
  return <details className={styles.history}><summary>版本比較與簽署證據（{plan.historyTotal}）</summary>
    {plan.historyTruncated ? <p className={styles.truncated}>此處顯示最近 {plan.history.length} 版；完整版本仍保存於資料庫。</p> : null}
    <ol>{plan.history.map((item, index) => <li key={item.planId}><strong>v{item.version}・{STATUS[item.status]}</strong>
      <span>相較前版：{differences(plan.history[index - 1], item).join("、")}</span>
      <span>建立 {taipei(item.createdAt)}・{item.createdByDisplayName}・內容指紋 {item.payloadHash.slice(0, 12)}…</span>
      <span>核定來源 v{item.authorizedVersion}・{item.authorizedContentHash.slice(0, 12)}…</span>
      {item.approvedAt && item.approvedByDisplayName ? <span>核准：{item.approvedByDisplayName}・{taipei(item.approvedAt)}</span> : null}
      {item.signedAt && item.signedByDisplayName ? <span>簽署：{item.signedByDisplayName}・{taipei(item.signedAt)}・{item.signaturePurpose}</span> : null}
      <span>理由：{item.reason ?? "舊資料未保存工作流程理由"}</span></li>)}</ol></details>;
}

function PlanSummary({ plan }: { plan: ClientServicePlan }) {
  return <><div className={styles.secondary}><span className={`${styles.pill} ${styles[`pill_${plan.status}`]}`}>
    {STATUS[plan.status]}</span><span className={styles.pill}>{SOURCE[plan.authorizationStatus]}</span>
    <span className={styles.pill}>{plan.streamOperationalStatus === "signed_current" ?
      `可供服務執行追溯（已發布 v${plan.publishedVersion}）` : "不可作為當日執行版本"}</span></div>
    {plan.authorizationStatus !== "current" ? <aside className={styles.sourceWarning}><AlertTriangle aria-hidden="true" />
      <p><strong>{SOURCE[plan.authorizationStatus]}</strong></p><p>不可再核准或簽署；可改綁當前核定建立修訂草稿，或以近期 AAL2 安全作廢。</p></aside> : null}
    <dl><div><dt>期間／檢討</dt><dd>{plan.effectiveFrom}～{plan.effectiveTo}・檢討 {plan.reviewDueOn}</dd></div>
      <div><dt>主要負責人</dt><dd>{plan.responsibleDisplayName ?? "任用資料已失效"}</dd></div>
      <div><dt>精確核定版本</dt><dd>v{plan.authorizedVersion}・{plan.authorizedSourceSystem}・{plan.authorizedContentHash.slice(0, 12)}…</dd></div></dl>
    <PlanContent plan={plan} /><History plan={plan} /></>;
}

export function ClientServicePlanWorkspace({ page, snapshot, filters, loadError,
  canManage, canApprove, canSign, hasRecentAal2 }: { page: PageCatalogEntry;
  snapshot: ClientServicePlanSnapshot | null; filters: ClientServicePlanFilters;
  loadError: boolean; canManage: boolean; canApprove: boolean; canSign: boolean;
  hasRecentAal2: boolean }) {
  if (loadError || !snapshot) return <div className="workspace-page"><section className="empty-card core-care-state">
    <FileWarning aria-hidden="true" /><h1>{page.title}</h1><p>篩選無效，或正式個案服務計畫快照暫時無法取得。</p>
    <Link className="button button--secondary" href="?">清除篩選並重試</Link></section></div>;
  const basePath = `/app/${page.slug}`;
  const metrics = [{ label: "符合計畫", value: snapshot.metrics.planTotal },
    { label: "草稿", value: snapshot.metrics.draftTotal }, { label: "已核准", value: snapshot.metrics.approvedTotal },
    { label: "已簽署", value: snapshot.metrics.signedTotal }, { label: "已作廢", value: snapshot.metrics.voidedTotal },
    { label: "到期檢討", value: snapshot.metrics.reviewDueTotal }, { label: "待映射", value: snapshot.metrics.needsMappingTotal },
    { label: "核定已變更", value: snapshot.metrics.outdatedAuthorizationTotal },
    { label: "可追溯執行", value: snapshot.metrics.executableTotal }];
  return <div className="workspace-page"><header className="page-heading core-care-heading"><div>
    <p className="eyebrow">服務管理・Page 52</p><h1>{page.title}</h1><p className="page-heading__description">{page.description}
      每次建立、修訂、核准、簽署與作廢都新增不可變版本，並精確鎖定核定來源。</p></div>
    <div className={`page-heading__actions ${styles.headerMeta}`}><span><ShieldCheck aria-hidden="true" /> 分支＋指派個案隔離</span>
      <span><Clock3 aria-hidden="true" /> 更新 {taipei(snapshot.generatedAt)}</span></div></header>
    <section aria-label="個案服務計畫法規邊界" className={styles.boundary}><AlertTriangle aria-hidden="true" /><div>
      <strong>申報規則尚未配置，已強制阻擋申報資格</strong><p>本頁保存機構服務目標、措施、頻率、負責人及版本證據；不虛構官方服務代碼、費率或專業資格映射。</p>
      <p className={styles.limitation}>「可供服務執行追溯」不等於「可申報」；目前所有 Page52 新流程版本皆為 blocked_not_configured。</p></div></section>
    {snapshot.demo ? <p className="demo-banner">目前為合成展示資料；正式寫入操作均關閉。</p> : null}
    <SnapshotFreshness expiresAt={snapshot.staleAfter} demo={snapshot.demo} />
    <CreateClientServicePlan snapshot={snapshot} canManage={canManage} />
    <section aria-label="個案服務計畫統計" className={`metric-grid ${styles.metrics}`}>{metrics.map((item) =>
      <article className="metric-card" key={item.label}><div className="metric-card__top"><span>{item.label}</span></div>
        <div className="metric-card__value"><strong>{item.value}</strong><span>條</span></div>
        <p className="metric-card__foot">完整符合集合</p></article>)}</section>
    <form action={basePath} className={styles.filters} method="get"><label><span>個案</span><select defaultValue={filters.clientId ?? ""} name="client">
      <option value="">全部授權個案</option>{snapshot.clients.map((item) => <option key={item.clientId} value={item.clientId}>{item.displayName}</option>)}</select></label>
      <label><span>狀態</span><select defaultValue={filters.status} name="status"><option value="all">全部</option>
        <option value="draft">草稿</option><option value="approved">已核准</option><option value="signed">已簽署</option><option value="voided">已作廢</option>
        <option value="needs_mapping">舊格式待映射</option><option value="authorization_outdated">核定來源已變更</option><option value="review_due">到期檢討</option></select></label>
      <label><span>檢視日期</span><input defaultValue={filters.asOf} name="as_of" required type="date" /></label>
      <label><span>個案、代碼或計畫鍵</span><input defaultValue={filters.query ?? ""} maxLength={120} name="q" type="search" /></label>
      <div className={styles.filterActions}><button className="button button--secondary" type="submit">套用篩選</button>
        <Link className="button button--quiet" href={basePath}>清除</Link></div></form>
    <section aria-labelledby="client-service-plan-list" className={styles.records}><div className={styles.sectionHeading}><div><p className="eyebrow">同一不可變快照</p>
      <h2 id="client-service-plan-list">個案服務計畫</h2></div><p>{snapshot.plans.length} / {snapshot.matchingTotal} 條版本鏈</p></div>
      {snapshot.plansTruncated || snapshot.historyTruncated ? <p className={styles.truncated} role="status">清單最多 100 條版本鏈、每條最近 5 版；統計仍使用完整符合集合。</p> : null}
      {!snapshot.plans.length ? <section className={`empty-card ${styles.empty}`}><CalendarClock aria-hidden="true" /><h3>沒有符合條件的計畫</h3>
        <p>請調整個案、狀態、檢視日期或查詢；系統不會擴大至其他分支或未指派個案。</p></section> : <>
        <div aria-label="可水平捲動的個案服務計畫表格" className={styles.tableWrap} role="region" tabIndex={0}><table className={styles.table}><thead><tr>
          <th>個案／期間</th><th>狀態／核定來源</th><th>目標與措施</th><th>版本證據</th><th>操作</th></tr></thead><tbody>{snapshot.plans.map((plan) => <tr key={plan.planKey}>
          <td><strong>{plan.clientDisplayName}</strong><small>{plan.clientCode}</small><small>{plan.effectiveFrom}～{plan.effectiveTo}</small></td>
          <td><span className={`${styles.pill} ${styles[`pill_${plan.status}`]}`}>{STATUS[plan.status]}</span><small>{SOURCE[plan.authorizationStatus]}</small></td>
          <td><PlanContent plan={plan} /></td><td>v{plan.version}<small>{plan.payloadHash.slice(0, 12)}…</small><History plan={plan} /></td>
          <td><ClientServicePlanActions plan={plan} snapshot={snapshot} canManage={canManage}
            canApprove={canApprove} canSign={canSign} hasRecentAal2={hasRecentAal2} /></td></tr>)}</tbody></table></div>
        <div className={styles.mobileCards}>{snapshot.plans.map((plan) => <article key={plan.planKey}><div className={styles.cardHeading}><div>
          <h3>{plan.clientDisplayName}</h3><small>{plan.clientCode}・v{plan.version}</small></div><span className={`${styles.pill} ${styles[`pill_${plan.status}`]}`}>{STATUS[plan.status]}</span></div>
          <PlanSummary plan={plan} /><ClientServicePlanActions plan={plan} snapshot={snapshot}
            canManage={canManage} canApprove={canApprove} canSign={canSign}
            hasRecentAal2={hasRecentAal2} /></article>)}</div></>}
    </section></div>;
}
