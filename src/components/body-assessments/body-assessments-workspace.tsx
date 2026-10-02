"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { PageCatalogEntry } from "@/lib/catalog";
import { bodyObservationsReady, parseBodyAssessmentMutation, parseBodyAssessmentSuccess, type BodyAssessmentInput } from "@/lib/body-assessments/parser";
import { BODY_AREAS, BODY_AREA_LABELS, BODY_OBSERVATION_STATES, BODY_STATE_LABELS,
  type BodyAssessmentRecord, type BodyAssessmentSnapshot, type BodyAssessmentVersion } from "@/lib/body-assessments/types";
import { GovernanceDialog } from "@/components/ui/governance-dialog";
import { useUnsavedChanges } from "@/lib/navigation/use-unsaved-changes";
import { formatBodyAssessmentTime as time } from "@/lib/body-assessments/display-time";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { hasPendingOperations, hasViewTransition, tryAcquireViewTransition,
  usePendingOperations, useViewTransitionPending } from "@/lib/navigation/pending-operation-lock";
import { beginBodyAssessment, bodyAssessmentScopeIdentity, getBodyAssessmentPending, isConfirmedBodyAssessmentRejection,
  reconcileBodyAssessmentConfirmed, retryBodyAssessment, settleBodyAssessment, useBodyAssessmentPending,
  type BodyAssessmentOperation } from "@/lib/body-assessments/pending";
import styles from "./body-assessments.module.css";

