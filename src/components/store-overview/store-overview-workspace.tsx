"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { STORE_ATTENDANCE_MONTH_PATH } from "@/lib/store-overview/attendance-month";
import { ArrowDownLeft, ArrowUpRight, Building2, CalendarDays, ChevronRight, CircleCheck, CircleHelp, CircleX, FlaskConical, Info, RefreshCw, UsersRound, Wallet } from "lucide-react";
import { ModuleLoading } from "@/components/app/module-loading";
import { formatTwd, STORE_OVERVIEW_PATH, STORE_OVERVIEW_TITLE, type StoreOverview } from "@/lib/store-overview/types";
import styles from "./store-overview.module.css";

function timeLabel(value: string) {
  // Intl literal separators differ between Node and browsers (e.g. thin vs ASCII space).
  // Join only numeric parts so server HTML and hydration always use identical text.
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", calendar: "gregory", numberingSystem: "latn",
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const field = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${field("month")}/${field("day")} ${field("hour")}:${field("minute")}:${field("second")}`;
}

function Unavailable({ source, status }: { source: "出勤" | "Finance"; status: string }) {
  return <div className={styles.sourceNotice} role="status">
    <strong>{status === "not_connected" ? "Finance 尚未連線" : `${source}${status === "timeout" ? "讀取逾時" : "暫時無法讀取"}`}</strong>
    <p>{status === "not_connected" ? "請管理員完成這間店的 Finance 對應與連線設定；完成後會顯示實際收入、支出。" : "請按「更新資料」重試；若仍無法讀取，請聯絡系統管理員。"}</p>
    <small>目前沒有可顯示的數字，不代表 0。</small>
  </div>;
}

export function StoreOverviewWorkspace({ overview }: { overview: StoreOverview }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [online, setOnline] = useState(true);
  const [stale, setStale] = useState(false);
  const [navigationError, setNavigationError] = useState(false);
  const [reconnectRequired, setReconnectRequired] = useState(false);
  const attendanceAt = overview.attendance.status === "ready" ? overview.attendance.data.generatedAt : null;
  const financeAt = overview.finance.status === "ready" ? overview.finance.data.generatedAt : null;
  const attendanceTotal = overview.attendance.status === "ready"
    ? overview.attendance.data.present + overview.attendance.data.leave + overview.attendance.data.absent
    : 0;

  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      if (!navigator.onLine) setReconnectRequired(true);
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  useEffect(() => {
    const update = () => {
      const times = [attendanceAt, financeAt].filter((v): v is string => v !== null);
      setStale(times.some((value) => Date.now() - Date.parse(value) > 60_000));
    };
    update();
    const timer = window.setInterval(update, 10_000);
    return () => window.clearInterval(timer);
  }, [attendanceAt, financeAt]);

  function apply(event: FormEvent<HTMLFormElement>) {
    if (!online) { event.preventDefault(); return; }
    // Use the native GET form after disconnection: it forces a full no-store
    // request, rechecking the session and sources instead of a cached RSC.
    if (reconnectRequired) return;
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const query = new URLSearchParams({ date: String(values.get("date")), month: String(values.get("month")) });
    setNavigationError(false);
    startTransition(() => {
      try {
        const current = new URLSearchParams(window.location.search);
        if (current.toString() === query.toString()) router.refresh();
        else router.push(`${STORE_OVERVIEW_PATH}?${query}`);
      } catch { setNavigationError(true); }
    });
  }

  const hideData = !online || reconnectRequired;
  return <div className={styles.workspace}>
    <header className={styles.overviewIntro}>
      <p className={styles.overviewEyebrow}><Building2 aria-hidden="true" />{STORE_OVERVIEW_TITLE}</p>
      <h1>{overview.branchName}</h1>
      <p className={styles.organization}>{overview.organizationName}</p>
    </header>
    {overview.demo && <aside className={styles.demoNotice} aria-label="合成展示資料"><FlaskConical aria-hidden="true" /><p><strong>合成展示資料</strong><span>人數與金額僅供試用，不是這間店的實際營運資料；不會連線正式 Finance。</span></p></aside>}
    {!overview.invalid && !hideData && <nav className={styles.quickSummary} aria-label="快速查看出勤與收支">
      <a href="#store-attendance-heading">
        <span className={styles.quickIcon}><UsersRound aria-hidden="true" /></span>
        <span className={styles.quickCopy}><strong>出勤 <time dateTime={overview.periods.date}>{overview.periods.date}</time></strong>
          <span>{overview.attendance.status === "ready"
            ? `出席 ${overview.attendance.data.present} · 請假 ${overview.attendance.data.leave} · 缺席 ${overview.attendance.data.absent}`
            : "出勤暫無資料"}</span></span>
        <ChevronRight aria-hidden="true" />
      </a>
      <a href="#store-finance-heading">
        <span className={styles.quickIcon}><Wallet aria-hidden="true" /></span>
        <span className={styles.quickCopy}><strong>Finance <time dateTime={overview.periods.month}>{overview.periods.month}</time></strong>
          <span>{overview.finance.status === "ready"
            ? `收入 NT$${formatTwd(overview.finance.data.income)} · 支出 NT$${formatTwd(overview.finance.data.expenses)}`
            : overview.finance.status === "not_connected" ? "Finance 尚未連線" : "Finance 暫無資料"}</span></span>
        <ChevronRight aria-hidden="true" />
      </a>
    </nav>}
    <form className={styles.overviewFilters} action={STORE_OVERVIEW_PATH} method="get" onSubmit={apply} aria-label="選擇出勤日期與收支月份">
      <label>出勤日期<input key={`date-${overview.periods.date}`} type="date" name="date" min="2000-01-01" max="2200-12-31" required defaultValue={overview.periods.date} /></label>
      <label>收支月份<input key={`month-${overview.periods.month}`} type="month" name="month" min="2000-01" max="2200-12" required defaultValue={overview.periods.month} /></label>
      <button className="button button--secondary" disabled={pending || !online} type="submit"><RefreshCw aria-hidden="true" />{pending ? "更新中…" : "更新資料"}</button>
    </form>
    <p className={styles.timezoneNote}>日期與月份可分開選擇 · 臺北時間</p>
    {navigationError && <p className={styles.notice} role="alert">更新失敗，請重試或重新整理頁面。</p>}
    {overview.invalid ? <section className={styles.notice} role="alert"><h2>請重新選擇日期與月份</h2><p>日期或查詢條件無效，本次未讀取任何出勤或財務數字。</p></section> : hideData ?
      <section className={styles.notice} role="status"><h2>{online ? "已恢復連線，請更新資料" : "目前離線"}</h2><p>出勤與收支需連線查看。重新連線後，請按「更新資料」取得最新數字。</p></section> : <>
      {stale && <p className={styles.notice} role="status">資料已超過 1 分鐘，可能有新紀錄；請按「更新資料」重新讀取。</p>}
      <div className={styles.overviewSections} aria-busy={pending} inert={pending ? true : undefined}>
        <section className={styles.overviewPanel} aria-labelledby="store-attendance-heading">
          <header className={styles.overviewPanelHeading}>
            <span className={styles.panelIcon}><UsersRound aria-hidden="true" /></span>
            <div><h2 id="store-attendance-heading">個案出缺勤</h2><p><CalendarDays aria-hidden="true" /><time dateTime={overview.periods.date}>{overview.periods.date}</time></p></div>
          </header>
          {overview.attendance.status === "ready" ? <>
            <dl className={styles.overviewAttendanceMetrics}>
              <div><dt><CircleCheck aria-hidden="true" />出席</dt><dd>{overview.attendance.data.present}<span>人</span></dd></div>
              <div><dt><CircleHelp aria-hidden="true" />請假</dt><dd>{overview.attendance.data.leave}<span>人</span></dd></div>
              <div><dt><CircleX aria-hidden="true" />缺席</dt><dd>{overview.attendance.data.absent}<span>人</span></dd></div>
            </dl>
            {attendanceTotal > 0 ? <div className={styles.registeredBand}>
              <span>已登記 <strong>{attendanceTotal}</strong> 人</span>
              <div className={styles.attendanceBand} aria-hidden="true">
                <span className={styles.bandPresent} style={{ flexGrow: overview.attendance.data.present }} />
                <span className={styles.bandLeave} style={{ flexGrow: overview.attendance.data.leave }} />
                <span className={styles.bandAbsent} style={{ flexGrow: overview.attendance.data.absent }} />
              </div>
            </div> : <p className={styles.sourceNotice}>這一天尚無有效出勤紀錄，不代表所有個案都缺席。</p>}
            <p className={styles.overviewUpdated}>讀取於 <time dateTime={attendanceAt!}>{timeLabel(attendanceAt!)}</time></p>
          </> : <Unavailable source="出勤" status={overview.attendance.status} />}
          <p className={styles.caveat}><Info aria-hidden="true" />未登記不等於缺席；已取消紀錄不計。</p>
          <div className={styles.panelActions}>
            <details className={styles.method}><summary>統計方式</summary><p>依已登記的出勤狀態統計，同一個案當天只計一次。未登記與已取消不列入缺席；這裡不計算出勤率。</p></details>
            <Link className="button button--secondary" prefetch={false} href={`${STORE_ATTENDANCE_MONTH_PATH}?month=${overview.periods.date.slice(0, 7)}`}>查看出缺勤月報</Link>
          </div>
        </section>
        <section className={styles.overviewPanel} aria-labelledby="store-finance-heading">
          <header className={styles.overviewPanelHeading}>
            <span className={styles.panelIcon}><Wallet aria-hidden="true" /></span>
            <div><h2 id="store-finance-heading">Finance 收入與支出</h2><p><CalendarDays aria-hidden="true" /><time dateTime={overview.periods.month}>{overview.periods.month}</time><span>・新臺幣</span></p></div>
          </header>
          {overview.finance.status === "ready" ? <>
            <dl className={styles.overviewFinanceMetrics}>
              <div><dt><ArrowDownLeft aria-hidden="true" />收入</dt><dd><span className={styles.currency}>NT$</span>{formatTwd(overview.finance.data.income)}</dd></div>
              <div><dt><ArrowUpRight aria-hidden="true" />支出</dt><dd><span className={styles.currency}>NT$</span>{formatTwd(overview.finance.data.expenses)}</dd></div>
            </dl>
            {overview.finance.data.entryCount === 0 && <p className={styles.sourceNotice}>Finance 這個月尚無分類帳紀錄。</p>}
            <p className={styles.overviewUpdated}>Finance 讀取於 <time dateTime={financeAt!}>{timeLabel(financeAt!)}</time></p>
          </> : <Unavailable source="Finance" status={overview.finance.status} />}
          <p className={styles.caveat}><Info aria-hidden="true" />分類帳金額，非銀行實際收付款。修改帳務請至 Finance。</p>
          <details className={styles.method}><summary>金額口徑</summary><p>與 Finance 同店、同月份的分類帳口徑一致；不是銀行實際收付款。修改帳務請回 Finance 處理。</p></details>
        </section>
      </div>
    </>}
    {pending && <ModuleLoading title="正在更新出勤與收支" transition />}
  </div>;
}
