"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { parseAbcdAssessmentApiReceipt, parseAbcdAssessmentMutation } from "@/lib/abcd-assessments/parser";
import type { AbcdAssessment, AbcdAssessmentMutationInput, AbcdAssessmentSnapshot,
  AbcdValueState } from "@/lib/abcd-assessments/types";
import { installPendingNavigationGuard } from "@/lib/navigation/pending-navigation-guard";

import { useAbcdRecoveryGate } from "./abcd-recovery-gate";
import styles from "./abcd-assessments.module.css";

type State = { kind: "idle" | "working" | "success" | "error"; text: string };
type ExistingOperation = "revise" | "sign" | "correct";
class ConfirmedAbcdRejection extends Error {
  constructor(message: string) { super(message); this.name = "ConfirmedAbcdRejection"; }
}
const DEFINITIVE_REJECTION_CODES: Record<number, readonly string[]> = {
  400: ["INVALID_ABCD_ASSESSMENT_OPERATION", "INVALID_JSON"],
  401: ["AUTH_REQUIRED"],
  403: ["AAL2_REQUIRED", "DEMO_READ_ONLY", "ABCD_ASSESSMENT_NOT_AUTHORIZED"],
};
const VALUE_OPTIONS: Array<{ value: AbcdValueState; label: string }> = [
  { value: "recorded", label: "已記錄" }, { value: "missing", label: "缺值（待人工補登）" },
  { value: "not_applicable", label: "不適用" },
];

async function envelope(response: Response) {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
    const errors = body && Array.isArray(body.errors) ? body.errors : null;
    const first = errors?.length === 1 && errors[0] && typeof errors[0] === "object"
      ? errors[0] as Record<string, unknown> : null;
    const message = first?.message;
    // Only a complete, route-owned pre-write rejection proves this request was not committed.
    // A conflict, timeout, 5xx, or malformed envelope must keep the original operation frozen.
    if (!response.redirected && body?.status === "error" && body.data === null && typeof body.requestId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(body.requestId) &&
      typeof first?.code === "string" && DEFINITIVE_REJECTION_CODES[response.status]?.includes(first.code) &&
      typeof message === "string" && message.length > 0) {
      throw new ConfirmedAbcdRejection(message);
    }
    throw new Error(typeof message === "string" ? message : "ABCD 候選評估操作未完成。");
  }
  if (!payload || typeof payload !== "object" || (payload as { status?: unknown }).status !== "ok" ||
    !Array.isArray((payload as { errors?: unknown }).errors) || (payload as { errors: unknown[] }).errors.length !== 0 ||
    !("data" in payload) || (payload as { data: unknown }).data === null) {
    throw new Error("ABCD 候選評估成功回應不完整；請保留相同操作鍵重新核對。");
  }
  return (payload as { data: unknown }).data;
}

function readFields(data: FormData) {
  const resultState = String(data.get("result_state") ?? "") as AbcdValueState;
  const reassessmentState = String(data.get("reassessment_state") ?? "") as AbcdValueState;
  return { client_id: String(data.get("client_id") ?? ""),
    assessment_type: String(data.get("assessment_type") ?? ""),
    assessment_year: Number(data.get("assessment_year")),
    assessment_date: String(data.get("assessment_date") ?? ""),
    manual_summary: String(data.get("manual_summary") ?? "").trim(),
    result: { state: resultState,
      text: resultState === "recorded" ? String(data.get("result_text") ?? "").trim() : null,
      reason: resultState === "recorded" ? null : String(data.get("result_reason") ?? "").trim() },
    reassessment: { state: reassessmentState,
      date: reassessmentState === "recorded" ? String(data.get("reassessment_date") ?? "") : null,
      basis: String(data.get("reassessment_basis") ?? "").trim() } };
}

