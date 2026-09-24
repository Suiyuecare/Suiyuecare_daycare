"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { SnapshotFreshness } from "@/components/ui/snapshot-freshness";
import { formatCareTaipeiTime } from "@/lib/core-care/date";
import { STORE_ATTENDANCE_MONTH_PATH } from "@/lib/store-overview/attendance-month";
import type { AttendanceMonthSnapshot } from "@/lib/store-overview/attendance-month-snapshot";
import { STORE_OVERVIEW_PATH } from "@/lib/store-overview/types";
import styles from "./store-overview.module.css";

export function AttendanceMonthWorkspace({ snapshot }: { snapshot: AttendanceMonthSnapshot }) {
  const [connection, setConnection] = useState<"online" | "offline" | "reconnect">("online");
  useEffect(() => {
    const offline = () => setConnection("offline");
    const online = () => setConnection("reconnect");
    if (!navigator.onLine) offline();
    window.addEventListener("offline", offline); window.addEventListener("online", online);
    return () => { window.removeEventListener("offline", offline); window.removeEventListener("online", online); };
  }, []);
  const data = snapshot.source.status === "ready" ? snapshot.source.data : null;
  return <div className={styles.workspace}>
    <header className="page-heading"><div><p className="eyebrow">{snapshot.branchName}</p><h1>出缺勤月報</h1>
      <p>查看每天已登記的出席、請假與缺席，以及整月人次。</p></div></header>
    {snapshot.demo && <p className={styles.notice}>合成展示資料，不是正式營運報表。</p>}
    <form action={STORE_ATTENDANCE_MONTH_PATH} method="get" className={styles.filters} aria-label="出缺勤月報月份">
      <label>月份<input name="month" type="month" key={snapshot.month} defaultValue={snapshot.month} min="2000-01" max="2200-12" required /></label>
      <button type="submit" className="button button--primary" disabled={connection === "offline"}>查詢月報</button>
    </form>
    {snapshot.invalid ? <p role="alert" className={styles.notice}>月份或查詢條件無效，請重新選擇；本次未讀取報表。</p>
      : connection !== "online" ? <p role="status" className={styles.notice}>{connection === "offline" ? "目前離線，報表需連線查看。" : "已恢復連線，請按查詢月報重新確認權限並取得資料。"}</p>
        : !data ? <p role="alert" className={styles.notice}>{snapshot.source.status === "timeout" ? "月報讀取逾時。" : "月報暫時無法讀取。"}請重新查詢；無法讀取不代表 0 人。</p> : <>
          <SnapshotFreshness expiresAt={new Date(Date.parse(data.generatedAt) + 60_000).toISOString()} demo={snapshot.demo} />
          <dl className={styles.attendanceMetrics} aria-label="當月已登記人次">
            <div><dt>出席人次</dt><dd>{data.totals.present}</dd></div>
            <div><dt>請假人次</dt><dd>{data.totals.leave}</dd></div>
            <div><dt>缺席人次</dt><dd>{data.totals.absent}</dd></div>
          </dl>
          <p>當月曾出席：{data.distinctPresentClients} 位個案（不重複）。</p>
          <p className={styles.updated}>資料讀取於 {formatCareTaipeiTime(data.generatedAt)}；重新查詢可能取得新版紀錄。</p>
          <div className={styles.monthTable}><table><caption>{data.month} 每日已登記出缺勤；單日同一個案只計一次</caption>
            <thead><tr><th scope="col">日期</th><th scope="col">出席</th><th scope="col">請假</th><th scope="col">缺席</th><th scope="col">查看</th></tr></thead>
            <tbody>{data.days.map((day) => <tr key={day.date}><th scope="row"><time dateTime={day.date}>{day.date.slice(5)}</time></th>
              <td>{day.present}</td><td>{day.leave}</td><td>{day.absent}</td>
              <td><Link prefetch={false} href={`${STORE_OVERVIEW_PATH}?date=${day.date}&month=${data.month}`} aria-label={`查看 ${day.date} 出勤`}>當日</Link></td></tr>)}</tbody>
          </table></div>
        </>}
    <p className={styles.notice}>只統計已登記且未取消的有效紀錄，未登記不等於缺席。人次是每天人數相加，不是不同個案人數；目前不計算應到人數、出勤率，也不提供正式匯出。</p>
    <Link className="button button--secondary" prefetch={false} href={STORE_OVERVIEW_PATH}>返回單店出勤與收支</Link>
  </div>;
}
