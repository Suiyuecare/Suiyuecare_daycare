"use client";

import { useEffect, useRef, useState } from "react";
import { BellRing, ClipboardPlus, ListChecks, LockKeyhole, SearchCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseAbnormalEventActionError,
  parseAbnormalEventActionSuccess,
} from "@/lib/abnormal-events/parser";
import type {
  AbnormalAction,
  AbnormalAffectedTargetKind,
  AbnormalClientOption,
  AbnormalDueDateAction,
  AbnormalIncidentItem,
  AbnormalMajorState,
  AbnormalResponsibleOption,
} from "@/lib/abnormal-events/types";

import styles from "./abnormal-events.module.css";

export type AbnormalEventActionKind = AbnormalAction;
const labels: Record<AbnormalAction, string> = {
  report: "新增事件",
  manual_notification: "人工通知證據",
  improvement: "新增改善",
  follow_up: "新增追蹤",
  close: "完成結案",
};

function icon(kind: AbnormalAction) {
  if (kind === "report") return <ClipboardPlus aria-hidden="true" />;
  if (kind === "manual_notification") return <BellRing aria-hidden="true" />;
  if (kind === "improvement") return <ListChecks aria-hidden="true" />;
  if (kind === "follow_up") return <SearchCheck aria-hidden="true" />;
  return <LockKeyhole aria-hidden="true" />;
}

function taipeiLocal(value: Date | string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function taipeiLocalToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) return "";
  const parsed = new Date(`${value}:00+08:00`);
  return Number.isFinite(parsed.getTime()) && taipeiLocal(parsed) === value
    ? parsed.toISOString()
    : "";
}

function todayTaipei(value: Date | string) { return taipeiLocal(value).slice(0, 10); }
function requestIdSuffix(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const requestId = (value as { requestId?: unknown }).requestId;
  return typeof requestId === "string" && /^[0-9a-f-]{36}$/iu.test(requestId)
    ? `（請求識別碼：${requestId}）`
    : "";
}