async function send(input: AbcdAssessmentMutationInput, operation: ExistingOperation | "create",
  organizationId: string, branchId: string) {
  const payload = input.action === "save_assessment" ? { action: input.action, mode: input.mode,
    assessment_key: input.assessmentKey, previous_version_id: input.previousVersionId,
    expected_version: input.expectedVersion, expected_content_hash: input.expectedContentHash,
    client_id: input.clientId, assessment_type: input.assessmentType,
    assessment_year: input.assessmentYear, assessment_date: input.assessmentDate,
    manual_summary: input.manualSummary, result: input.result, reassessment: input.reassessment,
    revision_reason: input.revisionReason } : input.action === "correct_assessment" ? {
    action: input.action, assessment_key: input.assessmentKey,
    previous_version_id: input.previousVersionId, expected_version: input.expectedVersion,
    expected_content_hash: input.expectedContentHash, client_id: input.clientId,
    assessment_type: input.assessmentType, assessment_year: input.assessmentYear,
    assessment_date: input.assessmentDate, manual_summary: input.manualSummary,
    result: input.result, reassessment: input.reassessment, reason: input.reason } : {
    action: input.action, client_id: input.clientId, assessment_key: input.assessmentKey,
    assessment_type: input.assessmentType, assessment_year: input.assessmentYear,
    previous_version_id: input.previousVersionId, expected_version: input.expectedVersion,
    expected_content_hash: input.expectedContentHash };
  const response = await fetchWithTimeout("/api/abcd-assessments", { method: "POST", cache: "no-store",
    headers: { "content-type": "application/json", "idempotency-key": input.idempotencyKey,
      "x-abcd-assessment-operation": operation }, body: JSON.stringify(payload) });
  return parseAbcdAssessmentApiReceipt(await envelope(response), input, organizationId, branchId);
}

