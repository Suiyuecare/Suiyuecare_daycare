"use client";

import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FileSignature, ShieldCheck, UserCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { GovernanceDialog } from "@/components/ui/governance-dialog";
import { CLIENT_WRITE_TIMEOUT_MS } from "@/lib/api/client-fetch";
import type { TenantContext } from "@/lib/domain/types";
import type { MedicationOutcome } from "@/lib/integrations/medications";
import { parseMedicationActionError, parseMedicationResponseRequestId, type MedicationActionExpectation } from "@/lib/medications/action-response";
import { beginMedicationOperation, confirmMedicationOperation, getMedicationPending, isMedicationOperationCurrent,
  markMedicationUnknown, medicationAuthorityMatches, medicationAuthoritySignature, observeMedicationTarget, rejectMedicationOperation,
  retryMedicationOperation, useMedicationPending, type MedicationOperation } from "@/lib/medications/pending";
import type { MedicationAdministrationRecord } from "@/lib/medications/types";
import { hasPendingOperations, hasViewTransition, usePendingOperations, useViewTransitionPending } from "@/lib/navigation/pending-operation-lock";
import { useUnsavedChanges } from "@/lib/navigation/use-unsaved-changes";
import styles from "./medication-action.module.css";

const statusLabels: Record<MedicationOutcome, string> = { administered: "已服用", refused: "拒絕服用", held: "暫停服用", missed: "漏服" };
function defaultTaipeiLocal(serviceDate: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).reduce<Record<string, string>>((result, part) => { result[part.type] = part.value; return result; }, {});
  return `${serviceDate}T${parts.hour}:${parts.minute}`;
}
export function taipeiLocalToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) throw new Error("INVALID_LOCAL_DATETIME");
  const parsed = new Date(`${value}:00+08:00`);
  if (!Number.isFinite(parsed.getTime()) || new Date(parsed.getTime() + 8 * 60 * 60 * 1_000).toISOString().slice(0, 16) !== value) throw new Error("INVALID_LOCAL_DATETIME");
  return parsed.toISOString();
}
function olderThanProvisionalThreshold(value: string) { return Date.now() - new Date(value).getTime() > 60 * 60 * 1_000; }

/** One explicit attempt. Its deadline includes JSON decoding even when a
 * broken transport ignores abort. It never starts an automatic retry. */
async function sendMedication(operation: MedicationOperation) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("結果待確認")); }, CLIENT_WRITE_TIMEOUT_MS); });
  try {
    return await Promise.race([(async () => {
      const response = await fetch(`/api/medications/administrations/${operation.expectation.kind === "record" ? "record" : "verify"}`, {
        method: "POST", cache: "no-store", credentials: "same-origin", redirect: "error", signal: controller.signal,
        headers: { "Content-Type": "application/json", "Idempotency-Key": operation.key }, body: operation.body,
      });
      const value: unknown = await response.json().catch(() => null);
      return { response, value };
    })(), deadline]);
  } finally { clearTimeout(timer); }
}

