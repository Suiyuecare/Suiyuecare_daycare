"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { lifecycleInputSchema, parseLifecycleReadResponse, parseLifecycleWriteResponse, pendingRetirement, type LifecycleHistory, type LifecycleInput } from "@/lib/form-governance/lifecycle";
import type { FormGovernanceVersion } from "@/lib/form-governance/types";
import { IntegrationError } from "@/lib/integrations/errors";
import { parseFormPublicationActionError } from "@/lib/form-governance/parser";
import { useCoreDraftGuard } from "@/components/core-care/client-continuation";
import { tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";
import styles from "./custom-form-draft-editor.module.css";

const labels = { clone: "複製成下一版草稿", request_retirement: "送出停用申請", approve_retirement: "核准停用", reject_retirement: "退回停用申請" };
const nonCommits = new Set(["FORM_LIFECYCLE_DENIED", "FORM_LIFECYCLE_INVALID", "FORM_LIFECYCLE_CONFLICT", "INVALID_FORM_LIFECYCLE", "CUSTOM_FORM_NOT_AUTHORIZED", "AUTH_REQUIRED", "AAL2_REQUIRED", "BRANCH_CONTEXT_REQUIRED", "DEMO_READ_ONLY", "INVALID_JSON", "REQUEST_TOO_LARGE"]);
export function FormLifecycleAction({ version, instance, enabled, disabledReason }: { version: FormGovernanceVersion; instance: "desktop" | "mobile"; enabled: boolean; disabledReason?: string }) {
  const router = useRouter(); const dialog = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLButtonElement>(null);
  const guard = useCoreDraftGuard();
  const lock = useRef(false); const mounted = useRef(true); const attempt = useRef<{ input: LifecycleInput; key: string; ambiguous: boolean } | null>(null);
  const operationLease = useRef<(() => void) | null>(null); const viewLease = useRef<(() => void) | null>(null);
  const [history, setHistory] = useState<LifecycleHistory | null>(null); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState(""); const [uncertain, setUncertain] = useState(false); const [completed, setCompleted] = useState(false);
  const heading = `lifecycle-${instance}-${version.id}`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (!attempt.current) { operationLease.current?.(); operationLease.current = null; } viewLease.current?.(); viewLease.current = null; }; }, []);
  function releaseKnown() { operationLease.current?.(); operationLease.current = null; attempt.current = null; guard.finish(); }
  async function load() {
    if (lock.current || attempt.current) return;
    const lease = tryAcquireViewTransition(); if (!lease) { setError("另有操作尚待確認，請完成後再讀取版本歷程。"); return; }
    viewLease.current = lease; lock.current = true; setBusy(true); setError(null);
    try {
      const response = await fetchWithTimeout(`/api/forms/lifecycle?version=${version.id}`, { cache: "no-store" });
      if (!response.ok) throw new Error("版本歷程暫時無法載入，請重試。");
      const result = parseLifecycleReadResponse(await response.json(), version.id);
      if (mounted.current) setHistory(result);
    } catch { if (mounted.current) setError("版本歷程暫時無法載入，請重試；未載入前不會送出操作。"); }
    finally { viewLease.current?.(); viewLease.current = null; lock.current = false; if (mounted.current) setBusy(false); }
  }
  function open() { if (!enabled || lock.current || attempt.current) return; setHistory(null); setCompleted(false); setNotice(null); setReason(""); dialog.current?.showModal(); void load(); }
  function close() { if (!lock.current && !attempt.current && guard.discard()) { dialog.current?.close(); trigger.current?.focus(); } }
  const pending = history ? pendingRetirement(history.events) : undefined;
  async function write(action: LifecycleInput["action"]) {
    if (!enabled || lock.current || completed || !history || history.truncated) return;
    if (!attempt.current) {
      const parsed = lifecycleInputSchema.safeParse({ action, formVersionId: version.id, requestId: action === "approve_retirement" || action === "reject_retirement" ? pending?.id ?? null : null, reason });
      if (!parsed.success) { setError("請填寫至少五字的原因，再確認操作。"); return; }
      const lease = tryAcquirePendingOperation(); if (!lease) { setError("畫面正在更新或切換分支，請稍候再操作。"); return; }
      operationLease.current = lease;
      try { attempt.current = { input: parsed.data, key: crypto.randomUUID(), ambiguous: false }; }
      catch { releaseKnown(); setError("尚未送出操作，請重新確認。"); return; }
      guard.begin();
    }
    const operation = attempt.current; lock.current = true; setBusy(true); setError(null);
    try {
      const response = await fetchWithTimeout("/api/forms/lifecycle", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": operation.key }, body: JSON.stringify(operation.input) });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const known = parseFormPublicationActionError(payload);
        if (!operation.ambiguous && known && nonCommits.has(known.errors[0]!.code) && [400, 401, 403, 409, 413].includes(response.status)) {
          releaseKnown();
          throw new IntegrationError("FORM_LIFECYCLE_REJECTED", "操作未通過驗證；請確認權限、第二人資格或重新載入最新歷程。", response.status);
        }
        throw new Error("unknown");
      }
      const receipt = parseLifecycleWriteResponse(payload, operation.input, response.status);
      releaseKnown(); guard.saved();
      if (mounted.current) {
        setUncertain(false); setCompleted(true);
        setHistory(old => old ? { ...old, events: [receipt.event, ...old.events.filter(e => e.id !== receipt.event.id)], total: old.total + (old.events.some(e => e.id === receipt.event.id) ? 0 : 1) } : old);
        setNotice(operation.input.action === "clone" ? "下一版草稿已建立。關閉後可在版本清單編輯欄位與生效日；舊版未改動。" : operation.input.action === "request_retirement" ? "已送交另一位管理員覆核，目前仍可使用原表單。" : operation.input.action === "approve_retirement" ? "已停止新增此版本的填答，既有紀錄仍可查閱、續填與更正；替代版本最早明日生效。" : "已退回停用申請，原版本仍可使用。");
        router.refresh();
      }
    } catch (caught) {
      if (attempt.current) { attempt.current.ambiguous = true; if (mounted.current) setUncertain(true); }
      if (mounted.current) setError(caught instanceof IntegrationError && caught.code === "FORM_LIFECYCLE_REJECTED" ? caught.message : "操作結果尚未確認。請勿離開，直接按「以原操作重試」；不會產生第二筆操作。");
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  const blocked = busy || uncertain || completed || !history || history.truncated;
  return <>
    <button className="button button--secondary" type="button" ref={trigger} disabled={!enabled} title={disabledReason} onClick={open}>改版／停用歷程</button>
    <dialog className={`drawer ${styles.dialog}`} ref={dialog} aria-labelledby={heading} onCancel={event => { if (lock.current || attempt.current || !guard.discard()) event.preventDefault(); }} onClose={() => trigger.current?.focus()}>
      <header className="drawer__header"><h2 id={heading}>{version.name} v{version.version}：改版與停用</h2><button className="button button--quiet" type="button" disabled={busy || uncertain} onClick={close}>關閉</button></header>
      <div className={`drawer__body ${styles.body}`}>
        <p>改版保留原名稱與類型，新增一份獨立草稿供您修改欄位。舊版與已填紀錄不會改寫。</p>
        <p>這是全機構共用表單，歷程會標示提出操作的分支。停用須由另一位具權限管理員覆核；核准後全機構立即停止新增填答。原發布日期不改寫，替代版本最早可從核准次日開始。</p>
        {busy ? <p role="status">正在確認版本操作…</p> : null}
        {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
        {!history && !busy ? <button className="button button--secondary" type="button" onClick={() => void load()}>重試載入歷程</button> : null}
        {history?.truncated ? <p role="alert">歷程超過 100 筆，目前未完整載入；操作暫停，請聯絡管理員核對。</p> : null}
        <fieldset className={styles.fields} disabled={blocked}><legend>本次操作原因</legend><label>原因（至少五字）<textarea rows={3} maxLength={1000} value={reason} onChange={event => { if (blocked || lock.current || attempt.current) return; setReason(event.target.value); guard.changed(); }} /></label>
          <button className="button button--secondary" type="button" onClick={() => void write("clone")}>複製成下一版草稿</button>
          {version.status === "published" && !pending ? <button className="button button--secondary" type="button" onClick={() => void write("request_retirement")}>送出停用申請</button> : null}
          {pending ? <><p>待覆核原因：{pending.reason}</p>{pending.byCurrentUser ? <p>這是您提出的申請，請由另一位管理員覆核。</p> : <><button className="button" type="button" onClick={() => void write("approve_retirement")}>核准停用</button><button className="button button--secondary" type="button" onClick={() => void write("reject_retirement")}>退回停用申請</button></>}</> : null}
        </fieldset>
        {uncertain ? <button className="button" type="button" disabled={busy} onClick={() => { if (attempt.current) void write(attempt.current.input.action); }}>以原操作重試</button> : null}
        <section aria-label="改版與停用歷程"><h3>操作歷程</h3>{history?.events.length ? <ol>{history.events.map(event => <li key={event.id}><strong>{labels[event.action]}</strong>・{event.branchName}・{event.byCurrentUser ? "本人" : "另一位授權管理員"}・{new Date(event.createdAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}<p>{event.reason}</p>{event.effectiveThrough ? <p>最後涵蓋日：{event.effectiveThrough}；替代版本不得與此日重疊。</p> : null}</li>)}</ol> : history ? <p>尚無改版或停用紀錄。</p> : null}</section>
      </div>
    </dialog>
  </>;
}
