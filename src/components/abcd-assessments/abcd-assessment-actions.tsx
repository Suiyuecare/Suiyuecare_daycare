"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { parseAbcdAssessmentMutation, parseAbcdAssessmentReceipt } from "@/lib/abcd-assessments/parser";
import type { AbcdAssessment, AbcdAssessmentMutationInput, AbcdAssessmentSnapshot,
  AbcdValueState } from "@/lib/abcd-assessments/types";

import styles from "./abcd-assessments.module.css";

type State = { kind: "idle" | "working" | "success" | "error"; text: string };
type ExistingOperation = "revise" | "sign" | "correct";
const VALUE_OPTIONS: Array<{ value: AbcdValueState; label: string }> = [
  { value: "recorded", label: "已記錄" }, { value: "missing", label: "缺值（待人工補登）" },
  { value: "not_applicable", label: "不適用" },
];

function resultUnknown(error: unknown) {
  if (isClientFetchTimeoutError(error) || error instanceof TypeError) return "連線中斷或逾時，結果未知；請保留內容並使用相同操作鍵重試。";
  return error instanceof Error ? error.message : "ABCD 候選評估操作未完成。";
}

async function envelope(response: Response) {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && Array.isArray((payload as { errors?: unknown }).errors)
      ? (payload as { errors: Array<{ message?: unknown }> }).errors[0]?.message : null;
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
  return parseAbcdAssessmentReceipt(await envelope(response), input, organizationId, branchId);
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
      <textarea defaultValue={initial?.manualSummary ?? ""} maxLength={8000} minLength={1}
        name="manual_summary" required rows={4} /></label>
    <fieldset className={styles.triField}><legend>人工結果</legend>
      <label><span>結果狀態</span><select name="result_state" value={resultState}
        onChange={(event) => setResultState(event.target.value as AbcdValueState)}>
        {VALUE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      {resultState === "recorded" ? <label><span>人工結果文字</span><textarea
        defaultValue={initial?.result.text ?? ""} maxLength={4000} minLength={1}
        name="result_text" required rows={3} /></label> : <label><span>{resultState === "missing" ? "缺值理由" : "不適用理由"}</span>
        <textarea defaultValue={initial?.result.reason ?? ""} maxLength={1000} minLength={1}
          name="result_reason" required rows={3} /></label>}
    </fieldset>
    <fieldset className={styles.triField}><legend>人工複評日期</legend>
      <label><span>複評狀態</span><select name="reassessment_state" value={reassessmentState}
        onChange={(event) => setReassessmentState(event.target.value as AbcdValueState)}>
        {VALUE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      {reassessmentState === "recorded" ? <label><span>人工指定複評日</span><input
        defaultValue={initial?.reassessment.date ?? ""} name="reassessment_date" required type="date" /></label> : null}
      <label><span>人工依據</span><textarea defaultValue={initial?.reassessment.basis ?? ""}
        maxLength={1000} minLength={1} name="reassessment_basis" required rows={3} /></label>
    </fieldset>
  </>;
}

export function CreateAbcdAssessment({ canManage, snapshot }: { canManage: boolean; snapshot: AbcdAssessmentSnapshot }) {
  const router = useRouter(); const key = useRef<string | null>(null); const failed = useRef(false);
  const [state, setState] = useState<State>({ kind: "idle", text: "" });
  if (!canManage || snapshot.demo || !snapshot.clients.length) return null;
  function changed() { if (failed.current) key.current = null; failed.current = false;
    if (state.kind === "error") setState({ kind: "idle", text: "" }); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setState({ kind: "working", text: "正在確認個案、年度與類型的獨立版本鏈…" });
    key.current ??= crypto.randomUUID();
    try { const data = new FormData(event.currentTarget); const input = parseAbcdAssessmentMutation({
      action: "save_assessment", mode: "create", assessment_key: null, previous_version_id: null,
      expected_version: 0, expected_content_hash: null, ...readFields(data),
      revision_reason: "建立 ABCD 人工候選評估初稿",
    }, key.current); const receipt = await send(input, "create", snapshot.organizationId, snapshot.branchId);
      key.current = null; failed.current = false;
      setState({ kind: "success", text: `${receipt.assessmentYear} 年 ${receipt.assessmentType} 類候選草稿 v${receipt.version} 已建立；尚未簽署。` });
      router.refresh();
    } catch (error) { failed.current = true; setState({ kind: "error", text: resultUnknown(error) }); }
  }
  return <section aria-label="新增 ABCD 人工候選評估" className={styles.actions}><details className={styles.action}>
    <summary>新增獨立候選草稿</summary><form onInput={changed} onSubmit={submit}>
      <fieldset className={styles.formGrid} disabled={state.kind === "working"}>
        <label><span>個案</span><select name="client_id" required>{snapshot.clients.map((client) =>
          <option key={client.clientId} value={client.clientId}>{client.displayName}</option>)}</select></label>
        <CandidateFields /><button className="button button--primary" type="submit">建立人工候選草稿</button>
      </fieldset>{state.kind !== "idle" ? <p className={state.kind === "error" ? styles.error : styles.message}
        role="status">{state.text}</p> : null}</form></details></section>;
}

export function AbcdAssessmentActions({ canManage, hasRecentAal2, assessment, organizationId, branchId }: {
  canManage: boolean; hasRecentAal2: boolean; assessment: AbcdAssessment;
  organizationId: string; branchId: string;
}) {
  const router = useRouter(); const key = useRef<string | null>(null); const failed = useRef(false);
  const available: ExistingOperation[] = !canManage ? [] : assessment.assessmentState === "draft" ?
    ["revise", "sign"] : ["correct"];
  const [operation, setOperation] = useState<ExistingOperation>(available[0] ?? "revise");
  const [state, setState] = useState<State>({ kind: "idle", text: "" });
  if (!available.length) return <span className={styles.noAction}>無可用操作</span>;
  const contentAction = operation !== "sign"; const recentRequired = operation !== "revise";
  function changed() { if (failed.current) key.current = null; failed.current = false;
    if (state.kind === "error") setState({ kind: "idle", text: "" }); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setState({ kind: "working", text: "正在鎖定類型、年度、最新版本與內容指紋…" });
    key.current ??= crypto.randomUUID();
    try { const data = new FormData(event.currentTarget); let input: AbcdAssessmentMutationInput;
      if (operation === "revise") input = parseAbcdAssessmentMutation({ action: "save_assessment", mode: "revise",
        assessment_key: assessment.assessmentKey, previous_version_id: assessment.versionId,
        expected_version: assessment.version, expected_content_hash: assessment.contentHash,
        ...readFields(data), revision_reason: String(data.get("reason") ?? "") }, key.current);
      else if (operation === "correct") input = parseAbcdAssessmentMutation({ action: "correct_assessment",
        assessment_key: assessment.assessmentKey, previous_version_id: assessment.versionId,
        expected_version: assessment.version, expected_content_hash: assessment.contentHash,
        ...readFields(data), reason: String(data.get("reason") ?? "") }, key.current);
      else input = parseAbcdAssessmentMutation({ action: "sign_assessment", client_id: assessment.clientId,
        assessment_key: assessment.assessmentKey, assessment_type: assessment.assessmentType,
        assessment_year: assessment.assessmentYear, previous_version_id: assessment.versionId,
        expected_version: assessment.version, expected_content_hash: assessment.contentHash }, key.current);
      const receipt = await send(input, operation, organizationId, branchId);
      key.current = null; failed.current = false;
      setState({ kind: "success", text: `${operation === "sign" ? "人工候選評估已簽署" : "新版本已建立"}（v${receipt.version}）。` });
      router.refresh();
    } catch (error) { failed.current = true; setState({ kind: "error", text: resultUnknown(error) }); }
  }
  return <details className={styles.rowAction}><summary>候選紀錄操作</summary><form onInput={changed} onSubmit={submit}>
    <fieldset className={styles.formGrid} disabled={state.kind === "working" || (recentRequired && !hasRecentAal2)}>
      <label><span>操作</span><select value={operation} onChange={(event) => {
        setOperation(event.target.value as ExistingOperation); changed(); }}>
        {available.map((item) => <option key={item} value={item}>{item === "revise" ? "修訂草稿" :
          item === "sign" ? "簽署人工候選紀錄" : "建立有理由更正版"}</option>)}</select></label>
      {contentAction ? <CandidateFields fixedIdentity initial={assessment} /> : null}
      {contentAction ? <label className={styles.wide}><span>{operation === "correct" ? "更正理由（至少 8 字）" : "修訂理由"}</span>
        <textarea maxLength={1000} minLength={operation === "correct" ? 8 : 1} name="reason" required rows={3} /></label> : null}
      {operation === "sign" ? <p className={styles.wide}><strong>簽署確認：</strong>我確認這是人工、非標準化候選紀錄；
        系統未套用正式題本、公式、分數、診斷、自動複評或照顧決策，並同意以目前版本及內容指紋建立不可變簽署證據。</p> : null}
      <button className="button button--primary"
        disabled={state.kind === "working" || (recentRequired && !hasRecentAal2)}
        type="submit">鎖定版本並送出</button>
    </fieldset>{recentRequired && !hasRecentAal2 ? <p className={styles.reauth}>簽署與更正需同一工作階段最近 15 分鐘 AAL2。 <Link href="/mfa?audience=staff">重新驗證</Link></p> : null}
    {state.kind !== "idle" ? <p className={state.kind === "error" ? styles.error : styles.message}
      role="status">{state.text}</p> : null}</form></details>;
}
