import { CalendarDays, CheckCircle2, CircleAlert, Download, MessageCircleMore, ShieldCheck } from "lucide-react";

import type { PageCatalogEntry } from "@/lib/catalog";
import type { FamilyPortalSnapshot } from "@/lib/family/snapshot";
import { StatusPill } from "@/components/ui/status-pill";

const dataCategoryLabels: Partial<Record<PageCatalogEntry["number"], string>> = {
  85: "訊息",
  86: "健康與照顧摘要",
  87: "行程、活動與交通",
  88: "帳務與核准文件",
  89: "通知與設定",
};

export function FamilyWorkspace({ demo, page, snapshot }: { demo: boolean; page: PageCatalogEntry; snapshot: FamilyPortalSnapshot | null }) {
  const Icon = page.number === 85 ? MessageCircleMore : page.number === 87 ? CalendarDays : CheckCircle2;
  const dataCategoryLabel = dataCategoryLabels[page.number] ?? "此頁資料";
  if (!demo && !snapshot) {
    return <section className="empty-card"><ShieldCheck aria-hidden="true" /><h1>目前沒有可顯示的授權個案</h1><p>請由機構確認個案關係、資料類別與授權有效期限；系統不會顯示未授權資料。</p></section>;
  }
  if (!demo && snapshot?.state === "selection_required") {
    return <section className="empty-card"><ShieldCheck aria-hidden="true" /><h1>請選擇要查看的個案</h1><p>每次只會載入一位已授權個案，避免跨個案資料混合。</p><div className="page-heading__actions">{snapshot.authorizedClients.map((client) => <a className="button button--secondary" href={`?client=${encodeURIComponent(client.clientId)}`} key={client.clientId}>{client.clientName}</a>)}</div></section>;
  }
  const ready = !demo && snapshot?.state === "ready" ? snapshot : null;
  const clientName = demo ? "陳O華" : ready?.clientName ?? "已授權個案";
  return (
    <>
      <header className="page-heading"><div><p className="eyebrow">已授權個案・{clientName}</p><h1>{page.title}</h1><p className="page-heading__description">{page.description}</p></div>{page.number === 88 ? <button className="button button--secondary" disabled type="button"><Download />目前無可下載文件</button> : null}</header>
      {!demo ? <div className="callout"><CircleAlert /><span>正式環境僅顯示通過個案、關係、資料類別與有效期限授權的內容；沒有核准資料時不使用示範值補位。</span></div> : null}
      <section className="family-grid">
        <article className="family-card"><span className="metric-card__icon"><Icon /></span><h2>{page.metrics[0]}</h2><p>{demo ? "最近更新：今天 10:24" : "此頁專用資料來源尚未配置"}</p><StatusPill status={demo ? "已更新" : "無資料"} /></article>
        <article className="family-card"><span className="metric-card__icon"><ShieldCheck /></span><h2>資料類別授權：{dataCategoryLabel}</h2><p>{demo ? "這是去識別化展示資料。" : `${dataCategoryLabel}的授權與機構發布流程尚未配置；目前僅確認個案識別授權。`}</p><StatusPill status={demo ? "展示" : "未配置"} /></article>
      </section>
      <section className="panel" style={{ marginTop: 14 }}><div className="panel__header"><div className="panel__title"><h2>最近紀錄</h2><p>依發生時間排序</p></div></div><div className="panel__body">{demo ? <ul className="task-list">{page.columns.slice(0, 4).map((column, index) => <li className="task-item" key={column}><span className="task-item__icon"><Icon /></span><span><strong>{column}</strong><small>{index === 0 ? "今天 10:24・機構已發布" : "目前沒有需要您處理的事項"}</small></span><StatusPill status={index === 0 ? "已更新" : "正常"} /></li>)}</ul> : <section className="empty-card"><Icon aria-hidden="true" /><h2>目前沒有已核准公開的紀錄</h2><p>有新資料時會顯示來源與更新時間；系統不會把缺值當成正常。</p></section>}<div className="callout"><CircleAlert /><span>{page.offline.note}</span></div></div></section>
    </>
  );
}