function CandidateFields({ initial, fixedIdentity }: { initial?: AbcdAssessment; fixedIdentity?: boolean }) {
  const [resultState, setResultState] = useState<AbcdValueState>(initial?.result.state ?? "recorded");
  const [reassessmentState, setReassessmentState] = useState<AbcdValueState>(initial?.reassessment.state ?? "recorded");
  const year = initial?.assessmentYear ?? new Date().getFullYear();
  return <>
    {fixedIdentity && initial ? <><input name="client_id" type="hidden" value={initial.clientId} />
      <input name="assessment_type" type="hidden" value={initial.assessmentType} />
      <input name="assessment_year" type="hidden" value={initial.assessmentYear} />
      <p className={styles.identity}><strong>固定版本鏈：</strong>{initial.clientDisplayName}・{initial.assessmentYear} 年・{initial.assessmentType} 類。
        類型或年度不得在既有鏈上變更。</p></> : null}
    {!fixedIdentity ? <><label><span>年度</span><input defaultValue={year} max={2200} min={2000}
      name="assessment_year" required type="number" /></label>
      <label><span>類型</span><select name="assessment_type" required>
        {(["A", "B", "C", "D"] as const).map((value) => <option key={value} value={value}>{value} 類</option>)}</select></label></> : null}
    <label><span>人工評估日期</span><input defaultValue={initial?.assessmentDate ?? ""}
      name="assessment_date" required type="date" /></label>
    <label className={styles.wide}><span>人工摘要（非正式題本、非診斷）</span>
      <textarea className="resize-none" defaultValue={initial?.manualSummary ?? ""} maxLength={8000} minLength={1}
        name="manual_summary" required rows={4} /></label>
    <fieldset className={styles.triField}><legend>人工結果</legend>
      <label><span>結果狀態</span><select name="result_state" value={resultState}
        onChange={(event) => setResultState(event.target.value as AbcdValueState)}>
        {VALUE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      {resultState === "recorded" ? <label><span>人工結果文字</span><textarea className="resize-none"
        defaultValue={initial?.result.text ?? ""} maxLength={4000} minLength={1}
        name="result_text" required rows={3} /></label> : <label><span>{resultState === "missing" ? "缺值理由" : "不適用理由"}</span>
        <textarea className="resize-none" defaultValue={initial?.result.reason ?? ""} maxLength={1000} minLength={1}
          name="result_reason" required rows={3} /></label>}
    </fieldset>
    <fieldset className={styles.triField}><legend>人工複評日期</legend>
      <label><span>複評狀態</span><select name="reassessment_state" value={reassessmentState}
        onChange={(event) => setReassessmentState(event.target.value as AbcdValueState)}>
        {VALUE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      {reassessmentState === "recorded" ? <label><span>人工指定複評日</span><input
        defaultValue={initial?.reassessment.date ?? ""} name="reassessment_date" required type="date" /></label> : null}
      <label><span>人工依據</span><textarea className="resize-none" defaultValue={initial?.reassessment.basis ?? ""}
        maxLength={1000} minLength={1} name="reassessment_basis" required rows={3} /></label>
    </fieldset>
  </>;
}

export function CreateAbcdAssessment({ canManage, selectedClientId = null, snapshot }: {
  canManage: boolean; selectedClientId?: string | null; snapshot: AbcdAssessmentSnapshot;
}) {
  const router = useRouter();
  const recovery = useAbcdRecoveryGate();
  const sent = useRef<{ input: AbcdAssessmentMutationInput; organizationId: string; branchId: string;
    hadUnknown: boolean } | null>(null);
  const [pendingAttempt, setPendingAttempt] = useState<NonNullable<typeof sent.current> | null>(null);
  const [state, setState] = useState<State>({ kind: "idle", text: "" });
  const [resultUnknown, setResultUnknown] = useState(false);
  const selectedFromSnapshot = selectedClientId && snapshot.clients.some((client) => client.clientId === selectedClientId)
    ? selectedClientId : "";
  const [clientId, setClientId] = useState(selectedFromSnapshot);
  const [clientError, setClientError] = useState("");
  const clientField = useRef<HTMLSelectElement | null>(null);
  const details = useRef<HTMLDetailsElement | null>(null);
  const formEdited = useRef(false);
  const [editingRouteClientId, setEditingRouteClientId] = useState<string | null | undefined>(undefined);
  const routeChangedAfterEdit = editingRouteClientId !== undefined && editingRouteClientId !== selectedClientId;
  const selectedClientUnavailable = Boolean(selectedClientId && !selectedFromSnapshot);
  useEffect(() => {
    // A refreshed filter can preselect a client only before the form is edited.
    // Never silently retarget an in-progress assessment to another person.
    if (!formEdited.current) {
      setClientId(selectedFromSnapshot);
      setClientError("");
      if (selectedFromSnapshot && details.current) details.current.open = true;
    } else setClientError("");
  }, [selectedClientId, selectedFromSnapshot]);
  useEffect(() => {
    if (!pendingAttempt) return;
    return installPendingNavigationGuard({ hasPendingOperation: () => Boolean(sent.current),
      permittedFormAttribute: "data-abcd-assessment-own-form",
      onBlocked: () => setState({ kind: "error", text: "原筆結果尚未確認，請留在此頁使用相同內容重試或請主管核對。" }) });
  }, [pendingAttempt]);
  if (!canManage || snapshot.demo || !snapshot.clients.length) {
    if (pendingAttempt) return <section aria-label="ABCD 原操作待核對" className={styles.actions} role="alert">
      <p>原筆保存結果尚未確認；目前權限或個案名單已變更，不能在此頁重試或另建。</p>
      <p>請通知主管核對原筆。若需離開，請使用頁首登出。</p>
    </section>;
    return null;
  }
  function changed() { if (sent.current || state.kind === "success") return;
    if (!formEdited.current) setEditingRouteClientId(selectedClientId);
    formEdited.current = true;
    if (state.kind === "error") setState({ kind: "idle", text: "" }); }
  async function sendExact(attempt: NonNullable<typeof sent.current>) {
    if (attempt.organizationId !== snapshot.organizationId || attempt.branchId !== snapshot.branchId ||
      !snapshot.clients.some((client) => client.clientId === attempt.input.clientId)) {
      setState({ kind: "error", text: "原操作的個案或分支已不在目前授權範圍；請由主管核對原筆，不要重複建立。" });
      return;
    }
    setState({ kind: "working", text: "正在確認原筆候選草稿…" });
    try {
      const receipt = await send(attempt.input, "create", attempt.organizationId, attempt.branchId);
      if (sent.current !== attempt) return;
      sent.current = null;
      setPendingAttempt(null);
      setResultUnknown(false);
      setState({ kind: "success", text: `${receipt.assessmentYear} 年 ${receipt.assessmentType} 類候選草稿 v${receipt.version} 已建立；尚未簽署。` });
      router.refresh();
    } catch (error) {
      if (sent.current !== attempt) return;
      if (error instanceof ConfirmedAbcdRejection && !attempt.hadUnknown) {
        sent.current = null;
        setPendingAttempt(null);
        setResultUnknown(false);
        setState({ kind: "error", text: `${error.message} 本次未建立，請確認後再試。` });
        return;
      }
      attempt.hadUnknown = true;
      setResultUnknown(true);
      setState({ kind: "error", text: "保存結果尚未確認；原內容已鎖定，請只用相同內容重試，或由主管核對原筆。" });
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sent.current || state.kind === "working" || state.kind === "success") return;
    if (selectedClientUnavailable) {
      setClientError("目前可選名單未包含此個案；請重新開啟表單或聯絡管理員。");
      clientField.current?.focus();
      return;
    }
    if (routeChangedAfterEdit) {
      setState({ kind: "error", text: "填寫途中查詢個案已改變；請回到原個案查詢後再保存。" });
      clientField.current?.focus();
      return;
    }
    const chosenClientId = String(new FormData(event.currentTarget).get("client_id") ?? "");
    if (selectedClientId && chosenClientId !== selectedClientId) {
      setClientError("表單個案與目前查詢不同；請重新選擇原個案後再保存。");
      clientField.current?.focus();
      return;
    }
    if (!snapshot.clients.some((client) => client.clientId === chosenClientId)) {
      setClientError("請先選擇目前可處理的個案。");
      clientField.current?.focus();
      return;
    }
    if (!recovery.canStart(chosenClientId)) {
      setState({ kind: "error", text: recovery.reasonFor(chosenClientId) ?? "請先查證原操作。" });
      return;
    }
    const firstInvalid = event.currentTarget.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      "input:invalid, select:invalid, textarea:invalid");
    if (firstInvalid) {
      const label = firstInvalid.closest("label")?.querySelector("span")?.textContent ?? "必填欄位";
      setState({ kind: "error", text: `請完成「${label}」後再建立。` });
      firstInvalid.focus();
      return;
    }
    setClientError("");
    let input: AbcdAssessmentMutationInput;
    try { const data = new FormData(event.currentTarget); input = parseAbcdAssessmentMutation({
      action: "save_assessment", mode: "create", assessment_key: null, previous_version_id: null,
      expected_version: 0, expected_content_hash: null, ...readFields(data),
      revision_reason: "建立 ABCD 人工候選評估初稿",
    }, crypto.randomUUID()); }
    catch (error) { setState({ kind: "error", text: error instanceof Error ? error.message : "請檢查表單內容。" }); return; }
    const attempt = { input, organizationId: snapshot.organizationId, branchId: snapshot.branchId,
      hadUnknown: false };
    sent.current = attempt;
    setPendingAttempt(attempt);
    await sendExact(attempt);
  }
  const visibleClientId = snapshot.clients.some((client) => client.clientId === clientId) ? clientId : "";
  const retryScopeValid = pendingAttempt !== null && pendingAttempt.organizationId === snapshot.organizationId &&
    pendingAttempt.branchId === snapshot.branchId &&
    snapshot.clients.some((client) => client.clientId === pendingAttempt.input.clientId);
  return <section aria-label="新增 ABCD 人工候選評估" className={styles.actions}><details className={styles.action} ref={details}>
    <summary>新增獨立候選草稿</summary><form noValidate onChange={changed} onInput={changed} onSubmit={submit}>
      <fieldset className={styles.formGrid} disabled={pendingAttempt !== null || state.kind === "success" ||
        !recovery.canStart(visibleClientId)}>
        <label><span>個案</span><select aria-describedby={clientError ? "abcd-create-client-error" : undefined}
          aria-invalid={Boolean(clientError)} name="client_id" onChange={(event) => {
            setClientId(event.target.value); setClientError("");
          }} ref={clientField} required value={visibleClientId}>
          <option value="">請選擇個案</option>
          {snapshot.clients.map((client) => <option key={client.clientId} value={client.clientId}>{client.displayName}</option>)}
        </select>{clientError ? <small id="abcd-create-client-error" role="alert">{clientError}</small> : null}</label>
        {selectedClientUnavailable && !clientError ? <p className={styles.reauth} role="alert">
          目前可選名單未包含此個案，不能保存這份表單。
        </p> : null}
        {routeChangedAfterEdit || (selectedFromSnapshot && visibleClientId && visibleClientId !== selectedFromSnapshot) ?
          <p className={styles.reauth} role="alert">
          表單個案與目前查詢不同；請回到原個案後再保存。
        </p> : null}
        {clientId && !visibleClientId ? <p className={styles.reauth} role="alert">
          原個案已不在目前可選名單，尚未送出的內容不會改存到其他個案。
        </p> : null}
        <CandidateFields /><button className="button button--primary" type="submit">{pendingAttempt ? "保存待確認" : "建立人工候選草稿"}</button>
      </fieldset>{!pendingAttempt && !recovery.canStart(visibleClientId) ? <p className={styles.reauth} role="status">
        {recovery.reasonFor(visibleClientId)}</p> : null}{state.kind !== "idle" ? <p className={state.kind === "error" ? styles.error : styles.message}
        role={resultUnknown ? "alert" : "status"}>{state.text}</p> : null}
      {resultUnknown ? <button className="button button--secondary" disabled={state.kind === "working" || !retryScopeValid}
        onClick={() => { if (sent.current) void sendExact(sent.current); }} type="button">以相同內容重試</button> : null}
      {state.kind === "success" ? <button className="button button--secondary" onClick={() => window.location.reload()}
        type="button">重新載入後新增另一份</button> : null}
    </form></details></section>;
}

export function AbcdAssessmentActions({ canManage, hasRecentAal2, assessment, organizationId, branchId }: {
  canManage: boolean; hasRecentAal2: boolean; assessment: AbcdAssessment;
  organizationId: string; branchId: string;
}) {
  type Attempt = { input: AbcdAssessmentMutationInput; operation: ExistingOperation;
    organizationId: string; branchId: string; clientId: string; assessmentKey: string;
    versionId: string; version: number; contentHash: string; assessmentState: AbcdAssessment["assessmentState"];
    hadUnknown: boolean };
  const router = useRouter();
  const recovery = useAbcdRecoveryGate();
  const sent = useRef<Attempt | null>(null);
  const [pendingAttempt, setPendingAttempt] = useState<Attempt | null>(null);
  const available: ExistingOperation[] = !canManage ? [] : assessment.assessmentState === "draft" ?
    ["revise", "sign"] : ["correct"];
  const [operation, setOperation] = useState<ExistingOperation>(available[0] ?? "revise");
  const [state, setState] = useState<State>({ kind: "idle", text: "" });
  const [resultUnknown, setResultUnknown] = useState(false);
  const [formBaseline, setFormBaseline] = useState(() => ({ assessment, organizationId, branchId }));
  const [formEdited, setFormEdited] = useState(false);
  const formContextCurrent = formBaseline.organizationId === organizationId && formBaseline.branchId === branchId &&
    formBaseline.assessment.clientId === assessment.clientId &&
    formBaseline.assessment.assessmentKey === assessment.assessmentKey &&
    formBaseline.assessment.versionId === assessment.versionId &&
    formBaseline.assessment.version === assessment.version &&
    formBaseline.assessment.contentHash === assessment.contentHash &&
    formBaseline.assessment.assessmentState === assessment.assessmentState;
  useEffect(() => {
    // Refresh untouched fields from the newest immutable version. Edited fields remain pinned
    // to their original version; a background refresh must never rebase them silently.
    if (!formEdited && !sent.current && state.kind !== "success" && !formContextCurrent) {
      setFormBaseline({ assessment, organizationId, branchId });
      setOperation(assessment.assessmentState === "draft" ? "revise" : "correct");
      setState({ kind: "idle", text: "" });
    }
  }, [assessment, branchId, formContextCurrent, formEdited, organizationId, state.kind]);
  useEffect(() => {
    if (!pendingAttempt) return;
    return installPendingNavigationGuard({ hasPendingOperation: () => Boolean(sent.current),
      permittedFormAttribute: "data-abcd-assessment-own-form",
      onBlocked: () => setState({ kind: "error", text: "原操作結果尚未確認，請留在此頁使用相同內容重試或核對原筆。" }) });
  }, [pendingAttempt]);
  if (!available.length) return pendingAttempt ? <p className={styles.noAction} role="alert">
    原操作結果尚未確認；目前權限已變更，不能在此頁重試或另建。請通知主管核對原筆；若需離開，請使用頁首登出。
  </p> : <span className={styles.noAction}>無可用操作</span>;
  const contentAction = operation !== "sign"; const recentRequired = operation !== "revise";
  function matchesCurrent(attempt: Attempt) {
    return canManage && available.includes(attempt.operation) &&
      attempt.organizationId === organizationId && attempt.branchId === branchId &&
      attempt.clientId === assessment.clientId && attempt.assessmentKey === assessment.assessmentKey &&
      attempt.versionId === assessment.versionId && attempt.version === assessment.version &&
      attempt.contentHash === assessment.contentHash && attempt.assessmentState === assessment.assessmentState &&
      (attempt.operation === "revise" || hasRecentAal2);
  }
  function changed() { if (sent.current || state.kind === "success") return;
    setFormEdited(true);
    if (state.kind === "error") setState({ kind: "idle", text: "" }); }
  async function sendExact(attempt: Attempt) {
    if (!matchesCurrent(attempt)) {
      setResultUnknown(true);
      setState({ kind: "error", text: "原操作的個案、分支、版本或權限已改變；請核對原筆，不要重新送出。" });
      return;
    }
    setState({ kind: "working", text: "正在確認原筆候選評估…" });
    try {
      const receipt = await send(attempt.input, attempt.operation, attempt.organizationId, attempt.branchId);
      if (sent.current !== attempt) return;
      sent.current = null;
      setPendingAttempt(null);
      setResultUnknown(false);
      setState({ kind: "success", text: `${attempt.operation === "sign" ? "人工候選評估已簽署" : "新版本已建立"}（v${receipt.version}）。` });
      router.refresh();
    } catch (error) {
      if (sent.current !== attempt) return;
      if (error instanceof ConfirmedAbcdRejection && !attempt.hadUnknown) {
        sent.current = null;
        setPendingAttempt(null);
        setResultUnknown(false);
        setState({ kind: "error", text: `${error.message} 本次未寫入，請確認後再試。` });
        return;
      }
      attempt.hadUnknown = true;
      setResultUnknown(true);
      setState({ kind: "error", text: "操作結果尚未確認；原內容已鎖定，請只用相同內容重試，或核對原筆。" });
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sent.current || state.kind === "working" || state.kind === "success") return;
    if (!formContextCurrent) {
      setState({ kind: "error", text: "此評估版本或個案已更新；舊表單內容不會改存到新版本，請先核對並重新載入。" });
      return;
    }
    if (!available.includes(operation) || (recentRequired && !hasRecentAal2)) {
      setState({ kind: "error", text: "操作權限或重新驗證已失效，請更新畫面後再試。" });
      return;
    }
    if (!recovery.canStart(assessment.clientId)) {
      setState({ kind: "error", text: recovery.reasonFor(assessment.clientId) ?? "請先查證原操作。" });
      return;
    }
    const firstInvalid = event.currentTarget.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      "input:invalid, select:invalid, textarea:invalid");
    if (firstInvalid) {
      const label = firstInvalid.closest("label")?.querySelector("span")?.textContent ?? "必填欄位";
      setState({ kind: "error", text: `請完成「${label}」後再送出。` });
      firstInvalid.focus();
      return;
    }
    let input: AbcdAssessmentMutationInput;
    try { const data = new FormData(event.currentTarget); const key = crypto.randomUUID();
      if (operation === "revise") input = parseAbcdAssessmentMutation({ action: "save_assessment", mode: "revise",
        assessment_key: assessment.assessmentKey, previous_version_id: assessment.versionId,
        expected_version: assessment.version, expected_content_hash: assessment.contentHash,
        ...readFields(data), revision_reason: String(data.get("reason") ?? "") }, key);
      else if (operation === "correct") input = parseAbcdAssessmentMutation({ action: "correct_assessment",
        assessment_key: assessment.assessmentKey, previous_version_id: assessment.versionId,
        expected_version: assessment.version, expected_content_hash: assessment.contentHash,
        ...readFields(data), reason: String(data.get("reason") ?? "") }, key);
      else input = parseAbcdAssessmentMutation({ action: "sign_assessment", client_id: assessment.clientId,
        assessment_key: assessment.assessmentKey, assessment_type: assessment.assessmentType,
        assessment_year: assessment.assessmentYear, previous_version_id: assessment.versionId,
        expected_version: assessment.version, expected_content_hash: assessment.contentHash }, key);
    } catch (error) { setState({ kind: "error", text: error instanceof Error ? error.message : "請檢查表單內容。" }); return; }
    if (input.clientId !== assessment.clientId || input.assessmentKey !== assessment.assessmentKey ||
      input.previousVersionId !== assessment.versionId || input.expectedVersion !== assessment.version ||
      input.expectedContentHash !== assessment.contentHash || input.assessmentType !== assessment.assessmentType ||
      input.assessmentYear !== assessment.assessmentYear) {
      setState({ kind: "error", text: "表單個案或版本已改變；請重新載入後再試。" });
      return;
    }
    const attempt: Attempt = { input, operation, organizationId, branchId, clientId: assessment.clientId,
      assessmentKey: assessment.assessmentKey, versionId: assessment.versionId,
      version: assessment.version, contentHash: assessment.contentHash,
      assessmentState: assessment.assessmentState, hadUnknown: false };
    sent.current = attempt;
    setPendingAttempt(attempt);
    await sendExact(attempt);
  }
  const retryAllowed = pendingAttempt !== null && matchesCurrent(pendingAttempt);
  return <details className={styles.rowAction} onToggle={(event) => {
    // Opening the review surface is already an intent to act: do not silently switch
    // the candidate under a person who is reading its fields before signing.
    if (event.currentTarget.open && !sent.current && state.kind !== "success") setFormEdited(true);
  }}><summary onClick={() => { if (!sent.current && state.kind !== "success") setFormEdited(true); }}>
    候選紀錄操作</summary><form
    key={`${formBaseline.organizationId}:${formBaseline.branchId}:${formBaseline.assessment.versionId}:${formBaseline.assessment.contentHash}`}
    noValidate onChange={changed}
    onInput={changed} onSubmit={submit}>
    <fieldset className={styles.formGrid} disabled={!formContextCurrent || pendingAttempt !== null || state.kind === "success" ||
      !recovery.canStart(assessment.clientId) ||
      (recentRequired && !hasRecentAal2)}>
      <label><span>操作</span><select value={operation} onChange={(event) => {
        setOperation(event.target.value as ExistingOperation); changed(); }}>
        {available.map((item) => <option key={item} value={item}>{item === "revise" ? "修訂草稿" :
          item === "sign" ? "簽署人工候選紀錄" : "建立有理由更正版"}</option>)}</select></label>
      {contentAction ? <CandidateFields fixedIdentity initial={formBaseline.assessment} /> : null}
      {contentAction ? <label className={styles.wide}><span>{operation === "correct" ? "更正理由（至少 8 字）" : "修訂理由"}</span>
        <textarea className="resize-none" maxLength={1000} minLength={operation === "correct" ? 8 : 1} name="reason" required rows={3} /></label> : null}
      {operation === "sign" ? <p className={styles.wide}><strong>簽署確認：</strong>我確認這是人工、非標準化候選紀錄；
        系統未套用正式題本、公式、分數、診斷、自動複評或照顧決策，並同意以目前版本及內容指紋建立不可變簽署證據。</p> : null}
      <button className="button button--primary"
        disabled={!formContextCurrent || pendingAttempt !== null || state.kind === "success" ||
          !recovery.canStart(assessment.clientId) ||
          (recentRequired && !hasRecentAal2)}
        type="submit">{pendingAttempt ? "操作待確認" : "鎖定版本並送出"}</button>
    </fieldset>{!pendingAttempt && !recovery.canStart(assessment.clientId) ? <p className={styles.reauth} role="status">
      {recovery.reasonFor(assessment.clientId)}</p> : null}{recentRequired && !hasRecentAal2 ? <p className={styles.reauth}>簽署與更正需同一工作階段最近 15 分鐘 AAL2。 <Link href="/mfa?audience=staff&purpose=sensitive-action">重新驗證</Link></p> : null}
    {!formContextCurrent && state.kind !== "success" ? <p className={styles.reauth} role="alert">
      此評估版本或個案已更新；原表單內容已保留但不能直接送出。
      {pendingAttempt ? "原操作結果尚未確認，請先由主管核對原筆；不要重新建立。" : "請核對新版本後重新載入。"}
    </p> : null}
    {state.kind !== "idle" ? <p className={state.kind === "error" ? styles.error : styles.message}
      role={resultUnknown ? "alert" : "status"}>{state.text}</p> : null}
    {resultUnknown ? <button className="button button--secondary" disabled={state.kind === "working" || !retryAllowed}
      onClick={() => { if (sent.current) void sendExact(sent.current); }} type="button">以相同內容重試</button> : null}
    {state.kind === "success" || (!formContextCurrent && formEdited && pendingAttempt === null) ? <button className="button button--secondary"
      onClick={() => window.location.reload()} type="button">重新載入最新版本</button> : null}</form></details>;
}
