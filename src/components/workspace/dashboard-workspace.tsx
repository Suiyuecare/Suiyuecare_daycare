import { TriangleAlert } from "lucide-react";
import { NavigationLink } from "@/components/app/navigation-link";
import { buildTodayWorkRows } from "@/lib/core-care/today-work";
import type { DailyCareSnapshot } from "@/lib/core-care/types";
import { DashboardAutoRefresh } from "./dashboard-auto-refresh";
import { TodayWorkList } from "./today-work-list";
import type { CareRosterSnapshot } from "@/lib/care-roster/types";
import { RosterComposer } from "@/components/care-roster/roster-composer";

export function DashboardWorkspace({ snapshot, serviceDate, roster, loadError = false, canViewManagementDetails = false }: {
  snapshot: DailyCareSnapshot | null;
  serviceDate: string;
  loadError?: boolean;
  canViewManagementDetails?: boolean;
  roster?: CareRosterSnapshot;
}) {
  if (loadError || !snapshot) {
    return <section className="empty-card core-care-state" role="alert">
      <span className="empty-card__icon empty-card__icon--warning"><TriangleAlert aria-hidden="true" /></span>
      <h1>今日工作暫時無法載入</h1>
      <p>請重新載入。若仍無法取得清單，請聯絡機構管理員；目前無法確認哪些工作已完成。</p>
      <a className="button button--secondary" href={`?date=${serviceDate}`}>重新載入</a>
    </section>;
  }
  const dayLabel = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "long", day: "numeric", weekday: "long" })
    .format(new Date(`${serviceDate}T12:00:00+08:00`));
  const updated = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(snapshot.generatedAt));
  return <>
    <nav aria-label="所在位置" className="context-bar"><span>工作台</span><span aria-hidden="true">／</span><span aria-current="page" className="context-bar__crumb">今日工作</span></nav>
    <header className="page-heading today-heading">
      <div><p className="eyebrow">{dayLabel}・更新於 {updated}{snapshot.demo ? "・合成示範" : ""}</p>
        <h1>今天的照顧工作，一眼掌握。</h1>
        <p className="page-heading__description">先找個案，再接續出勤、量測與照顧日誌。</p></div>
      <DashboardAutoRefresh generatedAt={snapshot.generatedAt} />
    </header>
    <TodayWorkList key={serviceDate} rows={buildTodayWorkRows(snapshot, roster)} serviceDate={serviceDate} access={snapshot.sourceAccess} roster={roster} />
    {roster && <RosterComposer roster={roster} clients={snapshot.clients} serviceDate={serviceDate} />}
    <footer className="today-footer">
      <NavigationLink className="button button--secondary" loadingLabel="個案中心" href={`/app/staff/workspace/case-center?date=${serviceDate}`}>到個案中心調整篩選</NavigationLink>
      <p>本頁僅整理出勤、量測與最近一筆日誌。交通、餐食及其他照顧工作，請到各自頁面確認。</p>
      {canViewManagementDetails && <details className="today-management"><summary>管理檢查明細</summary>
        <p>{roster?.status === "ready" ? "清單依當日已確認分工，僅保留目前仍可查閱的個案；不是全店出席率或申報證據。每班量測分別查核種類與時間，日誌須為最新已簽版本。" : "清單為目前授權可見的在案個案，尚未與當日排程比對；不是應服務分母或整體完成率。"}請假／未到不產生缺測或缺日誌待辦；既有草稿與待簽署仍需查閱。</p>
        <p>各來源依相同服務日取得，不代表跨資料表交易快照。無權限不計為零；量測有資料不等於全部項目完成，日誌僅顯示最近一筆。</p>
        <NavigationLink className="button button--quiet" loadingLabel="整合與稽核中心" href="/app/staff/governance/integrations-audit">開啟整合與稽核中心</NavigationLink>
      </details>}
    </footer>
  </>;
}
