"use client";

import { CheckCircle2, Send, ShieldCheck, Undo2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { assessmentFormHref } from "@/lib/assessment-matrix/config";
import { useScopeChangeDraftRegistration } from "@/lib/navigation/scope-change-pending";
import { readQuestionnaireMutationReceipt } from "@/lib/questionnaire-assessments/receipt";
import type { QuestionnaireDraft, QuestionnaireFormKey } from "@/lib/questionnaire-assessments/types";
import styles from "./questionnaire-assessments.module.css";

export function QuestionnaireLifecycleActions({ record, clientId, formKey, canManage, canSign, complete, dirty, safetyConcern, draftOnly = false, siblingBlocked = false, onDirtyChange, onWriteGuardChange }: {
  record: QuestionnaireDraft; clientId: string; formKey: QuestionnaireFormKey; canManage: boolean; canSign: boolean;
  complete: boolean; dirty: boolean; safetyConcern: boolean; draftOnly?: boolean; siblingBlocked?: boolean; onDirtyChange?: (dirty: boolean) => void; onWriteGuardChange: (busy: boolean, unknown: boolean) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false); const [unknown, setUnknown] = useState(false);
  const [message, setMessage] = useState(""); const [reason, setReason] = useState("");
  const [followUp, setFollowUp] = useState(record.followUpDueOn ?? ""); const [safety, setSafety] = useState(false);
  const state = record.recordState ?? "draft";
  const currentDraft = JSON.stringify(state === "draft" ? { followUp, safety } : { reason });
  const [savedDraft, setSavedDraft] = useState(currentDraft);
  const lifecycleDirty = currentDraft !== savedDraft;
  const locked = busy || unknown || siblingBlocked;
  const operation = useRef<{ key: string; body: string; action: "submit" | "sign" | "return" | "correct" } | null>(null);
  const register = useScopeChangeDraftRegistration();
  useLayoutEffect(() => { onWriteGuardChange(busy, unknown); register({ dirty: dirty || lifecycleDirty, busy, unknown }); }, [busy, unknown, dirty, lifecycleDirty, register, onWriteGuardChange]);
  useEffect(() => { onDirtyChange?.(lifecycleDirty); }, [lifecycleDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => () => onWriteGuardChange(false, false), [onWriteGuardChange]);
  if (record.isLatest === false) return <p className={styles.readOnly}>歷史版本，僅供查閱。請從歷史清單開啟最新版本。</p>;

  async function transition(action?: "submit" | "sign" | "return" | "correct") {
    if (draftOnly || siblingBlocked || busy || (!action && !operation.current)) return;
    if (!operation.current) {
      if (action === "sign" && lifecycleDirty) { setMessage("退回原因尚未送出；請先退回補正或清除未送出內容，再簽署。"); return; }
      if ((action === "correct" || action === "return") && !reason.trim()) { setMessage("請填寫更正／退回原因。"); return; }
      if (action === "submit" && (dirty || !complete || (safetyConcern && !safety))) { setMessage("請先保存完整答案，並確認安全提醒。"); return; }
      operation.current = { key: crypto.randomUUID(), action: action!, body: JSON.stringify({ action, clientId, formKey,
        assessmentKey: record.assessmentKey, previousVersionId: record.versionId, expectedVersion: record.version,
        ...(["correct", "return"].includes(action!) ? { reason: reason.trim() } : {}),
        ...(action === "submit" && followUp ? { followUpDueOn: followUp } : {}),
        ...(action === "submit" && safetyConcern ? { safetyAcknowledged: safety } : {}),
      }) };
    }
    const current = operation.current;
    setBusy(true); onWriteGuardChange(true, unknown); setMessage("");
    try {
      const response = await fetchWithTimeout(`/api/questionnaire-assessments?form_key=${formKey}`, {
        method: "POST", headers: { "content-type": "application/json", "idempotency-key": current.key }, body: current.body,
      });
      const envelope = await response.json();
      if (!response.ok) {
        const rejected = response.status >= 400 && response.status < 500 && ![408, 409, 429].includes(response.status) && envelope.status === "error" && !unknown;
        if (rejected) { operation.current = null; setUnknown(false); } else setUnknown(true);
        setMessage(envelope.errors?.[0]?.message ?? "操作未完成，請保留畫面重試。"); return;
      }
      const receipt = readQuestionnaireMutationReceipt(envelope.data, { action: current.action, clientId, formKey,
        assessmentKey: record.assessmentKey, expectedVersion: record.version, previousVersionId: record.versionId,
        assessedOn: record.assessedOn, contentHash: record.contentHash });
      if (envelope.status !== "ok" || !receipt) throw new Error("invalid receipt");
      operation.current = null; setUnknown(false); onWriteGuardChange(false, false);
      setSavedDraft(currentDraft);
      const url = new URL(window.location.href); url.searchParams.set("version", receipt.versionId); url.searchParams.delete("new");
      router.replace(`${url.pathname}${url.search}`); router.refresh();
      setMessage(receipt.recordState === "signed" ? "已簽署保存。" : receipt.recordState === "submitted" ? "已送審，等待簽署。" : "已建立更正／退回草稿。");
    } catch { setUnknown(true); setMessage("結果尚未確認，請重試同一次操作。"); }
    finally { setBusy(false); }
  }

  return <section className={styles.questionCard} aria-label="評估作業狀態">
    <h3>{state === "signed" ? <CheckCircle2 aria-hidden="true" size={20} /> : <ShieldCheck aria-hidden="true" size={20} />} {state === "signed" ? "已簽署" : state === "submitted" ? "待簽署" : "草稿"}</h3>
    {draftOnly ? <p>待收案 · 可保存草稿，確認收案後再送審。</p> : null}
    {lifecycleDirty && !locked ? <button className="button button--secondary" type="button" onClick={() => {
      setReason(""); setFollowUp(record.followUpDueOn ?? ""); setSafety(false);
    }}>清除未送出的送審／補正內容</button> : null}
    {state === "draft" && canManage && !draftOnly ? <>
      <label>複評日期（選填）<input disabled={locked} min={record.assessedOn} type="date" value={followUp} onChange={(event) => setFollowUp(event.currentTarget.value)} /></label>
      {safetyConcern ? <label><input checked={safety} disabled={locked} onChange={(event) => setSafety(event.currentTarget.checked)} type="checkbox" />已由授權人員確認並依安全流程處置</label> : null}
      <button className="button button--primary" disabled={locked || dirty || !complete || (safetyConcern && !safety)} onClick={() => void transition("submit")} type="button"><Send aria-hidden="true" size={18} /> 送審</button>
      {dirty ? <p>先保存修改，再送審。</p> : !complete ? <p>待答項目完成後可送審。</p> : null}
    </> : null}
    {state === "submitted" && !draftOnly ? <>
      {!record.ruleAvailable ? <p>已保存完整評估，待治理頁完成規則發布後簽署。</p> : null}
      {canSign ? <button className="button button--primary" disabled={locked || lifecycleDirty || !record.ruleAvailable} onClick={() => void transition("sign")} type="button"><ShieldCheck aria-hidden="true" size={18} /> 確認內容並簽署</button> : <p>等待有簽署權限的人員覆核。</p>}
      {lifecycleDirty ? <p>退回原因尚未送出；請先退回補正或清除未送出內容，再簽署。</p> : null}
    </> : null}
    {state === "signed" ? <><p>{record.signerDisplayName} · {record.signedAt ? new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "short", timeStyle: "short" }).format(new Date(record.signedAt)) : ""}</p>
      {record.resultSnapshot ? <strong>{record.resultSnapshot.status === "complete" ? `${record.resultSnapshot.adjusted} ${record.resultSnapshot.unit} · ${record.resultSnapshot.classification?.label ?? "已記錄"}` : "包含不適用項目，不計完整總分"}</strong> : null}
      {record.followUpDueOn ? <p>複評：{record.followUpDueOn}</p> : null}
    </> : null}
    {canSign && state !== "draft" && !draftOnly ? <details><summary>{state === "signed" ? "建立更正版" : "退回補正"}</summary>
      <label>原因<textarea disabled={locked} maxLength={500} value={reason} onChange={(event) => setReason(event.currentTarget.value)} /></label>
      <button className="button button--secondary" disabled={locked || !reason.trim()} onClick={() => void transition(state === "signed" ? "correct" : "return")} type="button"><Undo2 aria-hidden="true" size={18} />{state === "signed" ? "建立更正草稿" : "退回補正"}</button>
    </details> : null}
    {canSign && state !== "draft" && !draftOnly ? <a className="button button--secondary" href={`/auth/mfa?next=${encodeURIComponent(assessmentFormHref(formKey, clientId, undefined, record.versionId) ?? "/app")}`} target="_blank" rel="noopener noreferrer">在新分頁完成近期驗證</a> : null}
    {unknown && canSign && state !== "draft" && !draftOnly ? <p>保留原頁，在新分頁完成驗證後返回，重試同一次操作。</p> : null}
    {unknown ? <button className="button button--primary" disabled={busy || siblingBlocked} type="button" onClick={() => void transition()}>重試同一次操作</button> : null}
    {message ? <p role="status" aria-live="polite">{message}</p> : null}
  </section>;
}
