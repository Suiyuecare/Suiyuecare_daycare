import {
  ArrowRight,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  History,
  PauseCircle,
  Search,
  ShieldCheck,
  UserRoundPlus,
} from "lucide-react";
import Link from "next/link";
import { IntakeEntryLink } from "@/components/client-intake/intake-entry-link";

import { ClientTransitionComposer } from "@/components/clients/client-transition-composer";
import { StatusPill } from "@/components/ui/status-pill";
import type { PageCatalogEntry } from "@/lib/catalog";
import { filterClientLifecycleTransitions } from "@/lib/clients/lifecycle";
import { allowedClientTransitionKinds } from "@/lib/clients/lifecycle-rules";
import type {
  ClientLifecycleSnapshot,
  ClientLifecycleStatusFilter,
  ClientServiceState,
  ClientTransitionKind,
} from "@/lib/clients/types";

const statusLabels: Record<ClientServiceState, string> = {
  pending_admission: "待收案",
  active: "在案",
  suspended: "暫停",
  transferred: "已轉出",
  closed: "已結案",
  deceased: "死亡結案",
};

const eventLabels: Record<ClientTransitionKind, string> = {
  admit: "收案",
  suspend: "暫停服務",
  resume: "恢復服務",
  transfer: "轉出",
  close: "結案",
  death: "死亡結案",
};

