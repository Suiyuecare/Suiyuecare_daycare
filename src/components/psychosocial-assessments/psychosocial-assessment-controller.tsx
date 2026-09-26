"use client";

import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { GovernanceDialog } from "@/components/ui/governance-dialog";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import type { TenantContext } from "@/lib/domain/types";
import { useUnsavedChanges } from "@/lib/navigation/use-unsaved-changes";
import { hasPendingOperations, hasViewTransition, tryAcquireViewTransition, usePendingOperations, useViewTransitionPending } from "@/lib/navigation/pending-operation-lock";
import { parseCreatePsychosocialDraft, parsePsychosocialActionSuccess, parsePsychosocialAssessmentMutation, psychosocialDimensionsSchema } from "@/lib/psychosocial-assessments/parser";
import { beginPsychosocialAssessment, getPsychosocialAssessmentPending, getPsychosocialAssessmentSnapshotAdmission, isConfirmedPsychosocialAssessmentRejection, observePsychosocialAssessmentAuthority, observePsychosocialAssessmentSnapshot, psychosocialAssessmentAuthoritySignature, psychosocialAssessmentScopeIdentity, reconcilePsychosocialAssessmentConfirmed, retryPsychosocialAssessment, settlePsychosocialAssessment, usePsychosocialAssessmentPending, type PsychosocialInput, type PsychosocialOperation } from "@/lib/psychosocial-assessments/pending";
import { normalizePsychosocialSnapshot } from "@/lib/psychosocial-assessments/snapshot-contract";
import { PSYCHOSOCIAL_DOMAIN_KEYS, type PsychosocialAssessmentListItem, type PsychosocialAssessmentSnapshot, type PsychosocialDimensions, type PsychosocialDomainKey } from "@/lib/psychosocial-assessments/types";
import styles from "./psychosocial-assessments.module.css";

type Action = PsychosocialInput["action"];
type Values = { assessedOn: string; reassessmentDueOn: string; dueBasis: string; assessmentSummary: string; correctionReason: string; dimensions: PsychosocialDimensions };
type Editor = { action: Action; target: PsychosocialAssessmentListItem; sourceAt: string; fingerprint: string; epoch: number; privacyEpoch: number; initial: Values };
const labels: Record<Action, string> = { create_draft: "快速新增評估草稿", revise_draft: "建立草稿新版", sign: "簽署評估", correct: "建立更正版" };
const domainLabels: Record<PsychosocialDomainKey, string> = { family_relationships: "家庭／關係人互動", social_support: "社會支持", social_participation: "社交／活動參與", communication_context: "溝通情境與偏好", resource_access: "資源取得情形" };
const signing = (action: Action) => action === "sign" || action === "correct";
function readable(context: TenantContext) { return context.demo || context.assuranceLevel === "aal2" && context.scopes.includes("clients.read") && context.scopes.includes("social_work_records.read"); }
function taipeiDate(value: string) { return new Date(Date.parse(value) + 8 * 60 * 60_000).toISOString().slice(0, 10); }
function initialValues(item: PsychosocialAssessmentListItem, sourceAt: string, action: Action): Values {
  const existing = action !== "create_draft";
  return { assessedOn: existing ? item.assessedOn! : taipeiDate(sourceAt), reassessmentDueOn: existing ? item.reassessmentDueOn! : "",
    dueBasis: existing ? item.dueBasis! : "", assessmentSummary: existing ? item.assessmentSummary! : "", correctionReason: "",
    dimensions: existing ? structuredClone(item.dimensions!) : Object.fromEntries(PSYCHOSOCIAL_DOMAIN_KEYS.map((key) => [key, { state: "missing", detail: null }])) as PsychosocialDimensions };
}
function safeSnapshot(value: PsychosocialAssessmentSnapshot | null, context: TenantContext) {
  if (!value || value.organizationId !== context.organizationId || value.branchId !== context.branchId || value.demo !== context.demo) return null;
  try { return normalizePsychosocialSnapshot(value, context); } catch { return null; }
}
type ControllerValue = { snapshot: PsychosocialAssessmentSnapshot | null; unavailable: (action: Action, item: PsychosocialAssessmentListItem) => boolean;
  open: (action: Action, item: PsychosocialAssessmentListItem, trigger: HTMLElement) => void; refresh: () => void; readBlocked: boolean };
