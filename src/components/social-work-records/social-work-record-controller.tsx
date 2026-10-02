"use client";

import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { GovernanceDialog } from "@/components/ui/governance-dialog";
import type { TenantContext } from "@/lib/domain/types";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { useUnsavedChanges } from "@/lib/navigation/use-unsaved-changes";
import { hasPendingOperations, hasViewTransition, tryAcquireViewTransition, usePendingOperations, useViewTransitionPending } from "@/lib/navigation/pending-operation-lock";
import { parseSocialWorkActionSuccess } from "@/lib/social-work-records/parser";
import { beginSocialWork, getSocialWorkPending, getSocialWorkSnapshotAdmission, isConfirmedSocialWorkRejection, observeSocialWorkAuthority, observeSocialWorkSnapshot, parseSocialWorkInput, quarantineSocialWorkSnapshot, reconcileSocialWorkConfirmed, retrySocialWork, settleSocialWork, socialWorkAuthoritySignature, socialWorkExpectation, socialWorkScopeIdentity, tryAcquireSocialWorkRecoveryRead, useSocialWorkPending, type SocialWorkCapabilities, type SocialWorkInput, type SocialWorkOperation } from "@/lib/social-work-records/pending";
import { normalizeSocialWorkSnapshot } from "@/lib/social-work-records/snapshot-contract";
import { readSocialWorkSnapshot, SnapshotReadError } from "@/lib/social-work-records/snapshot-client";
import type { SocialWorkRecordFilters, SocialWorkRecordSnapshot, SocialWorkServiceRecord } from "@/lib/social-work-records/types";
import styles from "./social-work-records.module.css";

export type SocialWorkAction = SocialWorkInput["action"];
export const socialWorkLabels: Record<SocialWorkAction, string> = { create_draft: "新增服務草稿", revise_draft: "建立草稿新版", sign: "簽署紀錄", correct: "建立更正版", track: "建立追蹤", complete_follow_up: "完成追蹤", cancel_follow_up: "取消追蹤" };
type Values = { clientId: string; occurredAt: string; serviceType: string; serviceContent: string; serviceResult: string; correctionReason: string; dueOn: string; followUpPlan: string; followUpOutcome: string; transitionReason: string };
type Editor = { action: SocialWorkAction; target: SocialWorkServiceRecord | null; sourceAt: string; fingerprint: string; epoch: number; privacyEpoch: number; initial: Values };
function localTime(value: string) { return isStrictOffsetDateTime(value) ? new Date(Date.parse(value) + 8 * 60 * 60_000).toISOString().slice(0, 16) : ""; }
function absoluteTime(value: string) { const result = `${value}:00+08:00`; return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value) && isStrictOffsetDateTime(result) ? new Date(result).toISOString() : null; }
function initialValues(snapshot: SocialWorkRecordSnapshot, record?: SocialWorkServiceRecord): Values { return { clientId: record?.clientId ?? "", occurredAt: localTime(record?.occurredAt ?? snapshot.generatedAt), serviceType: record?.serviceType ?? "", serviceContent: record?.serviceContent ?? "", serviceResult: record?.serviceResult ?? "", correctionReason: "", dueOn: "", followUpPlan: "", followUpOutcome: "", transitionReason: "" }; }
function safeSnapshot(value: SocialWorkRecordSnapshot | null, context: TenantContext) { if (!value || value.organizationId !== context.organizationId || value.branchId !== context.branchId || value.demo !== context.demo) return null; try { return normalizeSocialWorkSnapshot(value, context); } catch { return null; } }
function clients(snapshot: SocialWorkRecordSnapshot) { return [...new Set([...snapshot.clientOptions.map((value) => value.clientId), ...snapshot.records.map((value) => value.clientId)])].sort(); }
function permitted(context: TenantContext, snapshot: SocialWorkRecordSnapshot | null, caps: SocialWorkCapabilities, action: SocialWorkAction, client?: string) { const signing = action === "sign" || action === "correct"; return !!snapshot && !context.demo && context.assuranceLevel === "aal2" && context.scopes.includes("clients.read") && context.scopes.includes("social_work_records.read") && context.scopes.includes(signing ? "social_work_records.sign" : "social_work_records.manage") && (signing ? caps.canSign && caps.hasRecentAal2 : caps.canManage) && (!client || clients(snapshot).includes(client)); }
type ControllerValue = { snapshot: SocialWorkRecordSnapshot | null; capabilities: SocialWorkCapabilities; unavailable: (action: SocialWorkAction, target?: SocialWorkServiceRecord) => boolean; open: (action: SocialWorkAction, target: SocialWorkServiceRecord | undefined, trigger: HTMLElement) => void; refresh: () => void; readBlocked: boolean };
const noCapabilities: SocialWorkCapabilities = { canManage: false, canSign: false, hasRecentAal2: false };
const emptyFilters: SocialWorkRecordFilters = { dateFrom: null, dateTo: null, clientId: null, serviceType: null, authorUserId: null };
type RecoverySource = { identity: string; privacyEpoch: number; authorityEpoch: number; origin: string; serverAt: string | null; snapshot: SocialWorkRecordSnapshot | null; capabilities: SocialWorkCapabilities };
const Controller = createContext<ControllerValue | null>(null);
export function useSocialWorkController() { return useContext(Controller); }

