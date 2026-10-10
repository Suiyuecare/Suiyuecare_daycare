"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, Check, ClipboardCheck, HeartPulse, RotateCw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { z } from "zod";

import { NavigationLink } from "@/components/app/navigation-link";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { formatCareTaipeiTime, taipeiToday } from "@/lib/core-care/date";
import { dailyWorkflowHref } from "@/lib/core-care/workflow-links";

const itemSchema = z.object({
  id: z.uuid(), client_id: z.uuid(), client_name: z.string(), client_code: z.string(),
  requester_user_id: z.uuid(), requester_name: z.string(), service_date: z.iso.date(),
  requested_at: z.string(), reason_code: z.enum(["refused", "device_failure", "emergency_transfer", "measurement_preexisting"]),
  reason_note: z.string().nullable(), status: z.enum(["pending", "approved", "rejected", "cancelled"]),
  measurement_at: z.string().nullable(), measurement_source: z.string().nullable(),
  resolved_arrival_at: z.string().nullable(), decision_note: z.string().nullable(), resolved_at: z.string().nullable(),
});
const snapshotSchema = z.object({ service_date: z.iso.date(), requests: z.array(itemSchema), reviewer: z.boolean() });
type ExceptionItem = z.infer<typeof itemSchema>;
type ExceptionSnapshot = z.infer<typeof snapshotSchema>;
type Mutation = {
  endpoint: string; serialized: string; key: string;
  expectedStatus: ExceptionItem["status"]; clientId?: string; clientName?: string; viewClientId?: string;
  serviceDate: string; requestId?: string;
};
const receiptSchema = z.object({
  id: z.uuid(), client_id: z.uuid(), service_date: z.iso.date(),
  status: z.enum(["pending", "approved", "rejected", "cancelled"]),
  replayed: z.boolean(), attendance_id: z.uuid().nullable().optional(),
});

const reasonLabels = {
  refused: "個案拒測", device_failure: "設備故障", emergency_transfer: "緊急送醫",
  measurement_preexisting: "已有量測，補核簽到",
} as const;
function sourceLabel(source: string | null) {
  return source === "staff" ? "員工量測" : source === "device" ? "設備量測" : source ?? "來源待核對";
}
function taipeiInputToIso(value: string) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) return null;
  const instant = new Date(`${value}:00+08:00`);
  return Number.isNaN(instant.valueOf()) ? null : instant.toISOString();
}
async function responseMessage(response: Response) {
  try {
    const body: unknown = await response.clone().json();
    if (body && typeof body === "object" && "errors" in body && Array.isArray(body.errors)) {
      const first: unknown = body.errors[0];
      if (first && typeof first === "object" && "message" in first && typeof first.message === "string") return first.message;
    }
  } catch { /* A proxy may return HTML. Never render it. */ }
  return "結果尚未確認；請重試同一次操作。";
}

