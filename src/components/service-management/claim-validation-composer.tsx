"use client";

import styles from "./claim-validation.module.css";
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { FileCheck2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { GovernanceDialog } from "@/components/ui/governance-dialog";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { hasViewTransition, tryAcquireViewTransition, usePendingOperations, useViewTransitionPending } from "@/lib/navigation/pending-operation-lock";
import { isConfirmedClaimValidationRejection, parseClaimValidationEnvelope } from "@/lib/service-management/claim-validation-client";
import { beginClaimValidation, claimValidationScopeIdentity, getClaimValidationPending,
  reconcileClaimValidationConfirmed, retryClaimValidation, settleClaimValidation, useClaimValidationPending,
  type ClaimValidationBatch, type ClaimValidationOperation, type ClaimValidationScope } from "@/lib/service-management/claim-validation-pending";

const UNKNOWN = "上次結果未知，已保留原批次、筆數、金額及操作鍵；請核對原請求，不要另建相同操作。";
const STALE = "申報草稿已驗證並凍結明細，但清單尚未確認更新。請重新載入清單，不要再次送出；正式格式完成前仍不能下載或送件。";
function displayMoney(value: string) {
  const [whole, fraction = "00"] = value.split(".");
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",")}.${fraction.padEnd(2, "0")}`;
}

export function ClaimValidationComposer({ batches, enabled, hasRecentAal2, demo, scope }: {
  batches: readonly ClaimValidationBatch[]; enabled: boolean; hasRecentAal2: boolean;
  demo: boolean; scope: ClaimValidationScope;
}) {
  const router = useRouter(); const journal = useClaimValidationPending();
  const viewPending = useViewTransitionPending(); const operationPending = usePendingOperations();
  const trigger = useRef<HTMLButtonElement>(null); const consent = useRef<HTMLInputElement>(null);
  const mounted = useRef(false); const composing = useRef(false);
  const identity = claimValidationScopeIdentity(scope, demo);
  const fingerprint = JSON.stringify([identity, enabled, hasRecentAal2]);
  const context = useRef({ fingerprint, epoch: 0 });
  const [open, setOpen] = useState(false); const [openedIdentity, setOpenedIdentity] = useState(identity);
  const [consentTuple, setConsentTuple] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(batches[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const [lastFingerprint, setLastFingerprint] = useState(fingerprint);
  const [reading, setReading] = useState(false); const readLease = useRef<(() => void) | null>(null);
  const errorId = useId();
  if (lastFingerprint !== fingerprint) { setLastFingerprint(fingerprint); setConsentTuple(null); }

  useLayoutEffect(() => {
    if (context.current.fingerprint !== fingerprint) {
      context.current = { fingerprint, epoch: context.current.epoch + 1 };
      composing.current = false;
    }
  }, [fingerprint]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; context.current.epoch += 1; readLease.current?.(); readLease.current = null; };
  }, []);
  useEffect(() => { reconcileClaimValidationConfirmed(scope, demo, batches.map((batch) => batch.id)); },
    [scope, demo, batches]);
  // A refreshed server-prop object ends only the view-transition lease, never
  // establishes that the validated batch disappeared or that a write failed.
  useEffect(() => {
    if (readLease.current) { readLease.current(); readLease.current = null; setReading(false); }
  }, [batches]);

  const operation = journal.operation;
  const ownOperation = operation?.identity === identity ? operation : null;
  const foreignOperation = !!operation && !ownOperation;
  const otherOperationPending = operationPending && !ownOperation;
  const markedIds = new Set(journal.confirmed.filter((entry) => entry.identity === identity).map((entry) => entry.batchId));
  const candidates = batches.filter((batch) => !markedIds.has(batch.id.toLowerCase()));
  const selected = candidates.find((batch) => batch.id === selectedId) ?? candidates[0];
  const canDisplay = enabled && hasRecentAal2 && !foreignOperation;
  const displayed = canDisplay ? ownOperation?.batch ?? selected : undefined;
  const unknown = ownOperation?.phase === "unknown";
  const pending = ownOperation?.phase === "sending";
  const tuple = displayed ? JSON.stringify([identity, fingerprint, displayed.id,
    displayed.itemCount, displayed.totalAmount, displayed.periodLabel]) : null;
  const confirmed = tuple !== null && tuple === consentTuple;
  const ready = canDisplay && !otherOperationPending && !viewPending && !reading && !!displayed && !pending;
  const options = ownOperation && displayed ? [displayed] : candidates;
  const disabledReason = !enabled ? "目前角色沒有申報驗證權限"
    : !hasRecentAal2 ? "請先完成最近 15 分鐘內的雙因素重新驗證"
      : foreignOperation ? "其他帳號或分支仍有未確認的申報操作；請由原帳號與分支回查。"
        : otherOperationPending ? "其他作業尚待確認，請先回原表單完成回查。"
          : viewPending || reading ? "畫面正在更新，請稍候。"
          : !displayed ? "目前沒有可驗證且已取得總額的草稿批次" : undefined;

  function isCurrent(epoch: number, value: ClaimValidationOperation) {
    const active = getClaimValidationPending().operation;
    return mounted.current && context.current.epoch === epoch && context.current.fingerprint === fingerprint &&
      active?.token === value.token && active.attempt === value.attempt;
  }
  function requestRead(force = false) {
    if (reading && !force || hasViewTransition()) return;
    const lease = tryAcquireViewTransition(); if (!lease) return;
    readLease.current = lease; setReading(true);
    // refresh() returns void. Never await it or clear the confirmed marker.
    try { router.refresh(); }
    catch { lease(); readLease.current = null; setReading(false); setError("清單尚未更新，請稍後重新載入。不要再次送出已驗證批次。"); }
  }
  function show() {
    if (!ready) return; composing.current = false; setOpenedIdentity(identity); setOpen(true);
    setError(null); if (!ownOperation) setConsentTuple(null);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (composing.current || !ready || !displayed || hasViewTransition()) return;
    if (!confirmed || new FormData(event.currentTarget).get("confirmed") !== "on") {
      setError("請先核對筆數與總額，並勾選確認。"); consent.current?.focus(); return;
    }
    let attempt: ClaimValidationOperation | null = null;
    try { attempt = ownOperation ? retryClaimValidation(ownOperation.token) : beginClaimValidation(scope, demo, displayed); }
    catch { setError("批次資料無效或無法建立安全操作識別，請重新核對。"); return; }
    if (!attempt) { setError("已有未完成操作或畫面正在更新，請先完成回查。"); return; }
    const epoch = context.current.epoch; setError(null);
    try {
      const response = await fetchWithTimeout("/api/claims/validate", { method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.expected.idempotencyKey }, body: attempt.body });
      const payload: unknown = await response.json();
      if (!isCurrent(epoch, attempt)) { settleClaimValidation(attempt, "unknown"); return; }
      if (!response.ok) {
        const known = isConfirmedClaimValidationRejection(payload, response.status);
        settleClaimValidation(attempt, known ? "denied" : "unknown");
        setError(known && !attempt.everUnknown ? "批次未確認完成驗證。請檢查明細、簽署服務、有效計畫與總額，再核對送出。"
          : "原操作結果仍未確認。請保留原批次與操作鍵，恢復權限後回查；不要另建操作。"); return;
      }
      parseClaimValidationEnvelope(payload, response.status, attempt.expected);
      if (!settleClaimValidation(attempt, "success")) return;
      setOpen(false); setConsentTuple(null);
      setNotice(attempt.expected.demo ? "展示請求已通過相同欄位驗證；展示批次不會凍結。" : STALE);
      if (!attempt.expected.demo) requestRead();
    } catch {
      const current = isCurrent(epoch, attempt); settleClaimValidation(attempt, "unknown");
      if (current) setError("批次結果尚未確認。網路恢復後請核對原請求，重試會沿用原操作鍵。");
    }
  }
  const hasConfirmed = markedIds.size > 0;
  const visibleNotice = notice === STALE && !hasConfirmed ? null : notice;
  return <div className="core-composer">
    <button className="button button--secondary" aria-busy={pending} disabled={!ready} onClick={show} ref={trigger} type="button">
      <FileCheck2 aria-hidden="true" />{ownOperation ? "核對上次申報驗證" : "驗證草稿"}
    </button>
    {disabledReason ? <p className="core-care-muted" role={otherOperationPending ? "status" : undefined}>{disabledReason}</p> : null}
    {pending ? <p role="status">上次申報驗證仍在處理，請等候回覆；不要另外送出。</p> : null}
    {unknown && !open ? <p role="status">上次申報驗證尚未確認，請核對原請求。</p> : null}
    {visibleNotice && openedIdentity === identity ? <p className="core-composer__notice" role="status">{visibleNotice}</p> : null}
    {hasConfirmed ? <div><p role="status">已驗證批次仍出現在舊清單，暫不接受再次驗證。</p>
      <button className="button button--secondary" disabled={!!operation || viewPending && !reading} onClick={() => {
        // Explicit GET-only retry releases this read lease, never a write.
        readLease.current?.(); readLease.current = null; setReading(false); requestRead(true);
      }} type="button">重新載入清單</button></div> : null}
    {foreignOperation ? <p className="form-error" role="alert">另一個帳號或分支仍有未確認操作。此處不顯示其批次或金額，請由原帳號與分支回查。</p> : null}
    {journal.navigationBlocked ? <p className="form-error" role="alert">操作結果尚未確認，請先回查原請求再離開。關閉或重新整理整個分頁可能遺失暫存內容。</p> : null}
    <GovernanceDialog open={open && openedIdentity === identity && !foreignOperation} title="驗證申報草稿"
      busy={pending} onRequestClose={() => { if (!pending) { composing.current = false; setOpen(false); } }} returnFocusRef={trigger}>
      <form data-claim-validation-form noValidate onSubmit={submit}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={(event) => { if (event.key === "Enter" && (event.nativeEvent.isComposing || composing.current)) event.preventDefault(); }}>
        <p>只驗證並凍結明細，不會產生主管機關檔案或送件。</p>
        <div className="callout core-care-callout"><ShieldCheck aria-hidden="true" /><span>逐筆核對已簽署服務、有效計畫與證據；任一不符時整批不變更。</span></div>
        {displayed ? <>
          <label className="field"><span>草稿批次 *</span><select disabled={pending || !!ownOperation} name="claim_batch_id"
            value={displayed.id} onChange={(event) => { if (!ownOperation) { setSelectedId(event.target.value); setConsentTuple(null); setError(null); } }}>
            {options.map((batch) => <option key={batch.id} value={batch.id}>{batch.periodLabel}・{batch.itemCount} 筆・{displayMoney(batch.totalAmount)}</option>)}
          </select></label>
          <dl className="core-care-card-grid claim-confirmation-summary"><div><dt>申報期間</dt><dd>{displayed.periodLabel}</dd></div>
            <div><dt>明細筆數</dt><dd>{displayed.itemCount} 筆</dd></div><div><dt>確認總額</dt><dd>{displayMoney(displayed.totalAmount)}</dd></div>
            <div><dt>完成後狀態</dt><dd>已驗證、明細凍結</dd></div></dl>
          <label className={styles.consent}><input checked={confirmed} disabled={pending} name="confirmed" type="checkbox" ref={consent}
            aria-invalid={!!error && !confirmed} aria-describedby={error ? errorId : undefined}
            onChange={(event) => { setConsentTuple(event.target.checked ? tuple : null); setError(null); }} />
            <span>我已核對上列筆數與總額，並了解這不是正式送件。</span></label>
        </> : <p role="alert">目前權限或驗證狀態已變更，請恢復權限後再核對原請求。</p>}
        {unknown ? <p className="form-error" role="alert">{UNKNOWN}</p> : null}
        {error ? <p className="form-error" id={errorId} role="alert">{error}</p> : null}
        <footer className="drawer__footer"><button className="button button--primary" aria-busy={pending}
          disabled={pending || !ready} type="submit">{pending ? "驗證中…" : unknown ? "核對原請求結果" : "確認驗證並凍結"}</button></footer>
      </form>
    </GovernanceDialog>
  </div>;
}