export function MedicationAction({ row, serviceDate, canRecord, canVerify, hasRecentAal2, currentUserId,
  context, snapshotGeneratedAt, demo, instance }: {
  row: MedicationAdministrationRecord; serviceDate: string; canRecord: boolean; canVerify: boolean;
  hasRecentAal2: boolean; currentUserId: string; context: TenantContext; snapshotGeneratedAt: string;
  demo: boolean; instance: "desktop" | "mobile";
}) {
  const router = useRouter();
  const trigger = useRef<HTMLButtonElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const fallback = useRef<HTMLParagraphElement>(null);
  const mounted = useRef(false);
  const ownAttempt = useRef<MedicationOperation | null>(null);
  const composing = useRef(false);
  const scope = { organizationId: context.organizationId, branchId: context.branchId, userId: context.userId };
  const scopeKey = JSON.stringify([context.organizationId, context.branchId, context.userId, demo]);
  const journal = useMedicationPending();
  const anyPending = usePendingOperations();
  const changingView = useViewTransitionPending();
  const operation = journal.operation;
  const mine = !!operation && operation.scope.organizationId === scope.organizationId && operation.scope.branchId === scope.branchId &&
    operation.scope.userId === scope.userId && operation.expectation.medicationAdministrationId === row.id;
  const authorityMatches = !demo && !context.demo && medicationAuthorityMatches(scope) && journal.authority === medicationAuthoritySignature(context);
  const isRecord = row.finalizationState === "scheduled";
  const isVerification = row.finalizationState === "pending_verification";
  const isSamePerson = row.executor?.id === currentUserId;
  const permitted = isRecord ? canRecord : isVerification && canVerify && !isSamePerson;
  const enabled = permitted && !demo && !context.demo && hasRecentAal2 && authorityMatches && context.userId === currentUserId;
  const source = JSON.stringify([snapshotGeneratedAt, serviceDate, row, canRecord, canVerify, hasRecentAal2]);
  const visibleOperation = mine && authorityMatches && !operation.quarantined ? operation : null;
  const saved = journal.saved.find(entry => entry.identity === JSON.stringify([scope.organizationId.toLowerCase(), scope.branchId.toLowerCase(), scope.userId.toLowerCase()]) && entry.rowId === row.id);
  const capacityReached = journal.saved.length >= 32;
  const capacityReason = "本次登入已達待核對上限；請核對已保存紀錄後安全登出重新登入。";
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [baseline, setBaseline] = useState(() => defaultTaipeiLocal(serviceDate));
  const [status, setStatus] = useState<MedicationOutcome>("administered");
  const [occurredAt, setOccurredAt] = useState(baseline);
  const [reason, setReason] = useState("");
  // Consent belongs to the exact source the person reviewed. A new schedule,
  // dose or snapshot generation cannot inherit agreement to the older view.
  const [confirmedSource, setConfirmedSource] = useState<string | null>(null);
  const confirmed = confirmedSource === source;
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<"date" | "reason" | "confirmation" | null>(null);
  const latest = useRef({ scopeKey, source, enabled, epoch: journal.epoch });
  useLayoutEffect(() => { latest.current = { scopeKey, source, enabled, epoch: journal.epoch }; }, [scopeKey, source, enabled, journal.epoch]);
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false;
    if (ownAttempt.current) markMedicationUnknown(ownAttempt.current);
  }; }, []);
  useLayoutEffect(() => { if (!demo) observeMedicationTarget(scope, row.id, source, enabled); }, [scopeKey, row.id, source, enabled, demo]); // eslint-disable-line react-hooks/exhaustive-deps
  function reset() {
    const time = defaultTaipeiLocal(serviceDate);
    setBaseline(time); setStatus("administered"); setOccurredAt(time); setReason(""); setConfirmedSource(null); setError(null); setFieldError(null); setEditing(false);
  }
  const unsaved = useUnsavedChanges({ dirty: editing && !operation && (status !== "administered" || occurredAt !== baseline || reason !== "" || confirmed),
    scopeKey: `${scopeKey}:${journal.epoch}`, revisionKey: source, canPrompt: enabled, permittedFormAttribute: "data-medication-action-form",
    onDiscard: () => { reset(); setOpen(false); } });
  const shownStatus = visibleOperation?.draft.status ?? status;
  const shownDate = visibleOperation?.draft.occurredAt ?? occurredAt;
  const shownReason = visibleOperation?.draft.reason ?? reason;
  const locked = !!operation;
  const pending = visibleOperation?.phase === "sending";
  const unknown = visibleOperation?.phase === "unknown";
  const provisionalSecondPerson = row.highRisk || row.requiresSecondVerification || olderThanProvisionalThreshold(row.scheduledFor) ||
    (() => { try { return olderThanProvisionalThreshold(taipeiLocalToIso(shownDate)); } catch { return false; } })();
  const errorId = `medication-error-${instance}-${row.id}`;
  const dateLabelId = `medication-date-label-${instance}-${row.id}`;
  const disabledReason = demo ? "展示模式只讀，不會送出或保存用藥簽署" : !permitted ? isSamePerson ? "執行人不可覆核自己的紀錄" : "目前角色沒有此用藥操作權限" :
    !hasRecentAal2 ? "請先完成最近 15 分鐘內的雙因素重新驗證" : !authorityMatches ? "目前授權尚未確認" : capacityReached && !visibleOperation ? capacityReason : undefined;

  async function attempt(active: MedicationOperation) {
    ownAttempt.current = active;
    const owner = latest.current;
    setError(null); setFieldError(null);
    const mayUpdate = () => mounted.current && latest.current.scopeKey === owner.scopeKey && latest.current.source === owner.source && latest.current.epoch === owner.epoch;
    try {
      if (!isMedicationOperationCurrent(active)) return;
      const { response, value } = await sendMedication(active);
      if (!isMedicationOperationCurrent(active)) return;
      if (!response.ok) {
        const known = rejectMedicationOperation(active, value, response.status);
        if (mayUpdate()) setError(known ? parseMedicationActionError(value)?.errors[0]?.message ?? "這次簽署未保存，請檢查內容。" : "原操作結果仍待確認；只能重試原內容。");
        return;
      }
      const success = confirmMedicationOperation(active, value, response.status);
      if (!success) {
        const requestId = parseMedicationResponseRequestId(value);
        if (mayUpdate()) setError(`伺服器回覆不完整；原操作仍待確認，請重試原內容。${requestId ? `（請求識別碼 ${requestId}）` : ""}`);
        return;
      }
      if (mayUpdate()) { setOpen(false); setEditing(false); router.refresh(); }
    } catch {
      if (markMedicationUnknown(active) && mayUpdate()) setError("連線未完成；原操作結果仍待確認，請重試原內容。");
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (composing.current || !latest.current.enabled || hasViewTransition()) return;
    const current = getMedicationPending().operation;
    if (current) {
      if (!visibleOperation || current !== visibleOperation) return;
      const retry = retryMedicationOperation(current, scope, source);
      if (retry) await attempt(retry);
      return;
    }
    if (hasPendingOperations() || saved || capacityReached) return;
    let occurredIso: string | null = null;
    if (isRecord) {
      try { occurredIso = taipeiLocalToIso(occurredAt); if (occurredAt.slice(0, 10) !== serviceDate) throw new Error(); }
      catch { setError("請填寫此服務日的有效日期與時間。"); setFieldError("date"); dateRef.current?.focus(); return; }
      if (status !== "administered" && (!reason.trim() || reason.trim().length > 1000)) { setError("請填寫拒絕、暫停或漏服的原因（1–1000 字）。"); setFieldError("reason"); reasonRef.current?.focus(); return; }
    }
    if (!confirmed) { setError("請先勾選核對與簽署確認。"); setFieldError("confirmation"); confirmationRef.current?.focus(); return; }
    const expectation: MedicationActionExpectation = isRecord ? { kind: "record", medicationAdministrationId: row.id, status,
      occurredAt: occurredIso!, mustRequireSecondVerification: row.highRisk || row.requiresSecondVerification } : {
      kind: "verify", medicationAdministrationId: row.id, status: row.status as MedicationOutcome, occurredAt: row.occurredAt!, executionSignedAt: row.executionSignedAt! };
    const body = JSON.stringify(isRecord ? { medication_administration_id: row.id, status, occurred_at: occurredIso,
      ...(status === "administered" ? { actual_dose: row.plannedDose, dose_unit: row.doseUnit } : { reason: reason.trim() }) } : { medication_administration_id: row.id });
    const active = beginMedicationOperation(scope, body, expectation, { status, occurredAt, reason }, source);
    if (active) await attempt(active);
  }
  function close() {
    if (operation) {
      // Closing unknown is only leaving its read-only view. The journal,
      // navigation lease and exact original intent remain held for reopening.
      if (visibleOperation?.phase === "unknown") setOpen(false);
      return;
    }
    setOpen(false);
    unsaved.requestExit(() => reset());
  }
  const triggerLabel = visibleOperation ? "檢視原用藥操作" : isRecord ? "記錄並簽署" : "獨立覆核";
  return <div className={`medication-action ${styles.action}`}>
    {isRecord || isVerification || mine ? <button aria-label={disabledReason && (!enabled || capacityReached && !visibleOperation) ? `${triggerLabel}：${disabledReason}` : triggerLabel}
      className={isRecord ? "button button--primary" : "button button--secondary"}
      disabled={!enabled || !!saved || capacityReached && !visibleOperation || changingView || (anyPending && !visibleOperation)} onClick={() => {
        if (getMedicationPending().operation && !visibleOperation || hasViewTransition()) return;
        setEditing(true); setOpen(true);
      }} ref={trigger} title={disabledReason} type="button">
      {isRecord ? <FileSignature aria-hidden="true" /> : <UserCheck aria-hidden="true" />}{triggerLabel}
    </button> : <span className="medication-action-done">已完成</span>}
    <p className="medication-action__notice" ref={fallback} tabIndex={-1} role="status">
      {mine && (!authorityMatches || operation?.quarantined) ? "授權或原紀錄已變更；原操作仍待確認。請安全登出後重新登入並核對紀錄。" :
        saved ? saved.receipt.data.finalizationState === "pending_verification" ? "第一人簽署已保存；仍待第二人覆核。清單尚待更新。" : "用藥結果已完成簽署；清單尚待更新。" :
          journal.navigationBlocked && mine ? "請先確認原用藥操作，才能離開此頁。" : unknown && !open ? "原用藥操作仍待確認。" : capacityReached ? capacityReason :
            editing && confirmedSource !== null && !confirmed ? "原紀錄已更新；請重新核對目前內容並勾選簽署確認。" : ""}
    </p>
    <GovernanceDialog busy={pending} cancelLabel={unknown ? "返回清單" : "取消"} open={open && enabled && (!mine || !!visibleOperation) && !unsaved.open}
      title={isRecord ? "記錄並簽署用藥結果" : "第二人獨立覆核"} onRequestClose={close}
      returnFocusRef={trigger} fallbackFocusRef={fallback}>
      <form data-medication-action-form noValidate onSubmit={submit}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}>
        <p>{row.clientDisplayName}・{row.medicationName}</p>
        <div className="callout core-care-callout"><ShieldCheck aria-hidden="true" /><span>{isRecord ? provisionalSecondPerson ?
          "第一人簽署後仍須另一位具權限人員覆核，才會列為完成。" : "請確認執行結果；簽署後將保存執行人與時間。" : `執行人為 ${row.executor?.displayName ?? "—"}，須由不同人員獨立覆核。`}</span></div>
        <dl className="medication-dialog-summary"><div><dt>排程</dt><dd>{new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(row.scheduledFor))}</dd></div>
          <div><dt>計畫劑量</dt><dd>{row.plannedDose} {row.doseUnit}</dd></div><div><dt>途徑</dt><dd>{row.route}</dd></div><div><dt>覆核條件</dt><dd>{provisionalSecondPerson ? "需第二人" : "一般一次簽署"}</dd></div></dl>
        {isRecord ? <>
          <label className="field"><span>執行狀態 *</span><select disabled={locked} onChange={event => { if (!getMedicationPending().operation) setStatus(event.currentTarget.value as MedicationOutcome); }} value={shownStatus}>
            {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field"><span id={dateLabelId}>實際發生日期與時間 *</span><input aria-labelledby={dateLabelId} aria-invalid={fieldError === "date"} aria-describedby={fieldError === "date" ? errorId : undefined}
            disabled={locked} min={`${serviceDate}T00:00`} max={`${serviceDate}T23:59`} onChange={event => { if (!getMedicationPending().operation) setOccurredAt(event.currentTarget.value); }} ref={dateRef} type="datetime-local" value={shownDate} />
            <small>接受最近 24 小時至未來 5 分鐘；時間以台北時區核對。</small></label>
          {shownStatus === "administered" ? <div className="medication-dose-lock" aria-label="實際服用劑量"><span>實際服用劑量</span><strong>{row.plannedDose} {row.doseUnit}</strong><small>須等於已簽計畫；劑量差異暫不允許簽署。</small></div> :
            <label className="field"><span>{statusLabels[shownStatus]}原因 *</span><textarea className="resize-none" aria-invalid={fieldError === "reason"} aria-describedby={fieldError === "reason" ? errorId : undefined}
              disabled={locked} maxLength={1000} onChange={event => { if (!getMedicationPending().operation) setReason(event.currentTarget.value); }} ref={reasonRef} value={shownReason} style={{ resize: "none" }} /></label>}
        </> : <div className="medication-verification-copy"><strong>第一人紀錄</strong><p>{statusLabels[row.status as MedicationOutcome]}{row.actualDose !== null ? `・${row.actualDose} ${row.actualDoseUnit}` : ""}{row.reason ? `・原因：${row.reason}` : ""}</p></div>}
        <label className="check-field"><input aria-invalid={fieldError === "confirmation"} aria-describedby={fieldError === "confirmation" ? errorId : undefined}
          checked={!!visibleOperation || confirmed} disabled={locked} onChange={event => { if (!getMedicationPending().operation) setConfirmedSource(event.currentTarget.checked ? source : null); }} ref={confirmationRef} type="checkbox" />
          <span>{isRecord ? "我確認以上執行結果正確，並同意以目前身分完成第一人簽署。" : "我已獨立核對排程、計畫劑量、執行結果及第一人身分，並同意完成第二人簽署。"}</span></label>
        {pending ? <p role="status">簽署中，請稍候。</p> : unknown ? <p role="status">原操作結果仍待確認；內容已鎖定，重試會沿用原簽署。</p> : null}
        {capacityReached && !unknown ? <p role="status">{capacityReason}</p> : null}
        {error ? <p className="form-error" id={errorId} role="alert">{error}</p> : null}
        <footer className="drawer__footer"><button className="button button--secondary" disabled={pending} onClick={close} type="button">{unknown ? "返回清單（保留原操作）" : "取消"}</button>
          <button className="button button--primary" disabled={pending || changingView || !enabled || (locked && !unknown) || capacityReached && !unknown} type="submit">
            {pending ? "簽署中…" : unknown ? "重試原用藥操作" : isRecord ? "確認執行並簽署" : "完成獨立覆核"}</button></footer>
      </form>
    </GovernanceDialog>
    <GovernanceDialog open={unsaved.open} title="離開未保存的用藥填寫？" cancelLabel="繼續填寫" onRequestClose={() => { unsaved.cancel(); setOpen(true); }} returnFocusRef={trigger} fallbackFocusRef={fallback}>
      <p>這些內容尚未送出。捨棄後才會繼續原操作。</p><button className="button button--danger" onClick={unsaved.confirmDiscard} type="button">捨棄填寫並繼續</button>
    </GovernanceDialog>
  </div>;
}
