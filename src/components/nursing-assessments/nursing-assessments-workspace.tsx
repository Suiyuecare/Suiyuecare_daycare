"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { blankNursingContent } from "@/lib/nursing-assessments/demo";
import { nursingRequestSchema, parseNursingActionSuccess, parseNursingRequest, projectNursingAssessmentSnapshot } from "@/lib/nursing-assessments/parser";
import type { TenantContext } from "@/lib/domain/types";
import { GovernanceDialog } from "@/components/ui/governance-dialog";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { useUnsavedChanges } from "@/lib/navigation/use-unsaved-changes";
import { hasPendingOperations, hasViewTransition, usePendingOperations, useViewTransitionPending } from "@/lib/navigation/pending-operation-lock";
import { beginNursingAssessment, beginNursingAssessmentReceiptCheck, cancelNursingAssessmentReceiptCheck,
  getNursingAssessmentPending, getNursingAssessmentSnapshotAdmission, isConfirmedNursingAssessmentRejection, isNursingAssessmentReceiptCheckCurrent,
  nursingAssessmentAuthoritySignature, nursingAssessmentScopeIdentity, observeNursingAssessmentAuthority,
  observeNursingAssessmentSnapshot, quarantineNursingAssessmentSnapshot,
  reconcileNursingAssessmentConfirmed, retryNursingAssessment, settleNursingAssessment, settleNursingAssessmentReceiptCheck,
  tryAcquireNursingAssessmentRecoveryRead, useNursingAssessmentPending,
  type NursingAssessmentOperation, type NursingAssessmentTarget } from "@/lib/nursing-assessments/pending";
import { NURSING_DOMAIN_LABELS, type NursingAssessmentSnapshot, type NursingContent,
  type NursingDomainKey, type NursingRequest, type NursingVersion } from "@/lib/nursing-assessments/types";
import styles from "./nursing-assessments.module.css";
import { readNursingSnapshot, NursingSnapshotReadError } from "@/lib/nursing-assessments/snapshot-client";
import { readNursingOperationReceipt, NursingOperationReceiptReadError } from "@/lib/nursing-assessments/operation-receipt-client";

