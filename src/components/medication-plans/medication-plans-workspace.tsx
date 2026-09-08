import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  FileClock,
  History,
  LockKeyhole,
  Pill,
  Search,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import {
  MEDICATION_PLAN_LIFECYCLE_STATES,
  type MedicationPlanLifecycleFilter,
  type MedicationPlanRecord,
  type MedicationPlanSnapshot,
} from "@/lib/medication-plans/types";
import { medicationPlanActionEligibility } from "@/lib/medication-plans/projection";

import { MedicationPlanAction } from "./medication-plan-action";
import styles from "./medication-plans.module.css";

const lifecycleLabels: Record<MedicationPlanRecord["lifecycleState"], string> = {
  draft: "草稿",
  submitted: "待獨立核准",
  scheduled: "已核准・尚未生效",
  active: "生效中",
  expired: "已到期",
  stopped: "已停藥",
  replaced: "已換版",
};

function statusClass(state: MedicationPlanRecord["lifecycleState"]) {
  if (state === "active") return "status-pill--success";
  if (state === "submitted" || state === "scheduled") return "status-pill--warning";
  if (state === "draft") return "status-pill--info";
  if (state === "stopped") return "status-pill--danger";
  return "";
}

function formatDateTime(value: string | null) {
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

function period(plan: MedicationPlanRecord) {
  return `${formatDateTime(plan.effectiveFrom)} ～ ${plan.effectiveTo ? formatDateTime(plan.effectiveTo) : "持續有效"}`;
}

function Lifecycle({ plan }: { plan: MedicationPlanRecord }) {
  return (
    <span className={styles.lifecycle}>
      <span className={`status-pill ${statusClass(plan.lifecycleState)}`}>
        {lifecycleLabels[plan.lifecycleState]}
      </span>
      <small>流程：{plan.workflowState === "approved" ? "已核准" : plan.workflowState === "submitted" ? "已送審" : "草稿"}</small>
    </span>
  );
}

function Termination({ plan }: { plan: MedicationPlanRecord }) {
  if (!plan.terminationKind) return <span className="muted">—</span>;
  const future = !["stopped", "replaced"].includes(plan.lifecycleState);
  return (
    <span className={styles.termination}>
      <strong>
        {future ? "預定" : "已於"} {formatDateTime(plan.terminatedAt)}
        {plan.terminationKind === "replaced" ? "換版" : "停藥"}
      </strong>
      <small>{plan.terminationReason}</small>
    </span>
  );
}

function PlanActions({
  plan,
  snapshot,
  canManage,
  hasRecentAal2,
  instance,
  eligibility,
}: {
  plan: MedicationPlanRecord;
  snapshot: MedicationPlanSnapshot;
  canManage: boolean;
  hasRecentAal2: boolean;
  instance: string;
  eligibility: ReturnType<typeof medicationPlanActionEligibility>;
}) {
  const client = snapshot.selectedClient!;
  if (plan.lifecycleState === "draft") {
    return (
      <div className={styles.actionGroup}>
        <MedicationPlanAction canManage={canManage} client={client} demo={snapshot.demo} eligible={eligibility.latestVersion} generatedAt={snapshot.generatedAt} hasRecentAal2={hasRecentAal2} instance={instance} kind="submit" plan={plan} />
      </div>
    );
  }
  if (plan.lifecycleState === "submitted") {
    if (plan.submittedByCurrentActor) {
      return <span className={styles.lockedAction}><ShieldCheck aria-hidden="true" />需由另一名具權限人員核准</span>;
    }
    return (
      <div className={styles.actionGroup}>
        <MedicationPlanAction canManage={canManage} client={client} demo={snapshot.demo} eligible={eligibility.latestVersion} generatedAt={snapshot.generatedAt} hasRecentAal2={hasRecentAal2} instance={instance} kind="approve" plan={plan} />
      </div>
    );
  }
  if (
    plan.workflowState === "approved" &&
    ["active", "scheduled"].includes(plan.lifecycleState) &&
    !plan.terminationKind
  ) {
    if (eligibility.lockedByFutureCutover) {
      return <span className={styles.lockedAction}><CalendarClock aria-hidden="true" />預定換藥切換已鎖定建立新版與停藥</span>;
    }
    return (
      <div className={styles.actionGroup}>
        {eligibility.canRevise ? <MedicationPlanAction canManage={canManage} client={client} demo={snapshot.demo} generatedAt={snapshot.generatedAt} hasRecentAal2={hasRecentAal2} instance={`${instance}-revise`} kind="revise" plan={plan} /> : null}
        {eligibility.canStop ? <MedicationPlanAction canManage={canManage} client={client} demo={snapshot.demo} generatedAt={snapshot.generatedAt} hasRecentAal2={hasRecentAal2} instance={`${instance}-stop`} kind="stop" plan={plan} /> : null}
      </div>
    );
  }
  return <span className={styles.lockedAction}><LockKeyhole aria-hidden="true" />歷史版本鎖定</span>;
}

export function MedicationPlansWorkspace({
  page,
  snapshot,
  status,
  query,
  canManage,
  hasRecentAal2,
  loadError = false,
}: {
  page: PageCatalogEntry;
  snapshot: MedicationPlanSnapshot | null;
  status: MedicationPlanLifecycleFilter;
  query: string;
  canManage: boolean;
  hasRecentAal2: boolean;
  loadError?: boolean;
}) {
  if (loadError || !snapshot) {
    return (
      <section className="empty-card core-care-state" role="alert">
        <span className="empty-card__icon empty-card__icon--warning"><CircleAlert aria-hidden="true" /></span>
        <h1>用藥計畫暫時無法載入</h1>
        <p>系統不會改查其他機構、其他分支、未指派個案、直接資料表或展示資料來補值。</p>
        <Link className="button button--secondary" href="/app/staff/daily-care/medication-plans">重新載入</Link>
      </section>
    );
  }

  const normalizedQuery = query.trim().toLocaleLowerCase("zh-TW");
  const plans = snapshot.plans.filter((plan) => {
    if (status !== "all" && plan.lifecycleState !== status) return false;
    if (!normalizedQuery) return true;
    return `${plan.medicationName} ${plan.dose} ${plan.doseUnit} ${plan.route} ${plan.version}`
      .toLocaleLowerCase("zh-TW")
      .includes(normalizedQuery);
  });
  const byId = new Map(snapshot.plans.map((plan) => [plan.id, plan]));
  const hasFilters = status !== "all" || Boolean(query.trim());
  const updatedAt = formatDateTime(snapshot.generatedAt);

  return (
    <>
      <nav aria-label="所在位置" className="context-bar">
        <span>工作台</span><ChevronRight aria-hidden="true" /><span>日常照顧</span>
        <ChevronRight aria-hidden="true" />
        <span aria-current="page" className="context-bar__crumb">{page.title}</span>
      </nav>
      <header className="page-heading">
        <div>
          <p className="eyebrow">版本化用藥治理・頁面 8</p>
          <h1>{page.title}</h1>
          <p className="page-heading__description">
            以草稿、送審、第二人核准及不可變停藥／換藥事件管理計畫；所有時間均以 Asia/Taipei 顯示。
          </p>
        </div>
        <div className="page-heading__actions">
          {snapshot.selectedClient ? (
            <MedicationPlanAction canManage={canManage} client={snapshot.selectedClient} demo={snapshot.demo} generatedAt={snapshot.generatedAt} hasRecentAal2={hasRecentAal2} instance="header" kind="create" />
          ) : null}
        </div>
      </header>

      <div className={`callout ${styles.boundaryCallout}`}>
        <ShieldCheck aria-hidden="true" />
        <span>申請人與核准人必須不同；已送審或已核准版本不可改寫，修改只能建立新版。高風險是機構標記，本頁只管理紀錄與流程，不提供診斷或自動照顧決策。</span>
      </div>
      {snapshot.demo ? (
        <div className={`callout ${styles.demoCallout}`} role="status">
          <CircleAlert aria-hidden="true" />
          <span>目前為展示模式：姓名、藥物與狀態皆為合成資料；所有寫入按鈕已停用，API 也會拒絕且不持久化。</span>
        </div>
      ) : canManage && !hasRecentAal2 ? (
        <div className={`callout ${styles.reauthCallout}`} role="status">
          <ShieldCheck aria-hidden="true" />
          <span>獨立核准與停藥需要最近 15 分鐘內 AAL2；草稿與送審仍會由資料庫核對角色、分支、個案指派與精確版本。</span>
          <Link className="button button--secondary" href="/mfa?audience=staff">立即重新驗證</Link>
        </div>
      ) : null}

      <section aria-label="用藥計畫摘要" className={`metric-grid ${styles.metrics}`}>
        {[
          { label: "有效計畫", value: snapshot.metrics.active, foot: "目前時間生效中", Icon: CheckCircle2 },
          { label: "即將到期", value: snapshot.metrics.expiringSoon, foot: "30 日內到期", Icon: CalendarClock },
          { label: "近期異動", value: snapshot.metrics.recentChanges, foot: "近 7 日送審、核准或終止", Icon: History },
          { label: "待核准", value: snapshot.metrics.pendingApproval, foot: "需另一位人員獨立核准", Icon: FileClock },
        ].map(({ label, value, foot, Icon }) => (
          <article className="metric-card" key={label}>
            <div className="metric-card__top"><span>{label}</span><span className="metric-card__icon"><Icon aria-hidden="true" /></span></div>
            <div className="metric-card__value"><strong>{value}</strong><span>筆</span></div>
            <p className="metric-card__foot">{foot}</p>
          </article>
        ))}
      </section>

      <section className="panel">
        <div className="panel__header">
          <div className="panel__title">
            <h2>{snapshot.selectedClient ? `${snapshot.selectedClient.displayName} 的版本紀錄` : "目前沒有可查看個案"}</h2>
            <p>{plans.length} 筆符合條件・更新 {updatedAt}・Asia/Taipei</p>
          </div>
          <span className={`status-pill ${snapshot.demo ? "status-pill--warning" : "status-pill--success"}`}>
            {snapshot.demo ? "展示唯讀" : "正式受限資料"}
          </span>
        </div>
        <form className={`filter-bar ${styles.filters}`} method="get">
          <label className="field field--compact">
            <span>個案</span>
            <select defaultValue={snapshot.selectedClient?.id ?? ""} name="client">
              {snapshot.clients.length === 0 ? <option value="">沒有可查看個案</option> : null}
              {snapshot.clients.map((client) => <option key={client.id} value={client.id}>{client.displayName}（{client.code}）</option>)}
            </select>
          </label>
          <label className={`filter-search ${styles.searchField}`}>
            <Search aria-hidden="true" />
            <span className="sr-only">搜尋藥物、劑量、途徑或版本</span>
            <input defaultValue={query} maxLength={120} name="q" placeholder="搜尋藥物、劑量、途徑或版本" type="search" />
          </label>
          <label className="field field--compact">
            <span>生效狀態</span>
            <select defaultValue={status} name="status">
              <option value="all">全部狀態</option>
              {MEDICATION_PLAN_LIFECYCLE_STATES.map((value) => <option key={value} value={value}>{lifecycleLabels[value]}</option>)}
            </select>
          </label>
          <button className="button button--secondary" type="submit">套用篩選</button>
          {hasFilters ? <Link className="button button--quiet" href={`?client=${snapshot.selectedClient?.id ?? ""}`}>清除</Link> : null}
        </form>

        {plans.length ? (
          <>
            <div className={`table-wrap ${styles.tableWrap}`}>
              <table className={`data-table ${styles.table}`}>
                <thead><tr><th scope="col">藥物／用法</th><th scope="col">版本沿革</th><th scope="col">每日時點</th><th scope="col">生效期間</th><th scope="col">狀態</th><th scope="col">停藥／換藥</th><th scope="col">下一步</th></tr></thead>
                <tbody>{plans.map((plan) => {
                  const previous = plan.previousVersionId ? byId.get(plan.previousVersionId) : null;
                  const eligibility = medicationPlanActionEligibility(plan, snapshot.plans, snapshot.generatedAt);
                  return (
                    <tr key={plan.id}>
                      <td><span className={styles.medication}><strong>{plan.medicationName}</strong><small>{plan.dose} {plan.doseUnit}・{plan.route}</small>{plan.highRisk ? <span className={styles.highRisk}>高風險</span> : null}</span></td>
                      <td><span className={styles.lineage}><strong>第 {plan.version} 版・資料 v{plan.rowVersion}</strong><small>{previous ? `承接第 ${previous.version} 版` : "初版"}</small></span></td>
                      <td><span className={styles.scheduleTimes}>{plan.schedule.times.map((time) => <span key={time}>{time}</span>)}</span></td>
                      <td><span className={styles.period}><strong>{period(plan)}</strong><small>核准 {formatDateTime(plan.approvedAt)}</small></span></td>
                      <td><Lifecycle plan={plan} /></td>
                      <td><Termination plan={plan} /></td>
                      <td><PlanActions canManage={canManage} eligibility={eligibility} hasRecentAal2={hasRecentAal2} instance={`desktop-${plan.id}`} plan={plan} snapshot={snapshot} /></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
            <div className={styles.mobileCards}>
              {plans.map((plan) => {
                const previous = plan.previousVersionId ? byId.get(plan.previousVersionId) : null;
                const eligibility = medicationPlanActionEligibility(plan, snapshot.plans, snapshot.generatedAt);
                return (
                  <article className={styles.mobileCard} key={`${plan.id}-mobile`}>
                    <div className={styles.cardTop}>
                      <div><h3>{plan.medicationName}</h3><p>{plan.dose} {plan.doseUnit}・{plan.route}{plan.highRisk ? "・高風險" : ""}</p></div>
                      <Lifecycle plan={plan} />
                    </div>
                    <dl className={styles.cardGrid}>
                      <div><dt>版本沿革</dt><dd>第 {plan.version} 版・資料 v{plan.rowVersion}<small>{previous ? `承接第 ${previous.version} 版` : "初版"}</small></dd></div>
                      <div><dt>每日時點</dt><dd>{plan.schedule.times.join("、")}</dd></div>
                      <div className={styles.cardWide}><dt>生效期間</dt><dd>{period(plan)}</dd></div>
                      <div className={styles.cardWide}><dt>停藥／換藥</dt><dd><Termination plan={plan} /></dd></div>
                    </dl>
                    <div className={styles.mobileActions}><PlanActions canManage={canManage} eligibility={eligibility} hasRecentAal2={hasRecentAal2} instance={`mobile-${plan.id}`} plan={plan} snapshot={snapshot} /></div>
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <div className="empty-card core-care-state">
            <span className="empty-card__icon"><Pill aria-hidden="true" /></span>
            <h2>{hasFilters ? "沒有符合條件的用藥計畫" : "此個案尚無用藥計畫版本"}</h2>
            <p>{hasFilters ? "請清除部分篩選條件；系統不會查詢未指派個案補值。" : snapshot.selectedClient?.canCreatePlan ? "可從新增計畫建立第一版草稿。" : "個案須為已收案、服務中且尚未結案，才能建立計畫。"}</p>
            {hasFilters ? <Link className="button button--secondary" href={`?client=${snapshot.selectedClient?.id ?? ""}`}>清除篩選</Link> : null}
          </div>
        )}
      </section>
    </>
  );
}