const stateLabel = { draft: "草稿待簽", signed: "已簽署", corrected: "已簽更正版" };
function localTime(value: string) { return new Date(Date.parse(value) + 8 * 3_600_000).toISOString().slice(0, 16); }
function Observations({ version }: { version: Pick<BodyAssessmentVersion, "observations"> }) {
  return <dl className={styles.observations}>{version.observations.map((item) => <div key={item.area}>
    <dt>{BODY_AREA_LABELS[item.area]} · {BODY_STATE_LABELS[item.state]}</dt>
    <dd>{item.description ?? (item.state === "abnormal" ? "異常描述待補" : item.state === "normal" ? "人工標記正常" : "")}</dd>
    {item.reason && <dd>理由：{item.reason}</dd>}
    {item.state === "abnormal" && <dd>人工處置：{item.disposition ?? "待工作人員填寫；目前不能簽署"}</dd>}
  </div>)}</dl>;
}
type EditorRow = { area: string; state: string; description: string; reason: string; disposition: string };
type Editor = { record: BodyAssessmentRecord | null; clientId: string; observedAt: string; rows: EditorRow[]; reason: string; snapshotAt: string };
function editorValues(editor: Editor) {
  return JSON.stringify([editor.clientId, editor.observedAt, editor.rows, editor.reason]);
}
type Props = { page: PageCatalogEntry; snapshot: BodyAssessmentSnapshot; canManage: boolean; canSign: boolean; actorUserId: string };
export function BodyAssessmentsWorkspace({ page, snapshot, canManage, canSign, actorUserId }: Props) {
  const router = useRouter(); const [editor, setEditor] = useState<Editor | null>(null);
  const [editorBaseline, setEditorBaseline] = useState<string | null>(null);
  const [message, setMessage] = useState(""); const [receipt, setReceipt] = useState("");
  const [invalidSnapshot, setInvalidSnapshot] = useState<string | null>(null);
  const [expired, setExpired] = useState(false); const [signTarget, setSignTarget] = useState<string | null>(null);
  const [correction, setCorrection] = useState<BodyAssessmentInput | null>(null);
  const [reading, startRead] = useTransition(); const [readEpoch, setReadEpoch] = useState(0);
  const readLease = useRef<(() => void) | null>(null); const confirmationTrigger = useRef<HTMLButtonElement>(null);
  const editorForm = useRef<HTMLFormElement>(null);
  const mounted = useRef(false); const composing = useRef(false);
  const journal = useBodyAssessmentPending(); const operationPending = usePendingOperations(); const viewPending = useViewTransitionPending();
  const scope = { organizationId: snapshot.organizationId, branchId: snapshot.branchId, userId: actorUserId };
  const identity = bodyAssessmentScopeIdentity(scope, snapshot.demo);
  // The complete server snapshot lists currently readable/assigned clients.
  // Bind IDs, not names or list order, so revocation/restoration advances the
  // privacy epoch even when actor/branch and broad role flags remain unchanged.
  const assignedClientIds = [...new Set(snapshot.clients.map((client) => client.clientId.toLowerCase()))].sort();
  const fingerprint = JSON.stringify([identity, canManage, canSign, assignedClientIds]);
  const assignedClients = new Set(assignedClientIds);
  const context = useRef({ fingerprint, epoch: 0, privacyEpoch: journal.privacyEpoch });
  useLayoutEffect(() => {
    if (context.current.fingerprint !== fingerprint || context.current.privacyEpoch !== journal.privacyEpoch) {
      context.current = { fingerprint, epoch: context.current.epoch + 1, privacyEpoch: journal.privacyEpoch };
      composing.current = false;
      setEditor(null); setEditorBaseline(null); setSignTarget(null); setCorrection(null); setMessage(""); setReceipt(""); setInvalidSnapshot(null);
    }
  }, [fingerprint, journal.privacyEpoch]);
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false; context.current.epoch += 1; readLease.current?.(); readLease.current = null;
  }; }, []);
  useEffect(() => { reconcileBodyAssessmentConfirmed({ organizationId: snapshot.organizationId,
    branchId: snapshot.branchId, userId: actorUserId }, snapshot, Date.now()); },
    [actorUserId, snapshot]); // actor changes are an explicit privacy boundary
  useEffect(() => { if (!reading && readLease.current) { readLease.current(); readLease.current = null; } }, [reading, readEpoch]);
  useEffect(() => { const tick = () => setExpired(Date.now() > Date.parse(snapshot.staleAfter));
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id); }, [snapshot.staleAfter]);
  const operation = journal.operation; const ownOperation = operation?.identity === identity ? operation : null;
  const foreignOperation = !!operation && !ownOperation;
  const busy = ownOperation?.phase === "sending"; const uncertain = ownOperation?.phase === "unknown";
  const confirmedMarker = journal.confirmed.find((entry) => entry.identity === identity);
  const confirmedStale = !!confirmedMarker;
  const incomplete = snapshot.clientsTruncated || snapshot.recordsTruncated;
  const blocked = snapshot.demo || expired || incomplete || operationPending || viewPending || reading ||
    confirmedStale || invalidSnapshot === snapshot.generatedAt;
  const retryAllowed = !!ownOperation && uncertain && !snapshot.demo && !incomplete && !viewPending && !reading &&
    assignedClients.has(ownOperation.input.payload.client_id.toLowerCase()) &&
    (ownOperation.input.payload.action === "sign" || ownOperation.input.payload.action === "correct" ? canSign : canManage);
  function closeEditor() { composing.current = false; setEditor(null); setEditorBaseline(null); }
  const draftGuard = useUnsavedChanges({ dirty: !!editor && editorValues(editor) !== editorBaseline,
    scopeKey: JSON.stringify([fingerprint, journal.privacyEpoch]), revisionKey: snapshot.generatedAt,
    canPrompt: !signTarget && !correction && !operationPending && !viewPending && !reading,
    permittedFormAttribute: "data-body-assessment-form", onDiscard: closeEditor });
  function performRead() {
    if (hasPendingOperations() || hasViewTransition() || reading) return;
    const lease = tryAcquireViewTransition(); if (!lease) return;
    readLease.current = lease; setReadEpoch((value) => value + 1);
    startRead(() => { try { return router.refresh(); }
      catch { lease(); readLease.current = null; setMessage("已保存，但清單尚未更新；請重新載入核對，不要再次送出。"); } });
  }
  function requestRead() {
    if (hasPendingOperations() || hasViewTransition() || reading) return;
    draftGuard.requestExit(performRead);
  }
  function prepareQuery(event: FormEvent<HTMLFormElement>) {
    if (hasPendingOperations() || hasViewTransition()) { event.preventDefault(); return; }
    // A native GET owns its lease until the old view truly unmounts.
    const lease = tryAcquireViewTransition(); if (!lease) { event.preventDefault(); return; }
    readLease.current = lease;
  }
  function openEditor(record: BodyAssessmentRecord | null) {
    if (blocked || (record && !assignedClients.has(record.client_id.toLowerCase())) || (record && record.record_state !== "draft" ? !canSign : !canManage)) return;
    draftGuard.requestExit(() => {
      composing.current = false;
      setMessage(""); setSignTarget(null);
      const next = { record, snapshotAt: snapshot.generatedAt, clientId: record?.client_id ?? snapshot.filters.clientId ?? "", observedAt: record ? localTime(record.observed_at) : "",
        rows: record?.observations.map((o) => ({ area: o.area, state: o.state, description: o.description ?? "", reason: o.reason ?? "", disposition: o.disposition ?? "" })) ?? [], reason: "" };
      setEditorBaseline(editorValues(next)); setEditor(next);
    });
  }
  function updateRow(index: number, patch: Partial<EditorRow>) {
    setEditor((current) => current ? { ...current, rows: current.rows.map((r, i) => i === index ? { ...r, ...patch } : r) } : null);
  }
  function isCurrent(attempt: BodyAssessmentOperation, epoch: number) {
    const active = getBodyAssessmentPending();
    return mounted.current && context.current.epoch === epoch && context.current.fingerprint === fingerprint &&
      context.current.privacyEpoch === active.privacyEpoch && active.operation?.token === attempt.token &&
      active.operation.attempt === attempt.attempt;
  }
  async function send(input?: BodyAssessmentInput) {
    if (snapshot.demo || hasViewTransition() || reading || !navigator.onLine || incomplete ||
      (!ownOperation && (blocked || Date.now() > Date.parse(snapshot.staleAfter))) || (ownOperation && !retryAllowed)) return;
    const action = ownOperation?.input.payload.action ?? input?.payload.action;
    const clientId = ownOperation?.input.payload.client_id ?? input?.payload.client_id;
    if (!action || !clientId || !assignedClients.has(clientId.toLowerCase()) || ((action === "sign" || action === "correct") ? !canSign : !canManage)) return;
    let attempt: BodyAssessmentOperation | null;
    try { attempt = ownOperation ? retryBodyAssessment(ownOperation.token, scope, snapshot.demo)
      : input ? beginBodyAssessment(scope, snapshot.demo, input) : null; }
    catch { setMessage("無法建立安全操作，請確認欄位與資料範圍後重試。"); return; }
    if (!attempt) return;
    const epoch = context.current.epoch; setMessage("");
    if (!isCurrent(attempt, epoch)) { settleBodyAssessment(attempt, "unknown"); return; }
    try {
      const response = await fetchWithTimeout("/api/body-assessments", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", "idempotency-key": attempt.input.idempotencyKey, "x-body-assessment-operation": attempt.input.payload.action },
        body: attempt.body });
      const envelope: unknown = await response.json();
      if (!isCurrent(attempt, epoch)) { settleBodyAssessment(attempt, "unknown"); return; }
      if (!response.ok) {
        const known = isConfirmedBodyAssessmentRejection(envelope, response.status);
        settleBodyAssessment(attempt, known ? "denied" : "unknown");
        if (!known || attempt.everUnknown) {
          setMessage("原操作結果仍未確認。請保留原內容與操作鍵，恢復權限後回查，不要另建紀錄。"); return;
        }
        if (response.status === 409) {
          setInvalidSnapshot(snapshot.generatedAt); setSignTarget(null); setCorrection(null);
          setMessage("本次操作未接受：版本或操作鍵已有衝突，請重新載入後重新開啟紀錄核對。"); return;
        }
        setMessage(response.status === 403 ? "權限或最近 15 分鐘雙因素驗證不足，請完成驗證後再操作。" :
          "輸入或工作階段未通過驗證，請確認欄位後重試。"); return;
      }
      const confirmed = parseBodyAssessmentSuccess(envelope, attempt.input, attempt.scope, response.status);
      if (!settleBodyAssessment(attempt, confirmed)) return;
      setReceipt(`已保存第 ${confirmed.version} 版（${stateLabel[confirmed.record_state]}）`);
      closeEditor(); setSignTarget(null); setCorrection(null); performRead();
    } catch {
      const current = isCurrent(attempt, epoch); settleBodyAssessment(attempt, "unknown");
      if (current) setMessage("結果尚未確認。已保留本次內容與操作鍵，請按「重試相同操作」核對，避免另建重複紀錄。");
    }
  }
  function submitEditor() {
    if (!editor || blocked || composing.current || (editor.record && editor.record.record_state !== "draft" ? !canSign : !canManage)) return;
    if (!assignedClients.has(editor.clientId.toLowerCase())) { setMessage("請選擇目前仍可操作的個案；個案指派可能已變更。");
      editorForm.current?.querySelector<HTMLElement>("[data-body-first-field]")?.focus(); return; }
    if (editor.snapshotAt !== snapshot.generatedAt) { setMessage("畫面資料已更新，請取消編輯並重新開啟紀錄核對。"); return; }
    const record = editor.record;
    try {
      const observations = editor.rows.map((row) => ({ area: row.area, state: row.state,
        description: row.state === "missing" || row.state === "not_applicable" ? null : row.description.trim() || null,
        reason: row.state === "missing" || row.state === "not_applicable" ? row.reason.trim() || null : null,
        disposition: row.state === "abnormal" ? row.disposition.trim() || null : null }));
      const action = record ? record.record_state === "draft" ? "revise" : "correct" : "create";
      const input = parseBodyAssessmentMutation({ action, client_id: editor.clientId,
        assessment_key: record?.assessment_key ?? null, previous_version_id: record?.version_id ?? null,
        expected_version: record?.version ?? 0, expected_content_hash: record?.content_hash ?? null,
        observed_at: `${editor.observedAt}:00+08:00`, observations, instrument: "manual_nonstandard_body_observation_v1", reason: editor.reason }, crypto.randomUUID());
      if (action === "correct") setCorrection(input); else void send(input);
    } catch {
      setMessage("請完整選取個案、時間、部位與狀態；缺值及不適用須理由，更正簽署須補齊異常描述與人工處置，且更正理由至少 8 字。");
      (editorForm.current?.querySelector<HTMLElement>(":invalid") ?? editorForm.current?.querySelector<HTMLElement>("[data-body-first-field]"))?.focus();
    }
  }
  function sign(record: BodyAssessmentRecord) {
    if (blocked || !canSign || !assignedClients.has(record.client_id.toLowerCase()) || !bodyObservationsReady(record.observations) || record.historyTruncated) return;
    void send(parseBodyAssessmentMutation({ action: "sign", client_id: record.client_id, assessment_key: record.assessment_key,
      previous_version_id: record.version_id, expected_version: record.version, expected_content_hash: record.content_hash,
      reason: "本人確認已核對所選部位的人工觀察與處置" }, crypto.randomUUID()));
  }
  const signingRecord = snapshot.records.find((record) => record.version_id === signTarget && assignedClients.has(record.client_id.toLowerCase()));
  const pendingAuthorized = ownOperation && assignedClients.has(ownOperation.input.payload.client_id.toLowerCase()) &&
    (ownOperation.input.payload.action === "sign" || ownOperation.input.payload.action === "correct" ? canSign : canManage);
  return <section className={styles.workspace} aria-label="身體評估工作區">
    <header className={styles.header}><div><p>個案照護 · 人工身體觀察</p><h1 data-governance-focus-anchor tabIndex={-1}>{page.title}</h1>
      <p>逐一選取本次實際觀察的部位。未列出的部位不代表已評估或正常。</p></div>
      <button type="button" disabled={blocked || !canManage || snapshot.clients.length === 0} onClick={() => openEditor(null)}>新增評估草稿</button></header>
    <p className={styles.notice}>本頁為非標準化人工觀察紀錄，不提供診斷或量表分數。照片／附件服務尚未設定，現階段僅能保存文字觀察。</p>
    {snapshot.demo && <p className={styles.notice}>唯讀展示模式：以下個案、紀錄與簽署歷程皆為合成示例。</p>}
    {incomplete && <p role="alert">可用資料範圍不完整，已停用寫入。請縮小查詢範圍或聯絡管理人員。</p>}
    {expired && <p role="alert">資料已超過 5 分鐘，請重新載入後再操作。</p>}
    <div className={styles.toolbar}><form aria-label="查詢身體評估" method="get" noValidate action={`/app/${page.slug}`} className={styles.filters}
      onSubmit={prepareQuery}>
      <label>個案<select name="client" defaultValue={snapshot.filters.clientId ?? ""}><option value="">全部個案</option>
        {snapshot.clients.map((c) => <option key={c.clientId} value={c.clientId}>{c.displayName}</option>)}</select></label>
      <label>狀態<select name="state" defaultValue={snapshot.filters.state}><option value="all">全部狀態</option>
        <option value="draft">草稿待簽</option><option value="signed">已簽署</option><option value="corrected">已簽更正版</option></select></label>
      <button type="submit" disabled={operationPending || viewPending || reading}>查詢</button>
    </form><button type="button" onClick={requestRead} disabled={operationPending || viewPending || reading}>重新載入</button></div>
    <p>{snapshot.matchingTotal} 筆評估 · 更新於 {time(snapshot.generatedAt)}</p>
    {message && !signingRecord && !correction && <p role="alert" className={styles.notice}>{message}</p>}
    {busy && <p role="status">原操作仍在處理，請等候回覆，不要另外送出。</p>}
    {foreignOperation && <p role="alert">其他帳號或分支仍有未確認的身體評估操作；此處不顯示其內容，請由原帳號與分支回查。</p>}
    {operationPending && !operation && <p role="status">其他作業尚待確認，請先回原表單完成回查。</p>}
    {uncertain && <div className={styles.notice}><p role="status">上次結果尚未確認。原內容與操作鍵只暫存在本分頁記憶體；請回查原操作，完整重載可能遺失暫存。</p>
      {pendingAuthorized && ownOperation && <p>原操作：{ownOperation.input.payload.action === "sign" ? "簽署" : ownOperation.input.payload.action === "correct" ? "更正簽署" : "保存草稿"} ·
        {snapshot.clients.find((client) => client.clientId === ownOperation.input.payload.client_id)?.displayName ?? "原指派個案"}</p>}
      {!signingRecord && !correction && <button type="button" disabled={!retryAllowed} onClick={() => void send()}>重試相同操作</button>}
      {!pendingAuthorized && <p>個案指派或操作權限已變更，請恢復原帳號的必要權限後回查；原操作未被丟棄。</p>}
      <Link target="_blank" rel="noopener noreferrer" href="/mfa?audience=staff&purpose=sensitive-action">於新分頁重新完成雙因素驗證</Link>
    </div>}
    {journal.navigationBlocked && <p role="alert">操作結果尚未確認，請先回查原請求再離開；關閉整個分頁可能遺失暫存內容。</p>}
    {confirmedMarker && (assignedClients.has(confirmedMarker.clientId.toLowerCase()) ? <div className={styles.notice}><p role="status">已保存，但清單尚未確認更新；原篩選可能不顯示已保存的狀態。請查看已保存紀錄核對，不要再次建立相同紀錄。</p>
      <form aria-label="查看已保存身體評估" action={`/app/${page.slug}`} method="get" noValidate onSubmit={prepareQuery}>
        <input type="hidden" name="client" value={confirmedMarker.clientId} /><input type="hidden" name="state" value="all" />
        <button type="submit" disabled={operationPending || viewPending || reading}>查看已保存紀錄</button>
      </form></div> : <p role="status">已保存紀錄的個案權限已變更；此處不顯示原個案識別，請恢復權限後核對原回執。</p>)}
    {receipt && <p role="status">{receipt}</p>}
    {draftGuard.notice && <p role="alert">{draftGuard.notice}</p>}
    {editor && <form aria-label="身體評估編輯" className={styles.editor} data-body-assessment-form noValidate ref={editorForm}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={(event) => { if (event.key === "Enter" && (event.nativeEvent.isComposing || composing.current)) event.preventDefault(); }}
      onSubmit={(e) => { e.preventDefault(); submitEditor(); }}>
      <h2>{editor.record ? editor.record.record_state === "draft" ? "修訂草稿" : "建立更正簽署版" : "新增評估草稿"}</h2>
      <fieldset disabled={blocked}><legend>本次人工觀察</legend><div className={styles.filters}>
        <label>個案<select data-body-first-field value={editor.clientId} required disabled={!!editor.record} onChange={(e) => setEditor({ ...editor, clientId: e.target.value })}>
          <option value="">請選擇個案</option>{snapshot.clients.map((c) => <option key={c.clientId} value={c.clientId}>{c.displayName}</option>)}</select></label>
        <label>觀察時間（臺灣時間）<input type="datetime-local" required value={editor.observedAt} onChange={(e) => setEditor({ ...editor, observedAt: e.target.value })} /></label></div>
        {editor.rows.map((row, index) => <fieldset className={styles.rowEditor} key={index}><legend>部位觀察 {index + 1}</legend>
          <label>部位<select required value={row.area} onChange={(e) => updateRow(index, { area: e.target.value })}>
            <option value="">請明確選擇部位</option>{BODY_AREAS.map((a) => <option key={a} value={a} disabled={editor.rows.some((r, i) => i !== index && r.area === a)}>{BODY_AREA_LABELS[a]}</option>)}</select></label>
          <label>觀察狀態<select required value={row.state} onChange={(e) => updateRow(index, { state: e.target.value, description: "", reason: "", disposition: "" })}>
            <option value="">請明確選擇狀態</option>{BODY_OBSERVATION_STATES.map((s) => <option key={s} value={s}>{BODY_STATE_LABELS[s]}</option>)}</select></label>
          {(row.state === "normal" || row.state === "abnormal") && <label>觀察描述{row.state === "abnormal" ? "（簽署前必填）" : "（其他部位須註明位置）"}<textarea className="resize-none" maxLength={2000} value={row.description} onChange={(e) => updateRow(index, { description: e.target.value })} /></label>}
          {row.state === "abnormal" && <label>人工處置／追蹤安排（簽署前必填）<textarea className="resize-none" maxLength={2000} value={row.disposition} onChange={(e) => updateRow(index, { disposition: e.target.value })} /></label>}
          {(row.state === "missing" || row.state === "not_applicable") && <label>理由<textarea className="resize-none" required maxLength={1000} value={row.reason} onChange={(e) => updateRow(index, { reason: e.target.value })} /></label>}
          <button type="button" onClick={() => setEditor({ ...editor, rows: editor.rows.filter((_, i) => i !== index) })}>移除部位 {index + 1}</button>
        </fieldset>)}
        <button type="button" disabled={editor.rows.length >= BODY_AREAS.length} onClick={() => setEditor({ ...editor, rows: [...editor.rows, { area: "", state: "", description: "", reason: "", disposition: "" }] })}>加入觀察部位</button>
        <label>{editor.record?.record_state !== "draft" && editor.record ? "更正理由（至少 8 字）" : "建立／修訂理由"}<textarea className="resize-none" required maxLength={1000} value={editor.reason} onChange={(e) => setEditor({ ...editor, reason: e.target.value })} /></label>
        <div className={styles.actions}><button type="submit" ref={confirmationTrigger}>{editor.record && editor.record.record_state !== "draft" ? "確認內容並簽署更正版" : "保存草稿"}</button>
          <button type="button" onClick={() => draftGuard.requestExit(closeEditor)}>取消編輯</button></div></fieldset>
      {editor.record && editor.record.record_state !== "draft" && <p>更正會保留前版與本次理由；需最近 15 分鐘內完成雙因素驗證。</p>}
    </form>}
    {snapshot.records.length === 0 && <p className={styles.empty}>目前查詢範圍尚無身體評估紀錄。</p>}
    {snapshot.records.map((record) => <article className={styles.record} key={record.version_id}>
      <header><h2>{record.client_display_name}</h2><span>{stateLabel[record.record_state]} · 第 {record.version} 版</span></header>
      <p>觀察於 {time(record.observed_at)} · 記錄人 {record.actor_display_name}</p><Observations version={record} />
      <p>本版理由：{record.reason}</p>
      {record.signed_at && <p>已由：{record.actor_display_name} · {time(record.signed_at)} · {record.signature_purpose}</p>}
      <div className={styles.actions}>
        <button type="button" disabled={blocked || record.historyTruncated || (record.record_state === "draft" ? !canManage : !canSign)} onClick={() => openEditor(record)}>{record.record_state === "draft" ? "修訂草稿" : "建立更正版"}</button>
        {record.record_state === "draft" && <button type="button" disabled={blocked || !canSign || record.historyTruncated || !bodyObservationsReady(record.observations)} onClick={(event) => {
          if (blocked || !canSign) return;
          const trigger = event.currentTarget;
          draftGuard.requestExit(() => { closeEditor(); confirmationTrigger.current = trigger; setSignTarget(record.version_id); });
        }}>核對並簽署</button>}
      </div>
      {record.record_state === "draft" && !bodyObservationsReady(record.observations) && <p>異常描述或人工處置待補，尚不能簽署。</p>}
      <details><summary>紀錄詳情與版本歷程（前版 {record.historyTotal} 筆）</summary>
        <p className={styles.hash}>本版識別：{record.version_id}<br />內容雜湊：{record.content_hash}</p>
        {record.historyTruncated && <p role="alert">僅顯示最近 50 個前版，歷程不完整，已停用此筆寫入。</p>}
        {record.history.map((version) => <section className={styles.history} key={version.version_id}>
          <h3>第 {version.version} 版 · {stateLabel[version.record_state]}</h3><p>{time(version.created_at)} · {version.actor_display_name} · {version.reason}</p>
          <Observations version={version} />{version.signed_at && <p>已由：{version.actor_display_name} · {version.signature_purpose}</p>}
          <p className={styles.hash}>內容雜湊：{version.content_hash}</p></section>)}
      </details>
    </article>)}
    {draftGuard.open && <GovernanceDialog open title="捨棄尚未保存的填寫？" cancelLabel="繼續填寫"
      returnFocusRef={draftGuard.returnFocusRef} onRequestClose={draftGuard.cancel}>
      <div onCompositionStart={draftGuard.compositionStart} onCompositionEnd={draftGuard.compositionEnd}
        onKeyDown={(event) => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }}>
        <p>本次輸入尚未保存。捨棄後無法還原，不會刪除已保存的紀錄。</p>
        {draftGuard.notice && <p role="alert">{draftGuard.notice}</p>}
        <button className="button button--danger" type="button" onClick={draftGuard.confirmDiscard}>捨棄填寫並繼續</button>
      </div>
    </GovernanceDialog>}
    {(signingRecord || correction) && <GovernanceDialog open title={correction ? "確認身體評估更正簽署" : "確認身體評估簽署"}
      busy={busy || uncertain} returnFocusRef={confirmationTrigger} onRequestClose={() => { setSignTarget(null); setCorrection(null); }}>
      <p>簽署會固定本次部位、觀察及處置並保留原版；仍須最近 15 分鐘內完成雙因素驗證。</p>
      {signingRecord && <><p>{signingRecord.client_display_name} · 第 {signingRecord.version} 版</p><Observations version={signingRecord} /></>}
      {correction && "observations" in correction.payload && <>
        <p>{snapshot.clients.find((client) => client.clientId === correction.payload.client_id)?.displayName ?? "所選個案"} ·
          觀察於 {time(correction.payload.observed_at)}</p>
        <Observations version={correction.payload} /><p>更正理由：{correction.payload.reason}</p>
      </>}
      {message && <p role="alert">{message}</p>}
      {uncertain ? <><button type="button" className="button button--primary" disabled={!retryAllowed} onClick={() => void send()}>重試相同操作</button>
        <Link target="_blank" rel="noopener noreferrer" href="/mfa?audience=staff&purpose=sensitive-action">於新分頁重新完成雙因素驗證</Link></> :
        <button type="button" className="button button--primary" disabled={blocked || !canSign} onClick={() => {
          if (correction) void send(correction); else if (signingRecord) sign(signingRecord);
        }}>{busy ? "送出中…" : correction ? "確認簽署更正版" : "本人確認已核對所選部位的人工觀察與處置"}</button>}
    </GovernanceDialog>}
    {!snapshot.demo && <p><Link href="/mfa?audience=staff&purpose=sensitive-action">重新完成雙因素驗證</Link></p>}
  </section>;
}
