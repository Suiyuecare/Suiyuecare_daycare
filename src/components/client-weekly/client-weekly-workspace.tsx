"use client";

import { useEffect, useRef, useState } from "react";
import { addDays, emptyDay, emptyPlan, previewWeeklyPlan, weekdayOf, weeklyInputSchema, weeklyReceiptSchema, weeklySnapshotSchema, type TransportNeed, type WeeklyDay, type WeeklyInput, type WeeklyPlan, type WeeklySnapshot } from "@/lib/client-weekly/schema";
import styles from "./client-weekly.module.css";

const WEEKDAYS = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"];
const STATUS = { scheduled: "應到・尚非出勤", not_scheduled: "未安排", cancelled: "請假／取消", inactive: "服務暫停或已終止", not_admitted: "尚未正式收案／未到收案日", plan_expired: "不在週表生效期間" };
type Props = { clientId: string; canManage: boolean; demo?: boolean; today: string; onDirty?: (dirty: boolean) => void; onBusy?: (busy: boolean) => void };
type Envelope = { status: string; data?: unknown; errors?: { code?: string; message?: string }[] };
type PendingWrite = { input: WeeklyInput; body: string; everUncertain: boolean; confirmedVersion?: number };

async function readSnapshot(clientId: string, from: string, signal?: AbortSignal) {
  const response = await fetch(`/api/client-weekly?client=${encodeURIComponent(clientId)}&from=${from}`, { cache: "no-store", signal: signal ?? AbortSignal.timeout(15000) });
  const body = await response.json() as Envelope;
  if (!response.ok || body.status !== "ok") throw new Error(body.errors?.[0]?.message ?? "每週安排暫時無法讀取，請重試。");
  const snapshot = weeklySnapshotSchema.parse(body.data);
  if (snapshot.clientId !== clientId || snapshot.from !== from || snapshot.days.some((day, i) => day.date !== addDays(from, i))) throw new Error("讀回的安排與目前個案不一致，請重新載入。");
  return snapshot;
}
function planFromSnapshot(snapshot: WeeklySnapshot, today: string): WeeklyPlan {
  const p = snapshot.plan;
  return p ? { effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo, days: p.days, reason: p.reason } : emptyPlan(today);
}
function defaultTransport(direction: "outbound" | "inbound", day: WeeklyDay): TransportNeed {
  const value = direction === "outbound" ? day.startsAt ?? "09:00" : day.endsAt ?? "16:00";
  return { location: "", contact: "", windowStart: value, windowEnd: value, wheelchair: false };
}
function TransportReview({ day }: { day: WeeklyDay }) {
  return <>{(["outbound", "inbound"] as const).map((direction) => {
    const need = day[direction];
    const label = direction === "outbound" ? "去程" : "回程";
    return <p key={direction}>{label}：{need ? `${need.windowStart}–${need.windowEnd}，${need.location}，${need.contact}，${need.wheelchair ? "需要輪椅空間" : "不需輪椅空間"}` : "不需接送"}</p>;
  })}</>;
}
function DayEditor({ value, onChange, label, disabled }: { value: WeeklyDay; onChange: (day: WeeklyDay) => void; label: string; disabled: boolean }) {
  return <fieldset className={styles.day} disabled={disabled}>
    <legend>{label}</legend>
    <label className={styles.check}><input type="checkbox" checked={value.attending} onChange={(event) => onChange(event.target.checked ? { ...value, attending: true, startsAt: "09:00", endsAt: "16:00" } : emptyDay(value.weekday))} />{label}到站</label>
    {value.attending ? <>
      <div className={styles.fields}>
        <label>{label}到站時間<input type="time" value={value.startsAt ?? ""} onChange={(event) => onChange({ ...value, startsAt: event.target.value })} required /></label>
        <label>{label}離站時間<input type="time" value={value.endsAt ?? ""} onChange={(event) => onChange({ ...value, endsAt: event.target.value })} required /></label>
      </div>
      {(["outbound", "inbound"] as const).map((direction) => {
        const text = direction === "outbound" ? "去程" : "回程";
        const need = value[direction];
        const update = (patch: Partial<TransportNeed>) => { if (need) onChange({ ...value, [direction]: { ...need, ...patch } }); };
        return <div className={styles.transport} key={direction}>
          <label className={styles.check}><input type="checkbox" checked={need !== null} onChange={(event) => onChange({ ...value, [direction]: event.target.checked ? defaultTransport(direction, value) : null })} />{label}{text}需要交通車</label>
          {need ? <div className={styles.fields}>
            <label>{label}{text}接送地點<input value={need.location} maxLength={300} onChange={(event) => update({ location: event.target.value })} required /></label>
            <label>{label}{text}聯絡人／電話<input value={need.contact} maxLength={300} onChange={(event) => update({ contact: event.target.value })} required /></label>
            <label>{label}{text}時間窗開始<input type="time" value={need.windowStart} onChange={(event) => update({ windowStart: event.target.value })} required /></label>
            <label>{label}{text}時間窗結束<input type="time" value={need.windowEnd} onChange={(event) => update({ windowEnd: event.target.value })} required /></label>
            <label className={styles.check}><input type="checkbox" checked={need.wheelchair} onChange={(event) => update({ wheelchair: event.target.checked })} />{label}{text}需要輪椅空間</label>
          </div> : null}
        </div>;
      })}
    </> : <p>本日不來；不建立交通需求。</p>}
  </fieldset>;
}