const keys = Object.keys(NURSING_DOMAIN_LABELS) as NursingDomainKey[];
const stateLabels = { recorded: "已記錄", missing: "缺值／尚未取得", not_applicable: "不適用" };
const recordLabels = { draft: "草稿待簽", signed: "已簽署", corrected: "已簽更正版" };
function fieldText(field: NursingContent["domains"][NursingDomainKey]) {
  return `${stateLabels[field.state]}：${field.detail ?? field.reason ?? "—"}`;
}
function dateText(value: string) {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
function NursingContentView({ content }: { content: NursingContent }) {
  return <dl className={styles.domain}>
    <dt>評估日期</dt><dd>{content.assessedOn}</dd>
    {keys.map((key) => <div key={key}><dt>{NURSING_DOMAIN_LABELS[key]}</dt><dd>{fieldText(content.domains[key])}</dd></div>)}
    <dt>人工複評安排</dt><dd>{stateLabels[content.reassessment.state]}{content.reassessment.dueOn ? ` · ${content.reassessment.dueOn}` : ""}：{content.reassessment.reason}</dd>
  </dl>;
}
export function NursingVersionDifferences({ previous, current }: { previous: NursingVersion; current: NursingVersion }) {
  const differences = [
    { label: "評估日期", before: previous.content.assessedOn, after: current.content.assessedOn },
    ...keys.map((key) => ({ label: NURSING_DOMAIN_LABELS[key], before: fieldText(previous.content.domains[key]), after: fieldText(current.content.domains[key]) })),
    { label: "複評安排", before: `${stateLabels[previous.content.reassessment.state]} ${previous.content.reassessment.dueOn ?? "—"}：${previous.content.reassessment.reason}`,
      after: `${stateLabels[current.content.reassessment.state]} ${current.content.reassessment.dueOn ?? "—"}：${current.content.reassessment.reason}` },
  ].filter((item) => item.before !== item.after);
  return <section aria-label="前後版差異">
    <h3>v{previous.version} → v{current.version} 差異</h3>
    <p>狀態：{recordLabels[previous.state]} → {recordLabels[current.state]}</p>
    {differences.length === 0 ? <p>護理內容未變更；此版追加簽署或版本紀錄。</p> : differences.map((item) => <div key={item.label}>
      <h4>{item.label}</h4><div className={styles.difference}><div><strong>前版</strong><p>{item.before}</p></div><div><strong>本版</strong><p>{item.after}</p></div></div>
    </div>)}
  </section>;
}
type Editor = { mode: "create_draft" | "revise_draft" | "correct"; clientId: string; sourceAt: string;
  target: NursingAssessmentTarget | null; fingerprint: string; epoch: number; privacyEpoch: number; initial: NursingContent };
type Confirmation = { request: NursingRequest; sourceAt: string; target: NursingAssessmentTarget;
  fingerprint: string; epoch: number; privacyEpoch: number };
function permitted(context: TenantContext, action: NursingRequest["action"], canManage: boolean, canSign: boolean, recent: boolean, now: number) {
  const signing = action === "sign" || action === "correct";
  const age = context.recentAal2At === null ? Infinity : now - Date.parse(context.recentAal2At);
  return !context.demo && context.assuranceLevel === "aal2" && context.roles.includes("nurse") &&
    ["clients.read", "nursing_assessments.read", signing ? "nursing_assessments.sign" : "nursing_assessments.manage"].every((scope) => context.scopes.includes(scope)) &&
    (signing ? canSign && recent && age >= 0 && age <= 15 * 60_000 : canManage);
}
function permittedAtAttempt(context: TenantContext, action: NursingRequest["action"], canManage: boolean, canSign: boolean, recent: boolean) {
  return permitted(context, action, canManage, canSign, recent, Date.now());
}
export function NursingAssessmentsWorkspace({ context, snapshot: suppliedSnapshot, canManage: suppliedCanManage, canSign: suppliedCanSign, hasRecentAal2: suppliedRecentAal2,
  initialClientId = null, loadError = false }: {
  context: TenantContext;
  snapshot: NursingAssessmentSnapshot | null; canManage: boolean; canSign: boolean;
  hasRecentAal2: boolean; actorUserId?: string; initialClientId?: string | null; loadError?: boolean;
}) {
  const journal = useNursingAssessmentPending(); const pendingWork = usePendingOperations(); const changingView = useViewTransitionPending();
  const scope = useMemo(() => ({ organizationId: context.organizationId, branchId: context.branchId, userId: context.userId }), [context.organizationId, context.branchId, context.userId]);
  const identity = context.demo ? JSON.stringify([context.organizationId, context.branchId, context.userId, true]) : nursingAssessmentScopeIdentity(scope, false);
  const authority = nursingAssessmentAuthoritySignature(context);
  const authorityBinding = JSON.stringify([authority, suppliedCanManage, suppliedCanSign, suppliedRecentAal2, journal.authorityEpoch, journal.privacyEpoch]);
  const [readOverride, setReadOverride] = useState<{ identity: string; authorityBinding: string; privacyEpoch: number;
    suppliedSnapshot: NursingAssessmentSnapshot | null; suppliedLoadError: boolean;
    bundle: Awaited<ReturnType<typeof readNursingSnapshot>> } | null>(null);
  const [readStatus, setReadStatus] = useState("");
  const [readError, setReadError] = useState("");
  const [readBinding, setReadBinding] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  // A manual read cannot shadow a subsequently supplied server projection,
  // including an assignment withdrawal with the very same generation time.
  const activeOverride = readOverride?.identity === identity && readOverride.authorityBinding === authorityBinding &&
    readOverride.privacyEpoch === journal.privacyEpoch && readOverride.suppliedSnapshot === suppliedSnapshot &&
    readOverride.suppliedLoadError === loadError ? readOverride : null;
  const candidate = activeOverride && (loadError || !suppliedSnapshot || Date.parse(activeOverride.bundle.snapshot.generatedAt) >= Date.parse(suppliedSnapshot.generatedAt))
    ? activeOverride.bundle.snapshot : loadError ? null : suppliedSnapshot;
  const effectiveCapabilities = activeOverride && candidate === activeOverride.bundle.snapshot
    ? activeOverride.bundle.capabilities : { canManage: suppliedCanManage, canSign: suppliedCanSign, hasRecentAal2: suppliedRecentAal2 };
  const { canManage, canSign, hasRecentAal2 } = effectiveCapabilities;
  const readable = context.demo || context.assuranceLevel === "aal2" && context.scopes.includes("clients.read") && context.scopes.includes("nursing_assessments.read");
  const validated = useMemo(() => {
    if (!candidate || !readable || candidate.demo !== context.demo || candidate.organizationId !== context.organizationId || candidate.branchId !== context.branchId) return null;
    try { return context.demo ? candidate : projectNursingAssessmentSnapshot(candidate, context.organizationId, context.branchId); }
    catch { return null; }
  }, [candidate, readable, context.demo, context.organizationId, context.branchId]);
  // The journal admits against the actual time in the layout observer. A newer
  // source must be admitted before rendering, without mistaking its temporary
  // pre-admission state for an assignment change that discards open editing.
  const snapshot = validated && (context.demo || journal.authoritySignature === authority &&
    getNursingAssessmentSnapshotAdmission(scope, false) === validated.generatedAt) ? validated : null;
  const fingerprint = JSON.stringify([authority, canManage, canSign, hasRecentAal2, validated?.clients.map((item) => item.clientId).sort() ?? null]);
  const lifecycle = useRef({ mounted: false, epoch: 0, fingerprint });
  const live = useRef({ context, snapshot, canManage, canSign, hasRecentAal2, identity, fingerprint, suppliedSnapshot, loadError });
  const composition = useRef(false); const form = useRef<HTMLFormElement | null>(null);
  const recovery = useRef<HTMLElement | null>(null); const trigger = useRef<HTMLElement | null>(null);
  const receiptFocus = useRef<{ identity: string; privacyEpoch: number; from: Element | null } | null>(null);
  const readAttempt = useRef<{ token: symbol; abort: AbortController; release: () => void } | null>(null);
  const [reading, setReading] = useState(false);
  const [readPurpose, setReadPurpose] = useState<"snapshot" | "receipt">("snapshot");
  const [clientId, setClientId] = useState(() => initialClientId ?? suppliedSnapshot?.clients[0]?.clientId ?? "");
  const [versionId, setVersionId] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [content, setContent] = useState<NursingContent>(() => blankNursingContent());
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState<{ identity: string; privacyEpoch: number } | null>(null);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [offline, setOffline] = useState(false);
  const id = useId();
  useLayoutEffect(() => {
    live.current = { context, snapshot, canManage, canSign, hasRecentAal2, identity, fingerprint, suppliedSnapshot, loadError };
    if (lifecycle.current.fingerprint !== fingerprint) {
      lifecycle.current.epoch += 1; lifecycle.current.fingerprint = fingerprint;
      const operation = getNursingAssessmentPending().operation;
      if (operation?.phase === "sending") settleNursingAssessment(operation, "unknown");
      setEditor(null); setConfirmation(null); setErrors({}); setError(""); setSaved(null); composition.current = false;
    }
    observeNursingAssessmentAuthority(authority);
    try { observeNursingAssessmentSnapshot(scope, context.demo, validated, { canManage, canSign, hasRecentAal2 }); }
    catch { quarantineNursingAssessmentSnapshot(scope, context.demo); }
  }, [context, snapshot, validated, canManage, canSign, hasRecentAal2, identity, fingerprint, authority, scope, suppliedSnapshot, loadError]);
  useEffect(() => {
    const life = lifecycle.current; life.mounted = true;
    return () => { life.mounted = false; life.epoch += 1; const read = readAttempt.current;
      readAttempt.current = null; read?.abort.abort(); read?.release();
      const operation = getNursingAssessmentPending().operation;
      if (operation?.identity === live.current.identity && operation.phase === "sending") settleNursingAssessment(operation, "unknown"); };
  }, []);
  useLayoutEffect(() => {
    const read = readAttempt.current;
    if (read) { readAttempt.current = null; read.abort.abort(); read.release(); setReading(false); }
  }, [fingerprint, journal.privacyEpoch, journal.authorityEpoch, journal.capabilityEpoch, suppliedSnapshot, loadError]);
  useEffect(() => {
    const check = () => { setClock(Date.now()); setOffline(!navigator.onLine); };
    check(); const timer = window.setInterval(check, 1000);
    window.addEventListener("online", check); window.addEventListener("offline", check);
    return () => { window.clearInterval(timer); window.removeEventListener("online", check); window.removeEventListener("offline", check); };
  }, [snapshot]);
  useEffect(() => { if (snapshot && !context.demo) reconcileNursingAssessmentConfirmed({ organizationId: context.organizationId, branchId: context.branchId, userId: context.userId }, snapshot, Date.now()); }, [snapshot, context.organizationId, context.branchId, context.userId, context.demo]);
  const client = snapshot?.clients.find((item) => item.clientId === clientId);
  const latest = client?.versions[0];
  const selected = client?.versions.find((version) => version.versionId === versionId) ?? latest;
  const previous = client?.versions.find((version) => version.versionId === selected?.previousVersionId);
  const ownOperation = journal.operation?.identity === identity ? journal.operation : null;
  const readRecoverable = ownOperation && readable && snapshot && !snapshot.demo && clock < Date.parse(snapshot.staleAfter) &&
    snapshot.clients.some((item) => item.clientId === ownOperation.input.request.clientId);
  const recoverable = readRecoverable && permitted(context, ownOperation!.input.request.action, canManage, canSign, hasRecentAal2, clock);
  const pending = journal.operation; const busy = pending?.phase === "sending";
  const visibleEditor = editor?.fingerprint === fingerprint && editor.privacyEpoch === journal.privacyEpoch ? editor : null;
  const mode = visibleEditor?.mode ?? null;
  const stale = !snapshot || clock >= Date.parse(snapshot.staleAfter);
  const confirmed = journal.confirmed.filter((entry) => entry.identity === identity);
  const unavailable = !snapshot || snapshot.demo || stale || offline || !!pending || pendingWork || changingView || reading || confirmed.length >= 32 || confirmed.some((entry) => entry.clientId === client?.clientId);
  useLayoutEffect(() => {
    const focus = receiptFocus.current;
    if (!focus || journal.operation) return;
    receiptFocus.current = null;
    if (focus.identity === identity && focus.privacyEpoch === journal.privacyEpoch && readable &&
      (document.activeElement === document.body || document.activeElement === focus.from)) recovery.current?.focus();
  }, [journal.operation, journal.privacyEpoch, identity, readable, saved]);
  const existing = latest && client ? { clientId: client.clientId, assessmentKey: latest.assessmentKey,
    previousVersionId: latest.versionId, expectedVersion: latest.version, expectedContentHash: latest.contentHash } : null;

  const guard = useUnsavedChanges({ dirty: !!visibleEditor && !pending && (JSON.stringify(content) !== JSON.stringify(visibleEditor.initial) || reason !== ""),
    scopeKey: JSON.stringify([fingerprint, journal.privacyEpoch]), revisionKey: JSON.stringify([snapshot?.generatedAt, snapshot?.clients]), canPrompt: !pendingWork && !changingView && !reading,
    permittedFormAttribute: "data-nursing-assessment-form", onDiscard: () => { setEditor(null); setConfirmation(null); composition.current = false; } });
  function target(): NursingAssessmentTarget | null { return latest && client ? { clientId: client.clientId, assessmentKey: latest.assessmentKey, versionId: latest.versionId, version: latest.version, contentHash: latest.contentHash, state: latest.state, content: structuredClone(latest.content) } : null; }
  function allowed(action: NursingRequest["action"], targetClient: string) {
    const value = live.current;
    return !!value.snapshot?.clients.some((item) => item.clientId === targetClient) && navigator.onLine && permittedAtAttempt(value.context, action, value.canManage, value.canSign, value.hasRecentAal2);
  }
  function sourceValid(sourceAt: string, captured: NursingAssessmentTarget | null, targetClient: string) {
    const value = live.current.snapshot; if (!value || Date.now() >= Date.parse(value.staleAfter) || value.generatedAt !== sourceAt) return false;
    const source = value.clients.find((item) => item.clientId === targetClient)?.versions[0];
    return !captured || !!source && source.versionId === captured.versionId && source.contentHash === captured.contentHash && source.version === captured.version && JSON.stringify(source.content) === JSON.stringify(captured.content);
  }
  function start(nextMode: NonNullable<typeof mode>) {
    if (!client || unavailable || !allowed(nextMode, client.clientId)) return;
    guard.requestExit(() => {
      if (!client || !snapshot || unavailable || hasPendingOperations() || hasViewTransition() || !allowed(nextMode, client.clientId)) return;
      const initial = nextMode === "create_draft" ? blankNursingContent() : structuredClone(latest!.content);
      setEditor({ mode: nextMode, clientId: client.clientId, sourceAt: snapshot.generatedAt, target: nextMode === "create_draft" ? null : target(), fingerprint, epoch: lifecycle.current.epoch, privacyEpoch: journal.privacyEpoch, initial: structuredClone(initial) });
      setReason(""); setError(""); setErrors({}); setSaved(null); setContent(initial); composition.current = false;
    });
  }
  async function execute(operation: NursingAssessmentOperation) {
    const epoch = lifecycle.current.epoch; const capturedFingerprint = live.current.fingerprint;
    const currentAttempt = () => { const current = getNursingAssessmentPending(); return lifecycle.current.mounted && lifecycle.current.epoch === epoch && live.current.fingerprint === capturedFingerprint && live.current.identity === operation.identity && allowed(operation.input.request.action, operation.input.request.clientId) && current.operation === operation && current.privacyEpoch === operation.privacyEpoch && current.authorityEpoch === operation.authorityEpoch && current.capabilityEpoch === operation.capabilityEpoch && current.authoritySignature === operation.authoritySignature; };
    if (!currentAttempt()) { settleNursingAssessment(operation, "unknown"); return; }
    try {
      const response = await fetchWithTimeout("/api/nursing-assessments", { method: operation.input.request.action === "create_draft" ? "POST" : "PATCH", cache: "no-store",
        headers: { "content-type": "application/json", "idempotency-key": operation.input.idempotencyKey,
          "x-nursing-operation": operation.input.request.action }, body: operation.body });
      const body: unknown = await response.json();
      if (!currentAttempt()) { settleNursingAssessment(operation, "unknown"); return; }
      if (!response.ok) {
        settleNursingAssessment(operation, isConfirmedNursingAssessmentRejection(body, response.status) ? "denied" : "unknown");
        if (!getNursingAssessmentPending().operation) { setConfirmation(null); setError("本次操作未保存。請確認權限、個案指派或版本後重試。"); } return;
      }
      const receipt = parseNursingActionSuccess(body, { ...operation.input, actorUserId: operation.scope.userId, organizationId: operation.scope.organizationId, branchId: operation.scope.branchId }, response.status);
      if (settleNursingAssessment(operation, receipt) && !getNursingAssessmentPending().operation && getNursingAssessmentPending().confirmed.some((entry) => entry.identity === operation.identity && entry.versionId === receipt.result.versionId)) {
        setEditor(null); setConfirmation(null); setErrors({}); setSaved({ identity: operation.identity, privacyEpoch: operation.privacyEpoch });
      }
    } catch { settleNursingAssessment(operation, "unknown"); }
  }
  function begin(request: NursingRequest, sourceAt: string, captured: NursingAssessmentTarget | null) {
    if (hasPendingOperations() || hasViewTransition()) return;
    if (!allowed(request.action, request.clientId) || !sourceValid(sourceAt, captured, request.clientId)) { setError("畫面版本或授權已更新，請重新選擇最新紀錄核對。"); return; }
    try { const operation = beginNursingAssessment(scope, context.demo, parseNursingRequest(request, crypto.randomUUID()), sourceAt, captured ?? undefined); if (operation) { setError(""); setSaved(null); void execute(operation); } }
    catch { setError("資料或來源版本無效，請確認欄位後重試。"); }
  }
  function retry() {
    if (!ownOperation || !recoverable || composition.current || !allowed(ownOperation.input.request.action, ownOperation.input.request.clientId)) return;
    const operation = retryNursingAssessment(ownOperation.token, scope, context.demo); if (operation) void execute(operation);
  }
  function confirmSign(button: HTMLElement) {
    if (!existing || !snapshot || !client || unavailable || !allowed("sign", client.clientId)) return;
    trigger.current = button; composition.current = false; setError("");
    setConfirmation({ request: { ...existing, action: "sign" }, sourceAt: snapshot.generatedAt, target: target()!, fingerprint, epoch: lifecycle.current.epoch, privacyEpoch: journal.privacyEpoch });
  }
  function submit(event: FormEvent) {
    event.preventDefault(); if (!client || !visibleEditor || !mode || unavailable || composition.current) return;
    if (!sourceValid(visibleEditor.sourceAt, visibleEditor.target, visibleEditor.clientId)) {
      setError("畫面版本已更新。請保留內容、取消編輯後重新開啟最新紀錄核對。"); return;
    }
    try {
      const source = visibleEditor.target;
      const original = source ? { clientId: source.clientId, assessmentKey: source.assessmentKey, previousVersionId: source.versionId, expectedVersion: source.version, expectedContentHash: source.contentHash } : null;
      const request: NursingRequest = mode === "create_draft" ? { action: mode, clientId: visibleEditor.clientId, content }
        : mode === "correct" ? { ...original!, action: mode, content, correctionReason: reason } : { ...original!, action: mode, content };
      const validation = nursingRequestSchema.safeParse(request);
      if (!validation.success) {
        const next: Record<string, string> = {};
        for (const issue of validation.error.issues) {
          const path = issue.path.map(String); const key = path[0] === "correctionReason" ? "correctionReason" : path.includes("domains") ? `domains.${path[2]}` : path.includes("reassessment") ? path.includes("reason") ? "reassessment.reason" : "reassessment.dueOn" : "assessedOn";
          next[key] = key === "assessedOn" ? "請選擇有效評估日期。" : key === "reassessment.dueOn" ? "請填寫不早於評估日期的有效複評日期。" : `請填寫 1–${key.startsWith("domains.") && content.domains[key.slice(8) as NursingDomainKey]?.state === "recorded" ? 5000 : 1000} 字有效內容或理由。`;
        }
        setErrors(next); form.current?.querySelector<HTMLElement>(`[data-nursing-field="${Object.keys(next)[0]}"]`)?.focus(); return;
      }
      setErrors({});
      if (mode === "correct") { trigger.current = form.current?.querySelector<HTMLElement>("button[type=submit]") ?? null; setConfirmation({ request: validation.data, sourceAt: visibleEditor.sourceAt, target: source!, fingerprint, epoch: lifecycle.current.epoch, privacyEpoch: journal.privacyEpoch }); }
      else begin(validation.data, visibleEditor.sourceAt, source);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "請檢查輸入內容。"); }
  }
  function field(key: string) { return { id: `${id}-${key}`, "data-nursing-field": key, "aria-invalid": !!errors[key], "aria-describedby": errors[key] ? `${id}-${key}-error` : undefined }; }
  function fieldError(key: string) { return errors[key] ? <small id={`${id}-${key}-error`} role="alert">{errors[key]}</small> : null; }
  async function performRead() {
    if (context.demo || !readable || hasViewTransition() || readAttempt.current || !navigator.onLine) return;
    const before = getNursingAssessmentPending();
    const lease = tryAcquireNursingAssessmentRecoveryRead(scope, false); if (!lease) return;
    const abort = new AbortController(); const token = Symbol();
    const epoch = lifecycle.current.epoch; const capturedFingerprint = live.current.fingerprint;
    const current = () => { const state = getNursingAssessmentPending(); return !abort.signal.aborted && lifecycle.current.mounted &&
      readAttempt.current?.token === token && lifecycle.current.epoch === epoch && live.current.fingerprint === capturedFingerprint &&
      live.current.suppliedSnapshot === suppliedSnapshot && live.current.loadError === loadError &&
      live.current.identity === identity && state.privacyEpoch === before.privacyEpoch && state.authorityEpoch === before.authorityEpoch &&
      state.capabilityEpoch === before.capabilityEpoch && state.operation === before.operation && state.authoritySignature === authority; };
    readAttempt.current = { token, abort, release: lease };
    if (!current()) { readAttempt.current = null; abort.abort(); lease(); return; }
    setReading(true); setReadPurpose("snapshot"); setReadBinding(authorityBinding); setReadError(""); setReadStatus("");
    try {
      const bundle = await readNursingSnapshot(scope, abort.signal); if (!current()) return;
      if (bundle.authoritySignature !== authority) throw new NursingSnapshotReadError(200, "INVALID_RESPONSE");
      // Admission itself can quarantine visibility and advance its epoch. Report
      // that rejection here, while this response still owns the read, rather
      // than treating our own quarantine as an unrelated stale callback.
      if (!observeNursingAssessmentSnapshot(scope, false, bundle.snapshot, bundle.capabilities)) {
        quarantineNursingAssessmentSnapshot(scope, false); setReadOverride(null);
        setReadError("未能取得授權的最新資料，舊內容已隱藏；請核對帳號權限後再試一次。");
        return;
      }
      setClock(Date.now());
      setReadOverride({ identity, authorityBinding, privacyEpoch: before.privacyEpoch, suppliedSnapshot, suppliedLoadError: loadError, bundle });
      setReadStatus(before.operation ? "已更新授權資料；原操作仍待確認，未再次送出。" : "已更新護理資料。");
    } catch (caught) {
      if (!current()) return;
      const transportOnly = caught instanceof NursingSnapshotReadError && caught.status === null && caught.code === "UNAVAILABLE";
      if (!transportOnly) { quarantineNursingAssessmentSnapshot(scope, false); setReadOverride(null); }
      setReadError(transportOnly ? "目前連線未完成，尚未取得最新資料；請保留原操作後再試一次。" : "未能取得授權的最新資料，舊內容已隱藏；請核對帳號權限後再試一次。");
    } finally {
      if (readAttempt.current?.token === token) { readAttempt.current = null; lease(); if (lifecycle.current.mounted) setReading(false); }
    }
  }
  async function checkOriginalReceipt() {
    if (context.demo || !readable || hasViewTransition() || readAttempt.current || !navigator.onLine || composition.current) return;
    const check = beginNursingAssessmentReceiptCheck(scope, false); if (!check) return;
    const abort = new AbortController(), epoch = lifecycle.current.epoch, capturedFingerprint = live.current.fingerprint;
    const from = document.activeElement;
    const releaseCheck = () => { cancelNursingAssessmentReceiptCheck(check); };
    const current = () => !abort.signal.aborted && lifecycle.current.mounted && lifecycle.current.epoch === epoch &&
      readAttempt.current?.token === check.token && live.current.fingerprint === capturedFingerprint &&
      live.current.suppliedSnapshot === suppliedSnapshot && live.current.loadError === loadError &&
      live.current.identity === check.identity && isNursingAssessmentReceiptCheckCurrent(check);
    readAttempt.current = { token: check.token, abort, release: releaseCheck };
    if (!current()) { readAttempt.current = null; abort.abort(); releaseCheck(); return; }
    setReading(true); setReadPurpose("receipt"); setReadBinding(authorityBinding); setReadError(""); setReadStatus("");
    try {
      const proof = await readNursingOperationReceipt(scope, { key: check.operation.input.idempotencyKey,
        request: check.operation.input.request, nonce: check.nonce }, abort.signal);
      if (!current()) return;
      const result = settleNursingAssessmentReceiptCheck(check, proof);
      if (result === "confirmed") {
        receiptFocus.current = { identity: check.identity, privacyEpoch: check.privacyEpoch, from };
        setEditor(null); setConfirmation(null); setErrors({}); setSaved({ identity: check.identity, privacyEpoch: check.privacyEpoch });
        setReadStatus("已查證原紀錄保存成功；清單仍待核對，沒有再次送出。");
      } else if (result === "not_found") {
        setReadStatus("尚未取得原紀錄保存證明；原操作保持待確認，請稍後再查。沒有再次送出。");
      } else if (result === "unavailable") {
        quarantineNursingAssessmentSnapshot(scope, false); setReadOverride(null);
        setReadError("原紀錄證明未通過核對，舊內容已隱藏；請更新授權資料後再查證。");
      }
    } catch (caught) {
      if (!current()) return;
      const transportOnly = caught instanceof NursingOperationReceiptReadError && caught.status === null && caught.code === "UNAVAILABLE";
      if (!transportOnly) { quarantineNursingAssessmentSnapshot(scope, false); setReadOverride(null); }
      setReadError(transportOnly ? "目前連線未完成，原操作仍待確認；請保留內容後再查證。" : "尚未取得授權的原紀錄證明，舊內容已隱藏；請更新授權資料後再查證。");
    } finally {
      releaseCheck();
      if (readAttempt.current?.token === check.token) { readAttempt.current = null; if (lifecycle.current.mounted) setReading(false); }
    }
  }
  function refresh() { if (!hasPendingOperations() && !hasViewTransition() && !reading) guard.requestExit(() => { void performRead(); }); }
  const visibleConfirmation = confirmation?.fingerprint === fingerprint && confirmation.privacyEpoch === journal.privacyEpoch ? confirmation : null;
  return <div className={styles.workspace}>
    <section aria-label="護理操作回查" ref={recovery} tabIndex={-1} data-governance-focus-anchor>
      {ownOperation?.phase === "unknown" && readable && !context.demo && <button className="button button--secondary" disabled={reading || offline || changingView} aria-busy={reading} onClick={() => { if (!composition.current) void performRead(); }}>更新授權資料（不重送）</button>}
      {ownOperation?.phase === "unknown" && readRecoverable && !visibleConfirmation && <button className="button button--secondary" disabled={reading || offline || changingView} aria-busy={reading} onClick={() => { void checkOriginalReceipt(); }}>查證原紀錄（不重送）</button>}
      {reading && !visibleConfirmation && <p role="status">{readPurpose === "receipt" ? "正在查證原紀錄，原操作不會再次送出。" : "正在更新授權資料，原操作不會再次送出。"}</p>}
      {readBinding === authorityBinding && readError && !visibleConfirmation && <p className={styles.error} role="alert">{readError}</p>}
      {readBinding === authorityBinding && readStatus && !visibleConfirmation && <p role="status">{readStatus}</p>}
      {pending && !ownOperation && <p role="status">另一個資料範圍有未確認操作。請回到原範圍回查；此處不顯示操作內容。</p>}
      {ownOperation && !readRecoverable && <p role="status">上次操作尚未確認。目前授權資料或個案指派需重新核對，內容已隱藏；取得新授權資料後才能回查。</p>}
      {ownOperation && readRecoverable && <div className={styles.notice}><p role="status">{busy ? "護理操作確認中，請勿重複送出。" : "上次操作尚未確認，請勿建立另一筆。可先查證保存結果；重試仍保留原內容與識別碼。"}</p>
        <details><summary>查看原操作內容（唯讀）</summary>{"content" in ownOperation.input.request ? <NursingContentView content={ownOperation.input.request.content}/> : ownOperation.target ? <NursingContentView content={ownOperation.target.content}/> : null}
          {ownOperation.input.request.action === "correct" && <p>更正理由：{ownOperation.input.request.correctionReason}</p>}</details>
        {!recoverable && <p role="status">目前只能查證或查看原操作；重新送出仍須有效的寫入權限與簽署驗證。</p>}
        <button className="button button--primary" disabled={!recoverable || busy || offline || changingView || reading} onClick={retry}>{busy ? "確認中…" : "以相同內容重試"}</button></div>}
      {confirmed.length > 0 && <div className={styles.notice}><p role="status">護理操作已保存，清單尚未確認更新；請先更新清單核對。</p><button className="button button--secondary" disabled={!!pending || changingView} onClick={refresh}>重新載入清單</button></div>}
      {saved?.identity === identity && saved.privacyEpoch === journal.privacyEpoch && confirmed.length === 0 && <p className={styles.status} role="status">護理操作已保存，清單已確認更新。</p>}
      {(journal.navigationBlocked || guard.notice) && <p role="status">{guard.notice || "請先回查未確認操作，再離開此頁。"}</p>}
    </section>
    {!snapshot ? <section className={styles.card} role="alert"><h1>護理評估暫時無法載入</h1><p>請確認目前機構、分支與護理評估權限後重新載入。</p><button className="button button--secondary" disabled={!!pending} onClick={refresh}>重新載入</button></section> : <>
    <header className="page-heading"><div><p className="eyebrow">護理服務 · 頁面 51</p><h1>護理評估</h1><p>整理護理觀察、問題、措施與反應，檢視每次人工評估的版本與追蹤安排。</p></div></header>
    <div className={styles.notice}><strong>人工、非標準化紀錄</strong><p>本表未宣稱為官方或授權量表，不計分、不自動判定風險。複評日期與依據由護理人員填寫。</p></div>
    {snapshot.demo ? <p className={styles.notice} role="status">展示模式：以下均為合成示例，儲存、簽署及更正維持唯讀。</p> : null}
    <p className={styles.metadata}>官方量表計分、附件、匯出、通知與離線同步：尚未設定。</p>
    {(stale || offline) ? <p className={styles.error} role="status">{offline ? "目前離線，無法儲存；內容僅留在此畫面。" : "資料已到期或剛完成儲存，請重新載入後再操作。"}</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {clientId && !client ? <p className={styles.error} role="alert">所選個案不在目前可查看範圍，請從個案中心重新選擇。</p> : null}
    <div className={styles.toolbar}><label>個案<select value={client?.clientId ?? ""} disabled={!!pending || changingView}
      onChange={(event) => { const value = event.target.value; guard.requestExit(() => { setClientId(value); setVersionId(""); setEditor(null); setSaved(null); setError(""); }); }}>
      {!client ? <option value="">目前個案無法查看</option> : null}
      {snapshot.clients.map((item) => <option key={item.clientId} value={item.clientId}>{item.displayName} · {item.versionsTotal ? `${item.versionsTotal} 個版本` : "尚未評估"}</option>)}</select></label>
      <button className="button button--secondary" disabled={!!pending || changingView} onClick={refresh}>重新載入</button></div>
    {snapshot.clientsTruncated ? <p role="status">目前顯示前 {snapshot.clients.length} 位／共 {snapshot.clientTotal} 位可查看個案；尚未提供後續分頁。</p> : null}
    {client ? <section className={styles.card}><h2>{client.displayName}</h2>
      <div className={styles.actions}><button className="button button--primary" disabled={unavailable || !permitted(context, "create_draft", canManage, canSign, hasRecentAal2, clock) || mode !== null} onClick={() => start("create_draft")}>新增護理評估</button>
        {latest?.state === "draft" ? <><button className="button button--secondary" disabled={unavailable || !permitted(context, "revise_draft", canManage, canSign, hasRecentAal2, clock) || mode !== null} onClick={() => start("revise_draft")}>修訂最新草稿</button>
          <button className="button button--primary" disabled={unavailable || !permitted(context, "sign", canManage, canSign, hasRecentAal2, clock) || mode !== null || selected?.versionId !== latest.versionId}
            onClick={(event) => confirmSign(event.currentTarget)}>簽署目前草稿</button></>
          : latest ? <button className="button button--secondary" disabled={unavailable || !permitted(context, "correct", canManage, canSign, hasRecentAal2, clock) || mode !== null} onClick={() => start("correct")}>追加更正版</button> : null}</div>
      {!snapshot.demo && !hasRecentAal2 ? <p>簽署與更正需最近 15 分鐘完成雙因素驗證。<Link href="/mfa?audience=staff&purpose=sensitive-action">前往重新驗證</Link></p> : null}
      {mode ? <form className={styles.form} ref={form} data-nursing-assessment-form noValidate onSubmit={submit} onCompositionStart={() => { composition.current = true; guard.compositionStart(); }} onCompositionEnd={() => { composition.current = false; guard.compositionEnd(); }}><h3>{mode === "create_draft" ? "新增人工護理評估" : mode === "revise_draft" ? "修訂草稿（追加版本）" : "更正已簽紀錄（追加簽署版本）"}</h3>
        <fieldset disabled={!!pending}><legend>評估內容</legend><label className={styles.field}>評估日期<input {...field("assessedOn")} type="date" value={content.assessedOn} required onChange={(event) => setContent({ ...content, assessedOn: event.target.value })}/>{fieldError("assessedOn")}</label>
          {keys.map((key) => <fieldset key={key}><legend>{NURSING_DOMAIN_LABELS[key]}</legend><label className={styles.field}>紀錄狀態<select value={content.domains[key].state} onChange={(event) => {
            const state = event.target.value as NursingContent["domains"][NursingDomainKey]["state"];
            setContent({ ...content, domains: { ...content.domains, [key]: { state, detail: state === "recorded" ? "" : null, reason: state === "recorded" ? null : "" } } });
          }}>{Object.entries(stateLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className={styles.field}>{content.domains[key].state === "recorded" ? "人工觀察與處置內容" : "缺值或不適用理由"}<textarea {...field(`domains.${key}`)} className="resize-none" required maxLength={content.domains[key].state === "recorded" ? 5000 : 1000}
              value={content.domains[key].detail ?? content.domains[key].reason ?? ""} onChange={(event) => setContent({ ...content, domains: { ...content.domains,
                [key]: { ...content.domains[key], [content.domains[key].state === "recorded" ? "detail" : "reason"]: event.target.value } } })}/>{fieldError(`domains.${key}`)}</label></fieldset>)}
        </fieldset>
        <fieldset disabled={!!pending}><legend>人工複評安排</legend><div className={styles.grid}>
          <label className={styles.field}>安排狀態<select value={content.reassessment.state} onChange={(event) => setContent({ ...content, reassessment: {
            ...content.reassessment, state: event.target.value as NursingContent["reassessment"]["state"], dueOn: null } })}>
            <option value="recorded">已排定日期</option><option value="missing">尚未排定／缺值</option><option value="not_applicable">不適用</option></select></label>
          {content.reassessment.state === "recorded" ? <label className={styles.field}>複評日期<input {...field("reassessment.dueOn")} type="date" required min={content.assessedOn} value={content.reassessment.dueOn ?? ""}
            onChange={(event) => setContent({ ...content, reassessment: { ...content.reassessment, dueOn: event.target.value || null } })}/>{fieldError("reassessment.dueOn")}</label> : null}</div>
          <label className={styles.field}>日期依據、缺值或不適用理由<textarea {...field("reassessment.reason")} className="resize-none" required maxLength={1000} value={content.reassessment.reason}
            onChange={(event) => setContent({ ...content, reassessment: { ...content.reassessment, reason: event.target.value } })}/>{fieldError("reassessment.reason")}</label></fieldset>
        {mode === "correct" ? <label className={styles.field}>更正理由<textarea {...field("correctionReason")} className="resize-none" required maxLength={1000} value={reason} disabled={!!pending} onChange={(event) => setReason(event.target.value)}/>{fieldError("correctionReason")}</label> : null}
        <div className={styles.actions}><button className="button button--primary" type="submit" disabled={unavailable || !permitted(context, mode, canManage, canSign, hasRecentAal2, clock)}>{mode === "correct" ? "簽署並追加更正版" : "儲存草稿"}</button>
          <button className="button button--secondary" type="button" disabled={!!pending} onClick={() => { if (!composition.current) guard.requestExit(() => setEditor(null)); }}>取消編輯</button></div>
      </form> : null}
    </section> : null}
    {selected ? <section className={styles.card}><h2>評估版本與內容</h2><label className={styles.field}>查看版本<select value={selected.versionId} disabled={!!pending || changingView} onChange={(event) => { const value = event.target.value; guard.requestExit(() => { setVersionId(value); setEditor(null); }); }}>
      {client!.versions.map((version) => <option key={version.versionId} value={version.versionId}>{version.content.assessedOn} · v{version.version} · {recordLabels[version.state]} · {dateText(version.createdAt)}</option>)}</select></label>
      <p className={styles.metadata}>表單版本：{selected.content.formVersionReference}（人工非標準化，未宣稱官方發布）</p>
      <p>{recordLabels[selected.state]} · 記錄者：{selected.recorderDisplayName} · {dateText(selected.createdAt)}</p>
      <NursingContentView content={selected.content}/>
      {selected.signedAt ? <p>已由：{selected.signerDisplayName} · {dateText(selected.signedAt)} · {selected.signaturePurpose}</p> : <p>尚未簽署</p>}
      {selected.correctionReason ? <p><strong>更正理由：</strong>{selected.correctionReason}</p> : null}
      <details><summary>版本與簽署證據</summary><p className={styles.metadata}>版本 ID：{selected.versionId}<br/>內容雜湊：{selected.contentHash}<br/>前版雜湊：{selected.previousContentHash ?? "首版"}<br/>近期驗證證據：{selected.signatureChallengeId ?? "尚未簽署"}</p></details>
      {previous ? <NursingVersionDifferences previous={previous} current={selected}/> : selected.previousVersionId ? <p>前版未包含於本次有界清單，暫不顯示差異；完整版本仍保留。</p> : null}
      {client!.versionsTruncated ? <p role="status">目前顯示最近 50 個版本；全部 {client!.versionsTotal} 個版本均保留，較早版本查詢尚未設定。</p> : null}
    </section> : client ? <section className={styles.card}><h2>尚未建立護理評估</h2><p>可由具權限且已指派的護理人員新增人工評估草稿。</p></section> : null}</>}
    <GovernanceDialog open={!!visibleConfirmation && !guard.open} title={visibleConfirmation?.request.action === "correct" ? "確認更正護理評估" : "確認簽署護理評估"} busy={!!pending} onRequestClose={() => { if (!composition.current && !pending) setConfirmation(null); }} returnFocusRef={trigger} fallbackFocusRef={recovery}>
      <p>確認後會追加不可直接修改的簽署版本；原紀錄與版本歷程會保留。</p>
      {visibleConfirmation && <><NursingContentView content={"content" in visibleConfirmation.request ? visibleConfirmation.request.content : visibleConfirmation.target.content}/>
        {visibleConfirmation.request.action === "correct" && <p>更正理由：{visibleConfirmation.request.correctionReason}</p>}</>}
      {error && <p role="alert">{error}</p>}
      {visibleConfirmation && readBinding === authorityBinding && readError && <p className={styles.error} role="alert">{readError}</p>}
      {visibleConfirmation && readBinding === authorityBinding && readStatus && <p role="status">{readStatus}</p>}
      {ownOperation?.phase === "unknown" && <><p role="alert">上次操作尚未確認；請以相同內容重試。</p><button className="button button--secondary" type="button" onClick={() => { if (!composition.current) setConfirmation(null); }}>回待確認清單</button>
        {readRecoverable && <button className="button button--secondary" type="button" disabled={reading || offline || changingView} aria-busy={reading} onClick={() => { void checkOriginalReceipt(); }}>查證原紀錄（不重送）</button>}
        {reading && <p role="status">正在查證原紀錄，原操作不會再次送出。</p>}
        <button className="button button--primary" type="button" disabled={!recoverable || offline || changingView || reading} onClick={retry}>重試同一護理操作</button></>}
      <button className="button button--primary" type="button" disabled={!!pending || pendingWork || changingView} onClick={() => { if (composition.current || !visibleConfirmation || hasPendingOperations() || hasViewTransition() || visibleConfirmation.epoch !== lifecycle.current.epoch) return; begin(visibleConfirmation.request, visibleConfirmation.sourceAt, visibleConfirmation.target); }}>{visibleConfirmation?.request.action === "correct" ? "確認更正並簽署" : "確認簽署"}</button>
    </GovernanceDialog>
    <GovernanceDialog open={guard.open} title="放棄未保存的護理編輯？" cancelLabel="繼續編輯" onRequestClose={() => { if (!composition.current) guard.cancel(); }} returnFocusRef={guard.returnFocusRef} fallbackFocusRef={recovery}>
      <p>尚未保存的內容會被清除；已送出但未確認的操作不能放棄。</p><button className="button" type="button" onClick={() => { if (!composition.current) guard.confirmDiscard(); }}>放棄編輯並繼續</button>
    </GovernanceDialog>
  </div>;
}