const Controller = createContext<ControllerValue | null>(null);
export function usePsychosocialAssessmentController() { return useContext(Controller); }

export function PsychosocialAssessmentController({ context, snapshot: source, canManage, canSign, hasRecentAal2, children }: {
  context: TenantContext; snapshot: PsychosocialAssessmentSnapshot | null; canManage: boolean; canSign: boolean; hasRecentAal2: boolean; children: ReactNode;
}) {
  const router = useRouter(); const journal = usePsychosocialAssessmentPending(); const pendingWork = usePendingOperations(); const changingView = useViewTransitionPending();
  const scope = { organizationId: context.organizationId, branchId: context.branchId, userId: context.userId };
  const identity = context.demo ? JSON.stringify([context.organizationId, context.branchId, context.userId, true]) : psychosocialAssessmentScopeIdentity(scope, false);
  const canRead = readable(context); const supplied = safeSnapshot(source, context); const watermark = getPsychosocialAssessmentSnapshotAdmission(scope, context.demo);
  const [admission, setAdmission] = useState({ identity, canRead, privacyEpoch: journal.privacyEpoch, sourceAt: supplied?.generatedAt ?? null as string | null, blockedAt: null as string | null });
  const boundary = admission.identity !== identity || admission.privacyEpoch !== journal.privacyEpoch || admission.canRead && !canRead;
  const admitted = !boundary && (admission.blockedAt === null || !!supplied && Date.parse(supplied.generatedAt) > Date.parse(admission.blockedAt)) &&
    (journal.snapshotFloor === null || !!supplied && Date.parse(supplied.generatedAt) > Date.parse(journal.snapshotFloor)) &&
    (watermark === null || !!supplied && Date.parse(supplied.generatedAt) >= Date.parse(watermark)) &&
    (!admission.sourceAt || !!supplied && Date.parse(supplied.generatedAt) >= Date.parse(admission.sourceAt));
  if (boundary) setAdmission({ identity, canRead, privacyEpoch: journal.privacyEpoch, sourceAt: null, blockedAt: admission.sourceAt ?? admission.blockedAt ?? supplied?.generatedAt ?? null });
  else if (admitted && supplied && admission.sourceAt !== supplied.generatedAt) setAdmission({ ...admission, canRead, sourceAt: supplied.generatedAt, blockedAt: null });
  const snapshot = admitted && canRead ? supplied : null;
  const authority = psychosocialAssessmentAuthoritySignature(context);
  const fingerprint = JSON.stringify([authority, canManage, canSign, hasRecentAal2, snapshot ? [...new Set([...snapshot.clientOptions.map((item) => item.clientId), ...snapshot.items.map((item) => item.clientId)])].sort() : null]);
  const life = useRef({ mounted: false, epoch: 0, fingerprint }); const live = useRef({ context, snapshot, fingerprint, identity, canManage, canSign, hasRecentAal2 });
  const composition = useRef(false); const form = useRef<HTMLFormElement | null>(null); const trigger = useRef<HTMLElement | null>(null); const recovery = useRef<HTMLElement | null>(null);
  const lease = useRef<(() => void) | null>(null); const [reading, startRead] = useTransition(); const [readEpoch, setReadEpoch] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null); const [values, setValues] = useState<Values | null>(null); const [errors, setErrors] = useState<Record<string, string>>({}); const [error, setError] = useState("");
  const [saved, setSaved] = useState<{ identity: string; privacyEpoch: number } | null>(null); const [clock, setClock] = useState(() => Date.now()); const [offline, setOffline] = useState(false); const id = useId();
  useLayoutEffect(() => {
    live.current = { context, snapshot, fingerprint, identity, canManage, canSign, hasRecentAal2 };
    if (life.current.fingerprint !== fingerprint) { life.current.epoch += 1; life.current.fingerprint = fingerprint;
      const op = getPsychosocialAssessmentPending().operation; if (op?.phase === "sending") settlePsychosocialAssessment(op, "unknown");
      setEditor(null); setValues(null); setErrors({}); setError(""); setSaved(null); composition.current = false; }
    observePsychosocialAssessmentAuthority(authority);
    observePsychosocialAssessmentSnapshot({ organizationId: context.organizationId, branchId: context.branchId, userId: context.userId }, context.demo, snapshot, { canManage, canSign, hasRecentAal2 });
  }, [context, snapshot, authority, fingerprint, identity, canManage, canSign, hasRecentAal2]);
  useEffect(() => { const lifecycle = life.current; lifecycle.mounted = true; return () => { lifecycle.mounted = false; lifecycle.epoch += 1;
    lease.current?.(); lease.current = null; const operation = getPsychosocialAssessmentPending().operation;
    if (operation?.phase === "sending" && operation.identity === live.current.identity) settlePsychosocialAssessment(operation, "unknown"); }; }, []);
  useEffect(() => { if (!reading && lease.current) { lease.current(); lease.current = null; } }, [reading, readEpoch]);
  useEffect(() => { const check = () => { setClock(Date.now()); setOffline(!navigator.onLine); }; check(); const timer = window.setInterval(check, 1000);
    window.addEventListener("online", check); window.addEventListener("offline", check); return () => { window.clearInterval(timer); window.removeEventListener("online", check); window.removeEventListener("offline", check); }; }, []);
  useEffect(() => { if (snapshot && !context.demo) reconcilePsychosocialAssessmentConfirmed({ organizationId: context.organizationId, branchId: context.branchId, userId: context.userId }, snapshot, Date.now()); }, [snapshot, context.organizationId, context.branchId, context.userId, context.demo]);
  const pending = journal.operation; const locked = !!pending; const confirmed = journal.confirmed.filter((entry) => entry.identity === identity);
  const ownOperation = pending?.identity === identity ? pending : null; const stale = !snapshot || clock >= Date.parse(snapshot.staleAfter);
  const visibleEditor = editor?.fingerprint === fingerprint && editor.privacyEpoch === journal.privacyEpoch ? editor : null;
  function permitted(action: Action, clientId: string) { const current = live.current; const source = current.snapshot;
    return !!source && !current.context.demo && readable(current.context) && current.context.scopes.includes(signing(action) ? "social_work_records.sign" : "social_work_records.manage") &&
      (signing(action) ? current.canSign && current.hasRecentAal2 : current.canManage) && (source.items.some((item) => item.clientId === clientId) || source.clientOptions.some((item) => item.clientId === clientId)); }
  const recoverable = ownOperation && !!snapshot && !context.demo && context.scopes.includes(signing(ownOperation.input.action) ? "social_work_records.sign" : "social_work_records.manage") &&
    (signing(ownOperation.input.action) ? canSign && hasRecentAal2 : canManage) && (snapshot.items.some((item) => item.clientId === ownOperation.input.clientId) || snapshot.clientOptions.some((item) => item.clientId === ownOperation.input.clientId));
  function unavailable(action: Action, item: PsychosocialAssessmentListItem) {
    return !snapshot || snapshot.demo || stale || offline || locked || pendingWork || changingView || reading || confirmed.length >= 32 || confirmed.some((entry) => entry.clientId === item.clientId) ||
      !context.scopes.includes(signing(action) ? "social_work_records.sign" : "social_work_records.manage") || (signing(action) ? !canSign || !hasRecentAal2 : !canManage) ||
      !snapshot.items.some((entry) => entry.clientId === item.clientId && entry.versionId === item.versionId && entry.assessmentVersion === item.assessmentVersion) ||
      action !== "create_draft" && (action === "correct" ? item.recordState !== "signed" && item.recordState !== "corrected" : item.recordState !== "draft");
  }
  const guard = useUnsavedChanges({ dirty: !!visibleEditor && !pending && !!values && JSON.stringify(values) !== JSON.stringify(visibleEditor.initial), scopeKey: JSON.stringify([fingerprint, journal.privacyEpoch]),
    revisionKey: snapshot?.generatedAt ?? "unavailable", canPrompt: !pendingWork && !changingView && !reading, permittedFormAttribute: "data-psychosocial-assessment-form",
    onDiscard: () => { setEditor(null); setValues(null); composition.current = false; } });
  function open(action: Action, item: PsychosocialAssessmentListItem, button: HTMLElement) {
    if (!snapshot || unavailable(action, item) || !permitted(action, item.clientId)) return;
    guard.requestExit(() => { const current = live.current.snapshot;
      if (!current || hasPendingOperations() || hasViewTransition() || unavailable(action, item) || !permitted(action, item.clientId)) return;
      const initial = initialValues(item, current.generatedAt, action); trigger.current = button; composition.current = false; setErrors({}); setError(""); setSaved(null); setValues(initial);
      setEditor({ action, target: structuredClone(item), sourceAt: current.generatedAt, fingerprint, epoch: life.current.epoch, privacyEpoch: journal.privacyEpoch, initial: structuredClone(initial) }); });
  }
  function performRead() { if (hasPendingOperations() || hasViewTransition() || reading) return; const held = tryAcquireViewTransition(); if (!held) return;
    lease.current = held; setReadEpoch((value) => value + 1); startRead(() => { try { return router.refresh(); } catch { held(); lease.current = null; setError("清單無法重新載入，請稍後再試。"); } }); }
  function refresh() { if (!hasPendingOperations() && !hasViewTransition() && !reading) guard.requestExit(performRead); }
  async function execute(operation: PsychosocialOperation) {
    const epoch = life.current.epoch; const captured = live.current.fingerprint;
    const currentAttempt = () => { const state = getPsychosocialAssessmentPending(); return life.current.mounted && life.current.epoch === epoch && live.current.fingerprint === captured && live.current.identity === operation.identity && navigator.onLine &&
      permitted(operation.input.action, operation.input.clientId) && state.operation === operation && state.privacyEpoch === operation.privacyEpoch && state.authorityEpoch === operation.authorityEpoch && state.capabilityEpoch === operation.capabilityEpoch; };
    if (!currentAttempt()) { settlePsychosocialAssessment(operation, "unknown"); return; }
    try { const response = await fetchWithTimeout("/api/psychosocial-assessments", { method: operation.input.action === "create_draft" ? "POST" : "PATCH", cache: "no-store",
      headers: { "content-type": "application/json", "idempotency-key": operation.input.idempotencyKey }, body: operation.body }); const raw: unknown = await response.json();
      if (!currentAttempt()) { settlePsychosocialAssessment(operation, "unknown"); return; }
      if (!response.ok) { settlePsychosocialAssessment(operation, isConfirmedPsychosocialAssessmentRejection(raw, response.status) ? "denied" : "unknown");
        if (!getPsychosocialAssessmentPending().operation) setError("本次操作未保存。請確認授權、個案指派與最新版本後再送出。"); return; }
      const receipt = parsePsychosocialActionSuccess(raw, operation.input, response.status);
      if (settlePsychosocialAssessment(operation, receipt) && !getPsychosocialAssessmentPending().operation && getPsychosocialAssessmentPending().confirmed.some((entry) => entry.versionId === receipt.data.versionId && entry.identity === operation.identity)) {
        setEditor(null); setValues(null); setErrors({}); composition.current = false; setSaved({ identity: operation.identity, privacyEpoch: operation.privacyEpoch }); }
    } catch { settlePsychosocialAssessment(operation, "unknown"); }
  }
  function retry() { if (!ownOperation || !recoverable || composition.current || !navigator.onLine || hasViewTransition() || reading) return;
    const operation = retryPsychosocialAssessment(ownOperation.token, scope, context.demo); if (operation) void execute(operation); }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!visibleEditor || !values || composition.current || pendingWork || changingView || reading || locked) return;
    const source = live.current.snapshot; if (!source || Date.now() >= Date.parse(source.staleAfter) || source.generatedAt !== visibleEditor.sourceAt || visibleEditor.epoch !== life.current.epoch || !permitted(visibleEditor.action, visibleEditor.target.clientId)) { setError("來源或授權已變更，請重新選擇操作。"); return; }
    const next: Record<string, string> = {}; const action = visibleEditor.action; const item = visibleEditor.target;
    const text = (key: "dueBasis" | "assessmentSummary" | "correctionReason", max: number) => { const value = values[key].trim(); if (!value || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) next[key] = `請填寫 1–${max} 字，不能含無效控制字元。`; };
    const date = (key: "assessedOn" | "reassessmentDueOn") => { const value = values[key]; const parsed = new Date(`${value}T12:00:00+08:00`); if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || Number(value.slice(0, 4)) < 2000 || Number(value.slice(0, 4)) > 2200) next[key] = "請填寫 2000–2200 年間的有效西元日期。"; };
    let body: Record<string, unknown> = { action, clientId: item.clientId };
    if (action !== "create_draft") body = { ...body, assessmentKey: item.assessmentKey, previousVersionId: item.versionId, expectedVersion: item.assessmentVersion };
    if (action !== "sign") {
      date("assessedOn"); date("reassessmentDueOn"); if (!next.assessedOn && !next.reassessmentDueOn && values.reassessmentDueOn < values.assessedOn) next.reassessmentDueOn = "複評期限不能早於評估日期。";
      text("dueBasis", 1000); text("assessmentSummary", 5000);
      for (const key of PSYCHOSOCIAL_DOMAIN_KEYS) if (!psychosocialDimensionsSchema.shape[key].safeParse(values.dimensions[key]).success) next[`dimensions.${key}`] = "請選擇面向狀態；已記錄時須填寫 1–2000 字內容。";
      body = { ...body, assessedOn: values.assessedOn, reassessmentDueOn: values.reassessmentDueOn, dueBasis: values.dueBasis, assessmentSummary: values.assessmentSummary, dimensions: values.dimensions, formVersionReference: "manual-psychosocial-v1" };
      if (action === "correct") { text("correctionReason", 1000); body.correctionReason = values.correctionReason; }
    }
    if (Object.keys(next).length) { setErrors(next); form.current?.querySelector<HTMLElement>(`[data-psychosocial-field="${Object.keys(next)[0]}"]`)?.focus(); return; }
    try { const key = crypto.randomUUID(); const input = action === "create_draft" ? parseCreatePsychosocialDraft(body, key) : parsePsychosocialAssessmentMutation(body, key);
      const operation = beginPsychosocialAssessment(scope, context.demo, input, visibleEditor.sourceAt, action === "create_draft" ? undefined : item);
      if (operation) { setErrors({}); setError(""); void execute(operation); } else setError("目前不能開始操作，請先處理待確認紀錄或重新取得授權資料。"); }
    catch { setError("內容或來源版本未通過驗證，請保留填寫並確認欄位。"); }
  }
  function update(key: keyof Values, value: Values[keyof Values]) { if (locked || !values) return; setValues({ ...values, [key]: value }); setErrors({}); setError(""); }
  function domain(key: PsychosocialDomainKey, state: PsychosocialDimensions[PsychosocialDomainKey]["state"], detail: string | null) { if (locked || !values) return; update("dimensions", { ...values.dimensions, [key]: { state, detail } }); }
  function field(key: string) {
    const label = key.startsWith("dimensions.") ? `${domainLabels[key.slice(11) as PsychosocialDomainKey]}狀態`
      : { assessedOn: "評估日期", reassessmentDueOn: "人工輸入複評期限", dueBasis: "期限來源／依據", assessmentSummary: "人工評估摘要", correctionReason: "更正理由" }[key];
    return { id: `${id}-${key}`, "data-psychosocial-field": key, "aria-label": label, "aria-invalid": !!errors[key], "aria-describedby": errors[key] ? `${id}-${key}-error` : undefined };
  }
  function fieldError(key: string) { return errors[key] ? <small id={`${id}-${key}-error`} role="alert">{errors[key]}</small> : null; }
  return <Controller.Provider value={{ snapshot, unavailable, open, refresh, readBlocked: locked || pendingWork || changingView || reading }}>
    <section className={`panel ${styles.recovery}`} aria-label="心理社會評估操作狀態" ref={recovery} tabIndex={-1}>
      <h2 data-governance-focus-anchor tabIndex={-1}>心理社會評估操作</h2>
      {ownOperation && <p role="status">{ownOperation.phase === "sending" ? "正在確認原操作，請勿重複送出。" : "原操作結果尚未確認；原內容與操作鍵仍保留。"}</p>}
      {pending && !ownOperation && <p role="status">其他帳號或分支有待確認操作，目前不顯示原資料。</p>}
      {ownOperation?.phase === "unknown" && <><button className="button button--primary" disabled={!recoverable || offline || changingView || reading} onClick={retry}>重試同一評估操作</button>
        {!recoverable && <p role="status">目前無法確認原授權；此頁尚無獨立授權回查入口。原操作保留，請聯絡管理員；不會另建新筆。</p>}</>}
      {confirmed.length > 0 && <p role="status">已確認保存；清單尚未確認更新，請手動重新載入。</p>}
      {saved?.identity === identity && saved.privacyEpoch === journal.privacyEpoch && confirmed.length === 0 && <p role="status">已確認保存，清單已確認更新。</p>}
      {error && !visibleEditor && <p role="alert">{error}</p>}
      {(journal.navigationBlocked || guard.notice) && <p role="status">{guard.notice || "請先回查待確認操作，再離開此頁。"}</p>}
      {offline && <p role="status">目前離線，不能送出；此頁不會將評估內容保存到裝置。</p>}
      <button className="button button--secondary" disabled={locked || pendingWork || changingView || reading} onClick={refresh}>重新載入評估清單</button>
    </section>
    {children}
    <GovernanceDialog open={!!visibleEditor && !guard.open} title={visibleEditor ? labels[visibleEditor.action] : "心理社會評估"} busy={locked} returnFocusRef={trigger} fallbackFocusRef={recovery}
      onRequestClose={() => { if (!composition.current && !locked) guard.requestExit(() => { setEditor(null); setValues(null); composition.current = false; }); }}>
      {visibleEditor && values && <form ref={form} noValidate data-psychosocial-assessment-form className={styles.editor} onSubmit={submit}
        onCompositionStart={() => { composition.current = true; guard.compositionStart(); }} onCompositionEnd={() => { composition.current = false; guard.compositionEnd(); }}
        onKeyDown={(event) => { if (event.key === "Enter" && (composition.current || event.nativeEvent.isComposing)) event.preventDefault(); }}>
        <p className={styles.fixedClient}><strong>已鎖定個案：{visibleEditor.target.clientDisplayName}</strong><small>人工紀錄，不是官方量表或診斷。</small></p>
        <fieldset disabled={locked} className={styles.actionGrid}>
          {visibleEditor.action !== "sign" ? <>
            <label className="field"><span>評估日期</span><input {...field("assessedOn")} required type="date" value={values.assessedOn} onChange={(event) => update("assessedOn", event.target.value)}/>{fieldError("assessedOn")}</label>
            <label className="field"><span>人工輸入複評期限</span><input {...field("reassessmentDueOn")} required type="date" value={values.reassessmentDueOn} onChange={(event) => update("reassessmentDueOn", event.target.value)}/>{fieldError("reassessmentDueOn")}</label>
            <label className={`field ${styles.full}`}><span>期限來源／依據</span><textarea {...field("dueBasis")} className="resize-none" required maxLength={1000} value={values.dueBasis} onChange={(event) => update("dueBasis", event.target.value)}/>{fieldError("dueBasis")}</label>
            <div className={styles.domainGrid}>{PSYCHOSOCIAL_DOMAIN_KEYS.map((key) => <fieldset className={styles.domainFieldset} key={key}><legend>{domainLabels[key]}</legend>
              <label className="field"><span>{domainLabels[key]}狀態</span><select {...field(`dimensions.${key}`)} value={values.dimensions[key].state} onChange={(event) => domain(key, event.target.value as PsychosocialDimensions[PsychosocialDomainKey]["state"], event.target.value === "provided" ? "" : null)}>
                <option value="missing">未知／尚未取得</option><option value="provided">已記錄</option><option value="not_applicable">不適用</option></select>{fieldError(`dimensions.${key}`)}</label>
              {values.dimensions[key].state === "provided" && <label className="field"><span>{domainLabels[key]}內容</span><textarea className="resize-none" required maxLength={2000} value={values.dimensions[key].detail ?? ""}
                aria-invalid={!!errors[`dimensions.${key}`]} aria-describedby={errors[`dimensions.${key}`] ? `${id}-dimensions.${key}-error` : undefined} onChange={(event) => domain(key, "provided", event.target.value)}/></label>}
            </fieldset>)}</div>
            <label className={`field ${styles.full}`}><span>人工評估摘要</span><textarea {...field("assessmentSummary")} className="resize-none" required maxLength={5000} value={values.assessmentSummary} onChange={(event) => update("assessmentSummary", event.target.value)}/>{fieldError("assessmentSummary")}</label>
            {visibleEditor.action === "correct" && <label className={`field ${styles.full}`}><span>更正理由</span><textarea {...field("correctionReason")} className="resize-none" required maxLength={1000} value={values.correctionReason} onChange={(event) => update("correctionReason", event.target.value)}/>{fieldError("correctionReason")}</label>}
          </> : <p className={styles.full}>確認簽署目前 v{visibleEditor.target.assessmentVersion} 草稿。簽署後不能直接修改，只能建立帶理由的更正版。</p>}
        </fieldset>
        {visibleEditor.action === "correct" && <p>更正會追加新版本並保留原簽署紀錄，不會覆寫原文。</p>}
        {error && <p role="alert">{error}</p>}
        <button className="button button--primary" type="submit" disabled={locked || pendingWork || changingView || reading || offline}>{visibleEditor.action === "sign" ? "確認簽署評估" : visibleEditor.action === "correct" ? "確認建立更正版" : "保存評估草稿"}</button>
      </form>}
      {ownOperation?.phase === "unknown" && <><p role="alert">原操作結果尚未確認，內容不可修改。</p><button className="button button--secondary" type="button" onClick={() => { if (!composition.current) { setEditor(null); setValues(null); composition.current = false; } }}>回待確認清單</button>
        <button className="button button--primary" type="button" disabled={!recoverable || offline || changingView || reading} onClick={retry}>重試同一評估操作</button></>}
    </GovernanceDialog>
    <GovernanceDialog open={guard.open} title="放棄未保存的心理社會評估？" cancelLabel="繼續填寫" onRequestClose={() => { if (!composition.current) guard.cancel(); }} returnFocusRef={guard.returnFocusRef} fallbackFocusRef={recovery}>
      <p>尚未保存的填寫會清除；已送出但未確認的操作不能放棄。</p><button className="button button--danger" type="button" onClick={() => { if (!composition.current) guard.confirmDiscard(); }}>放棄填寫並繼續</button>
    </GovernanceDialog>
  </Controller.Provider>;
}