/** Keyed boundary prevents drafts/receipts from leaking across selected clients. */
export function ClientWeeklyWorkspace(props: Props) { return <WeeklyEditor key={props.clientId} {...props} />; }
function WeeklyEditor({ clientId, canManage, demo = false, today, onDirty, onBusy }: Props) {
  const [snapshot, setSnapshot] = useState<WeeklySnapshot | null>(null);
  const [plan, setPlan] = useState(() => emptyPlan(today));
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [exceptionDirty, setExceptionDirty] = useState(false);
  const [exceptionDate, setExceptionDate] = useState(today);
  const [exceptionDay, setExceptionDay] = useState(() => emptyDay(weekdayOf(today)));
  const [exceptionReason, setExceptionReason] = useState("");
  const pending = useRef<PendingWrite | null>(null);
  const [recovery, setRecovery] = useState<"uncertain" | "conflict" | "committed" | null>(null);
  const [review, setReview] = useState<WeeklySnapshot | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [recoveryContext, setRecoveryContext] = useState<{ serviceDate: string | null; confirmedVersion: number | null }>({ serviceDate: null, confirmedVersion: null });
  const lock = useRef(false);
  useEffect(() => { onBusy?.(saving); return () => onBusy?.(false); }, [saving, onBusy]);
  useEffect(() => { onDirty?.(dirty || exceptionDirty || recovery !== null); }, [dirty, exceptionDirty, recovery, onDirty]);
  useEffect(() => {
    if (!dirty && !exceptionDirty && !recovery) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, exceptionDirty, recovery]);
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    void readSnapshot(clientId, today, controller.signal).then((data) => { setSnapshot(data); setPlan(planFromSnapshot(data, today)); setExceptionDay(data.exceptions.find((row) => row.serviceDate === today)?.day ?? data.days[0]?.day ?? emptyDay(weekdayOf(today))); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "讀取失敗，請重試。"); else setError("讀取逾時，請重試。"); })
      .finally(() => { clearTimeout(timeout); setLoading(false); });
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [clientId, today, demo]);
  async function reload() {
    if (demo || lock.current || pending.current || recovery) return;
    if ((dirty || exceptionDirty) && !window.confirm("重新載入會捨棄未儲存的每週安排與單日異動。確定繼續嗎？")) return;
    setLoading(true); setError(""); setMessage("");
    try { const data = await readSnapshot(clientId, today); setSnapshot(data); setPlan(planFromSnapshot(data, today)); setDirty(false); setExceptionDirty(false); pending.current = null; setExceptionDay(data.exceptions.find((row) => row.serviceDate === exceptionDate)?.day ?? data.days.find((row) => row.date === exceptionDate)?.day ?? emptyDay(weekdayOf(exceptionDate))); setExceptionReason(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "讀取失敗，請重試。"); }
    finally { setLoading(false); }
  }
  function chooseExceptionDate(date: string) {
    if (lock.current || pending.current || recovery) return;
    if (date === exceptionDate || (exceptionDirty && !window.confirm("更換日期會捨棄這筆未儲存的單日異動。確定更換嗎？"))) return;
    setExceptionDate(date);
    const existing = snapshot?.exceptions.find((row) => row.serviceDate === date);
    const projected = snapshot?.days.find((row) => row.date === date)?.day;
    setExceptionDay(existing?.day ?? projected ?? emptyDay(weekdayOf(date)));
    setExceptionReason(existing?.reason ?? "");
    setExceptionDirty(false);
  }
  async function save(action: "save_plan" | "save_exception") {
    if (demo || !canManage || !snapshot || lock.current || loading || recovery === "conflict" || recovery === "committed") return;
    // The operation, not the currently visible editor, owns all retry bytes.
    // A timeout may have committed: another action must never replace its key.
    if (pending.current && pending.current.input.action !== action) return;
    setError(""); setMessage("");
    if (!pending.current) {
      const input = action === "save_plan" ? { action, clientId, expectedVersion: snapshot.version, plan } : { action, clientId, expectedVersion: snapshot.exceptions.find((row) => row.serviceDate === exceptionDate)?.version ?? 0, serviceDate: exceptionDate, day: exceptionDay, reason: exceptionReason };
      const parsed = weeklyInputSchema.safeParse({ ...input, idempotency_key: crypto.randomUUID() });
      if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "請補齊每週安排。"); return; }
      pending.current = { input: parsed.data, body: JSON.stringify(parsed.data), everUncertain: false };
      setRecoveryContext({ serviceDate: parsed.data.action === "save_exception" ? parsed.data.serviceDate : null, confirmedVersion: null });
    }
    const operation = pending.current;
    lock.current = true; setSaving(true);
    try {
      const response = await fetch("/api/client-weekly", { method: "POST", headers: { "content-type": "application/json", "x-client-weekly-action": "save" }, body: operation.body, signal: AbortSignal.timeout(15000) });
      const body = await response.json() as Envelope;
      if (!response.ok || body.status !== "ok") {
        const confirmedConflict = response.status === 409 && body.status === "error" && body.errors?.[0]?.code === "WEEKLY_CONFLICT";
        const confirmedRejection = [400, 401, 403].includes(response.status) && body.status === "error" && Boolean(body.errors?.[0]?.code);
        // A later rejection says nothing about an earlier request's commit.
        if (!operation.everUncertain && (confirmedConflict || confirmedRejection)) {
          setError(body.errors?.[0]?.message ?? "本次安排未儲存，請核對後重試。");
          if (confirmedConflict) { setRecovery("conflict"); setReview(null); setReviewConfirmed(false); }
          else { pending.current = null; setRecovery(null); }
          return;
        }
        throw new Error(body.errors?.[0]?.message ?? "儲存尚未確認；請保留內容並重試。");
      }
      const receipt = weeklyReceiptSchema.parse((body.data as { receipt?: unknown })?.receipt);
      if (receipt.clientId !== clientId || receipt.version !== operation.input.expectedVersion + 1 || receipt.action !== operation.input.action) throw new Error("儲存回條不一致，請以原操作重試。");
      operation.confirmedVersion = receipt.version;
      setRecoveryContext((value) => ({ ...value, confirmedVersion: receipt.version }));
      const data = await readSnapshot(clientId, today);
      const serviceDate = operation.input.action === "save_exception" ? operation.input.serviceDate : null;
      const visibleVersion = serviceDate === null ? data.version : data.exceptions.find((row) => row.serviceDate === serviceDate)?.version;
      if (visibleVersion !== undefined && visibleVersion > receipt.version) {
        // A bound success receipt positively settles the original write. A newer
        // readback is reviewable, but must never silently replace a user's draft.
        operation.everUncertain = false; setReview(data); setReviewConfirmed(false); setRecovery("committed"); return;
      }
      if (visibleVersion !== receipt.version) throw new Error("已取得儲存回條，但最新資料尚未核對完成。請確認原次儲存結果，不要重複新增。");
      setSnapshot(data);
      if (action === "save_plan") { setPlan(planFromSnapshot(data, today)); setDirty(false); }
      else { setExceptionDirty(false); }
      pending.current = null;
      setRecovery(null); setReview(null); setReviewConfirmed(false);
      setMessage(`已儲存並重新讀回第 ${receipt.version} 版；這是到站安排與待排交通需求，尚不是出勤或派車紀錄。`);
    } catch (reason) {
      operation.everUncertain = true; setRecovery("uncertain");
      setError(reason instanceof Error ? reason.message : "儲存尚未確認，請保留內容並重試。");
    }
    finally { lock.current = false; setSaving(false); }
  }
  async function loadConflictReview() {
    if (demo || lock.current || (recovery !== "conflict" && recovery !== "committed") || !pending.current || pending.current.everUncertain) return;
    lock.current = true; setLoading(true); setReviewConfirmed(false); setError("");
    try {
      const current = await readSnapshot(clientId, today);
      const input = pending.current.input;
      const exceptionDate = input.action === "save_exception" ? input.serviceDate : null;
      const version = exceptionDate === null ? current.version : current.exceptions.find((row) => row.serviceDate === exceptionDate)?.version ?? 0;
      if (recovery === "committed" && version < (pending.current.confirmedVersion ?? Number.POSITIVE_INFINITY)) throw new Error("讀回版本早於已確認回條，請稍後重新讀取；不會改用較舊資料。");
      setReview(current);
    }
    catch (reason) { setReview(null); setError(reason instanceof Error ? reason.message : "目前版本尚未讀取，草稿仍保留。"); }
    finally { lock.current = false; setLoading(false); }
  }
  function useReviewedBaseline() {
    if (!review || !reviewConfirmed || (recovery !== "conflict" && recovery !== "committed") || !pending.current || pending.current.everUncertain || lock.current) return;
    if (recovery === "committed") {
      if (pending.current.input.action === "save_plan") { setPlan(planFromSnapshot(review, today)); setDirty(false); }
      else {
        const serviceDate = pending.current.input.serviceDate;
        const current = review.exceptions.find((row) => row.serviceDate === serviceDate);
        setExceptionDay(current?.day ?? review.days.find((row) => row.date === serviceDate)?.day ?? emptyDay(weekdayOf(serviceDate)));
        setExceptionReason(current?.reason ?? ""); setExceptionDirty(false);
      }
    }
    setSnapshot(review); pending.current = null; setRecovery(null); setReview(null); setReviewConfirmed(false); setError("");
    setMessage(recovery === "committed" ? "原次儲存已確認，已採用目前安排；其他未送出的草稿仍保留，沒有再建立新版本。" : "已核對目前版本，您的草稿仍保留。請再檢查內容後儲存；尚未送出任何新異動。");
  }
  const disabled = saving || loading || recovery !== null || (!canManage && !demo) || (!demo && !snapshot);
  const pendingExceptionDate = recoveryContext.serviceDate;
  const reviewException = review?.exceptions.find((row) => row.serviceDate === pendingExceptionDate);
  const preview = dirty || demo ? previewWeeklyPlan(plan, today) : snapshot?.days ?? [];
  return <section className={styles.workspace} aria-label="每週到站與交通需求">
    <div><h2>每週到站與交通需求</h2><p>先設定固定來站日，再處理請假、臨時加日或改時間。去程及回程可分別安排；車輛與駕駛仍須另行派定。</p></div>
    {demo ? <p className={styles.notice}>合成互動示範：可試排四週，所有變更僅在此畫面，不會儲存正式資料。</p> : null}
    {!canManage && !demo ? <p className={styles.notice}>您可檢視已授權個案安排；修改需排程管理權限與最近的身分確認。</p> : null}
    {loading ? <p role="status">正在讀取每週安排…</p> : null}
    {error ? <p role="alert" className={styles.notice}>{error} 草稿未清除。{!recovery ? "重新載入會捨棄目前草稿。" : ""}</p> : null}
    {recovery === "uncertain" ? <section className={styles.notice} aria-label="確認原次儲存結果"><h3>先確認剛才的儲存</h3><p>連線或回條尚未確認，資料可能已存入。已暫停修改、換日期與另一種安排；重試只會沿用剛才同一份內容，不會另開新操作。</p><p>若畫面提示重新登入或權限不足，請恢復授權後回來確認原次結果；這不表示先前一定沒有存入。</p><button type="button" disabled={saving || loading || !canManage} onClick={() => { const action = pending.current?.input.action; if (action) void save(action); }}>重試確認原次儲存</button></section> : null}
    {recovery === "conflict" || recovery === "committed" ? <section className={styles.notice} aria-label="核對版本衝突"><h3>{recovery === "committed" ? "原次已儲存，目前另有更新版本" : "安排版本已變動，請先核對"}</h3><p>{recovery === "committed" ? `原次已確認存入第 ${recoveryContext.confirmedVersion} 版，目前已有其他更新。請比對後採用目前安排，不會再送出新操作；另一種未送出的草稿仍保留。` : "本次操作被拒絕，草稿仍保留在下方。讀取目前版本不會自動改寫草稿，也不會再次送出。"}</p><button type="button" disabled={saving || loading} onClick={() => void loadConflictReview()}>讀取目前版本供核對</button>{review ? <>
      <h4>伺服器目前安排・週表第 {review.version} 版</h4><p>生效：{review.plan?.effectiveFrom ?? "尚未設定"} 至 {review.plan?.effectiveTo ?? "未指定結束日"}；安排依據：{review.plan?.reason ?? "尚未設定"}</p>
      <ul>{review.plan?.days.map((day) => <li key={day.weekday}>{WEEKDAYS[day.weekday - 1]}：{day.attending ? `${day.startsAt}–${day.endsAt}` : "不到站"}<TransportReview day={day} /></li>)}</ul>
      {pendingExceptionDate ? <><h4>{pendingExceptionDate} 單日異動</h4>{reviewException ? <><p>目前第 {reviewException.version} 版：{reviewException.day.attending ? `${reviewException.day.startsAt}–${reviewException.day.endsAt}` : "請假／取消"}；理由：{reviewException.reason}</p><TransportReview day={reviewException.day} /></> : <p>目前沒有這一天的單日異動，依週表安排。</p>}</> : null}
      <label className={styles.check}><input type="checkbox" checked={reviewConfirmed} disabled={saving || loading} onChange={(event) => setReviewConfirmed(event.target.checked)} />{recovery === "committed" ? "我已比對目前安排，同意採用目前版並結束原次確認" : "我已比對目前安排與下方保留的草稿，了解再次儲存將建立新版本"}</label><button type="button" disabled={!reviewConfirmed || saving || loading} onClick={useReviewedBaseline}>{recovery === "committed" ? "採用目前安排，結束確認" : "採用核對版本，繼續編輯草稿"}</button>
    </> : null}</section> : null}
    {message ? <p role="status" className={styles.notice}>{message}</p> : null}
    {!demo ? <button type="button" disabled={saving || loading || recovery !== null} onClick={() => void reload()}>{dirty || exceptionDirty ? "捨棄草稿並重新載入" : "重新載入每週安排"}</button> : null}
    <form onSubmit={(event) => { event.preventDefault(); void save("save_plan"); }}>
      <fieldset disabled={disabled}><legend>固定每週安排 {snapshot ? `・目前第 ${snapshot.version} 版` : ""}</legend>
        {plan.effectiveFrom < today ? <p>目前顯示已生效的歷史版本。調整前，請把新版本生效日期設為今天或未來日期；不會覆寫過去安排。</p> : null}
        <div className={styles.fields}>
          <label>週表生效日期<input type="date" min={today} max={addDays(today, 366)} required value={plan.effectiveFrom} onChange={(event) => { setPlan({ ...plan, effectiveFrom: event.target.value }); setDirty(true); }} /></label>
          <label>週表結束日期（可留空）<input type="date" min={plan.effectiveFrom} value={plan.effectiveTo ?? ""} onChange={(event) => { setPlan({ ...plan, effectiveTo: event.target.value || null }); setDirty(true); }} /></label>
        </div>
        <div className={styles.week}>{plan.days.map((day) => <DayEditor key={day.weekday} value={day} label={WEEKDAYS[day.weekday - 1]} disabled={disabled} onChange={(value) => { setPlan({ ...plan, days: plan.days.map((item) => item.weekday === value.weekday ? value : item) }); setDirty(true); }} />)}</div>
        <label>安排依據／異動理由<textarea value={plan.reason} minLength={3} maxLength={300} required onChange={(event) => { setPlan({ ...plan, reason: event.target.value }); setDirty(true); }} /></label>
      </fieldset>
      <button type="submit" disabled={disabled || demo}>{demo ? "展示模式不儲存" : saving ? "儲存並核對中…" : "儲存每週安排"}</button>
    </form>
    <div><h3>{dirty || demo ? "未儲存草稿・四週預覽" : snapshot ? "已儲存安排・四週預覽" : "安排尚未載入"}</h3><p>{snapshot || demo || dirty ? `共 ${preview.filter((row) => row.status === "scheduled").length} 個計畫到站日。` : "未取得正式安排，不能判定應到人數。"}{dirty || demo ? "草稿預覽尚未套用單日例外、收案及暫停狀態；儲存後以正式讀回結果為準。" : snapshot ? "已套用單日例外及目前服務狀態；不等於實際出勤。" : ""}</p>
      <ol className={styles.preview}>{preview.map((row) => <li key={row.date}><strong>{row.date} {WEEKDAYS[weekdayOf(row.date) - 1]}</strong><span>{STATUS[row.status]}</span>{row.status === "scheduled" && row.day ? <><span>{row.day.startsAt}–{row.day.endsAt}</span><span>去程：{row.day.outbound ? "需車・待排" : "自行到站"}／回程：{row.day.inbound ? "需車・待排" : "自行離站"}</span></> : null}</li>)}</ol>
    </div>
    <form onSubmit={(event) => { event.preventDefault(); void save("save_exception"); }}>
      <fieldset disabled={disabled || demo}><legend>單日請假／加日／改時間</legend><p>單日異動不改寫固定週表與歷史出勤。取消當日請取消「當日到站」；加日與改時請勾選並填寫。</p>
        <label>異動日期{exceptionDirty ? "（更換日期會捨棄此筆單日草稿）" : ""}<input type="date" min={today} max={addDays(today, 27)} value={exceptionDate} required onChange={(event) => { if (event.target.value) chooseExceptionDate(event.target.value); }} /></label>
        <DayEditor value={exceptionDay} label="當日" disabled={disabled || demo} onChange={(day) => { setExceptionDay(day); setExceptionDirty(true); }} />
        <label>單日異動理由<textarea value={exceptionReason} minLength={3} maxLength={300} required onChange={(event) => { setExceptionReason(event.target.value); setExceptionDirty(true); }} /></label>
      </fieldset>
      <button type="submit" disabled={disabled || demo}>儲存單日異動</button>
    </form>
  </section>;
}
