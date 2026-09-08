import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  FileCheck2,
  FileClock,
  Layers3,
  Search,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { StatusPill } from "@/components/ui/status-pill";
import type { PageCatalogEntry } from "@/lib/catalog";
import { filterCarePlanSnapshot, isPlanEffective } from "@/lib/care-plans/projection";
import type {
  AuthorizedCarePlanSummary,
  CarePlanSnapshot,
  CarePlanVersionStatus,
  ClientServicePlanSummary,
} from "@/lib/care-plans/types";

const statusLabels: Record<CarePlanVersionStatus, string> = {
  draft: "草稿",
  approved: "已核准待簽",
  signed: "已簽署",
  voided: "已作廢",
};

function formatDate(value: string | null) {
  if (!value) return "—";
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
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00+08:00`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function AuthorizedRows({ plans, serviceDate }: { plans: readonly AuthorizedCarePlanSummary[]; serviceDate: string }) {
  return plans.map((plan) => (
    <tr key={plan.id}>
      <td><span className="data-table__primary"><span className="avatar" aria-hidden="true">{plan.clientName.slice(0, 1)}</span><span>{plan.clientName}<small className="data-table__secondary">{plan.clientCode}</small></span></span></td>
      <td>v{plan.version}{plan.previousVersionId ? <small className="data-table__secondary">更正版</small> : null}</td>
      <td><StatusPill status={isPlanEffective(plan, serviceDate) ? "目前有效" : statusLabels[plan.status]} /></td>
      <td>{formatDate(plan.effectiveFrom)}–{formatDate(plan.effectiveTo)}</td>
      <td>{plan.sourceSystem}</td>
      <td>{plan.hasAuthorizationReference ? "已保存" : "—"}</td>
      <td>{plan.serviceLimitFieldCount} 項</td>
      <td><Link aria-label={`查看 ${plan.clientName} 的個案服務計畫`} className="icon-button" href={`/app/staff/service-management/client-service-plans?date=${serviceDate}&q=${encodeURIComponent(plan.clientCode)}`}><ArrowRight aria-hidden="true" /></Link></td>
    </tr>
  ));
}

function ServiceRows({ plans, serviceDate }: { plans: readonly ClientServicePlanSummary[]; serviceDate: string }) {
  return plans.map((plan) => (
    <tr key={plan.id}>
      <td><span className="data-table__primary"><span className="avatar" aria-hidden="true">{plan.clientName.slice(0, 1)}</span><span>{plan.clientName}<small className="data-table__secondary">{plan.clientCode}</small></span></span></td>
      <td>v{plan.version}{plan.previousVersionId ? <small className="data-table__secondary">更正版</small> : null}</td>
      <td><StatusPill status={isPlanEffective(plan, serviceDate) ? "目前有效" : statusLabels[plan.status]} /></td>
      <td>{formatDate(plan.effectiveFrom)}–{formatDate(plan.effectiveTo)}</td>
      <td>{plan.goalCount} 項</td>
      <td>{plan.plannedServiceCount} 項</td>
      <td>{formatDate(plan.reviewDueOn)}</td>
      <td><Link aria-label={`查看 ${plan.clientName} 的核定照顧計畫`} className="icon-button" href={`/app/staff/service-management/approved-care-plans?as_of=${serviceDate}&client=${plan.clientId}`}><ArrowRight aria-hidden="true" /></Link></td>
    </tr>
  ));
}

export function CarePlanWorkspace({
  page,
  snapshot,
  serviceDate,
  query,
  status,
  loadError = false,
}: {
  page: PageCatalogEntry;
  snapshot: CarePlanSnapshot | null;
  serviceDate: string;
  query: string;
  status: "all" | CarePlanVersionStatus;
  loadError?: boolean;
}) {
  const authorized = page.number === 55;
  if (loadError || !snapshot) {
    return (
      <section className="empty-card core-care-state" role="alert">
        <span className="empty-card__icon empty-card__icon--warning"><CircleAlert aria-hidden="true" /></span>
        <h1>照顧計畫快照暫時無法載入</h1>
        <p>系統不會顯示過期快取或展示版本代替正式計畫。</p>
        <a className="button button--secondary" href={`?date=${serviceDate}`}>重新載入</a>
      </section>
    );
  }

  const plans = filterCarePlanSnapshot(snapshot, {
    kind: authorized ? "authorized" : "service",
    query,
    status,
  });
  const allPlans = authorized ? snapshot.authorizedPlans : snapshot.servicePlans;
  const effective = allPlans.filter((plan) => isPlanEffective(plan, serviceDate)).length;
  const drafts = allPlans.filter((plan) => plan.status === "draft").length;
  const expiringThrough = addDays(serviceDate, 30);
  const expiring = allPlans.filter(
    (plan) =>
      plan.status === "signed" &&
      plan.effectiveTo >= serviceDate &&
      plan.effectiveTo <= expiringThrough,
  ).length;

  return (
    <>
      <nav aria-label="所在位置" className="context-bar"><span>工作台</span><ChevronRight aria-hidden="true" /><span>服務管理</span><ChevronRight aria-hidden="true" /><span aria-current="page" className="context-bar__crumb">{page.title}</span></nav>
      <header className="page-heading core-care-heading">
        <div><p className="eyebrow">不可變版本鏈・頁面 {page.number}</p><h1>{page.title}</h1><p className="page-heading__description">{authorized ? "中央或主管機關來源的核定版本，與機構每日執行資料分開保存。" : "每個服務計畫明確連到一份已簽署且期間涵蓋的核定照顧計畫。"}</p></div>
        <form className="core-date-filter" method="get"><input name="q" type="hidden" value={query} /><input name="status" type="hidden" value={status} /><label className="field"><span>判定日期</span><input defaultValue={serviceDate} name="date" type="date" /></label><button className="button button--secondary" type="submit"><CalendarDays aria-hidden="true" />套用日期</button></form>
      </header>

      <div className="callout core-care-callout"><ShieldCheck aria-hidden="true" /><span>版本一經建立即不可更新或刪除；更正必須建立下一版並連回原版。只有「已簽署」且涵蓋判定日期的版本會標示為目前有效。</span></div>

      <section aria-label="照顧計畫摘要" className="metric-grid">
        {[
          ["符合版本", plans.length, "版", "目前搜尋與狀態條件"],
          ["目前有效", effective, "版", `判定日 ${serviceDate}`],
          ["草稿", drafts, "版", "不計入有效計畫"],
          ["30 日內到期", expiring, "版", "依台北服務日計算"],
        ].map(([label, value, unit, foot], index) => <article className="metric-card" key={String(label)}><div className="metric-card__top"><span>{label}</span><span className="metric-card__icon">{index === 0 ? <Layers3 aria-hidden="true" /> : index === 1 ? <FileCheck2 aria-hidden="true" /> : index === 2 ? <FileClock aria-hidden="true" /> : <CalendarDays aria-hidden="true" />}</span></div><div className="metric-card__value"><strong>{value}</strong><span>{unit}</span></div><p className="metric-card__foot">{foot}</p></article>)}
      </section>

      <section className="panel">
        <div className="panel__header"><div className="panel__title"><h2>{authorized ? "核定版本清單" : "服務計畫版本清單"}</h2><p>{plans.length} 個可存取版本・快照 {formatTimestamp(snapshot.generatedAt)}</p></div><button className="button button--primary" disabled title="草稿交易、核准及 AAL2 簽署流程尚未接線" type="button">{page.primaryActions[0]}</button></div>
        <form className="filter-bar" method="get"><input name="date" type="hidden" value={serviceDate} /><label className="filter-search"><Search aria-hidden="true" /><span className="sr-only">搜尋個案代碼或姓名</span><input defaultValue={query} name="q" placeholder="搜尋個案代碼或姓名…" type="search" /></label><label className="field field--compact"><span>版本狀態</span><select defaultValue={status} name="status"><option value="all">全部狀態</option><option value="draft">草稿</option><option value="approved">已核准待簽</option><option value="signed">已簽署</option><option value="voided">已作廢</option></select></label><button className="button button--secondary" type="submit">套用篩選</button></form>
        {plans.length ? <>
          <div className="table-wrap core-care-table"><table className="data-table"><thead><tr>{(authorized ? ["個案", "版本", "狀態", "生效期間", "來源", "核定依據", "限制欄位"] : ["個案", "版本", "狀態", "生效期間", "目標", "計畫服務", "檢討日"]).map((heading) => <th key={heading} scope="col">{heading}</th>)}<th scope="col"><span className="sr-only">動作</span></th></tr></thead><tbody>{authorized ? <AuthorizedRows plans={plans as readonly AuthorizedCarePlanSummary[]} serviceDate={serviceDate} /> : <ServiceRows plans={plans as readonly ClientServicePlanSummary[]} serviceDate={serviceDate} />}</tbody></table></div>
          <div className="mobile-records core-care-mobile">{plans.map((plan) => <article className="record-card" key={plan.id}><div className="record-card__top"><div><h3>{plan.clientName}</h3><span className="data-table__secondary">{plan.clientCode}・v{plan.version}</span></div><StatusPill status={isPlanEffective(plan, serviceDate) ? "目前有效" : statusLabels[plan.status]} /></div><dl className="core-care-card-grid"><div><dt>生效日</dt><dd>{formatDate(plan.effectiveFrom)}</dd></div><div><dt>到期日</dt><dd>{formatDate(plan.effectiveTo)}</dd></div><div><dt>資料來源</dt><dd>{plan.sourceSystem}</dd></div><div><dt>版本鏈</dt><dd>{plan.previousVersionId ? "更正版" : "第 1 版"}</dd></div></dl><Link className="record-card__action" href={authorized ? `/app/staff/service-management/client-service-plans?date=${serviceDate}&q=${encodeURIComponent(plan.clientCode)}` : `/app/staff/service-management/approved-care-plans?as_of=${serviceDate}&client=${plan.clientId}`}>{authorized ? "查看個案服務計畫" : "查看核定照顧計畫"}<ArrowRight aria-hidden="true" /></Link></article>)}</div>
        </> : <div className="panel__body"><section className="empty-card core-care-state"><Search aria-hidden="true" /><h2>沒有符合條件的版本</h2><p>調整搜尋、狀態或判定日期；系統不會改查其他分支。</p><Link className="button button--secondary" href={`?date=${serviceDate}`}>清除篩選</Link></section></div>}
      </section>
    </>
  );
}
