"use client";

import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { GovernanceDialog } from "@/components/ui/governance-dialog";
import type { TenantContext } from "@/lib/domain/types";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { useUnsavedChanges } from "@/lib/navigation/use-unsaved-changes";
import { hasPendingOperations, hasViewTransition, tryAcquireViewTransition, usePendingOperations, useViewTransitionPending } from "@/lib/navigation/pending-operation-lock";
import { parseReferralManagementApiSuccess, parseReferralManagementMutation } from "@/lib/referral-management/parser";
import { readReferralSnapshot } from "@/lib/referral-management/snapshot-client";
import { normalizeReferralSnapshot } from "@/lib/referral-management/snapshot-contract";
import { beginReferral, getReferralPending, getReferralSnapshotAdmission, isConfirmedReferralRejection, observeReferralAuthority, observeReferralSnapshot, reconcileReferralConfirmed, referralAuthoritySignature, referralScopeIdentity, retryReferral, settleReferral, useReferralPending, type ReferralOperation } from "@/lib/referral-management/pending";
import type { ReferralClientOption, ReferralManagementFilters, ReferralManagementItem, ReferralManagementMutationInput, ReferralManagementSnapshot, ReferralReceivingUnitState } from "@/lib/referral-management/types";
import styles from "./referral-management.module.css";

type Action = ReferralManagementMutationInput["action"];
type Values = { clientId: string; receivingUnitState: ReferralReceivingUnitState; receivingUnitCode: string; receivingUnitName: string; referralDate: string; referralReason: string; entryContent: string; correctsEventId: string; correctionReason: string };
type Editor = { action: Action; target: ReferralManagementItem | null; sourceAt: string; fingerprint: string; epoch: number; privacyEpoch: number; initial: Values };
const labels: Record<Action, string> = { create: "建立轉介草稿", submit: "送出院內版本", register_received: "人工登記收件", respond: "登記回覆", close: "結案", correct: "狹義更正" };
const verbs: Record<Action, string> = { create: "建立不可變草稿", submit: "建立送出院內版本事件", register_received: "建立人工登記收件事件", respond: "建立登記回覆事件", close: "建立結案事件", correct: "建立更正事件" };
const scopes: Record<Action, string> = { create: "referral_management.create", submit: "referral_management.submit", register_received: "referral_management.receive", respond: "referral_management.respond", close: "referral_management.close", correct: "referral_management.correct" };
function capability(snapshot: ReferralManagementSnapshot, action: Action) { return action === "create" ? snapshot.canCreate : action === "submit" ? snapshot.canSubmit : action === "register_received" ? snapshot.canRegisterReceipt : action === "respond" ? snapshot.canRespond : action === "close" ? snapshot.canClose : snapshot.canCorrect; }
function isPermitted(context: TenantContext, snapshot: ReferralManagementSnapshot | null, action: Action, targetClient?: string) { return !!snapshot && !context.demo && context.assuranceLevel === "aal2" && context.scopes.includes("clients.read") && context.scopes.includes("referral_management.read") && context.scopes.includes(scopes[action]) && capability(snapshot, action) && (!targetClient || snapshot.clientOptions.some((entry) => entry.clientId === targetClient)); }
function localDate(value: string) { if (!isStrictOffsetDateTime(value)) return ""; return new Date(Date.parse(value) + 8 * 60 * 60_000).toISOString().slice(0, 16); }
function absoluteDate(value: string) { const offset = `${value}:00+08:00`; return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value) && isStrictOffsetDateTime(offset) ? new Date(offset).toISOString() : null; }
function initialValues(snapshot: ReferralManagementSnapshot): Values { return { clientId: "", receivingUnitState: "manual_unstandardized", receivingUnitCode: "", receivingUnitName: "", referralDate: localDate(snapshot.generatedAt), referralReason: "", entryContent: "", correctsEventId: "", correctionReason: "" }; }
function safeSnapshot(snapshot: ReferralManagementSnapshot | null, context: TenantContext) { if (!snapshot || snapshot.organizationId !== context.organizationId || snapshot.branchId !== context.branchId || snapshot.demo !== context.demo) return null; if (context.demo) return snapshot; try { return normalizeReferralSnapshot(snapshot, context); } catch { return null; } }
type ControllerValue = { snapshot: ReferralManagementSnapshot | null; unavailable: (action: Action, item?: ReferralManagementItem) => boolean; open: (action: Action, item: ReferralManagementItem | undefined, trigger: HTMLElement) => void; refresh: () => void; readBlocked: boolean };
const Controller = createContext<ControllerValue | null>(null);
export function useReferralController() { return useContext(Controller); }

