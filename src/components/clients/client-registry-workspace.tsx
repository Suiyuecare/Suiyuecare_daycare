import {
  ArrowRight,
  ChevronRight,
  CircleAlert,
  Database,
  History,
  Search,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import Link from "next/link";

import { StatusPill } from "@/components/ui/status-pill";
import type { PageCatalogEntry } from "@/lib/catalog";
import type {
  ClientLifecycleStatusFilter,
  ClientRegistryItem,
  ClientRegistrySnapshot,
  ClientServiceState,
} from "@/lib/clients/types";

const statusLabels: Record<ClientServiceState, string> = {
  pending_admission: "待收案",
  active: "在案",
  suspended: "暫停",
  transferred: "已轉出",
  closed: "已結案",
  deceased: "死亡結案",
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

function RegistryRows({
  clients,
  lifecycle,
}: {
  clients: readonly ClientRegistryItem[];
  lifecycle: boolean;
}) {
  return clients.map((client) => (
    <tr key={client.id}>
      <td><span className="data-table__primary"><span className="avatar" aria-hidden="true">{client.displayName.slice(0, 1)}</span><span>{client.displayName}<small className="data-table__secondary">{client.clientCode}</small></span></span></td>
      {lifecycle ? (
        <>
          <td><StatusPill status={statusLabels[client.serviceState]} /></td>
          <td>{formatDate(client.admittedOn)}</td>
          <td>{formatDate(client.endedOn)}</td>
          <td>v{client.rowVersion}</td>
          <td>{formatTimestamp(client.updatedAt)}</td>
        </>
      ) : (
        <>
          <td>{formatDate(client.dateOfBirth)}</td>
          <td><StatusPill status={statusLabels[client.serviceState]} /></td>
          <td>{formatDate(client.admittedOn)}</td>
          <td>{client.sourceSystem}</td>
          <td>{formatTimestamp(client.updatedAt)}</td>
        </>
      )}
      <td>
        <Link
          aria-label={`查看 ${client.displayName} 的${lifecycle ? "個案主檔" : "生命週期"}`}
          className="icon-button"
          href={
            lifecycle
              ? `/app/staff/operations/clients?q=${encodeURIComponent(client.clientCode)}`
              : `/app/staff/operations/client-transitions?q=${encodeURIComponent(client.clientCode)}`
          }
        >
          <ArrowRight aria-hidden="true" />
        </Link>
      </td>
    </tr>
  ));
}

export function ClientRegistryWorkspace({
  page,
  snapshot,
  query,
  status,
  loadError = false,
}: {
  page: PageCatalogEntry;
  snapshot: ClientRegistrySnapshot | null;
  query: string;
  status: ClientLifecycleStatusFilter;
  loadError?: boolean;
}) {
  const lifecycle = page.number === 61;
  if (loadError || !snapshot) {
    return (
      <section className="empty-card core-care-state" role="alert">
        <span className="empty-card__icon empty-card__icon--warning"><CircleAlert aria-hidden="true" /></span>
        <h1>個案資料暫時無法載入</h1>
        <p>系統沒有跨分支查詢，也沒有以展示資料代替正式資料。</p>
        <a className="button button--secondary" href="?status=all">重新載入</a>
      </section>
    );
  }

  const normalizedQuery = query.trim().toLocaleLowerCase("zh-TW");
  const clients = snapshot.clients.filter((client) => {
    const matchesQuery =
      !normalizedQuery ||
      `${client.displayName} ${client.clientCode}`
        .toLocaleLowerCase("zh-TW")
        .includes(normalizedQuery);
    return matchesQuery && (status === "all" || client.serviceState === status);
  });
  const active = snapshot.clients.filter((client) => client.serviceState === "active").length;
  const pendingAdmission = snapshot.clients.filter(
    (client) => client.serviceState === "pending_admission",
  ).length;
  const suspended = snapshot.clients.filter((client) => client.status === "suspended").length;
  const ended = snapshot.clients.filter((client) =>
    ["transferred", "closed", "deceased"].includes(client.status),
  ).length;

  return (
    <>
      <nav aria-label="所在位置" className="context-bar"><span>工作台</span><ChevronRight aria-hidden="true" /><span>機構營運管理</span><ChevronRight aria-hidden="true" /><span aria-current="page" className="context-bar__crumb">{page.title}</span></nav>
      <header className="page-heading">
        <div><p className="eyebrow">專用個案主檔投影・頁面 {page.number}</p><h1>{page.title}</h1><p className="page-heading__description">{lifecycle ? "以穩定個案 ID 顯示目前生命週期狀態；歷程交易完成前不以稽核摘要冒充正式異動紀錄。" : "清單只讀取工作所需欄位；身分證等加密識別資料不會進入列表或瀏覽器回應。"}</p></div>
        <div className="page-heading__actions"><button className="button button--primary" disabled title={lifecycle ? "不可變生命週期交易尚未接線" : "收案與主檔編輯交易尚未接線"} type="button">{page.primaryActions[0]}</button></div>
      </header>

      <div className="callout core-care-callout"><ShieldCheck aria-hidden="true" /><span>{lifecycle ? "目前只呈現 clients 的權威狀態與版本；新增異動會等不可變歷程、理由、交接與冪等交易一併完成後才開放。" : "列表刻意不查詢 national_id_ciphertext；聯絡人、資格、健康、同意與附件會在專用分頁及欄位權限完成後才接入。"}</span></div>

      <section aria-label="個案狀態摘要" className="metric-grid">
        {[
          ["符合條件", clients.length, "人", "搜尋與狀態篩選"],
          ["在案", active, "人", "目前分支權威狀態"],
          ["待收案", pendingAdmission, "人", "已建檔、尚未收案"],
          ["暫停", suspended, "人", "不自動視為結案"],
          ["已終止服務", ended, "人", "轉出、結案或死亡"],
        ].map(([label, value, unit, foot], index) => (
          <article className="metric-card" key={String(label)}><div className="metric-card__top"><span>{label}</span><span className="metric-card__icon">{index === 0 ? <Search aria-hidden="true" /> : index === 1 ? <UserRoundCheck aria-hidden="true" /> : index === 2 ? <History aria-hidden="true" /> : <Database aria-hidden="true" />}</span></div><div className="metric-card__value"><strong>{value}</strong><span>{unit}</span></div><p className="metric-card__foot">{foot}</p></article>
        ))}
      </section>

      <section className="panel">
        <div className="panel__header"><div className="panel__title"><h2>{lifecycle ? "目前生命週期狀態" : "個案主檔清單"}</h2><p>{clients.length} 位符合條件・快照 {formatTimestamp(snapshot.generatedAt)}</p></div></div>
        <form className="filter-bar" method="get">
          <label className="filter-search"><Search aria-hidden="true" /><span className="sr-only">搜尋個案代碼或姓名</span><input defaultValue={query} name="q" placeholder="搜尋個案代碼或姓名…" type="search" /></label>
          <label className="field field--compact"><span>個案狀態</span><select defaultValue={status} name="status"><option value="all">全部狀態</option><option value="pending_admission">待收案</option><option value="active">在案</option><option value="suspended">暫停</option><option value="transferred">已轉出</option><option value="closed">已結案</option><option value="deceased">死亡結案</option></select></label>
          <button className="button button--secondary" type="submit">套用篩選</button>
        </form>
        {clients.length ? (
          <>
            <div className="table-wrap"><table className="data-table"><thead><tr>{(lifecycle ? ["個案", "目前狀態", "收案日", "終止日", "資料版本", "最後更新"] : ["個案", "出生日期", "狀態", "收案日", "資料來源", "最後更新"]).map((heading) => <th key={heading} scope="col">{heading}</th>)}<th scope="col"><span className="sr-only">動作</span></th></tr></thead><tbody><RegistryRows clients={clients} lifecycle={lifecycle} /></tbody></table></div>
            <div className="mobile-records core-care-mobile">{clients.map((client) => <article className="record-card" key={client.id}><div className="record-card__top"><div><h3>{client.displayName}</h3><span className="data-table__secondary">{client.clientCode}</span></div><StatusPill status={statusLabels[client.serviceState]} /></div><dl className="core-care-card-grid"><div><dt>收案日</dt><dd>{formatDate(client.admittedOn)}</dd></div><div><dt>終止日</dt><dd>{formatDate(client.endedOn)}</dd></div><div><dt>資料來源</dt><dd>{client.sourceSystem}</dd></div><div><dt>資料版本</dt><dd>v{client.rowVersion}</dd></div></dl><Link className="record-card__action" href={lifecycle ? `/app/staff/operations/clients?q=${encodeURIComponent(client.clientCode)}` : `/app/staff/operations/client-transitions?q=${encodeURIComponent(client.clientCode)}`}>{lifecycle ? "查看個案主檔" : "查看生命週期"}<ArrowRight aria-hidden="true" /></Link></article>)}</div>
          </>
        ) : (
          <div className="panel__body"><section className="empty-card core-care-state"><Search aria-hidden="true" /><h2>沒有符合條件的個案</h2><p>請調整搜尋或狀態；系統不會擴大到其他分支。</p><Link className="button button--secondary" href="?status=all">清除篩選</Link></section></div>
        )}
      </section>
    </>
  );
}