/** One owner for both desktop and mobile entry buttons; no row-local write key. */
export function SocialWorkRecordController({ context, snapshot: serverSnapshot, capabilities: serverCapabilities, filters = emptyFilters, children }: { context: TenantContext; snapshot: SocialWorkRecordSnapshot | null; capabilities: SocialWorkCapabilities; filters?: SocialWorkRecordFilters; children: ReactNode }) {
  const router = useRouter(); const journal = useSocialWorkPending(); const pendingWork = usePendingOperations(); const changingView = useViewTransitionPending();
  const scope = { organizationId: context.organizationId, branchId: context.branchId, userId: context.userId };
  const identity = context.demo ? JSON.stringify([context.organizationId, context.branchId, context.userId, true]) : socialWorkScopeIdentity(scope, false);
  const readable = context.demo || context.assuranceLevel === "aal2" && context.scopes.includes("clients.read") && context.scopes.includes("social_work_records.read");
  const authority = socialWorkAuthoritySignature(context);
  const serverSource = safeSnapshot(serverSnapshot, context);
  const filterSignature = JSON.stringify([filters.dateFrom, filters.dateTo, filters.clientId, filters.serviceType, filters.authorUserId]);
  const origin = JSON.stringify([authority, serverCapabilities, serverSource ? clients(serverSource) : null, filterSignature]);
  const [recoverySource, setRecoverySource] = useState<RecoverySource | null>(null);
  const recovered = recoverySource?.identity === identity && recoverySource.privacyEpoch === journal.privacyEpoch && recoverySource.authorityEpoch === journal.authorityEpoch && recoverySource.origin === origin && (!serverSource || (recoverySource.snapshot ? Date.parse(recoverySource.snapshot.generatedAt) >= Date.parse(serverSource.generatedAt) : !recoverySource.serverAt || Date.parse(serverSource.generatedAt) <= Date.parse(recoverySource.serverAt))) ? recoverySource : null;
  const supersededSourceNotice = !!recoverySource && !recovered && !!serverSource && Date.parse(serverSource.generatedAt) > Date.parse(recoverySource.snapshot?.generatedAt ?? recoverySource.serverAt ?? "1970-01-01T00:00:00.000Z");
  const supplied = recovered ? recovered.snapshot : serverSource;
  const capabilities = recovered ? recovered.capabilities : serverCapabilities;
  const acceptedAt = getSocialWorkSnapshotAdmission(scope, context.demo);
  const [admission, setAdmission] = useState({ identity, readable, privacyEpoch: journal.privacyEpoch, sourceAt: supplied?.generatedAt ?? null as string | null, blockedAt: null as string | null });
  const boundary = admission.identity !== identity || admission.privacyEpoch !== journal.privacyEpoch || admission.readable && !readable;
  const admitted = !boundary && (admission.blockedAt === null || !!supplied && Date.parse(supplied.generatedAt) > Date.parse(admission.blockedAt)) && (journal.snapshotFloor === null || !!supplied && Date.parse(supplied.generatedAt) > Date.parse(journal.snapshotFloor)) && (acceptedAt === null || !!supplied && Date.parse(supplied.generatedAt) >= Date.parse(acceptedAt)) && (!admission.sourceAt || !!supplied && Date.parse(supplied.generatedAt) >= Date.parse(admission.sourceAt));
  if (boundary) setAdmission({ identity, readable, privacyEpoch: journal.privacyEpoch, sourceAt: null, blockedAt: admission.sourceAt ?? admission.blockedAt ?? supplied?.generatedAt ?? null });
  else if (admitted && supplied && admission.sourceAt !== supplied.generatedAt) setAdmission({ ...admission, readable, sourceAt: supplied.generatedAt, blockedAt: null });
  const snapshot = admitted && readable ? supplied : null;
  const fingerprint = JSON.stringify([authority, capabilities, snapshot ? clients(snapshot) : null, filterSignature]);
  const lifecycle = useRef({ mounted: false, epoch: 0, fingerprint }); const live = useRef({ context, snapshot, capabilities, fingerprint, identity });
  const composition = useRef(false); const form = useRef<HTMLFormElement | null>(null); const trigger = useRef<HTMLElement | null>(null); const recovery = useRef<HTMLElement | null>(null); const readLease = useRef<(() => void) | null>(null);
  const recoveryRead = useRef<{ token: symbol; abort: AbortController; release: () => void; origin: string; privacyEpoch: number; authorityEpoch: number; capabilityEpoch: number } | null>(null);
  const noticeEpoch = useRef(journal.authorityEpoch);
  const [checkingSource, setCheckingSource] = useState(false); const [sourceNotice, setSourceNotice] = useState("");
  const [reading, startRead] = useTransition(); const [readEpoch, setReadEpoch] = useState(0); const [editor, setEditor] = useState<Editor | null>(null); const [values, setValues] = useState<Values | null>(null); const [errors, setErrors] = useState<Record<string, string>>({}); const [error, setError] = useState(""); const [saved, setSaved] = useState<{ identity: string; privacyEpoch: number } | null>(null); const [clock, setClock] = useState(() => Date.now()); const [offline, setOffline] = useState(false); const id = useId();
  useLayoutEffect(() => {
    if (noticeEpoch.current !== journal.authorityEpoch) { noticeEpoch.current = journal.authorityEpoch; setSourceNotice(""); }
    const read = recoveryRead.current;
    if (read && (read.origin !== origin || read.privacyEpoch !== journal.privacyEpoch || read.authorityEpoch !== journal.authorityEpoch || read.capabilityEpoch !== journal.capabilityEpoch)) { recoveryRead.current = null; read.abort.abort(); read.release(); setCheckingSource(false); setSourceNotice(""); }
    live.current = { context, snapshot, capabilities, fingerprint, identity };
    if (lifecycle.current.fingerprint !== fingerprint) { lifecycle.current.epoch += 1; lifecycle.current.fingerprint = fingerprint; const operation = getSocialWorkPending().operation; if (operation?.phase === "sending") settleSocialWork(operation, "unknown"); setEditor(null); setValues(null); setErrors({}); setError(""); setSaved(null); composition.current = false; }
    observeSocialWorkAuthority(authority); observeSocialWorkSnapshot({ organizationId: context.organizationId, branchId: context.branchId, userId: context.userId }, context.demo, snapshot, capabilities);
  }, [authority, context, snapshot, capabilities, fingerprint, identity, scope.organizationId, scope.branchId, scope.userId, origin, journal.privacyEpoch, journal.authorityEpoch, journal.capabilityEpoch]);
  useEffect(() => { const life = lifecycle.current; life.mounted = true; return () => { life.mounted = false; life.epoch += 1; readLease.current?.(); readLease.current = null; const read = recoveryRead.current; recoveryRead.current = null; read?.abort.abort(); read?.release(); const operation = getSocialWorkPending().operation; if (operation?.phase === "sending" && operation.identity === live.current.identity) settleSocialWork(operation, "unknown"); }; }, []);
  useEffect(() => { if (!reading && readLease.current) { readLease.current(); readLease.current = null; } }, [reading, readEpoch]);
  useEffect(() => { const check = () => { setClock(Date.now()); setOffline(!navigator.onLine); }; check(); const timer = window.setInterval(check, 1000); window.addEventListener("online", check); window.addEventListener("offline", check); return () => { window.clearInterval(timer); window.removeEventListener("online", check); window.removeEventListener("offline", check); }; }, [snapshot?.generatedAt]);
  useEffect(() => { if (snapshot && !context.demo) reconcileSocialWorkConfirmed({ organizationId: context.organizationId, branchId: context.branchId, userId: context.userId }, snapshot, Date.now()); }, [snapshot, context.organizationId, context.branchId, context.userId, context.demo]);
  const pending = journal.operation; const own = pending?.identity === identity ? pending : null; const confirmed = journal.confirmed.filter((entry) => entry.identity === identity);
  const visibleEditor = editor?.fingerprint === fingerprint && editor.privacyEpoch === journal.privacyEpoch ? editor : null;
  const recoverable = !!own && permitted(context, snapshot, capabilities, own.input.action, own.input.clientId);
  const displayed = own && recoverable ? own.input : null; const busy = own?.phase === "sending"; const locked = !!pending; const stale = !snapshot || clock < Date.parse(snapshot.generatedAt) || clock >= Date.parse(snapshot.staleAfter);
  function allowed(action: SocialWorkAction, client?: string) { return permitted(live.current.context, live.current.snapshot, live.current.capabilities, action, client); }
  function unavailable(action: SocialWorkAction, target?: SocialWorkServiceRecord) { return !snapshot || stale || offline || locked || pendingWork || changingView || reading || confirmed.length >= 32 || !permitted(context, snapshot, capabilities, action, target?.clientId) || !!target && confirmed.some((entry) => entry.recordKey === target.recordKey); }
  const guard = useUnsavedChanges({ dirty: !!visibleEditor && !pending && !!values && JSON.stringify(values) !== JSON.stringify(visibleEditor.initial), scopeKey: JSON.stringify([fingerprint, journal.privacyEpoch]), revisionKey: snapshot?.generatedAt ?? "unavailable", canPrompt: !pendingWork && !changingView && !reading, permittedFormAttribute: "data-social-work-form", onDiscard: () => { setEditor(null); setValues(null); composition.current = false; } });
  function open(action: SocialWorkAction, target: SocialWorkServiceRecord | undefined, button: HTMLElement) { if (!snapshot || unavailable(action, target)) return; guard.requestExit(() => { if (hasPendingOperations() || hasViewTransition() || unavailable(action, target)) return; const initial = initialValues(snapshot, target); trigger.current = button; composition.current = false; setError(""); setErrors({}); setSaved(null); setValues(initial); setEditor({ action, target: target ? structuredClone(target) : null, sourceAt: snapshot.generatedAt, fingerprint, epoch: lifecycle.current.epoch, privacyEpoch: journal.privacyEpoch, initial: structuredClone(initial) }); }); }
  function performRead() { if (hasPendingOperations() || hasViewTransition() || reading) return; const lease = tryAcquireViewTransition(); if (!lease) return; readLease.current = lease; setReadEpoch((value) => value + 1); startRead(() => { try { return router.refresh(); } catch { lease(); readLease.current = null; setError("清單無法重新載入，請稍後再試。"); } }); }
  function refresh() { if (!hasPendingOperations() && !hasViewTransition() && !reading) guard.requestExit(performRead); }
  async function execute(operation: SocialWorkOperation) {
    const epoch = lifecycle.current.epoch; const captured = live.current.fingerprint;
    const current = () => { const state = getSocialWorkPending(); return lifecycle.current.mounted && lifecycle.current.epoch === epoch && live.current.fingerprint === captured && live.current.identity === operation.identity && navigator.onLine && allowed(operation.input.action, operation.input.clientId) && state.operation === operation && state.privacyEpoch === operation.privacyEpoch && state.authorityEpoch === operation.authorityEpoch && state.capabilityEpoch === operation.capabilityEpoch; };
    if (!current()) { settleSocialWork(operation, "unknown"); return; }
    try {
      const response = await fetchWithTimeout("/api/social-work-records", { method: operation.input.action === "create_draft" ? "POST" : "PATCH", cache: "no-store", headers: { "content-type": "application/json", "idempotency-key": operation.input.idempotencyKey }, body: operation.body }); const raw: unknown = await response.json();
      if (!current()) { settleSocialWork(operation, "unknown"); return; }
      if (!response.ok) { settleSocialWork(operation, isConfirmedSocialWorkRejection(raw, response.status) ? "denied" : "unknown"); if (!getSocialWorkPending().operation) setError("本次操作未保存，請核對授權與來源紀錄後重試。"); return; }
      const receipt = parseSocialWorkActionSuccess(raw, socialWorkExpectation(operation.input), response.status);
      if (settleSocialWork(operation, receipt) && !getSocialWorkPending().operation && getSocialWorkPending().confirmed.some((entry) => entry.identity === operation.identity && entry.recordKey === receipt.data.recordKey)) { setEditor(null); setValues(null); setErrors({}); setSaved({ identity: operation.identity, privacyEpoch: operation.privacyEpoch }); }
    } catch { settleSocialWork(operation, "unknown"); }
  }
  async function checkSource() {
    if (context.demo || !readable || composition.current || !navigator.onLine || checkingSource || reading || recoveryRead.current || own?.phase !== "unknown") return;
    const release = tryAcquireSocialWorkRecoveryRead(scope, context.demo); if (!release) { setSourceNotice("其他工作仍在確認，請完成後再更新授權資料。"); return; }
    const captured = getSocialWorkPending(); const operationToken = captured.operation?.token; const epoch = lifecycle.current.epoch;
    const read = { token: Symbol(), abort: new AbortController(), release, origin, privacyEpoch: captured.privacyEpoch, authorityEpoch: captured.authorityEpoch, capabilityEpoch: captured.capabilityEpoch };
    recoveryRead.current = read; setCheckingSource(true); setSourceNotice("");
    const current = () => { const state = getSocialWorkPending(); return recoveryRead.current === read && lifecycle.current.mounted && lifecycle.current.epoch === epoch && live.current.identity === identity && navigator.onLine && !read.abort.signal.aborted && state.operation?.token === operationToken && state.operation?.phase === "unknown" && state.privacyEpoch === read.privacyEpoch && state.authorityEpoch === read.authorityEpoch && state.capabilityEpoch === read.capabilityEpoch && state.authoritySignature === authority; };
    try {
      const result = await readSocialWorkSnapshot(scope, structuredClone(filters), read.abort.signal);
      if (!current()) return;
      const source = safeSnapshot(result.snapshot, live.current.context);
      const latest = getSocialWorkPending(); const floor = latest.snapshotFloor; const watermark = getSocialWorkSnapshotAdmission(scope, context.demo);
      if (result.authoritySignature !== socialWorkAuthoritySignature(live.current.context) || !source || Date.now() < Date.parse(source.generatedAt) || Date.now() >= Date.parse(source.staleAfter) || floor && Date.parse(source.generatedAt) <= Date.parse(floor) || watermark && Date.parse(source.generatedAt) < Date.parse(watermark) || !observeSocialWorkSnapshot(scope, context.demo, source, result.capabilities)) throw new Error("Untrusted recovery source");
      setRecoverySource({ identity, privacyEpoch: read.privacyEpoch, authorityEpoch: read.authorityEpoch, origin, serverAt: serverSource?.generatedAt ?? null, snapshot: source, capabilities: result.capabilities });
      setSourceNotice("授權資料已更新；原操作仍待確認，請自行選擇是否以相同內容重試。");
    } catch (failure) {
      if (current()) {
        if (failure instanceof SnapshotReadError && failure.status === null && failure.code === "UNAVAILABLE") setSourceNotice("尚未取得最新授權資料；目前資料不是最新，原操作仍保留。請稍後手動更新。");
        else { quarantineSocialWorkSnapshot(scope, context.demo); setRecoverySource({ identity, privacyEpoch: read.privacyEpoch, authorityEpoch: read.authorityEpoch, origin, serverAt: serverSource?.generatedAt ?? null, snapshot: null, capabilities: noCapabilities }); setSourceNotice("授權資料無法確認，原內容已隱藏；請再次更新資料或聯絡主管。原操作仍保留。"); }
      }
    } finally { if (recoveryRead.current === read) { recoveryRead.current = null; read.release(); if (lifecycle.current.mounted) setCheckingSource(false); } }
  }
  function retry() { if (!own || !recoverable || composition.current || !navigator.onLine || hasViewTransition() || changingView || reading || checkingSource) return; const operation = retrySocialWork(own.token, scope, context.demo); if (operation) void execute(operation); }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!visibleEditor || !values || composition.current || pendingWork || changingView || reading || locked || offline) return;
    const source = live.current.snapshot;
    if (!source || Date.now() < Date.parse(source.generatedAt) || Date.now() >= Date.parse(source.staleAfter) || source.generatedAt !== visibleEditor.sourceAt || visibleEditor.epoch !== lifecycle.current.epoch || !allowed(visibleEditor.action, visibleEditor.target?.clientId ?? values.clientId)) { setError("授權或畫面版本已更新，請重新開啟最新紀錄。"); return; }
    const target = visibleEditor.target; if (target && !source.records.some((record) => JSON.stringify(record) === JSON.stringify(target))) { setError("來源紀錄已更新，請重新開啟最新版本。"); return; }
    const next: Record<string, string> = {}; const action = visibleEditor.action; let body: Record<string, unknown>;
    const narrative = (key: keyof Values, max: number, single = false) => { const value = values[key].trim(); if (!value || value.length > max || (single ? /[\u0000-\u001f\u007f]/u : /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u).test(value)) next[key] = `請填寫 1–${max} 字有效內容。`; };
    if (["create_draft", "revise_draft", "correct"].includes(action)) {
      if (action === "create_draft" && !source.clientOptions.some((client) => client.clientId === values.clientId)) next.clientId = "請選擇目前可服務的個案。";
      const date = absoluteTime(values.occurredAt); if (!date) next.occurredAt = "請選擇有效的台北日期與時間。";
      narrative("serviceType", 120, true); narrative("serviceContent", 5000); narrative("serviceResult", 3000);
      body = { action, clientId: target?.clientId ?? values.clientId, ...(target ? { recordKey: target.recordKey, previousVersionId: target.versionId, expectedVersion: target.recordVersion } : {}), occurredAt: date, serviceType: values.serviceType, serviceContent: values.serviceContent, serviceResult: values.serviceResult };
      if (action === "correct") { narrative("correctionReason", 1000); body.correctionReason = values.correctionReason; }
    } else if (action === "sign") body = { action, clientId: target!.clientId, recordKey: target!.recordKey, previousVersionId: target!.versionId, expectedVersion: target!.recordVersion };
    else {
      body = { action, clientId: target!.clientId, recordKey: target!.recordKey, serviceVersionId: target!.versionId, expectedSequence: target!.followUpSequence };
      if (action === "track") { if (!/^\d{4}-\d{2}-\d{2}$/u.test(values.dueOn) || !isStrictOffsetDateTime(`${values.dueOn}T12:00:00+08:00`)) next.dueOn = "請選擇有效追蹤期限。"; narrative("followUpPlan", 2000); body.dueOn = values.dueOn; body.followUpPlan = values.followUpPlan; }
      else if (action === "complete_follow_up") { narrative("followUpOutcome", 2000); body.followUpOutcome = values.followUpOutcome; }
      else { narrative("transitionReason", 1000); body.transitionReason = values.transitionReason; }
    }
    if (action === "create_draft" && confirmed.some((entry) => entry.clientId === values.clientId)) next.clientId = "此個案已有操作待清單核對，請先重新載入。";
    if (Object.keys(next).length) { setErrors(next); form.current?.querySelector<HTMLElement>(`[data-social-work-field="${Object.keys(next)[0]}"]`)?.focus(); return; }
    try { const input = parseSocialWorkInput(body, crypto.randomUUID()); const operation = beginSocialWork(scope, context.demo, input, visibleEditor.sourceAt, target ?? undefined); if (operation) { setErrors({}); setError(""); void execute(operation); } else setError("目前無法送出，請先處理待回查操作。"); } catch { setError("資料或來源未通過驗證，請核對後重試。"); }
  }
  const names: Record<keyof Values, string> = { clientId: "個案", occurredAt: "服務日期與時間（台北）", serviceType: "服務類型", serviceContent: "服務內容", serviceResult: "服務結果", correctionReason: "更正理由", dueOn: "追蹤期限", followUpPlan: "追蹤計畫", followUpOutcome: "追蹤結果", transitionReason: "取消理由" };
  function field(key: keyof Values) { return { id: `${id}-${key}`, name: key, "aria-label": names[key], "data-social-work-field": key, "aria-invalid": !!errors[key], "aria-describedby": errors[key] ? `${id}-${key}-error` : undefined }; }
  function fieldError(key: keyof Values) { return errors[key] ? <small id={`${id}-${key}-error`} role="alert">{errors[key]}</small> : null; }
  function update(key: keyof Values, value: string) { if (!locked && values) { setValues({ ...values, [key]: value }); setErrors((previous) => { const next = { ...previous }; delete next[key]; return next; }); } }
  function textField(key: keyof Values, max: number) { return <label className={`field ${styles.full}`}><span>{names[key]}</span><textarea {...field(key)} className="resize-none" required maxLength={max} value={values?.[key] ?? ""} onChange={(event) => update(key, event.target.value)} />{fieldError(key)}</label>; }
  return <Controller.Provider value={{ snapshot, capabilities: snapshot ? capabilities : noCapabilities, unavailable, open, refresh, readBlocked: !!pending || pendingWork || changingView || reading || checkingSource }}>
    <section ref={recovery} tabIndex={-1} data-governance-focus-anchor aria-label="社工操作回查" className={styles.recovery}>
      {pending && !own && <p role="status">另一個資料範圍有待確認操作。請回原範圍回查，此處不顯示內容。</p>}
      {own && !recoverable && <p role="status">上次操作尚未確認；授權或個案指派已變更，原內容已隱藏。請手動更新授權資料；若登入角色已變更，需由主管確認。</p>}
      {own?.phase === "unknown" && <div className={styles.notice}><button className="button button--secondary" disabled={!readable || context.demo || offline || changingView || reading || checkingSource} aria-busy={checkingSource} onClick={() => void checkSource()}>更新授權資料（不重送）</button>{checkingSource && <p role="status">正在讀取授權資料；原操作仍保留。</p>}{sourceNotice && !supersededSourceNotice && <p role="status">{sourceNotice}</p>}</div>}
      {displayed && <div className={styles.notice}><p role="status">{busy ? "社工操作確認中，請勿重複送出。" : "上次操作結果尚未確認；重試保留原內容，不會建立另一筆。"}</p><details><summary>原操作內容（唯讀）</summary><p>{socialWorkLabels[displayed.action]}</p>{"serviceContent" in displayed && <p>{displayed.serviceContent}</p>}{"serviceResult" in displayed && <p>{displayed.serviceResult}</p>}{"correctionReason" in displayed && <p>{displayed.correctionReason}</p>}{"followUpPlan" in displayed && <p>{displayed.followUpPlan ?? displayed.followUpOutcome ?? displayed.transitionReason}</p>}</details><button className="button button--secondary" disabled={busy || offline || changingView || reading} onClick={retry}>以相同內容重試</button></div>}
      {confirmed.length > 0 && <div className={styles.notice}><p role="status">社工操作已保存，清單尚未確認更新。</p><button className="button button--secondary" disabled={!!pending || changingView || reading} onClick={refresh}>重新載入清單</button></div>}
      {saved?.identity === identity && saved.privacyEpoch === journal.privacyEpoch && confirmed.length === 0 && <p role="status">社工操作已保存，清單已確認更新。</p>}
      {(journal.navigationBlocked || guard.notice) && <p role="status">{guard.notice || "請先回查未確認操作，再離開此頁。"}</p>}
      {pendingWork && !pending && <p role="status">其他工作仍在確認，請先完成該操作。</p>}
      {offline && <p role="status">目前離線，不能送出；本頁不會將紀錄存入裝置。</p>}
      {error && !visibleEditor && <p role="alert">{error}</p>}
    </section>
    {children}
    <GovernanceDialog open={!!visibleEditor && !guard.open} title={visibleEditor ? socialWorkLabels[visibleEditor.action] : "社工操作"} busy={!!busy} onRequestClose={() => { if (!composition.current && !busy) { if (own) { setEditor(null); setValues(null); } else guard.requestExit(() => { setEditor(null); setValues(null); }); } }} returnFocusRef={trigger} fallbackFocusRef={recovery}>
      {visibleEditor?.target && <p>{visibleEditor.target.clientDisplayName} · 原紀錄 v{visibleEditor.target.recordVersion}</p>}
      {visibleEditor?.action === "sign" && <p>確認服務內容與結果後簽署。已簽紀錄不可直接修改，後續更正會保留原版。</p>}
      {visibleEditor && values && <form ref={form} noValidate data-social-work-form className={styles.actionEditor} onSubmit={submit} onCompositionStart={() => { composition.current = true; guard.compositionStart(); }} onCompositionEnd={() => { composition.current = false; guard.compositionEnd(); }}>
        <fieldset disabled={locked} className={styles.actionGrid}>
          {["create_draft", "revise_draft", "correct"].includes(visibleEditor.action) && <>
            {visibleEditor.action === "create_draft" && <label className="field"><span>個案</span><select {...field("clientId")} required value={values.clientId} onChange={(event) => update("clientId", event.target.value)}><option value="">請選擇個案</option>{snapshot?.clientOptions.map((client) => <option key={client.clientId} value={client.clientId}>{client.displayName}</option>)}</select>{fieldError("clientId")}</label>}
            <label className="field"><span>{names.occurredAt}</span><input {...field("occurredAt")} type="datetime-local" required value={values.occurredAt} onChange={(event) => update("occurredAt", event.target.value)} />{fieldError("occurredAt")}</label>
            <label className="field"><span>服務類型</span><input {...field("serviceType")} required maxLength={120} list={`${id}-types`} value={values.serviceType} onChange={(event) => update("serviceType", event.target.value)} /><datalist id={`${id}-types`}>{snapshot?.serviceTypeOptions.map((type) => <option key={type} value={type} />)}</datalist>{fieldError("serviceType")}</label>
            {textField("serviceContent", 5000)}{textField("serviceResult", 3000)}{visibleEditor.action === "correct" && textField("correctionReason", 1000)}
          </>}
          {visibleEditor.action === "sign" && <div className={styles.full}><p>{visibleEditor.target?.serviceContent}</p><p><strong>服務結果：</strong>{visibleEditor.target?.serviceResult}</p></div>}
          {visibleEditor.action === "track" && <><label className="field"><span>追蹤期限</span><input {...field("dueOn")} type="date" required value={values.dueOn} onChange={(event) => update("dueOn", event.target.value)} />{fieldError("dueOn")}</label>{textField("followUpPlan", 2000)}</>}
          {visibleEditor.action === "complete_follow_up" && textField("followUpOutcome", 2000)}
          {visibleEditor.action === "cancel_follow_up" && <><p className={styles.full}>取消此筆待追蹤，不會刪除服務紀錄或追蹤歷程。</p>{textField("transitionReason", 1000)}</>}
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <button className="button button--primary" type="submit" disabled={locked || pendingWork || changingView || reading || offline}>{socialWorkLabels[visibleEditor.action]}</button>
      </form>}
      {own?.phase === "unknown" && <><p role="alert">原操作結果尚未確認，內容不可修改。</p><button className="button button--secondary" onClick={() => { if (!composition.current) { setEditor(null); setValues(null); } }}>回待確認清單</button><button className="button button--primary" disabled={!recoverable || offline || changingView || reading} onClick={retry}>重試同一社工操作</button></>}
    </GovernanceDialog>
    <GovernanceDialog open={guard.open} title="放棄未保存的社工填寫？" cancelLabel="繼續填寫" onRequestClose={() => { if (!composition.current) guard.cancel(); }} returnFocusRef={guard.returnFocusRef} fallbackFocusRef={recovery}><p>尚未保存的填寫會清除；已送出但未確認的操作不能放棄。</p><button className="button button--danger" onClick={() => { if (!composition.current) guard.confirmDiscard(); }}>放棄填寫並繼續</button></GovernanceDialog>
  </Controller.Provider>;
}
