import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Link2,
  Search,
  ShieldCheck,
} from "lucide-react";

import { StatusPill } from "@/components/ui/status-pill";
import { ServiceUsageComposer } from "@/components/service-management/service-usage-composer";
import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  ServiceEventStatus,
  ServiceUsageSnapshot,
} from "@/lib/service-management/types";

const statusLabels: Record<ServiceEventStatus, string> = {
  planned: "已排定",
  in_progress: "執行中",
  completed: "已完成",
  cancelled: "已取消",
  voided: "已作廢",
};

function formatTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

export function ServiceUsageWorkspace({
  page,
  snapshot,
  serviceDate,
  query,
  status,
  canComplete,
  hasRecentAal2,
  loadError = false,
}: {
  page: PageCatalogEntry;
  snapshot: ServiceUsageSnapshot | null;
  serviceDate: string;
  query: string;
  status: "all" | ServiceEventStatus;
  canComplete: boolean;
  hasRecentAal2: boolean;
  loadError?: boolean;
}) {
  if (loadError || !snapshot) {
    return <section className="empty-card core-care-state" role="alert"><span className="empty-card__icon empty-card__icon--warning"><CircleAlert aria-hidden="true" /></span><h1>服務使用紀錄暫時無法載入</h1><p>系統不會跨分支或改用展示資料補值。</p><a className="button button--secondary" href={`?date=${serviceDate}`}>重新載入</a></section>;
  }
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-TW");
  const items = snapshot.items.filter((item) => {
    const matchesQuery = !normalizedQuery || `${item.clientName} ${item.clientCode} ${item.serviceCode}`.toLocaleLowerCase("zh-TW").includes(normalizedQuery);
    return matchesQuery && (status === "all" || item.status === status);
  });
  const completed = snapshot.items.filter((item) => item.status === "completed").length;
  const signed = snapshot.items.filter((item) => item.signedAt).length;
  const unlinked = snapshot.items.filter((item) => !item.hasEffectivePlanLink && ["in_progress", "completed"].includes(item.status)).length;

  return <>
    <nav aria-label="所在位置" className="context-bar"><span>工作台</span><ChevronRight aria-hidden="true" /><span>服務管理</span><ChevronRight aria-hidden="true" /><span aria-current="page" className="context-bar__crumb">{page.title}</span></nav>
    <header className="page-heading core-care-heading"><div><p className="eyebrow">執行證據鏈・頁面 53</p><h1>{page.title}</h1><p className="page-heading__description">每筆實際服務分開保存執行時間、狀態、人員、簽署與當時有效的個案服務計畫連結。</p></div><form className="core-date-filter" method="get"><input name="q" type="hidden" value={query} /><input name="status" type="hidden" value={status} /><label className="field"><span>服務日期</span><input defaultValue={serviceDate} name="date" type="date" /></label><button className="button button--secondary" type="submit"><CalendarDays aria-hidden="true" />套用日期</button></form></header>
    <div className="callout core-care-callout"><ShieldCheck aria-hidden="true" /><span>完成服務必須有結束時間，執行中或完成的服務必須連結當日有效計畫；簽署與完成是兩個不同狀態。清單不傳送 evidence 內容或雜湊。</span></div>
    <section aria-label="服務使用摘要" className="metric-grid">{[
      ["符合紀錄", items.length, "筆", "目前日期與篩選"],
      ["已完成", completed, "筆", "完成不等於已簽署"],
      ["已簽署", signed, "筆", "簽署後不得直接刪除"],
      ["缺有效計畫", unlinked, "筆", "執行中／完成應為 0"],
    ].map(([label, value, unit, foot], index) => <article className="metric-card" key={String(label)}><div className="metric-card__top"><span>{label}</span><span className="metric-card__icon">{index === 0 ? <Search aria-hidden="true" /> : index === 1 ? <CheckCircle2 aria-hidden="true" /> : index === 2 ? <ShieldCheck aria-hidden="true" /> : <Link2 aria-hidden="true" />}</span></div><div className="metric-card__value"><strong>{value}</strong><span>{unit}</span></div><p className="metric-card__foot">{foot}</p></article>)}</section>
    <section className="panel"><div className="panel__header"><div className="panel__title"><h2>{serviceDate} 服務紀錄</h2><p>{items.length} 筆符合條件・快照 {formatTime(snapshot.generatedAt)}</p></div><ServiceUsageComposer canComplete={canComplete} clients={snapshot.clients} demo={snapshot.demo} hasRecentAal2={hasRecentAal2} serviceDate={serviceDate} /></div>
      <form className="filter-bar" method="get"><input name="date" type="hidden" value={serviceDate} /><label className="filter-search"><Search aria-hidden="true" /><span className="sr-only">搜尋個案或服務代碼</span><input defaultValue={query} name="q" placeholder="搜尋個案或服務代碼…" type="search" /></label><label className="field field--compact"><span>執行狀態</span><select defaultValue={status} name="status"><option value="all">全部狀態</option><option value="planned">已排定</option><option value="in_progress">執行中</option><option value="completed">已完成</option><option value="cancelled">已取消</option><option value="voided">已作廢</option></select></label><button className="button button--secondary" type="submit">套用篩選</button></form>
      {items.length ? <><div className="table-wrap core-care-table"><table className="data-table"><thead><tr><th scope="col">個案</th><th scope="col">服務代碼</th><th scope="col">開始</th><th scope="col">結束</th><th scope="col">時長</th><th scope="col">計畫連結</th><th scope="col">狀態</th><th scope="col">簽署</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><span className="data-table__primary"><span className="avatar" aria-hidden="true">{item.clientName.slice(0, 1)}</span><span>{item.clientName}<small className="data-table__secondary">{item.clientCode}</small></span></span></td><td>{item.serviceCode}</td><td>{formatTime(item.startedAt)}</td><td>{formatTime(item.endedAt)}</td><td>{item.durationMinutes == null ? "—" : `${item.durationMinutes} 分`}</td><td>{item.hasEffectivePlanLink ? "已連結" : "—"}</td><td><StatusPill status={statusLabels[item.status]} /></td><td>{item.signedAt ? "已簽署" : "未簽署"}</td></tr>)}</tbody></table></div><div className="mobile-records core-care-mobile">{items.map((item) => <article className="record-card" key={item.id}><div className="record-card__top"><div><h3>{item.clientName}</h3><span className="data-table__secondary">{item.clientCode}・{item.serviceCode}</span></div><StatusPill status={statusLabels[item.status]} /></div><dl className="core-care-card-grid"><div><dt>開始</dt><dd>{formatTime(item.startedAt)}</dd></div><div><dt>結束</dt><dd>{formatTime(item.endedAt)}</dd></div><div><dt>有效計畫</dt><dd>{item.hasEffectivePlanLink ? "已連結" : "尚無連結"}</dd></div><div><dt>簽署</dt><dd>{item.signedAt ? "已簽署" : "未簽署"}</dd></div></dl></article>)}</div></> : <div className="panel__body"><section className="empty-card core-care-state"><Clock3 aria-hidden="true" /><h2>沒有符合條件的服務紀錄</h2><p>調整日期或篩選；缺資料不會被視為零次服務。</p></section></div>}
    </section>
  </>;
}