function formatDate(value: string) {
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

function pageHref(input: {
  clientId?: string | null;
  query: string;
  status: ClientLifecycleStatusFilter;
  eventKind: "all" | ClientTransitionKind;
  effectiveOn: string | null;
  page: number;
}) {
  const params = new URLSearchParams();
  if (input.clientId) params.set("client", input.clientId);
  if (input.query) params.set("q", input.query);
  if (input.status !== "all") params.set("status", input.status);
  if (input.eventKind !== "all") params.set("event", input.eventKind);
  if (input.effectiveOn) params.set("date", input.effectiveOn);
  if (input.page > 1) params.set("page", String(input.page));
  const query = params.toString();
  return query ? `?${query}` : "?";
}

export function ClientLifecycleWorkspace({
  canOpenIntake = false,
  page,
  snapshot,
  query,
  status,
  eventKind,
  effectiveOn,
  canManage,
  hasRecentAal2,
  canRoutineAdmit = false,
  loadError = false,
  selectedClientId = null,
}: {
  page: PageCatalogEntry;
  snapshot: ClientLifecycleSnapshot | null;
  query: string;
  status: ClientLifecycleStatusFilter;
  eventKind: "all" | ClientTransitionKind;
  effectiveOn: string | null;
  canManage: boolean;
  canOpenIntake?: boolean;
  hasRecentAal2: boolean;
  canRoutineAdmit?: boolean;
  loadError?: boolean;
  selectedClientId?: string | null;
}) {
  if (loadError || !snapshot) {
    return (
      <section className="empty-card core-care-state" role="alert">
        <span className="empty-card__icon empty-card__icon--warning"><CircleAlert aria-hidden="true" /></span>
        <h1>個案生命週期暫時無法載入</h1>
        <p>系統沒有擴大到其他分支，也沒有以展示歷程替代正式資料。</p>
        <a className="button button--secondary" href={selectedClientId ? `?client=${encodeURIComponent(selectedClientId)}` : "?"}>重新載入</a>
      </section>
    );
  }

  const transitions = filterClientLifecycleTransitions(snapshot, {
    clientId: selectedClientId,
    query,
    status,
    eventKind,
    effectiveOn,
  });
  const totalPages = Math.max(
    1,
    Math.ceil(snapshot.historyTotal / snapshot.historyPageSize),
  );
  const transitionableClients = snapshot.clients.filter(
    (client) => (!selectedClientId || client.id === selectedClientId) && allowedClientTransitionKinds(client).length > 0,
  );
  const selectedClient = selectedClientId ? snapshot.clients.find((client) => client.id === selectedClientId) : null;
  const clearHref = selectedClientId ? `?client=${encodeURIComponent(selectedClientId)}` : "?";
  const baseLink = {
    clientId: selectedClientId,
    query,
    status,
    eventKind,
    effectiveOn,
  };

  return (
    <>
      <nav aria-label="所在位置" className="context-bar"><span>工作台</span><ChevronRight aria-hidden="true" /><span>機構營運管理</span><ChevronRight aria-hidden="true" /><span aria-current="page" className="context-bar__crumb">{page.title}</span></nav>
      <header className="page-heading core-care-heading">
        <div><p className="eyebrow">不可變個案歷程・頁面 {page.number}</p><h1>{page.title}</h1><p className="page-heading__description">逐筆呈現收案、暫停、恢復、轉出、結案與死亡事件；列表不包含身分證、出生日期、健康資料、聯絡資料或建立者帳號 ID。</p></div>
        <div className="page-heading__actions"><IntakeEntryLink allowed={canOpenIntake} /><ClientTransitionComposer key={selectedClientId ?? "all"} canManage={canManage} canRoutineAdmit={canRoutineAdmit} clients={transitionableClients} demo={snapshot.demo} hasRecentAal2={hasRecentAal2} lockedClientId={selectedClientId} /></div>
      </header>

      {selectedClientId ? <section className="panel"><div className="panel__body">
        {selectedClient ? <><h2>目前處理：{selectedClient.displayName}（{selectedClient.clientCode}）</h2><p>服務狀態：{statusLabels[selectedClient.serviceState]}{selectedClient.admittedOn ? ` · 收案日 ${formatDate(selectedClient.admittedOn)}` : " · 尚無正式收案日"}</p>
          <p>確認評估、應備文件與開始服務日後，才建立收案異動。儲存不會自動建立出勤、給藥、派車或申報。</p>
          {canOpenIntake ? <Link className="button button--secondary" href={`/app/client-intake?client=${selectedClient.id}&step=weekly`}>回此個案的每週安排與文件</Link> : null}</> : <p role="alert">找不到所選個案或目前無權限。已停止帶入，不會改選其他個案；請回個案中心重新選擇。</p>}
      </div></section> : null}

      <div className="callout core-care-callout"><ShieldCheck aria-hidden="true" /><span>{snapshot.demo ? "目前為合成展示資料，異動功能保持唯讀。" : "正式收案可由已核准 Google 帳號依個案管理權限完成；暫停、恢復、轉出、結案與死亡仍需最近 15 分鐘雙因素驗證。每次異動都重新驗證分支、個案、合法狀態與版本，既有歷程不得修改或刪除。"}</span></div>

      {selectedClientId ? <p>分支整體摘要（以下五項不隨單一個案篩選）：</p> : null}
      <section aria-label="分支個案異動摘要（不隨個案篩選）" className="metric-grid">
        {[
          ["本月收案", snapshot.metrics.admittedThisMonth, "件", "依生效日計算", <UserRoundPlus aria-hidden="true" key="admit" />],
          ["待收案", snapshot.metrics.pendingAdmission, "人", "已建檔、尚未收案", <UserRoundPlus aria-hidden="true" key="pending" />],
          ["暫停服務", snapshot.metrics.suspended, "人", "目前權威狀態", <PauseCircle aria-hidden="true" key="suspend" />],
          ["本月終止", snapshot.metrics.endedThisMonth, "件", "轉出、結案或死亡", <CalendarClock aria-hidden="true" key="ended" />],
          ["待補交接", snapshot.metrics.pendingHandoff, "件", "終止事件必填", <History aria-hidden="true" key="handoff" />],
        ].map(([label, value, unit, foot, icon]) => (
          <article className="metric-card" key={String(label)}><div className="metric-card__top"><span>{label}</span><span className="metric-card__icon">{icon}</span></div><div className="metric-card__value"><strong>{value}</strong><span>{unit}</span></div><p className="metric-card__foot">{foot}</p></article>
        ))}
      </section>

      <section className="panel">
        <div className="panel__header"><div className="panel__title"><h2>{selectedClientId ? "此個案的異動歷程" : "不可變異動歷程"}</h2><p>共 {snapshot.historyTotal} 筆符合條件・快照 {formatTimestamp(snapshot.generatedAt)}</p></div></div>
        <form className="filter-bar" method="get">
          {selectedClientId ? <input type="hidden" name="client" value={selectedClientId} /> : null}
          <label className="filter-search"><Search aria-hidden="true" /><span className="sr-only">搜尋個案代碼或姓名</span><input defaultValue={query} name="q" placeholder="搜尋個案代碼或姓名…" type="search" /></label>
          <label className="field field--compact"><span>目前狀態</span><select defaultValue={status} name="status"><option value="all">全部狀態</option><option value="pending_admission">待收案</option><option value="active">在案</option><option value="suspended">暫停</option><option value="transferred">已轉出</option><option value="closed">已結案</option><option value="deceased">死亡結案</option></select></label>
          <label className="field field--compact"><span>異動類型</span><select defaultValue={eventKind} name="event"><option value="all">全部異動</option>{Object.entries(eventLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field field--compact"><span>生效日期</span><input defaultValue={effectiveOn ?? ""} name="date" type="date" /></label>
          <button className="button button--secondary" type="submit">套用篩選</button>
          <Link className="button button--quiet" href={clearHref}>清除篩選</Link>
        </form>
        {transitions.length ? (
          <>
            <div className="table-wrap lifecycle-table"><table className="data-table"><thead><tr>{["個案", "異動類型", "生效日期", "理由", "交接", "建立者", "狀態"].map((heading) => <th key={heading} scope="col">{heading}</th>)}<th aria-label="動作" scope="col" /></tr></thead><tbody>{transitions.map((transition) => <tr key={transition.id}><td><span className="data-table__primary"><span className="avatar" aria-hidden="true">{transition.clientName.slice(0, 1)}</span><span>{transition.clientName}<small className="data-table__secondary">{transition.clientCode}</small></span></span></td><td><StatusPill status={eventLabels[transition.eventKind]} /></td><td>{formatDate(transition.effectiveOn)}<small className="data-table__secondary">建立 {formatTimestamp(transition.createdAt)}</small></td><td className="lifecycle-copy">{transition.reason}</td><td className="lifecycle-copy">{transition.handoffNote ?? "不適用"}</td><td>{transition.actorLabel}</td><td><span className="lifecycle-state">{statusLabels[transition.fromServiceState]}<ArrowRight aria-hidden="true" />{statusLabels[transition.toServiceState]}</span><small className="data-table__secondary">v{transition.baseRowVersion} → v{transition.resultingRowVersion}</small></td><td><Link aria-label={`查看 ${transition.clientName} 個案主檔`} className="icon-button" href={`/app/staff/operations/clients?q=${encodeURIComponent(transition.clientCode)}`}><ArrowRight aria-hidden="true" /></Link></td></tr>)}</tbody></table></div>
            <div className="mobile-records core-care-mobile">{transitions.map((transition) => <article className="record-card" key={transition.id}><div className="record-card__top"><div><h3>{transition.clientName}</h3><span className="data-table__secondary">{transition.clientCode}</span></div><StatusPill status={eventLabels[transition.eventKind]} /></div><dl className="core-care-card-grid"><div><dt>生效日期</dt><dd>{formatDate(transition.effectiveOn)}</dd></div><div><dt>狀態</dt><dd>{statusLabels[transition.fromServiceState]} → {statusLabels[transition.toServiceState]}</dd></div><div><dt>建立者</dt><dd>{transition.actorLabel}</dd></div><div><dt>版本</dt><dd>v{transition.baseRowVersion} → v{transition.resultingRowVersion}</dd></div></dl><div className="lifecycle-card-copy"><strong>理由</strong><p>{transition.reason}</p><strong>交接</strong><p>{transition.handoffNote ?? "不適用"}</p></div><Link className="record-card__action" href={`/app/staff/operations/clients?q=${encodeURIComponent(transition.clientCode)}`}>查看個案主檔<ArrowRight aria-hidden="true" /></Link></article>)}</div>
          </>
        ) : (
          <div className="panel__body"><section className="empty-card core-care-state"><Search aria-hidden="true" /><h2>沒有符合條件的異動歷程</h2><p>請調整類型、日期或目前狀態；系統不會擴大到其他個案或分支。</p><Link className="button button--secondary" href={clearHref}>清除篩選</Link></section></div>
        )}
        {totalPages > 1 ? (
          <nav aria-label="異動歷程分頁" className="pagination">
            {snapshot.historyPage > 1 ? <Link className="button button--secondary" href={pageHref({ ...baseLink, page: snapshot.historyPage - 1 })}><ChevronLeft aria-hidden="true" />上一頁</Link> : <span />}
            <span>第 {snapshot.historyPage} / {totalPages} 頁</span>
            {snapshot.historyPage < totalPages ? <Link className="button button--secondary" href={pageHref({ ...baseLink, page: snapshot.historyPage + 1 })}>下一頁<ChevronRight aria-hidden="true" /></Link> : <span />}
          </nav>
        ) : null}
      </section>
    </>
  );
}
