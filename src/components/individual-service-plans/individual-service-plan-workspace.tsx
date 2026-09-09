import { CalendarRange, CheckCircle2, ChevronRight, CircleAlert, Clock3, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";

import type { PageCatalogEntry } from "@/lib/catalog";
import type { IndividualPlanProgress, IndividualServicePlanSnapshot } from "@/lib/individual-service-plans/types";

import { IndividualPlanComposer } from "./individual-plan-composer";
import styles from "./individual-service-plans.module.css";

const progressLabels: Record<IndividualPlanProgress, string> = {
  not_started: "尚未開始",
  in_progress: "進行中",
  completed: "已完成",
};

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

export function IndividualServicePlanWorkspace({
  page,
  snapshot,
  query,
  responsible,
  progress,
  canWrite,
  hasRecentAal2,
  loadError = false,
}: {
  page: PageCatalogEntry;
  snapshot: IndividualServicePlanSnapshot | null;
  query: string;
  responsible: string;
  progress: "all" | IndividualPlanProgress;
  canWrite: boolean;
  hasRecentAal2: boolean;
  loadError?: boolean;
}) {
  if (loadError || !snapshot) return (
    <section className="empty-card core-care-state" role="alert">
      <span className="empty-card__icon empty-card__icon--warning"><CircleAlert aria-hidden="true" /></span>
      <h1>個別化服務計畫暫時無法載入</h1>
      <p>系統不會改查其他分支、未指派個案、直接資料表或展示資料；請確認權限後重試。</p>
      <a className="button button--secondary" href="?">重新載入</a>
    </section>
  );
  const hasFilters = Boolean(query || responsible !== "all" || progress !== "all");
  return (
    <>
      <nav aria-label="所在位置" className="context-bar"><span>工作台</span><ChevronRight aria-hidden="true" /><span>日常照顧</span><ChevronRight aria-hidden="true" /><span aria-current="page" className="context-bar__crumb">{page.title}</span></nav>
      <header className="page-heading core-care-heading">
        <div><p className="eyebrow">每月不可覆寫版本・頁面 {page.number}</p><h1>{page.title}</h1><p className="page-heading__description">月份依 Asia/Taipei 預設；每次簽署都新增版本，目標、活動、頻率、負責人與人工進度完整保留。</p></div>
        <IndividualPlanComposer clients={snapshot.clients} responsibles={snapshot.responsibles} planMonth={snapshot.planMonth} canWrite={canWrite} hasRecentAal2={hasRecentAal2} demo={snapshot.demo} />
      </header>
      {snapshot.demo ? (
        <div className={`callout ${styles.demoCallout}`} role="status"><CircleAlert aria-hidden="true" /><span><strong>展示模式：</strong>以下是合成資料，建立與更新均停用，API 也回絕寫入，不會假裝成功。</span></div>
      ) : (
        <div className={`callout ${styles.securityCallout}`}><ShieldCheck aria-hidden="true" /><span>畫面只讀取本分支且符合指派範圍的最小快照；簽署需要最近 15 分鐘 AAL2。更新時間 {formatTimestamp(snapshot.generatedAt)}。</span></div>
      )}
      {!snapshot.demo && canWrite && !hasRecentAal2 ? <div className={`callout ${styles.reauthCallout}`} role="status"><ShieldCheck aria-hidden="true" /><span>目前可安全檢視；簽署新版本前請重新驗證。</span><Link className="button button--secondary" href="/mfa?audience=staff&purpose=sensitive-action">前往重新驗證</Link></div> : null}
      <section aria-label="計畫規則說明" className={styles.ruleGrid}>
        <article><CalendarRange aria-hidden="true" /><div><strong>台北月份分區</strong><span>預設值依 Asia/Taipei；切換月份只查該月，不會複製或覆寫其他月份。</span></div></article>
        <article><ShieldCheck aria-hidden="true" /><div><strong>人工內容邊界</strong><span>頻率與進度是人員輸入的文字／狀態；目前沒有已發布的完成率公式或自動照顧判斷。</span></div></article>
      </section>
      <section aria-label="本月計畫摘要" className="metric-grid">
        {[
          ["本月計畫", snapshot.counts.plans, "位個案", <CalendarRange aria-hidden="true" key="plans" />],
          ["尚未開始", snapshot.counts.notStarted, "項", <Clock3 aria-hidden="true" key="not-started" />],
          ["進行中", snapshot.counts.inProgress, "項", <Clock3 aria-hidden="true" key="progress" />],
          ["已完成", snapshot.counts.completed, "項", <CheckCircle2 aria-hidden="true" key="done" />],
        ].map(([label, value, unit, icon]) => <article className="metric-card" key={String(label)}><div className="metric-card__top"><span>{label}</span><span className="metric-card__icon">{icon}</span></div><div className="metric-card__value"><strong>{value}</strong><span>{unit}</span></div><p className="metric-card__foot">最新簽署版本的人工狀態</p></article>)}
      </section>
      <section className="panel">
        <div className="panel__header"><div className="panel__title"><h2>{snapshot.planMonth} 最新版本</h2><p>{snapshot.clients.length} 位符合篩選・計畫與項目共用同一快照</p></div></div>
        <form className="filter-bar" method="get">
          <label className="field field--compact"><span>月份</span><input defaultValue={snapshot.planMonth} name="month" type="month" /></label>
          <label className="filter-search"><Search aria-hidden="true" /><span className="sr-only">搜尋個案</span><input defaultValue={query} maxLength={120} name="q" placeholder="搜尋個案代碼或姓名…" type="search" /></label>
          <label className="field field--compact"><span>負責人</span><select defaultValue={responsible} name="responsible"><option value="all">全部負責人</option>{snapshot.responsibles.map((person) => <option key={person.userId} value={person.userId}>{person.displayName}</option>)}</select></label>
          <label className="field field--compact"><span>進度</span><select defaultValue={progress} name="progress"><option value="all">全部進度</option>{Object.entries(progressLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <button className="button button--secondary" type="submit">套用</button>
          {hasFilters ? <Link className="button button--quiet" href={`?month=${snapshot.planMonth}`}>清除</Link> : null}
        </form>
        {snapshot.clients.length ? <>
          <div aria-label="個別化服務計畫表格，可左右捲動" className={`table-wrap ${styles.table}`} role="region" tabIndex={0}>
            <table className="data-table"><thead><tr>{["個案", "版本／簽署", "目標與活動", "頻率", "負責人", "進度"].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead><tbody>
              {snapshot.clients.map((client) => <tr key={client.clientId}>
                <td><strong>{client.displayName}</strong><small className="data-table__secondary">{client.clientCode}</small></td>
                <td>{client.latestPlan ? <>v{client.latestPlan.version}<small className="data-table__secondary">{formatTimestamp(client.latestPlan.signedAt)}</small></> : <span>尚無計畫</span>}</td>
                <td className={styles.itemCell}>{client.latestPlan?.items.map((item) => <div key={item.itemOrder}><strong>{item.itemOrder}. {item.goal}</strong><span>{item.activity}</span></div>) ?? "—"}</td>
                <td>{client.latestPlan?.items.map((item) => <span className={styles.stack} key={item.itemOrder}>{item.frequency}</span>) ?? "—"}</td>
                <td>{client.latestPlan?.items.map((item) => <span className={styles.stack} key={item.itemOrder}>{item.responsibleDisplayName}</span>) ?? "—"}</td>
                <td>{client.latestPlan?.items.map((item) => <span className={styles.stack} key={item.itemOrder}>{progressLabels[item.progressStatus]}{item.progressNote ? <small>{item.progressNote}</small> : null}</span>) ?? "—"}</td>
              </tr>)}
            </tbody></table>
          </div>
          <div className="mobile-records core-care-mobile">{snapshot.clients.map((client) => <article className="record-card" key={client.clientId}><div className="record-card__top"><div><h3>{client.displayName}</h3><span className="data-table__secondary">{client.clientCode}</span></div><strong>{client.latestPlan ? `v${client.latestPlan.version}` : "尚無計畫"}</strong></div><div className={styles.mobileItems}>{client.latestPlan?.items.map((item) => <section key={item.itemOrder}><h4>{item.itemOrder}. {item.goal}</h4><p>{item.activity}</p><dl><div><dt>頻率</dt><dd>{item.frequency}</dd></div><div><dt>負責人</dt><dd>{item.responsibleDisplayName}</dd></div><div><dt>進度</dt><dd>{progressLabels[item.progressStatus]}</dd></div></dl></section>) ?? <p>此月份尚無計畫。</p>}</div></article>)}</div>
        </> : <div className="panel__body"><section className="empty-card"><Search aria-hidden="true" /><h2>沒有符合條件的計畫</h2><p>請調整月份、個案、負責人或進度；系統不會擴大資料範圍。</p><Link className="button button--secondary" href={`?month=${snapshot.planMonth}`}>清除篩選</Link></section></div>}
      </section>
    </>
  );
}