export function AbnormalEventAction({
  kind, instance, incident, clients, responsibles, canManage, canClose, hasRecentAal2, demo,
}: {
  kind: AbnormalEventActionKind;
  instance: string;
  incident?: AbnormalIncidentItem;
  clients: readonly AbnormalClientOption[];
  responsibles: readonly AbnormalResponsibleOption[];
  canManage: boolean;
  canClose: boolean;
  hasRecentAal2: boolean;
  demo: boolean;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const idempotencyKey = useRef<string | null>(null);
  const retainedAttempt = useRef<{
    body: Record<string, unknown>;
    expectation: Parameters<typeof parseAbnormalEventActionSuccess>[1];
  } | null>(null);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [occurredLocal, setOccurredLocal] = useState("");
  const [capturedNowLocal, setCapturedNowLocal] = useState("");
  const [targetKind, setTargetKind] = useState<AbnormalAffectedTargetKind>("client");
  const reportableClients = clients.filter((client) => client.canReport);
  const [selectedClientId, setSelectedClientId] = useState(reportableClients[0]?.clientId ?? "");
  const [majorState, setMajorState] = useState<AbnormalMajorState>("unclassified");
  const [responsibleId, setResponsibleId] = useState(responsibles[0]?.membershipId ?? "");
  const [dueAction, setDueAction] = useState<AbnormalDueDateAction>("keep");
  const selectedClient = reportableClients.find((client) => client.clientId === selectedClientId);
  const closed = incident?.handlingStatus === "closed";
  const allowed = kind === "close" ? canClose && hasRecentAal2 : canManage;
  const enabled = !demo && allowed && !pending && !closed &&
    responsibles.length > 0 && (kind !== "report" || targetKind !== "client" || reportableClients.length > 0);
  const label = labels[kind];
  const dialogId = `abnormal-event-${kind}-${instance}-${incident?.id ?? "new"}`;
  const descriptionId = `${dialogId}-description`;
  const occurredIso = taipeiLocalToIso(occurredLocal);
  const capturedNowIso = taipeiLocalToIso(capturedNowLocal);
  const lateReport = kind === "report" && occurredIso !== "" && capturedNowIso !== "" &&
    new Date(capturedNowIso).getTime() - new Date(occurredIso).getTime() > 24 * 60 * 60 * 1000;
  const selectedClientMax = selectedClient?.endedOn && capturedNowLocal &&
    selectedClient.endedOn < capturedNowLocal.slice(0, 10)
    ? `${selectedClient.endedOn}T23:59`
    : capturedNowLocal || undefined;
  const disabledReason = demo ? "展示模式不會寫入資料"
    : closed ? "事件已結案，歷史不可追加"
      : kind === "close" && !canClose ? "目前角色沒有 quality_events.close"
        : kind === "close" && !hasRecentAal2 ? "結案前須於同一工作階段完成最近 15 分鐘 AAL2 驗證"
          : kind !== "close" && !canManage ? "目前角色沒有 quality_events.manage"
            : responsibles.length === 0 ? "目前沒有可指派的有效責任人"
              : kind === "report" && targetKind === "client" && reportableClients.length === 0
                ? "目前沒有可新增事件的有效個案" : undefined;

  function open() {
    if (!enabled) return;
    const now = taipeiLocal(new Date());
    setCapturedNowLocal(now);
    setOccurredLocal(now);
    setTargetKind("client");
    setSelectedClientId(reportableClients[0]?.clientId ?? "");
    setMajorState("unclassified");
    setResponsibleId(incident?.currentResponsibleMembershipId ?? responsibles[0]?.membershipId ?? "");
    setDueAction("keep");
    setError(null);
    setNotice(null);
    setCompleted(false);
    setUnknownOutcome(false);
    idempotencyKey.current = crypto.randomUUID();
    retainedAttempt.current = null;
    dialog.current?.showModal();
  }

  function close() {
    if (!pendingRef.current && !unknownOutcome) dialog.current?.close();
  }

  function changed() {
    if (!error || unknownOutcome) return;
    idempotencyKey.current = crypto.randomUUID();
    retainedAttempt.current = null;
    setError(null);
  }

  function keepFocusInside(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first ||
      !event.currentTarget.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || completed || !occurredIso || (kind !== "report" && !incident)) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    idempotencyKey.current ??= crypto.randomUUID();
    const values = new FormData(event.currentTarget);
    let body: Record<string, unknown>;
    let expectation: Parameters<typeof parseAbnormalEventActionSuccess>[1];
    if (unknownOutcome && retainedAttempt.current) {
      ({ body, expectation } = retainedAttempt.current);
    } else if (kind === "report") {
      const clientTarget = targetKind === "client";
      const due = String(values.get("improvementDueDate") ?? "");
      body = {
        action: "report", affectedTargetKind: targetKind,
        affectedClientId: clientTarget ? selectedClientId : null,
        affectedTargetLabel: clientTarget ? null : String(values.get("affectedTargetLabel") ?? ""),
        occurredAt: occurredIso, location: String(values.get("location") ?? ""),
        eventType: String(values.get("eventType") ?? ""),
        eventSummary: String(values.get("eventSummary") ?? ""),
        immediateAction: String(values.get("immediateAction") ?? ""), majorState,
        responsibleMembershipId: responsibleId, improvementDueDate: due,
        lateEntryReason: lateReport ? String(values.get("lateEntryReason") ?? "") : null,
      };
      expectation = { action: "report", affectedTargetKind: targetKind,
        affectedClientId: clientTarget ? selectedClientId : null,
        responsibleMembershipId: responsibleId, effectiveDueDate: due };
    } else {
      const common = { action: kind, incidentId: incident!.id,
        affectedTargetKind: incident!.affectedTargetKind,
        affectedClientId: incident!.affectedClientId, occurredAt: occurredIso,
        expectedChainVersion: incident!.chainVersion };
      if (kind === "manual_notification") {
        body = { ...common, notificationTarget: String(values.get("notificationTarget") ?? ""),
          notificationMethod: String(values.get("notificationMethod") ?? ""),
          notificationResult: String(values.get("notificationResult") ?? "") };
      } else if (kind === "improvement" || kind === "follow_up") {
        body = { ...common, entryText: String(values.get("entryText") ?? ""),
          responsibleMembershipId: responsibleId, dueDateAction: dueAction,
          dueDateValue: dueAction === "replace" ? String(values.get("dueDateValue") ?? "") : null };
      } else {
        body = { ...common, closureOutcome: String(values.get("closureOutcome") ?? ""),
          closureReason: String(values.get("closureReason") ?? "") };
      }
      const effectiveDueDate = kind === "improvement" || kind === "follow_up"
        ? dueAction === "replace" ? String(values.get("dueDateValue") ?? "")
          : incident!.currentImprovementDueDate
        : incident!.currentImprovementDueDate;
      expectation = { action: kind, incidentId: incident!.id,
        affectedTargetKind: incident!.affectedTargetKind,
        affectedClientId: incident!.affectedClientId,
        expectedChainVersion: incident!.chainVersion,
        responsibleMembershipId: kind === "improvement" || kind === "follow_up"
          ? responsibleId : incident!.currentResponsibleMembershipId,
        effectiveDueDate };
    }
    retainedAttempt.current = { body, expectation };

    try {
      const response = await fetchWithTimeout("/api/abnormal-events", {
        method: kind === "report" ? "POST" : "PATCH",
        cache: "no-store",
        headers: { "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
          ...(kind === "report" ? {} : { "X-Abnormal-Action": kind }) },
        body: JSON.stringify(body),
      });
      const raw: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const envelope = parseAbnormalEventActionError(raw);
        setUnknownOutcome(false);
        setError(`${envelope?.errors.find((item) => item.message.trim())?.message ??
          "操作尚未確認完成；請保留內容，修改後會使用新的操作識別碼。"}${requestIdSuffix(raw)}`);
        return;
      }
      let success;
      try { success = parseAbnormalEventActionSuccess(raw, expectation); }
      catch {
        setUnknownOutcome(true);
        setError(`伺服器回覆不完整，操作結果未知；請保留內容並使用原操作重試。${requestIdSuffix(raw)}`);
        return;
      }
      if ((kind === "report" && response.status !== (success.data.replayed ? 200 : 201)) ||
        (kind !== "report" && response.status !== 200)) {
        setUnknownOutcome(true);
        setError(`伺服器狀態與完成憑證不一致，操作結果未知；請保留內容並使用原操作重試。${requestIdSuffix(raw)}`);
        return;
      }
      setCompleted(true);
      setUnknownOutcome(false);
      retainedAttempt.current = null;
      setNotice(success.data.replayed
        ? "已確認先前相同操作，沒有建立重複紀錄。"
        : kind === "report" ? "異常事件已建立。"
          : kind === "close" ? "事件已以不可修改的結案紀錄完成。"
            : "事件時間軸已追加不可修改的紀錄。");
      dialog.current?.close();
      window.setTimeout(() => trigger.current?.focus(), 0);
      router.refresh();
    } catch (caught) {
      setUnknownOutcome(true);
      setError(isClientFetchTimeoutError(caught)
        ? "連線逾時，操作結果未知；請保留內容並使用原操作重試。"
        : "網路狀態不明，操作結果未知；請保留內容並使用原操作重試。");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return <div className={styles.actionSlot}>
    <button aria-label={!enabled && disabledReason ? `${label}：${disabledReason}` : label}
      className={`button ${kind === "report" || kind === "close" ? "button--primary" : "button--secondary"} ${styles.actionButton}`}
      disabled={!enabled} onClick={open} ref={trigger} title={!enabled ? disabledReason : undefined} type="button">
      {icon(kind)}{label}
    </button>
    {notice ? <span className="sr-only" role="status">{notice}</span> : null}
    <dialog aria-describedby={descriptionId} aria-labelledby={dialogId}
      className={`core-dialog ${styles.dialog}`}
      onCancel={(event) => { if (pendingRef.current || unknownOutcome) event.preventDefault(); }}
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
      onClose={() => trigger.current?.focus()} onKeyDown={keepFocusInside} ref={dialog}>
      <form className="core-dialog__surface" onChange={changed} onSubmit={submit}>
        <header className="drawer__header"><div><p className="eyebrow">異常事件・不可變時間軸</p>
          <h2 id={dialogId}>{label}</h2><p id={descriptionId}>{kind === "report"
            ? "類型與重大性均由機構人員明確輸入；系統不診斷、不推論法定通報。"
            : kind === "manual_notification" ? "只保存人員自行完成的通知證據，不代表系統送達。"
              : kind === "close" ? "結案追加結果與理由，不覆寫事件或既有紀錄。"
                : "改善或追蹤會保存責任人、期限證據與目前鏈版本。"}</p></div>
          <button aria-label="關閉" className="icon-button" disabled={pending || unknownOutcome}
            onClick={close} type="button"><X aria-hidden="true" /></button></header>
        <div className="drawer__body"><fieldset className={styles.fields}
          disabled={pending || completed || unknownOutcome}>
          {kind === "report" ? <>
            <label className="field"><span>影響對象類型 *</span><select onChange={(event) =>
              setTargetKind(event.target.value as AbnormalAffectedTargetKind)} value={targetKind}>
              <option value="client">個案</option><option value="staff">員工</option>
              <option value="visitor">訪客</option><option value="facility">設施</option>
              <option value="other">其他</option></select></label>
            {targetKind === "client" ? <label className="field"><span>個案 *</span>
              <select onChange={(event) => setSelectedClientId(event.target.value)} required value={selectedClientId}>
                {reportableClients.map((client) => <option key={client.clientId} value={client.clientId}>{client.displayName}</option>)}
              </select></label> : <label className="field"><span>對象快照標籤 *</span>
              <input maxLength={240} name="affectedTargetLabel" required /></label>}
            <label className="field"><span>事件時間（台北）*</span><input max={targetKind === "client" ? selectedClientMax : capturedNowLocal || undefined}
              min={targetKind === "client" && selectedClient?.admittedOn ? `${selectedClient.admittedOn}T00:00` : undefined}
              onChange={(event) => setOccurredLocal(event.target.value)} required type="datetime-local" value={occurredLocal} /></label>
            <label className="field"><span>地點 *</span><input maxLength={240} name="location" required /></label>
            <label className="field"><span>事件類型（人工輸入）*</span><input maxLength={240} name="eventType" required /></label>
            <label className="field"><span>重大性（人工明確選擇）*</span><select onChange={(event) =>
              setMajorState(event.target.value as AbnormalMajorState)} value={majorState}>
              <option value="unclassified">未分類</option><option value="not_major">非重大</option>
              <option value="major">重大</option></select></label>
            <label className={`field ${styles.full}`}><span>事件描述 *</span><textarea maxLength={2000} name="eventSummary" required /></label>
            <label className={`field ${styles.full}`}><span>即時處置 *</span><textarea maxLength={2000} name="immediateAction" required /></label>
            <label className="field"><span>責任人 *</span><select onChange={(event) => setResponsibleId(event.target.value)}
              required value={responsibleId}>{responsibles.map((person) => <option key={person.membershipId}
                value={person.membershipId}>{person.displayName}（{person.scope === "branch" ? "分支" : "機構"}）</option>)}</select></label>
            <label className="field"><span>改善期限（台北日期）*</span><input min={occurredLocal.slice(0, 10) || todayTaipei(new Date())}
              name="improvementDueDate" required type="date" /></label>
            {lateReport ? <label className={`field ${styles.full} ${styles.lateField}`}><span>超過 24 小時補登理由 *</span>
              <textarea maxLength={1000} name="lateEntryReason" required />
              <small>24 小時整仍不屬超時；伺服器提交前會依最終時間再次驗證。</small></label> : null}
          </> : <>
            <div className={styles.incidentContext}><strong>{incident?.affectedTargetLabel}</strong>
              <span>{incident?.eventType}・{incident?.eventSummary}</span>
              <span>目前責任人：{incident?.currentResponsibleDisplayName}・期限 {incident?.currentImprovementDueDate}・鏈 v{incident?.chainVersion}</span></div>
            <label className="field"><span>發生時間（台北）*</span><input max={capturedNowLocal || undefined}
              min={incident ? taipeiLocal(incident.timeline.at(-1)?.occurredAt ?? incident.occurredAt) : undefined}
              onChange={(event) => setOccurredLocal(event.target.value)} required type="datetime-local" value={occurredLocal} /></label>
            {kind === "manual_notification" ? <>
              <label className="field"><span>人工通知對象 *</span><input maxLength={240} name="notificationTarget" required /></label>
              <label className="field"><span>人工通知方式 *</span><input maxLength={120} name="notificationMethod" required /></label>
              <label className={`field ${styles.full}`}><span>人工通知結果 *</span><textarea maxLength={1000} name="notificationResult" required /></label>
            </> : kind === "improvement" || kind === "follow_up" ? <>
              <label className={`field ${styles.full}`}><span>{kind === "improvement" ? "改善內容" : "追蹤內容"} *</span>
                <textarea maxLength={2000} name="entryText" required /></label>
              <label className="field"><span>接續責任人 *</span><select onChange={(event) => setResponsibleId(event.target.value)}
                required value={responsibleId}>{responsibles.map((person) => <option key={person.membershipId}
                  value={person.membershipId}>{person.displayName}</option>)}</select></label>
              <label className="field"><span>期限處理 *</span><select onChange={(event) =>
                setDueAction(event.target.value as AbnormalDueDateAction)} value={dueAction}>
                <option value="keep">維持 {incident?.currentImprovementDueDate}</option><option value="replace">明確更新期限</option>
              </select></label>
              {dueAction === "replace" ? <label className="field"><span>新改善期限 *</span>
                <input min={incident?.occurredAt ? todayTaipei(incident.occurredAt) : undefined}
                  name="dueDateValue" required type="date" /></label> : null}
            </> : <>
              <label className={`field ${styles.full}`}><span>結案結果 *</span><textarea maxLength={2000} name="closureOutcome" required /></label>
              <label className={`field ${styles.full}`}><span>結案理由 *</span><textarea maxLength={1000} name="closureReason" required /></label>
              <label className={`check-field ${styles.full}`}><input required type="checkbox" />
                <span>我已在同一工作階段完成最近 15 分鐘 AAL2 驗證，並確認結案證據。</span></label>
            </>}
          </>}
        </fieldset>{error ? <p className="form-error" role="alert">{error}</p> : null}
          {unknownOutcome ? <p className={styles.unknownNotice} role="status">內容與操作識別碼已鎖定；請直接重試以確認結果。</p> : null}
        </div>
        <footer className="drawer__footer"><button className="button button--secondary"
          disabled={pending || unknownOutcome} onClick={close} type="button">取消</button>
          <button className="button button--primary" disabled={pending || completed} type="submit">
            {pending ? "確認中…" : unknownOutcome ? "使用原操作重試" : label}</button></footer>
      </form>
    </dialog>
  </div>;
}

export function AbnormalEventFreshness({ staleAfter, demo }: { staleAfter: string; demo: boolean }) {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (demo) return;
    const timer = window.setTimeout(() => setExpired(true),
      Math.max(0, new Date(staleAfter).getTime() - Date.now()));
    return () => window.clearTimeout(timer);
  }, [demo, staleAfter]);
  if (demo) return <span>合成展示快照</span>;
  return expired
    ? <span className={styles.stale} role="status">資料已過期，請重新載入</span>
    : <span>資料為目前快照</span>;
}
