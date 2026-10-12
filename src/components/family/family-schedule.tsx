"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Bus, CalendarDays, List, RefreshCw } from "lucide-react";
import { z } from "zod";
import { familyScheduleSchema, type FamilyScheduleSnapshot } from "@/lib/family/workspace-schema";
import { formatCareTaipeiTime } from "@/lib/core-care/date";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import styles from "./family-schedule.module.css";
const labels = { scheduled: "已安排", cancelled: "已取消", completed: "已完成", boarded: "已上車", alighted: "已下車", attention: "待聯絡確認" };
const currentMonth = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" }).format(new Date());
async function readSchedule(clientId: string, audience: "staff" | "family", month: string, signal: AbortSignal) {
  const response = await fetchWithTimeout(`/api/family-schedule?${new URLSearchParams({ client: clientId, audience, month })}`, { cache: "no-store", signal }, 15_000);
  const result = z.object({ data: z.object({ snapshot: familyScheduleSchema }) }).safeParse(await response.json());
  if (!response.ok || !result.success || result.data.data.snapshot.clientId !== clientId || result.data.data.snapshot.month !== month) throw new Error(response.status === 401 || response.status === 403 ? "此個案的行程授權已失效。" : "行程暫時無法讀取，請重試。");
  return result.data.data.snapshot;
}
export function FamilySchedule({ clientId, audience = "family" }: { clientId: string; audience?: "staff" | "family" }) { return <Schedule key={`${audience}:${clientId}`} clientId={clientId} audience={audience} />; }
function Schedule({ clientId, audience }: { clientId: string; audience: "staff" | "family" }) {
  const id = useId(); const [month, setMonth] = useState(currentMonth); const [view, setView] = useState<"list" | "calendar">("list"); const [snapshot, setSnapshot] = useState<FamilyScheduleSnapshot | null>(null); const [busy, setBusy] = useState(true); const [error, setError] = useState(""); const active = useRef(false); const loading = useRef<AbortController | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; loading.current?.abort(); }; }, []);
  const load = useCallback(async () => {
    loading.current?.abort(); const controller = new AbortController(); loading.current = controller;
    try {
      const result = await readSchedule(clientId, audience, month, controller.signal);
      if (active.current && loading.current === controller && !controller.signal.aborted) { setSnapshot(result); setError(""); }
    } catch (failure) { if (active.current && loading.current === controller) { setSnapshot(null); setError(failure instanceof Error && failure.name !== "AbortError" ? failure.message : "讀取逾時，請重試。"); } }
    finally { if (active.current && loading.current === controller) setBusy(false); }
  }, [clientId, audience, month]);
  useEffect(() => {
    const controller = new AbortController(); loading.current = controller;
    void readSchedule(clientId, audience, month, controller.signal).then(result => { if (active.current && !controller.signal.aborted && loading.current === controller) { setSnapshot(result); setError(""); } }).catch(failure => { if (active.current && loading.current === controller) { setSnapshot(null); setError(failure instanceof Error && failure.name !== "AbortError" ? failure.message : "讀取逾時，請重試。"); } }).finally(() => { if (active.current && loading.current === controller) setBusy(false); });
    const timer = setInterval(() => { if (navigator.onLine) void load(); }, 60_000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [clientId, audience, month, load]);
  const days = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate() : 0;
  const rows = snapshot?.items ?? [];
  return <section className={styles.root} aria-label="活動與接送行程"><div className={styles.toolbar}><label htmlFor={`${id}-month`}>月份<input id={`${id}-month`} type="month" value={month} min="2000-01" max="2100-01" onChange={event => { setSnapshot(null); setBusy(true); setMonth(event.target.value); }} /></label><div className={styles.actions}><button className="button button--secondary" type="button" aria-pressed={view === "list"} onClick={() => setView("list")}><List aria-hidden="true" />列表</button><button className="button button--secondary" type="button" aria-pressed={view === "calendar"} onClick={() => setView("calendar")}><CalendarDays aria-hidden="true" />月曆</button><button className="button button--secondary" type="button" disabled={busy} onClick={() => { setBusy(true); void load(); }}><RefreshCw aria-hidden="true" />更新行程</button></div></div>
    {busy ? <p role="status">讀取行程…</p> : null}{error ? <p role="alert">{error}</p> : null}{snapshot ? <><small>更新 {formatCareTaipeiTime(snapshot.updatedAt)}</small>{!rows.length ? <p>本月尚無已核准的活動或接送</p> : null}{view === "list" ? <ol className={styles.list}>{rows.map(item => <li key={item.id}><span className={styles.icon}>{item.kind === "transport" ? <Bus aria-hidden="true" /> : <CalendarDays aria-hidden="true" />}</span><div><strong>{item.title}</strong><p>{formatCareTaipeiTime(item.startsAt)} — {formatCareTaipeiTime(item.endsAt).slice(11)}</p></div><span>{labels[item.status]}</span></li>)}</ol> : <ol className={styles.calendar}>{Array.from({ length: days }, (_, index) => { const date = `${month}-${String(index + 1).padStart(2, "0")}`; return <li key={date}><strong>{index + 1}日</strong>{rows.filter(row => row.date === date).map(row => <p key={row.id}>{row.kind === "transport" ? <Bus aria-hidden="true" /> : <CalendarDays aria-hidden="true" />}<span>{row.title}<small>{formatCareTaipeiTime(row.startsAt).slice(11)} · {labels[row.status]}</small></span></p>)}</li>; })}</ol>}</> : null}
  </section>;
}