export function ReferralController({ context, filters, snapshot: serverSnapshot, children }: { context: TenantContext; filters: ReferralManagementFilters; snapshot: ReferralManagementSnapshot | null; children: ReactNode }) {
  const router = useRouter(); const journal = useReferralPending(); const pendingWork = usePendingOperations(); const changingView = useViewTransitionPending();
  const scope = { organizationId: context.organizationId, branchId: context.branchId, userId: context.userId };
  const identity = context.demo ? JSON.stringify([context.organizationId, context.branchId, context.userId, true]) : referralScopeIdentity(scope, false);
  const readable = context.demo || context.assuranceLevel === "aal2" && context.scopes.includes("clients.read") && context.scopes.includes("referral_management.read");
  const [readOverride, setReadOverride] = useState<{ identity: string; privacyEpoch: number; filters: string; snapshot: ReferralManagementSnapshot } | null>(null);
  const filterIdentity = JSON.stringify(filters);
  const override = readOverride?.identity === identity && readOverride.privacyEpoch === journal.privacyEpoch && readOverride.filters === filterIdentity ? readOverride.snapshot : null;
  const candidate = override && (!serverSnapshot || Date.parse(override.generatedAt) > Date.parse(serverSnapshot.generatedAt)) ? override : serverSnapshot;
  const suppliedSnapshot = safeSnapshot(candidate, context);
  const acceptedSnapshotAt = getReferralSnapshotAdmission(scope, context.demo);
  const [admission, setAdmission] = useState({ identity, readable, privacyEpoch: journal.privacyEpoch, sourceAt: suppliedSnapshot?.generatedAt ?? null as string | null, blockedAt: null as string | null });
  const privacyChanged = admission.identity !== identity || admission.privacyEpoch !== journal.privacyEpoch || admission.readable && !readable;
  const admitted = !privacyChanged && (admission.blockedAt === null || !!suppliedSnapshot && Date.parse(suppliedSnapshot.generatedAt) > Date.parse(admission.blockedAt)) && (journal.snapshotFloor === null || !!suppliedSnapshot && Date.parse(suppliedSnapshot.generatedAt) > Date.parse(journal.snapshotFloor)) && (acceptedSnapshotAt === null || !!suppliedSnapshot && Date.parse(suppliedSnapshot.generatedAt) >= Date.parse(acceptedSnapshotAt)) && (!admission.sourceAt || !!suppliedSnapshot && Date.parse(suppliedSnapshot.generatedAt) >= Date.parse(admission.sourceAt));
  if (privacyChanged) setAdmission({ identity, readable, privacyEpoch: journal.privacyEpoch, sourceAt: null, blockedAt: admission.sourceAt ?? admission.blockedAt ?? suppliedSnapshot?.generatedAt ?? null });
  else if (admitted && suppliedSnapshot && admission.sourceAt !== suppliedSnapshot.generatedAt) setAdmission({ ...admission, readable, sourceAt: suppliedSnapshot.generatedAt, blockedAt: null });
  const snapshot = admitted && readable && suppliedSnapshot?.organizationId === context.organizationId && suppliedSnapshot.branchId === context.branchId && suppliedSnapshot.demo === context.demo ? suppliedSnapshot : null;
  const authority = referralAuthoritySignature(context);
  const fingerprint = JSON.stringify([authority, readable, snapshot ? [snapshot.canCreate, snapshot.canSubmit, snapshot.canRegisterReceipt, snapshot.canRespond, snapshot.canClose, snapshot.canCorrect, snapshot.clientOptions.map((option) => option.clientId).sort()] : null]);
  const lifecycle = useRef({ mounted: false, epoch: 0, fingerprint }); const live = useRef({ context, snapshot, fingerprint, identity, filterIdentity });
  const composition = useRef(false); const form = useRef<HTMLFormElement | null>(null); const trigger = useRef<HTMLElement | null>(null); const recovery = useRef<HTMLElement | null>(null);
  const readLease = useRef<(() => void) | null>(null); const [reading, startRead] = useTransition(); const [readEpoch, setReadEpoch] = useState(0);
  const recoveryRead = useRef<{ token: symbol; abort: AbortController } | null>(null); const [checkingAuthority, setCheckingAuthority] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null); const [values, setValues] = useState<Values | null>(null); const [errors, setErrors] = useState<Record<string, string>>({}); const [error, setError] = useState(""); const [readError, setReadError] = useState("");
  const [saved, setSaved] = useState<{ identity: string; privacyEpoch: number } | null>(null); const [clock, setClock] = useState(() => Date.now()); const [offline, setOffline] = useState(false); const id = useId();
  useLayoutEffect(() => {
    live.current = { context, snapshot, fingerprint, identity, filterIdentity };
    if (lifecycle.current.fingerprint !== fingerprint) { lifecycle.current.epoch += 1; lifecycle.current.fingerprint = fingerprint; recoveryRead.current?.abort.abort(); recoveryRead.current = null; setCheckingAuthority(false); const operation = getReferralPending().operation; if (operation?.phase === "sending") settleReferral(operation, "unknown"); setEditor(null); setValues(null); setErrors({}); setError(""); setReadError(""); setSaved(null); composition.current = false; }
    observeReferralAuthority(authority); observeReferralSnapshot({ organizationId: context.organizationId, branchId: context.branchId, userId: context.userId }, context.demo, snapshot);
  }, [authority, context, snapshot, fingerprint, identity, filterIdentity]);
  useEffect(() => { const life = lifecycle.current; life.mounted = true; return () => { life.mounted = false; life.epoch += 1; readLease.current?.(); readLease.current = null; recoveryRead.current?.abort.abort(); recoveryRead.current = null; const operation = getReferralPending().operation; if (operation?.phase === "sending" && operation.identity === live.current.identity) settleReferral(operation, "unknown"); }; }, []);
  useEffect(() => { if (!reading && readLease.current) { readLease.current(); readLease.current = null; } }, [reading, readEpoch]);
  useEffect(() => { const check = () => { setClock(Date.now()); setOffline(!navigator.onLine); }; check(); const timer = window.setInterval(check, 1000); window.addEventListener("online", check); window.addEventListener("offline", check); return () => { window.clearInterval(timer); window.removeEventListener("online", check); window.removeEventListener("offline", check); }; }, []);
  useEffect(() => { if (snapshot && !context.demo) reconcileReferralConfirmed({ organizationId: context.organizationId, branchId: context.branchId, userId: context.userId }, snapshot, Date.now()); }, [snapshot, context.organizationId, context.branchId, context.userId, context.demo]);
  const pending = journal.operation; const ownOperation = pending?.identity === identity ? pending : null; const busy = pending?.phase === "sending"; const confirmed = journal.confirmed.filter((entry) => entry.identity === identity);
  const visibleEditor = editor?.fingerprint === fingerprint && editor.privacyEpoch === journal.privacyEpoch ? editor : null;
  const locked = !!pending; const stale = !snapshot || clock >= Date.parse(snapshot.staleAfter);
  function permitted(action: Action, targetClient?: string) { const current = live.current; return isPermitted(current.context, current.snapshot, action, targetClient); }
  const recoverable = ownOperation && isPermitted(context, snapshot, ownOperation.input.action, ownOperation.input.clientId ?? ownOperation.target?.clientId);
  function unavailable(action: Action, item?: ReferralManagementItem) { return !snapshot || snapshot.demo || stale || offline || !!pending || pendingWork || changingView || reading || confirmed.length >= 32 || !capability(snapshot, action) || !context.scopes.includes(scopes[action]) || !!item && (!snapshot.clientOptions.some((option) => option.clientId === item.clientId) || confirmed.some((entry) => entry.referralKey === item.referralKey) || action === "submit" && item.receivingUnitState !== "manual_unstandardized"); }
  const guard = useUnsavedChanges({ dirty: !!visibleEditor && !pending && !!values && JSON.stringify(values) !== JSON.stringify(visibleEditor.initial), scopeKey: JSON.stringify([fingerprint, journal.privacyEpoch]), revisionKey: snapshot?.generatedAt ?? "unavailable", canPrompt: !pendingWork && !changingView && !reading, permittedFormAttribute: "data-referral-management-form", onDiscard: () => { setEditor(null); setValues(null); composition.current = false; } });
  function open(action: Action, item: ReferralManagementItem | undefined, button: HTMLElement) {
    if (!snapshot || unavailable(action, item) || !permitted(action, item?.clientId)) return;
    guard.requestExit(() => { if (!snapshot || hasPendingOperations() || hasViewTransition() || unavailable(action, item) || !permitted(action, item?.clientId)) return; const initial = initialValues(snapshot); trigger.current = button; composition.current = false; setError(""); setErrors({}); setSaved(null); setValues(initial); setEditor({ action, target: item ? structuredClone(item) : null, sourceAt: snapshot.generatedAt, fingerprint, epoch: lifecycle.current.epoch, privacyEpoch: journal.privacyEpoch, initial: structuredClone(initial) }); });
  }
  function performRead() { if (hasPendingOperations() || hasViewTransition() || reading) return; const lease = tryAcquireViewTransition(); if (!lease) return; readLease.current = lease; setReadEpoch((value) => value + 1); startRead(() => { try { return router.refresh(); } catch { lease(); readLease.current = null; setError("清單無法重新載入，請稍後再試。"); } }); }
  function refresh() { if (!hasPendingOperations() && !hasViewTransition() && !reading) guard.requestExit(performRead); }
  async function refreshRecovery() {
    const operation = getReferralPending().operation;
    if (!operation || operation.identity !== live.current.identity || operation.phase !== "unknown" || recoveryRead.current || reading || hasViewTransition() || !navigator.onLine || live.current.context.assuranceLevel !== "aal2" || !live.current.context.scopes.includes("clients.read") || !live.current.context.scopes.includes("referral_management.read")) return;
    const token = Symbol(); const abort = new AbortController(); recoveryRead.current = { token, abort }; setCheckingAuthority(true); setReadError("");
    const epoch = lifecycle.current.epoch; const privacyEpoch = journal.privacyEpoch; const authorityEpoch = journal.authorityEpoch; const capabilityEpoch = journal.capabilityEpoch; const capturedFilters = live.current.filterIdentity;
    const current = () => { const state = getReferralPending(); return lifecycle.current.mounted && lifecycle.current.epoch === epoch && recoveryRead.current?.token === token && live.current.identity === operation.identity && live.current.filterIdentity === capturedFilters && state.privacyEpoch === privacyEpoch && state.authorityEpoch === authorityEpoch && state.capabilityEpoch === capabilityEpoch && state.operation?.token === operation.token && state.operation.phase === "unknown"; };
    try { const next = await readReferralSnapshot(scope, filters, abort.signal); if (current()) { setReadOverride({ identity: operation.identity, privacyEpoch, filters: capturedFilters, snapshot: next }); setError(""); } }
    catch { if (current()) setReadError("未能重新取得授權資料；原操作仍保留，請稍後再查。"); }
    finally { if (recoveryRead.current?.token === token) { recoveryRead.current = null; if (lifecycle.current.mounted) setCheckingAuthority(false); } }
  }
  async function execute(operation: ReferralOperation) {
    const epoch = lifecycle.current.epoch; const captured = live.current.fingerprint;
    const currentAttempt = () => { const current = getReferralPending(); return lifecycle.current.mounted && lifecycle.current.epoch === epoch && live.current.fingerprint === captured && live.current.identity === operation.identity && navigator.onLine && permitted(operation.input.action, operation.input.clientId ?? operation.target?.clientId) && current.operation === operation && current.privacyEpoch === operation.privacyEpoch && current.authorityEpoch === operation.authorityEpoch && current.capabilityEpoch === operation.capabilityEpoch; };
    if (!currentAttempt()) { settleReferral(operation, "unknown"); return; }
    try {
      const response = await fetchWithTimeout("/api/referrals", { method: "POST", cache: "no-store", headers: { "content-type": "application/json", "idempotency-key": operation.input.idempotencyKey }, body: operation.body }); const raw: unknown = await response.json();
      if (!currentAttempt()) { settleReferral(operation, "unknown"); return; }
      if (!response.ok) { settleReferral(operation, isConfirmedReferralRejection(raw, response.status) ? "denied" : "unknown"); if (!getReferralPending().operation) setError("本次操作未保存。請確認授權、個案指派與最新事件後重試。"); return; }
      const receipt = parseReferralManagementApiSuccess(raw, operation.input, operation.scope.organizationId, operation.scope.branchId, response.status);
      if (settleReferral(operation, receipt) && !getReferralPending().operation && getReferralPending().confirmed.some((entry) => entry.identity === operation.identity && entry.eventId === receipt.data.eventId)) { setEditor(null); setValues(null); setErrors({}); setSaved({ identity: operation.identity, privacyEpoch: operation.privacyEpoch }); performRead(); }
    } catch { settleReferral(operation, "unknown"); }
  }
  function retry() { if (!ownOperation || !recoverable || composition.current || recoveryRead.current || !navigator.onLine || hasViewTransition() || reading) return; const operation = retryReferral(ownOperation.token, scope, context.demo); if (operation) void execute(operation); }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!visibleEditor || !values || composition.current || pendingWork || changingView || reading || locked) return;
    const source = live.current.snapshot; if (!source || Date.now() >= Date.parse(source.staleAfter) || source.generatedAt !== visibleEditor.sourceAt || visibleEditor.epoch !== lifecycle.current.epoch || !permitted(visibleEditor.action, visibleEditor.target?.clientId ?? values.clientId)) { setError("畫面版本或授權已更新。請保留內容並重新核對最新事件。"); return; }
    if (visibleEditor.target && !source.items.some((item) => item.referralKey === visibleEditor.target!.referralKey && item.eventId === visibleEditor.target!.eventId && item.sequence === visibleEditor.target!.sequence && item.contentHash === visibleEditor.target!.contentHash)) { setError("來源事件已更新，請重新開啟最新轉介核對。"); return; }
    const next: Record<string, string> = {}; const narrative = (key: "referralReason" | "entryContent" | "correctionReason", max: number, optional = false) => { const value = values[key].trim(); if ((!optional || value) && (value.length < 2 || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))) next[key] = `請填寫 2–${max} 字有效內容。`; };
    const action = visibleEditor.action; const target = visibleEditor.target; let body: Record<string, unknown>;
    if (action === "create") {
      if (!source.clientOptions.some((client) => client.clientId === values.clientId)) next.clientId = "請選擇目前可服務的個案。";
      if (values.receivingUnitState === "manual_unstandardized") { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u.test(values.receivingUnitCode.trim())) next.receivingUnitCode = "請填寫 1–40 字英數代碼，可含 . _ -。"; if (!values.receivingUnitName.trim() || values.receivingUnitName.trim().length > 160 || /[\u0000-\u001f\u007f]/u.test(values.receivingUnitName)) next.receivingUnitName = "請填寫 1–160 字接收單位名稱。"; }
      const date = absoluteDate(values.referralDate); if (!date) next.referralDate = "請選擇有效的台北轉介日期與時間。"; narrative("referralReason", 2000);
      body = { action, clientId: values.clientId, receivingUnitState: values.receivingUnitState, receivingUnitCode: values.receivingUnitState === "manual_unstandardized" ? values.receivingUnitCode : null, receivingUnitName: values.receivingUnitState === "manual_unstandardized" ? values.receivingUnitName : null, referralDate: date, referralReason: values.referralReason };
    } else {
      narrative("entryContent", 4000, action === "submit"); body = { action, referralKey: target!.referralKey, previousEventId: target!.eventId, expectedSequence: target!.sequence, ...(values.entryContent.trim() || action !== "submit" ? { entryContent: values.entryContent } : {}) };
      if (action === "correct") { if (!target!.history.some((entry) => entry.eventId === values.correctsEventId && entry.eventKind !== "corrected")) next.correctsEventId = "請選擇此轉介可更正的原事件。"; narrative("correctionReason", 500); body = { ...body, correctsEventId: values.correctsEventId, correctionReason: values.correctionReason }; }
    }
    if (action === "create" && confirmed.some((entry) => entry.clientId === values.clientId)) next.clientId = "此個案有已保存操作待清單核對，請先重新載入。";
    if (Object.keys(next).length) { setErrors(next); form.current?.querySelector<HTMLElement>(`[data-referral-field="${Object.keys(next)[0]}"]`)?.focus(); return; }
    try { const input = parseReferralManagementMutation(body, crypto.randomUUID()); const operation = beginReferral(scope, context.demo, input, visibleEditor.sourceAt, target ?? undefined); if (operation) { setErrors({}); setError(""); void execute(operation); } else setError("目前無法送出，請確認授權與待回查操作。"); } catch { setError("資料或來源事件未通過驗證，請核對後重試。"); }
  }
  function field(key: keyof Values) { const names: Record<keyof Values, string> = { clientId: "個案", receivingUnitState: "接收單位狀態", receivingUnitCode: "人工接收單位代碼", receivingUnitName: "人工接收單位名稱", referralDate: "轉介日期（台北）", referralReason: "轉介原因", correctsEventId: "更正哪一事件", correctionReason: "更正理由", entryContent: visibleEditor?.action === "submit" ? "送出備註（選填）" : visibleEditor?.action === "correct" ? "更正後內容" : `${labels[visibleEditor?.action ?? "respond"]}內容` }; return { id: `${id}-${key}`, name: key, "aria-label": names[key], "data-referral-field": key, "aria-invalid": !!errors[key], "aria-describedby": errors[key] ? `${id}-${key}-error` : undefined }; }
  function fieldError(key: keyof Values) { return errors[key] ? <small id={`${id}-${key}-error`} role="alert">{errors[key]}</small> : null; }
  function update(key: keyof Values, value: string) { if (!locked && values) setValues({ ...values, [key]: value }); }
  const displayed = ownOperation && recoverable ? ownOperation.input : null;
  return <Controller.Provider value={{ snapshot, unavailable, open, refresh, readBlocked: !!pending || pendingWork || changingView || reading }}>
    <section ref={recovery} tabIndex={-1} data-governance-focus-anchor aria-label="轉介操作回查">
      {pending && !ownOperation && <p role="status">另一個資料範圍有待確認操作。請回原範圍回查，此處不顯示內容。</p>}
      {ownOperation && !recoverable && <p role="status">上次轉介操作尚未確認；授權或個案指派已變更，原內容已隱藏。</p>}
      {ownOperation?.phase === "unknown" && <button className="button button--secondary" disabled={checkingAuthority || reading || changingView || offline || !readable} onClick={() => { void refreshRecovery(); }}>{checkingAuthority ? "核對授權中…" : "重新核對原範圍授權"}</button>}
      {displayed && <div className={styles.notice}><p role="status">{busy ? "轉介操作確認中，請勿重複送出。" : "上次轉介操作尚未確認，請勿建立另一筆；重試保留原內容與識別碼。"}</p><details><summary>原操作內容（唯讀）</summary><p>{labels[displayed.action]}</p>{displayed.referralReason && <p>{displayed.referralReason}</p>}{displayed.entryContent && <p>{displayed.entryContent}</p>}{displayed.correctionReason && <p>更正理由：{displayed.correctionReason}</p>}</details><button className="button button--secondary" disabled={busy || checkingAuthority || offline || changingView || reading} onClick={retry}>以相同內容重試</button></div>}
      {confirmed.length > 0 && <div className={styles.notice}><p role="status">轉介操作已保存，清單尚未確認更新；請先重新載入核對。</p><button className="button button--secondary" disabled={!!pending || changingView || reading} onClick={refresh}>重新載入清單</button></div>}
      {saved?.identity === identity && saved.privacyEpoch === journal.privacyEpoch && confirmed.length === 0 && <p role="status">轉介操作已保存，清單已確認更新。</p>}
      {(journal.navigationBlocked || guard.notice) && <p role="status">{guard.notice || "請先回查未確認操作，再離開此頁。"}</p>}
      {offline && <p role="status">目前離線，不能送出；此頁不會將轉介內容存入裝置。</p>}
      {readError && <p role="alert">{readError}</p>}
    </section>
    {children}
    <GovernanceDialog open={!!visibleEditor && !guard.open} title={visibleEditor ? labels[visibleEditor.action] : "轉介操作"} busy={locked} onRequestClose={() => { if (!composition.current && !locked) guard.requestExit(() => { setEditor(null); setValues(null); }); }} returnFocusRef={trigger} fallbackFocusRef={recovery}>
      <p>保存後只追加不可直接改寫的院內事件，原紀錄會保留；不代表外部已送達。</p>
      {visibleEditor?.target && <p>{visibleEditor.target.clientDisplayName} · 原事件 #{visibleEditor.target.sequence}</p>}
      {visibleEditor && values && <form ref={form} noValidate data-referral-management-form className={styles.actionEditor} onSubmit={submit} onCompositionStart={() => { composition.current = true; guard.compositionStart(); }} onCompositionEnd={() => { composition.current = false; guard.compositionEnd(); }}>
        <fieldset disabled={locked}><div className={styles.formGrid}>
          {visibleEditor.action === "create" ? <>
            <label className="field"><span>個案</span><select {...field("clientId")} required value={values.clientId} onChange={(event) => update("clientId", event.target.value)}><option value="">請選擇</option>{snapshot?.clientOptions.map((client) => <option key={client.clientId} value={client.clientId}>{client.displayName} · {client.clientCode}</option>)}</select>{fieldError("clientId")}</label>
            <label className="field"><span>接收單位狀態</span><select {...field("receivingUnitState")} value={values.receivingUnitState} onChange={(event) => update("receivingUnitState", event.target.value)}><option value="manual_unstandardized">人工輸入（未標準化）</option><option value="missing">缺值（待補）</option><option value="not_applicable">不適用</option></select></label>
            {values.receivingUnitState === "manual_unstandardized" && <><label className="field"><span>人工接收單位代碼</span><input {...field("receivingUnitCode")} required maxLength={40} value={values.receivingUnitCode} onChange={(event) => update("receivingUnitCode", event.target.value)}/>{fieldError("receivingUnitCode")}</label><label className="field"><span>人工接收單位名稱</span><input {...field("receivingUnitName")} required maxLength={160} value={values.receivingUnitName} onChange={(event) => update("receivingUnitName", event.target.value)}/>{fieldError("receivingUnitName")}</label></>}
            <label className="field"><span>轉介日期（台北）</span><input {...field("referralDate")} required type="datetime-local" value={values.referralDate} onChange={(event) => update("referralDate", event.target.value)}/>{fieldError("referralDate")}</label><label className={`field ${styles.wide}`}><span>轉介原因</span><textarea {...field("referralReason")} className="resize-none" required minLength={2} maxLength={2000} value={values.referralReason} onChange={(event) => update("referralReason", event.target.value)}/>{fieldError("referralReason")}</label>
          </> : <>{visibleEditor.action === "correct" && <label className="field"><span>更正哪一事件</span><select {...field("correctsEventId")} required value={values.correctsEventId} onChange={(event) => update("correctsEventId", event.target.value)}><option value="">請選擇</option>{visibleEditor.target!.history.filter((entry) => entry.eventKind !== "corrected").map((entry) => <option key={entry.eventId} value={entry.eventId}>#{entry.sequence} · {entry.eventKind}</option>)}</select>{fieldError("correctsEventId")}</label>}
            <label className={`field ${styles.wide}`}><span>{visibleEditor.action === "submit" ? "送出備註（選填）" : visibleEditor.action === "correct" ? "更正後內容" : `${labels[visibleEditor.action]}內容`}</span><textarea {...field("entryContent")} className="resize-none" required={visibleEditor.action !== "submit"} maxLength={4000} value={values.entryContent} onChange={(event) => update("entryContent", event.target.value)}/>{fieldError("entryContent")}</label>
            {visibleEditor.action === "correct" && <label className={`field ${styles.wide}`}><span>更正理由</span><textarea {...field("correctionReason")} className="resize-none" required minLength={2} maxLength={500} value={values.correctionReason} onChange={(event) => update("correctionReason", event.target.value)}/>{fieldError("correctionReason")}</label>}</>}
        </div></fieldset>
        {error && <p role="alert">{error}</p>}
        <button className="button button--primary" type="submit" disabled={locked || pendingWork || changingView || reading || offline}>{verbs[visibleEditor.action]}</button>
      </form>}
      {ownOperation?.phase === "unknown" && <><p role="alert">原操作結果尚未確認，內容不可修改。</p><button className="button button--secondary" onClick={() => { if (!composition.current) { setEditor(null); setValues(null); composition.current = false; } }}>回待確認清單</button><button className="button button--primary" disabled={!recoverable || checkingAuthority || offline || changingView || reading} onClick={retry}>重試同一轉介操作</button></>}
    </GovernanceDialog>
    <GovernanceDialog open={guard.open} title="放棄未保存的轉介填寫？" cancelLabel="繼續填寫" onRequestClose={() => { if (!composition.current) guard.cancel(); }} returnFocusRef={guard.returnFocusRef} fallbackFocusRef={recovery}><p>尚未保存的填寫會清除；已送出但未確認的操作不能放棄。</p><button className="button button--danger" onClick={() => { if (!composition.current) guard.confirmDiscard(); }}>放棄填寫並繼續</button></GovernanceDialog>
  </Controller.Provider>;
}

export function ReferralCreateForm({ canCreate }: { branchId: string; canCreate: boolean; clients: readonly ReferralClientOption[]; organizationId: string; referenceTime: string }) { const controller = useReferralController(); return <div className={styles.editor}><button className="button button--primary" disabled={!canCreate || !controller || controller.unavailable("create")} onClick={(event) => controller?.open("create", undefined, event.currentTarget)}>建立轉介草稿</button>{!canCreate || !controller ? <p className={styles.muted}>目前唯讀；建立需要指定個案權限及最近 15 分鐘 AAL2。</p> : null}</div>; }
const nextAction = { draft: "submit", submitted: "register_received", received: "respond", responded: "close", closed: null } as const;
export function ReferralTransitionForm({ item, snapshot }: { item: ReferralManagementItem; snapshot: ReferralManagementSnapshot }) { const controller = useReferralController(); const action = nextAction[item.status]; if (!action) return null; return <button className="button button--secondary" disabled={snapshot.demo || !controller || controller.unavailable(action, item)} onClick={(event) => controller?.open(action, item, event.currentTarget)}>{labels[action]}</button>; }
export function ReferralCorrectionForm({ item, snapshot }: { item: ReferralManagementItem; snapshot: ReferralManagementSnapshot }) { const controller = useReferralController(); return <button className="button button--secondary" disabled={snapshot.demo || !controller || controller.unavailable("correct", item)} onClick={(event) => controller?.open("correct", item, event.currentTarget)}>狹義更正</button>; }
