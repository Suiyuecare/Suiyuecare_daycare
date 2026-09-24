"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { NavigationLink } from "@/components/app/navigation-link";
import { formatCareTaipeiTime } from "@/lib/core-care/date";
import type { DailyExpectedState } from "@/lib/client-weekly/daily-projection";
import type { DispatchRow } from "@/lib/client-weekly/dispatch-reconciliation";
import styles from "./daily-expected.module.css";

function subscribeOnline(changed: () => void) {
  window.addEventListener("online", changed); window.addEventListener("offline", changed);
  return () => { window.removeEventListener("online", changed); window.removeEventListener("offline", changed); };
}
const onlineSnapshot = () => navigator.onLine;
const serverOnlineSnapshot = () => true;
const dispatchLabels: Record<DispatchRow["status"], string> = {
  pending: "待派車", assigned: "已派車", conflict: "重複派車・待核對", restricted: "派車資料無查閱權限",
};

export function DailyExpectedPanel({ state, mode, canOpenIntake, canOpenTransport }: {
  state: DailyExpectedState; mode: "all" | "transport"; canOpenIntake: boolean; canOpenTransport: boolean;
}) {
  const router = useRouter();
  const online = useSyncExternalStore(subscribeOnline, onlineSnapshot, serverOnlineSnapshot);
  const [pending, startTransition] = useTransition();
  const [visible, setVisible] = useState(10);
  const [dispatchFilter, setDispatchFilter] = useState<"all" | DispatchRow["status"]>("all");
  const [staleGeneration, setStaleGeneration] = useState<string | null>(null);
  const generatedAt = state.status === "ready" ? state.generatedAt : null;
  const stale = generatedAt !== null && staleGeneration === generatedAt;
  useEffect(() => {
    if (!generatedAt) return;
    const timer = window.setTimeout(() => setStaleGeneration(generatedAt), Math.max(0, new Date(generatedAt).getTime() + 60_000 - Date.now()));
    return () => window.clearTimeout(timer);
  }, [generatedAt]);
  const dispatch = state.status === "ready" ? state.dispatch : null;
  const dispatchByClient = new Map<string, DispatchRow[]>();
  if (dispatch?.status === "ready") for (const row of dispatch.rows) {
    const rows = dispatchByClient.get(row.clientId) ?? [];
    rows.push(row); dispatchByClient.set(row.clientId, rows);
  }
  const clients = state.status === "ready" ? state.clients.filter((row) =>
    (mode === "all" || row.outbound || row.inbound) &&
    (dispatchFilter === "all" || dispatch?.status !== "ready" || dispatchByClient.get(row.clientId)?.some((item) => item.status === dispatchFilter))) : [];
  const transportHref = `/app/staff/service-management/transport-plans?date=${encodeURIComponent(state.serviceDate)}`;
  return <section className={styles.panel} aria-label={mode === "transport" ? "接送需求與派車核對" : "預計到站與接送需求"} aria-busy={pending}>
    <header className={styles.heading}><div><h2>{mode === "transport" ? "接送需求與派車核對" : "預計到站・接送需求"}</h2><p>{state.serviceDate} · 依已保存的每週安排與當日異動</p></div>
      <button type="button" className="button button--secondary" disabled={!online || pending || state.status === "demo" || state.status === "forbidden"} onClick={() => startTransition(() => router.refresh())}>{pending ? "更新中…" : "重新讀取"}</button></header>
    <p className={styles.note}>這是預計名冊，不是簽到結果；派車核對以同個案、日期及方向的最新已發布趟次為準，不代表已接到或完成服務。</p>
    {!online ? <p role="status" className={styles.notice}>目前離線，以下安排可能已變動；連線後請重新讀取。</p> : null}
    {stale && online ? <p role="status" className={styles.notice}>資料已超過一分鐘，安排可能有異動，請重新讀取。</p> : null}
    {state.status !== "ready" ? <p role={state.status === "unavailable" ? "alert" : "status"} className={styles.notice}>
      {state.status === "forbidden" ? "目前沒有查看這個分支安排的權限。" : state.status === "demo" ? "合成展示不連接正式每週安排，這裡尚不顯示實際人數。" : "目前無法讀取預計名冊，尚不能確認人數；請重試，或向排程負責人核對。"}
    </p> : <>
      <dl className={styles.metrics}><div><dt>預計到站</dt><dd>{state.expectedCount}<small> 人</small></dd></div><div><dt>需要接送</dt><dd>{state.transportClientCount}<small> 人</small></dd></div><div><dt>去程／回程需求</dt><dd>{state.outboundCount}<small>／</small>{state.inboundCount}<small> 人次</small></dd></div></dl>
      {dispatch?.status === "ready" ? <><div className={styles.dispatchFilters} role="group" aria-label="依派車核對狀態查看">
        {([['all', '全部', state.outboundCount + state.inboundCount], ['pending', '待派車', dispatch.pendingCount], ['assigned', '已派車', dispatch.assignedCount], ['conflict', '重複待核對', dispatch.conflictCount], ['restricted', '無查閱權限', dispatch.restrictedCount]] as const).map(([value, label, count]) =>
          <button type="button" key={value} aria-pressed={dispatchFilter === value} onClick={() => { setDispatchFilter(value); setVisible(10); }}>{label} {count} 人次</button>)}
      </div><p className={styles.note}>人次依去程、回程分開計算；下方個案清單會顯示該個案的兩個方向。</p></> : <p role="status" className={styles.notice}>目前可查看接送需求，但沒有核對正式派車資料的權限；不能據此判定已派車或尚未派車。</p>}
      {clients.length === 0 ? <p className={styles.empty}>{dispatchFilter !== "all" && dispatch?.status === "ready" ? "沒有符合此派車核對狀態的個案，請選擇其他狀態。" : mode === "transport" ? "這一天目前沒有已保存且適用的接送需求；請核對每週安排與當日異動。" : "這一天目前沒有已保存且適用的預計到站安排。尚未收案、請假、停用與已過期安排不列入。"}</p> : <ul className={styles.list}>{clients.slice(0, visible).map((row) => <li key={row.clientId}>
        <div><strong>{row.displayName}</strong><p>{row.startsAt} 到站 · {row.endsAt} 離站</p><p>{row.outbound ? "去程需接送" : "去程自行到站"} · {row.inbound ? "回程需接送" : "回程自行離站"}</p>
          {dispatchByClient.get(row.clientId)?.map((item) => <div className={styles.dispatchRow} key={item.direction}>
            <span>{item.direction === "pickup" ? "到站去程" : "返家回程"}：{dispatchLabels[item.status]}</span>
            {canOpenTransport && item.status !== "restricted" ? <NavigationLink className="button button--secondary" loadingLabel="交通趟次計畫" href={`${transportHref}&direction=${item.direction}`} prefetch={false}>{item.direction === "pickup" ? "核對當日去程" : "核對當日回程"}</NavigationLink> : null}
          </div>)}
        </div>
        {canOpenIntake ? <NavigationLink className="button button--secondary" loadingLabel="個案每週安排" href={`/app/client-intake?client=${row.clientId}&step=weekly`} prefetch={false}>查看每週安排</NavigationLink> : null}
      </li>)}</ul>}
      {clients.length > visible ? <button type="button" className="button button--secondary" onClick={() => setVisible((current) => current + 10)}>再顯示 10 位（尚有 {clients.length - visible} 位）</button> : null}
      <p className={styles.timestamp}>資料時間：<time dateTime={state.generatedAt}>{formatCareTaipeiTime(state.generatedAt)}</time>（台北）</p>
    </>}
    {canOpenTransport ? <NavigationLink className="button button--secondary" loadingLabel="交通趟次計畫" href={transportHref} prefetch={false}>開啟交通趟次計畫</NavigationLink> : null}
  </section>;
}
