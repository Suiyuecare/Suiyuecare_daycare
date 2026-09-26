"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { STORE_ATTENDANCE_MONTH_PATH } from "@/lib/store-overview/attendance-month";
import { Building2, CalendarDays, RefreshCw, UsersRound, Wallet } from "lucide-react";
import { ModuleLoading } from "@/components/app/module-loading";
import { formatTwd, STORE_OVERVIEW_PATH, STORE_OVERVIEW_TITLE, type StoreOverview } from "@/lib/store-overview/types";
import { hasPendingOperations, hasViewTransition, tryAcquireViewTransition,
  usePendingOperations, useViewTransitionPending } from "@/lib/navigation/pending-operation-lock";
import { financeRefreshTimestamp, formatStoreTimestamp, freshFinanceAfterRefresh, storeRefreshIdentity,
  STORE_REFRESH_CHECK_MS, STORE_REFRESH_INTERVAL_MS, STORE_REFRESH_MAX_FAILURES,
  STORE_REFRESH_RETRY_MS } from "./store-overview-refresh";
import styles from "./store-overview.module.css";

function Unavailable({ source, status }: { source: "出勤" | "Finance"; status: string }) {
  return <div className={styles.notice} role="status">
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
  const operationPending = usePendingOperations();
  const viewPending = useViewTransitionPending();
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const [refreshAttention, setRefreshAttention] = useState(false);
  const [autoStopped, setAutoStopped] = useState(true);
  const identity = storeRefreshIdentity(overview);
  const refreshPolicy = useRef({ identity: "", nextAt: 0, failures: 0, stopped: true });
  const refreshRequest = useRef<null | { identity: string; timestamp: number | null;
    automatic: boolean; native: boolean; release: () => void }>(null);
  const attendanceAt = overview.attendance.status === "ready" ? overview.attendance.data.generatedAt : null;
  const financeAt = overview.finance.status === "ready" ? overview.finance.data.generatedAt : null;

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

  useEffect(() => {
    if (refreshPolicy.current.identity !== identity) {
      refreshPolicy.current = { identity, nextAt: Date.now() + STORE_REFRESH_INTERVAL_MS,
        failures: 0, stopped: financeRefreshTimestamp(overview, Date.now()) === null };
      setAutoStopped(refreshPolicy.current.stopped);
      setRefreshAttention(false);
    }
    if (pending || !refreshRequest.current || refreshRequest.current.native) return;
    const request = refreshRequest.current;
    refreshRequest.current = null;
    request.release();
    // A completed React transition is not a fresh-data receipt. Require a
    // newer server timestamp within the same displayed store and periods.
    if (request.identity !== identity) return;
    if (freshFinanceAfterRefresh(overview, request.identity, request.timestamp, Date.now())) {
      refreshPolicy.current.failures = 0;
      refreshPolicy.current.stopped = false;
      setAutoStopped(false);
      refreshPolicy.current.nextAt = Date.now() + STORE_REFRESH_INTERVAL_MS;
      setRefreshAttention(false);
    } else {
      refreshPolicy.current.failures += 1;
      refreshPolicy.current.stopped = !request.automatic || overview.invalid || overview.demo ||
        overview.finance.status === "not_connected" ||
        (overview.finance.status === "ready" && financeRefreshTimestamp(overview, Date.now()) === null) ||
        refreshPolicy.current.failures >= STORE_REFRESH_MAX_FAILURES;
      refreshPolicy.current.nextAt = Date.now() + STORE_REFRESH_RETRY_MS;
      setAutoStopped(refreshPolicy.current.stopped);
      setRefreshAttention(true);
    }
  }, [identity, overview, pending, refreshEpoch]);

  useEffect(() => () => { refreshRequest.current?.release(); refreshRequest.current = null; }, []);

  useEffect(() => {
    const refresh = () => {
      if (refreshPolicy.current.stopped || Date.now() < refreshPolicy.current.nextAt ||
        overview.demo || overview.invalid || !navigator.onLine || reconnectRequired ||
        document.visibilityState !== "visible" || pending || refreshRequest.current ||
        hasPendingOperations() || hasViewTransition()) return;
      const release = tryAcquireViewTransition();
      if (!release) return;
      refreshRequest.current = { identity, automatic: true, native: false, release,
        timestamp: financeRefreshTimestamp(overview, Date.now()) };
      refreshPolicy.current.nextAt = Date.now() + STORE_REFRESH_INTERVAL_MS;
      setRefreshEpoch((epoch) => epoch + 1);
      startTransition(() => {
        try { return router.refresh(); }
        catch {
          release(); refreshRequest.current = null;
          refreshPolicy.current.stopped = true; setAutoStopped(true); setRefreshAttention(true);
        }
      });
    };
    const timer = window.setInterval(refresh, STORE_REFRESH_CHECK_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [identity, overview, pending, reconnectRequired, router]);

  function apply(event: FormEvent<HTMLFormElement>) {
    if (!online || pending || refreshRequest.current || hasPendingOperations() || hasViewTransition()) {
      event.preventDefault(); return;
    }
    // Use the native GET form after disconnection: it forces a full no-store
    // request, rechecking the session and sources instead of a cached RSC.
    const release = tryAcquireViewTransition();
    if (!release) { event.preventDefault(); return; }
    if (reconnectRequired) {
      // The native GET must keep its lease until the old view actually unmounts.
      refreshRequest.current = { identity, automatic: false, native: true, release, timestamp: null };
      return;
    }
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const query = new URLSearchParams({ date: String(values.get("date")), month: String(values.get("month")) });
    refreshRequest.current = { identity, automatic: false, native: false, release,
      timestamp: financeRefreshTimestamp(overview, Date.now()) };
    setRefreshEpoch((epoch) => epoch + 1);
    setNavigationError(false);
    startTransition(() => {
      try {
        const current = new URLSearchParams(window.location.search);
        if (current.toString() === query.toString()) router.refresh();
        else router.push(`${STORE_OVERVIEW_PATH}?${query}`);
      } catch {
        release(); refreshRequest.current = null;
        refreshPolicy.current.stopped = true;
        setAutoStopped(true);
        setNavigationError(true);
      }
    });
  }

  const hideData = !online || reconnectRequired;
  return <div className={styles.workspace}>
    <header className="page-heading">
      <div><p className="eyebrow">店務概況</p><h1>{STORE_OVERVIEW_TITLE}</h1>
        <p className="page-heading__description">看今天的出缺勤，以及 Finance 這間店的每月收入、支出。</p></div>
    </header>
    <div className={styles.store}><Building2 aria-hidden="true" /><div><strong>{overview.branchName}</strong><p>{overview.organizationName}</p></div></div>
    {overview.demo && <aside className={styles.notice} aria-label="合成展示資料"><strong>合成展示資料</strong><p>以下人數與金額僅供試用畫面，不是這間店的實際營運資料；不會連線正式 Finance。</p></aside>}
    <form className={styles.filters} noValidate action={STORE_OVERVIEW_PATH} method="get" onSubmit={apply} aria-label="選擇出勤日期與收支月份">
      <label>出勤日期<input key={`date-${overview.periods.date}`} type="date" name="date" min="2000-01-01" max="2200-12-31" required defaultValue={overview.periods.date} /></label>
      <label>收支月份<input key={`month-${overview.periods.month}`} type="month" name="month" min="2000-01" max="2200-12" required defaultValue={overview.periods.month} /></label>
      <button className="button button--secondary" disabled={pending || !online || operationPending || viewPending} type="submit"><RefreshCw aria-hidden="true" />{pending ? "更新中…" : "更新資料"}</button>
    </form>
    <p className={styles.helper}>日期與月份可分開選擇，皆以臺北時間顯示。</p>
    {!overview.demo && !overview.invalid && <p className={styles.helper}>
      {autoStopped ? "請按「更新資料」確認收支連線。" : "每 55 秒自動讀取；背景、離線與其他操作進行中不會開始新讀取。"}
    </p>}
    {refreshAttention && !hideData && <p className={styles.notice} role="status">
      尚未取得更新的 Finance 資料；{autoStopped
        ? "自動更新已暫停，請按「更新資料」重新確認。" : "將稍後重試；也可按「更新資料」重新確認。"}
    </p>}
    {operationPending && <p className={styles.notice} role="status">有操作結果尚待確認，更新已暫停；請先回原表單確認。</p>}
    {navigationError && <p className={styles.notice} role="alert">更新失敗，請重試或重新整理頁面。</p>}
    {overview.invalid ? <section className={styles.notice} role="alert"><h2>請重新選擇日期與月份</h2><p>日期或查詢條件無效，本次未讀取任何出勤或財務數字。</p></section> : hideData ?
      <section className={styles.notice} role="status"><h2>{online ? "已恢復連線，請更新資料" : "目前離線"}</h2><p>出勤與收支需連線查看。重新連線後，請按「更新資料」取得最新數字。</p></section> : <>
      {stale && <p className={styles.notice} role="status">資料已超過 1 分鐘，可能有新紀錄；請按「更新資料」重新讀取。</p>}
      <div className={styles.sections} aria-busy={pending} inert={pending ? true : undefined}>
        <section className={styles.panel} aria-labelledby="store-attendance-heading">
          <header className={styles.panelHeading}><UsersRound aria-hidden="true" /><div><h2 id="store-attendance-heading">個案出缺勤</h2><p><CalendarDays aria-hidden="true" /><time dateTime={overview.periods.date}>{overview.periods.date}</time></p></div></header>
          {overview.attendance.status === "ready" ? <>
            <dl className={styles.attendanceMetrics}>
              <div><dt>出席</dt><dd>{overview.attendance.data.present}<span>人</span></dd></div>
              <div><dt>請假</dt><dd>{overview.attendance.data.leave}<span>人</span></dd></div>
              <div><dt>缺席</dt><dd>{overview.attendance.data.absent}<span>人</span></dd></div>
            </dl>
            {overview.attendance.data.present + overview.attendance.data.leave + overview.attendance.data.absent === 0 && <p className={styles.notice}>這一天尚無有效出勤紀錄，不代表所有個案都缺席。</p>}
            <p className={styles.updated}>讀取時間：<time dateTime={attendanceAt!}>{formatStoreTimestamp(attendanceAt!)}</time></p>
          </> : <Unavailable source="出勤" status={overview.attendance.status} />}
          <p className={styles.helper}>依已登記的出勤狀態統計，同一個案當天只計一次。未登記與已取消不列入缺席；這裡不計算出勤率。</p>
          <Link className="button button--secondary" prefetch={false} href={`${STORE_ATTENDANCE_MONTH_PATH}?month=${overview.periods.date.slice(0, 7)}`}>查看出缺勤月報</Link>
        </section>
        <section className={styles.panel} aria-labelledby="store-finance-heading">
          <header className={styles.panelHeading}><Wallet aria-hidden="true" /><div><h2 id="store-finance-heading">Finance 收入與支出</h2><p><CalendarDays aria-hidden="true" /><time dateTime={overview.periods.month}>{overview.periods.month}</time><span>・新臺幣</span></p></div></header>
          {overview.finance.status === "ready" ? <>
            <dl className={styles.financeMetrics}>
              <div><dt>收入</dt><dd>{formatTwd(overview.finance.data.income)}<span>元</span></dd></div>
              <div><dt>支出</dt><dd>{formatTwd(overview.finance.data.expenses)}<span>元</span></dd></div>
            </dl>
            {overview.finance.data.entryCount === 0 && <p className={styles.notice}>Finance 這個月尚無分類帳紀錄。</p>}
            <p className={styles.updated}>Finance 讀取時間：<time dateTime={financeAt!}>{formatStoreTimestamp(financeAt!)}</time></p>
          </> : <Unavailable source="Finance" status={overview.finance.status} />}
          <p className={styles.helper}>與 Finance 同店、同月份的分類帳口徑一致；不是銀行實際收付款。修改帳務請回 Finance 處理。</p>
        </section>
      </div>
    </>}
    {pending && <ModuleLoading title="正在更新出勤與收支" transition />}
  </div>;
}