export function AttendanceExceptionPanel({ serviceDate, selectedClientId, selectedClientName,
  hasAttendance, hasVital, caregiverMode, directorMode, canWrite,
  canApproveException, hasRecentExceptionAal2, userId }: {
  serviceDate: string;
  selectedClientId?: string;
  selectedClientName?: string;
  hasAttendance: boolean;
  hasVital: boolean;
  caregiverMode: boolean;
  directorMode: boolean;
  canWrite: boolean;
  canApproveException: boolean;
  hasRecentExceptionAal2: boolean;
  userId?: string;
}) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<ExceptionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<keyof typeof reasonLabels>("refused");
  const [reasonNote, setReasonNote] = useState("");
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [approveId, setApproveId] = useState<string | null>(null);
  const [arrivalMode, setArrivalMode] = useState<"measurement" | "verified">("measurement");
  const [verifiedArrival, setVerifiedArrival] = useState("");
  const [approvalNote, setApprovalNote] = useState("");
  const [arrivalConfirmed, setArrivalConfirmed] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);
  const pendingMutationRef = useRef<Mutation | null>(null);
  const [pendingMutation, setPendingMutation] = useState<Mutation | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ date: serviceDate });
      if (selectedClientId) params.set("client", selectedClientId);
      const response = await fetchWithTimeout(`/api/attendance-exceptions?${params}`, { cache: "no-store", signal }, 12_000);
      if (!response.ok) throw new Error(await responseMessage(response));
      const envelope: unknown = await response.json();
      const data = envelope && typeof envelope === "object" && "data" in envelope ? envelope.data : null;
      const parsed = snapshotSchema.safeParse(data);
      if (!parsed.success || parsed.data.service_date !== serviceDate) throw new Error("例外出勤狀態無法核對，請重新載入。");
      if (!signal?.aborted) setSnapshot(parsed.data);
    } catch (cause) {
      if (!signal?.aborted) { setSnapshot(null); setError(cause instanceof Error ? cause.message : "暫時無法載入例外出勤。"); }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [serviceDate, selectedClientId]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) void load(controller.signal); });
    return () => controller.abort();
  }, [load]);

  // Keep an uncertain mutation and its idempotency key across case navigation,
  // but never carry a draft reason or review form into a different case/day.
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setReason("refused"); setReasonNote(""); setRejectId(null); setRejectNote("");
      setApproveId(null); setVerifiedArrival(""); setApprovalNote("");
      setArrivalConfirmed(false); setNotice(null);
    });
    return () => { active = false; };
  }, [selectedClientId, serviceDate]);

  async function send(mutation: Mutation) {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetchWithTimeout(mutation.endpoint, {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "Idempotency-Key": mutation.key },
        body: mutation.serialized,
      });
      if (!response.ok) {
        const message = await responseMessage(response);
        if (response.status === 403 && message.includes("雙重驗證")) setNeedsReauth(true);
        if ([400, 403, 409, 422].includes(response.status) && message !== "結果尚未確認；請重試同一次操作。") {
          pendingMutationRef.current = null;
          setPendingMutation(null);
          void load();
        }
        throw new Error(message);
      }
      const envelope: unknown = await response.json();
      const data = envelope && typeof envelope === "object" && "data" in envelope ? envelope.data : null;
      const receipt = data && typeof data === "object" && "persisted" in data && data.persisted === true &&
        "request" in data ? receiptSchema.safeParse(data.request) : null;
      if (!receipt?.success ||
        (receipt.data.status !== mutation.expectedStatus && !(mutation.expectedStatus === "pending" && receipt.data.replayed)) ||
        (mutation.clientId && receipt.data.client_id !== mutation.clientId) ||
        (mutation.requestId && receipt.data.id !== mutation.requestId) ||
        (receipt.data.status === "approved" && !receipt.data.attendance_id) ||
        (receipt.data.status !== "approved" && receipt.data.attendance_id)) {
        throw new Error("回執尚未確認，請重試同一次操作。");
      }
      pendingMutationRef.current = null;
      setPendingMutation(null);
      setReasonNote(""); setRejectId(null); setRejectNote(""); setApproveId(null); setApprovalNote(""); setArrivalConfirmed(false);
      setNotice(receipt.data.status === "pending" ? "已送主任覆核；核准前不計入出勤。"
        : receipt.data.status === "approved" ? "已核准，正式出勤已建立。"
          : receipt.data.status === "rejected" ? "已駁回，沒有建立出勤。" : "已撤回，可重新量測簽到。");
      await load();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "結果尚未確認；請重試同一次操作。");
    } finally { setBusy(false); }
  }

  function begin(endpoint: string, body: Record<string, string>, expectedStatus: ExceptionItem["status"]) {
    if (pendingMutationRef.current || busy) return;
    if (!navigator.onLine) { setError("目前離線；例外簽到需連線送主任覆核。"); return; }
    const requestTarget = body.request_id ? items.find((item) => item.id === body.request_id) : undefined;
    if (body.request_id && !requestTarget) { setError("待覆核資料已變更，請更新後再試。"); return; }
    const mutation = { endpoint, serialized: JSON.stringify(body), key: crypto.randomUUID(), expectedStatus,
      clientId: body.client_id ?? requestTarget?.client_id,
      clientName: requestTarget?.client_name ?? selectedClientName, viewClientId: selectedClientId,
      serviceDate, requestId: body.request_id };
    pendingMutationRef.current = mutation;
    setPendingMutation(mutation);
    void send(mutation);
  }

  function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot || error || loading || !selectedClientId || !canWrite || hasAttendance || serviceDate !== taipeiToday()) return;
    begin("/api/attendance-exceptions", {
      client_id: selectedClientId, service_date: serviceDate,
      reason_code: hasVital ? "measurement_preexisting" : reason,
      reason_note: reasonNote.trim(),
    }, "pending");
  }

  function submitVerifiedArrival(event: FormEvent<HTMLFormElement>, item: ExceptionItem) {
    event.preventDefault();
    const confirmedAt = arrivalMode === "measurement" && item.measurement_at
      ? item.measurement_at : taipeiInputToIso(verifiedArrival);
    if (!snapshot || error || !canApproveException || !hasRecentExceptionAal2 || needsReauth ||
      !arrivalConfirmed || !approvalNote.trim() || !confirmedAt) {
      setError("請核對實際到場時間並填寫核對依據。");
      return;
    }
    begin("/api/attendance-exceptions/decision", {
      request_id: item.id, decision: "approve", confirmed_arrival_at: confirmedAt,
      decision_note: approvalNote.trim(),
    }, "approved");
  }

  const items = snapshot?.requests ?? [];
  const pending = items.filter((item) => item.status === "pending");
  const ownPending = selectedClientId && pending.find((item) => item.client_id === selectedClientId && item.requester_user_id === userId);
  const ownResolved = selectedClientId && items.find((item) => item.client_id === selectedClientId &&
    item.requester_user_id === userId && item.status !== "pending");
  const canRequest = caregiverMode && canWrite && Boolean(snapshot) && !error && !loading &&
    selectedClientId && !hasAttendance && !ownPending && serviceDate === taipeiToday();
  const returnToAttendance = dailyWorkflowHref(46, serviceDate, selectedClientId);
  const retrySameContext = !pendingMutation || (pendingMutation.serviceDate === serviceDate &&
    pendingMutation.viewClientId === selectedClientId);

  return <section className="panel attendance-exception" id="attendance-exception" aria-labelledby="attendance-exception-title">
    <div className="panel__header"><div className="panel__title">
      <h2 id="attendance-exception-title"><ClipboardCheck aria-hidden="true" />{directorMode ? "簽到例外覆核" : "簽到例外"}</h2>
      <p>{directorMode ? `${pending.length} 筆待覆核` : "拒測、設備故障或緊急送醫時，先送主任覆核。"}</p>
    </div><button className="button button--secondary" type="button" onClick={() => void load()} disabled={busy || loading}><RotateCw aria-hidden="true" />更新</button></div>
    <div className="panel__body attendance-exception__body">
      {loading ? <p role="status">正在核對例外出勤…</p> : null}
      {error ? <div className="callout attendance-exception__error" role="alert"><AlertCircle aria-hidden="true" /><span>{error}</span></div> : null}
      {error?.includes("日期已跨日") ? <NavigationLink className="button button--secondary"
        href={dailyWorkflowHref(46, taipeiToday(), selectedClientId)} loadingLabel="今日出勤" prefetch={false}>切換今天</NavigationLink> : null}
      {pendingMutation ? <div className="callout attendance-exception__error" role="status"><AlertCircle aria-hidden="true" />
        <span>{retrySameContext
          ? `上一筆 ${pendingMutation.clientName ?? "原個案"}（${pendingMutation.serviceDate}）結果待確認，請保留原內容重試。`
          : pendingMutation.viewClientId
            ? `先回到 ${pendingMutation.clientName ?? "原個案"}（${pendingMutation.serviceDate}）核對上一筆結果。`
            : `先回到未選個案的待審清單，核對 ${pendingMutation.clientName ?? "原個案"}（${pendingMutation.serviceDate}）。`}</span>
        <button className="button button--secondary" type="button" disabled={busy || !retrySameContext} onClick={() => { if (pendingMutationRef.current && retrySameContext) void send(pendingMutationRef.current); }}>重試同一次</button></div> : null}
      {notice ? <p className="callout" role="status">{notice}</p> : null}
      {directorMode && canApproveException && pending.length > 0 && (!hasRecentExceptionAal2 || needsReauth) ?
        <div className="callout attendance-exception__reauth" role="status"><AlertCircle aria-hidden="true" />
          <span>核准或駁回需最近 15 分鐘完成雙重驗證。</span>
          <NavigationLink className="button button--secondary" href={`/mfa?audience=staff&purpose=sensitive-action&next=${encodeURIComponent(returnToAttendance)}`} loadingLabel="雙重驗證" prefetch={false}>前往驗證</NavigationLink>
        </div> : null}
      {!loading && !error && pending.length === 0 && directorMode ? <p className="muted">目前沒有待覆核申請。</p> : null}
      {caregiverMode && selectedClientId && !loading && snapshot && !error ? <div>
        {ownPending ? <div className="attendance-exception__item"><span className="status-pill status-pill--warning">待主任覆核</span>
          <p>{reasonLabels[ownPending.reason_code]}・{formatCareTaipeiTime(ownPending.requested_at)}</p>
          <p className="muted">核准前不算簽到；若已能量測，先撤回再量測簽到。</p>
          <button className="button button--secondary" type="button" disabled={busy || Boolean(pendingMutation)} onClick={() => begin("/api/attendance-exceptions/decision", { request_id: ownPending.id, decision: "cancel" }, "cancelled")}><X aria-hidden="true" />撤回申請</button>
        </div> : null}
        {!ownPending && ownResolved ? <div className="attendance-exception__item" role="status">
          <span className="status-pill">{ownResolved.status === "approved" ? "主任已核准" : ownResolved.status === "rejected" ? "主任已駁回" : "已撤回"}</span>
          <p>{reasonLabels[ownResolved.reason_code]}・{formatCareTaipeiTime(ownResolved.resolved_at ?? ownResolved.requested_at)}</p>
          {ownResolved.status === "rejected" && ownResolved.decision_note ? <p>原因：{ownResolved.decision_note}</p> : null}
          {ownResolved.status === "rejected" ? <p className="muted">沒有建立出勤；可核對原因後重新申請，或直接量測簽到。</p> : null}
        </div> : null}
        {canRequest ? <form noValidate onSubmit={submitRequest} className="attendance-exception__form">
          <p><strong>{selectedClientName}</strong>・{hasVital ? "已有量測卻未簽到？" : "今天無法量測？"}</p>
          {hasVital ? <p className="muted">系統會核對當日最早有效量測時間；主任核准前不計入出勤。</p> :
            <label className="field"><span>原因 *</span><select value={reason} onChange={(event) => setReason(event.target.value as keyof typeof reasonLabels)} disabled={busy || Boolean(pendingMutation)}>
              {Object.entries(reasonLabels).filter(([value]) => value !== "measurement_preexisting").map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>}
          <label className="field"><span>補充說明（選填）</span><textarea value={reasonNote} onChange={(event) => setReasonNote(event.target.value)} maxLength={500} rows={2} disabled={busy || Boolean(pendingMutation)} /></label>
          <button className="button button--secondary" type="submit" disabled={busy || Boolean(pendingMutation)}><ClipboardCheck aria-hidden="true" />送主任覆核</button>
        </form> : null}
        {!ownPending && !hasAttendance && hasVital ? <p className="callout" role="status">已有當日量測卻尚無出勤；請送主任核對，勿重複量測或簽到。</p> : null}
        {!ownPending && canWrite && !hasAttendance && !hasVital && serviceDate === taipeiToday() ? <NavigationLink className="button button--secondary" href={dailyWorkflowHref(3, serviceDate, selectedClientId)} loadingLabel="生命徵象" prefetch={false}><HeartPulse aria-hidden="true" />可以量測？直接量測簽到</NavigationLink> : null}
        {!ownPending && !canRequest && !hasAttendance && serviceDate !== taipeiToday() ? <p className="muted">例外簽到只能在當日提出；歷史出勤請主管核對。</p> : null}
      </div> : null}
      {directorMode && !loading && snapshot ? <ul className="attendance-exception__list">
        {pending.map((item) => <li className="attendance-exception__item" key={item.id}>
          <div className="attendance-exception__summary"><strong>{item.client_name}（{item.client_code}）</strong><span className="status-pill status-pill--warning">待覆核</span></div>
          <p>{reasonLabels[item.reason_code]}・{formatCareTaipeiTime(item.requested_at)}・申請人 {item.requester_name}</p>
          {item.measurement_at ? <p>首筆有效量測：{formatCareTaipeiTime(item.measurement_at)}・{sourceLabel(item.measurement_source)}</p> : null}
          {item.reason_note ? <p>{item.reason_note}</p> : null}
          {item.requester_user_id === userId ? <p className="muted">不可覆核自己的申請。</p> : <div className="attendance-exception__actions">
            <button className="button button--primary" type="button" disabled={!canApproveException || !hasRecentExceptionAal2 || needsReauth || busy || Boolean(pendingMutation)} onClick={() => {
              setApproveId(item.id); setRejectId(null); setArrivalMode(item.measurement_at ? "measurement" : "verified");
              setVerifiedArrival(""); setApprovalNote(""); setArrivalConfirmed(false);
            }}><Check aria-hidden="true" />核准簽到</button>
            <button className="button button--secondary" type="button" disabled={!canApproveException || !hasRecentExceptionAal2 || needsReauth || busy || Boolean(pendingMutation)} onClick={() => { setRejectId(item.id); setRejectNote(""); }}>駁回</button>
          </div>}
          {!canApproveException && item.requester_user_id !== userId ? <p className="muted">目前沒有例外簽到核准權限，請聯絡系統管理員。</p> : null}
          {approveId === item.id ? <form noValidate onSubmit={(event) => submitVerifiedArrival(event, item)} className="attendance-exception__form">
            {item.measurement_at ? <fieldset><legend>核對實際到場時間 *</legend>
              <label className="attendance-exception__choice"><input type="radio" name={`arrival-${item.id}`} checked={arrivalMode === "measurement"} onChange={() => setArrivalMode("measurement")} />量測時間即到場：{item.measurement_at ? formatCareTaipeiTime(item.measurement_at) : "來源待確認"}</label>
              <label className="attendance-exception__choice"><input type="radio" name={`arrival-${item.id}`} checked={arrivalMode === "verified"} onChange={() => setArrivalMode("verified")} />另填已核對的到場時間</label>
            </fieldset> : <p>請核對實際到場時間；申請時間不會自動作為簽到時間。</p>}
            {arrivalMode === "verified" ? <label className="field"><span>實際到場時間（臺北）*</span><input type="datetime-local" value={verifiedArrival} onChange={(event) => setVerifiedArrival(event.target.value)} required /></label> : null}
            <label className="field"><span>核對依據／理由 *</span><textarea value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)} maxLength={500} rows={2} required /></label>
            <label className="attendance-exception__choice"><input type="checkbox" checked={arrivalConfirmed} onChange={(event) => setArrivalConfirmed(event.target.checked)} />我已核對這是個案實際到場時間，將作為正式簽到時間。</label>
            <div className="attendance-exception__actions"><button className="button button--primary" type="submit" disabled={!canApproveException || !hasRecentExceptionAal2 || needsReauth || !arrivalConfirmed || !approvalNote.trim() || (arrivalMode === "verified" && !taipeiInputToIso(verifiedArrival)) || busy || Boolean(pendingMutation)}>確認核准</button><button className="button button--secondary" type="button" onClick={() => setApproveId(null)} disabled={busy}>返回</button></div>
          </form> : null}
          {rejectId === item.id ? <form noValidate onSubmit={(event) => { event.preventDefault(); if (rejectNote.trim() && canApproveException && hasRecentExceptionAal2 && !needsReauth) begin("/api/attendance-exceptions/decision", { request_id: item.id, decision: "reject", decision_note: rejectNote.trim() }, "rejected"); }}>
            <label className="field"><span>駁回原因 *</span><textarea value={rejectNote} onChange={(event) => setRejectNote(event.target.value)} maxLength={500} rows={2} aria-invalid={!rejectNote.trim()} disabled={busy || Boolean(pendingMutation)} /></label>
            <div className="attendance-exception__actions"><button className="button button--secondary" type="submit" disabled={!rejectNote.trim() || !canApproveException || !hasRecentExceptionAal2 || needsReauth || busy || Boolean(pendingMutation)}>確認駁回</button><button className="button button--secondary" type="button" onClick={() => setRejectId(null)} disabled={busy}>返回</button></div>
          </form> : null}
        </li>)}
      </ul> : null}
    </div>
  </section>;
}
