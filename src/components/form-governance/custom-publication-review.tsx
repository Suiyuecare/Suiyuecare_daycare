"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { useCoreDraftGuard } from "@/components/core-care/client-continuation";
import { tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";
import type { CustomDraftPayload } from "@/lib/form-governance/custom-draft";
import { parseFormPublicationActionError } from "@/lib/form-governance/parser";
import { hasPublicationDraftChanges, parsePublicationReviewReadResponse, parsePublicationReviewWriteResponse, publicationReviewInputSchema, type PublicationReviewHistory, type PublicationReviewInput } from "@/lib/form-governance/publication-review";
import type { FormGovernanceVersion } from "@/lib/form-governance/types";
import styles from "./custom-form-draft-editor.module.css";

const statuses = { pending: "待第二人覆核", approved: "已核准發布", withdrawn: "申請人已撤回", returned: "已退回修改" };
const labels = { request: "送出覆核", approve: "核准並發布", withdraw: "撤回並修改", return: "退回修改" };
const knownNonCommits = new Set(["PUBLICATION_REVIEW_DENIED", "PUBLICATION_REVIEW_INVALID", "PUBLICATION_REVIEW_CONFLICT", "INVALID_PUBLICATION_REVIEW", "CUSTOM_FORM_NOT_AUTHORIZED", "AUTH_REQUIRED", "AAL2_REQUIRED", "BRANCH_CONTEXT_REQUIRED", "DEMO_READ_ONLY", "INVALID_JSON", "REQUEST_TOO_LARGE"]);
const fieldTypes = { text: "文字", number: "數字", date: "日期", boolean: "是／否", select: "單選" };
const subscribeHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;
function formatDate(value: string) { return new Date(value).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }); }

export function CustomPublicationFields({ payload }: { payload: CustomDraftPayload }) {
  return <section aria-label="完整欄位審閱">
    <h3>{payload.name}：實際欄位與限制</h3>
    <p>{payload.category}・{payload.effectiveFrom ?? "尚未設定生效日"} ～ {payload.effectiveTo ?? "持續有效"}。不含自動計分公式。</p>
    <ol className={styles.reviewFields}>{payload.schema.fields.map(field => <li key={field.key}>
      <strong>{field.label}</strong><span>{field.required ? "必填" : "選填"}・{fieldTypes[field.type]}</span>
      {field.type === "text" ? <p>最多 {field.maxLength} 字</p> : field.type === "number" ? <p>範圍：{field.minimum} ～ {field.maximum}</p> : field.type === "select" ? <p>可選：{field.options.join("、")}</p> : field.type === "date" ? <p>使用有效西元日期</p> : <p>選擇「是」或「否」；未填不等於「否」</p>}
      <small>欄位代碼：{field.key}</small>
    </li>)}</ol>
  </section>;
}

export function CustomPublicationReview({ version, instance, enabled, canAct, disabledReason, demoHistory }: {
  version: FormGovernanceVersion; instance: "desktop" | "mobile"; enabled: boolean; canAct: boolean; disabledReason?: string; demoHistory?: PublicationReviewHistory | null;
}) {
  const router = useRouter(); const dialog = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLButtonElement>(null);
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated);
  const guard = useCoreDraftGuard(); const mounted = useRef(true); const lock = useRef(false);
  const operationLease = useRef<(() => void) | null>(null); const readLease = useRef<(() => void) | null>(null);
  const attempt = useRef<{ input: PublicationReviewInput; key: string; ambiguous: boolean } | null>(null);
  const [history, setHistory] = useState<PublicationReviewHistory | null>(null); const [selected, setSelected] = useState("draft");
  const [busy, setBusy] = useState(false); const [uncertain, setUncertain] = useState(false); const [completed, setCompleted] = useState(false);
  const [reason, setReason] = useState(""); const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const heading = `publication-review-${instance}-${version.id}`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (!attempt.current) { operationLease.current?.(); operationLease.current = null; } readLease.current?.(); readLease.current = null; }; }, []);
  function releaseKnown() { operationLease.current?.(); operationLease.current = null; attempt.current = null; guard.finish(); }
  async function load() {
    if (lock.current || attempt.current) return;
    const lease = tryAcquireViewTransition(); if (!lease) { setError("另有操作尚待確認，請先完成後再載入審閱內容。"); return; }
    readLease.current = lease; lock.current = true; setBusy(true); setError(null); setHistory(null);
    try {
      if (demoHistory) {
        setHistory(demoHistory); setSelected(demoHistory.currentDraft ? "draft" : demoHistory.requests[0]?.id ?? "draft"); setConfirmed(false); return;
      }
      const response = await fetchWithTimeout(`/api/forms/publications/review?version=${version.id}`, { cache: "no-store" });
      if (!response.ok) throw new Error("read unavailable");
      const next = parsePublicationReviewReadResponse(await response.json(), version.id);
      if (mounted.current) { setHistory(next); setSelected(next.currentDraft ? "draft" : next.requests[0]?.id ?? "draft"); setConfirmed(false); }
    } catch { if (mounted.current) setError("完整欄位與歷程尚未載入，請重試。未確認內容前不會送審或核准。"); }
    finally { readLease.current?.(); readLease.current = null; lock.current = false; if (mounted.current) setBusy(false); }
  }
  function open() { if (!enabled || lock.current || attempt.current) return; setCompleted(false); setNotice(null); setReason(""); setConfirmed(false); dialog.current?.showModal(); void load(); }
  function returnFocus() {
    const visible = Array.from(document.querySelectorAll<HTMLButtonElement>(`button[data-publication-review="${version.id}"]`)).find(button => button.getClientRects().length > 0);
    (visible ?? trigger.current)?.focus();
  }
  function close() { if (!lock.current && !attempt.current && guard.discard()) { dialog.current?.close(); returnFocus(); } }
  const latest = history?.requests[0];
  const pending = latest?.status === "pending" ? latest : null;
  const currentSelection = Boolean(history && selected === (history.currentDraft ? "draft" : latest?.id));
  const payload = selected === "draft" ? history?.currentDraft : history?.requests.find(request => request.id === selected)?.payload;
  const needsEdit = Boolean(latest && ["returned", "withdrawn"].includes(latest.status) && (history!.currentDraftRevision <= latest.baseRevision
    || !hasPublicationDraftChanges(history!.currentDraft, latest.payload)));
  const blocked = !canAct || Boolean(demoHistory) || busy || uncertain || completed || !history || history.truncated || !currentSelection || !confirmed;
  async function write(action: PublicationReviewInput["action"]) {
    if (!enabled || !canAct || demoHistory || lock.current || completed || !history || history.truncated) return;
    if (!attempt.current) {
      if (!currentSelection || !confirmed || (action === "request" && (!history.currentDraft?.effectiveFrom || needsEdit))
        || (action !== "request" && !pending) || (action === "withdraw" && !pending?.requestedByCurrentUser)
        || (["approve", "return"].includes(action) && pending?.requestedByCurrentUser)) return;
      const parsed = publicationReviewInputSchema.safeParse({ action, formVersionId: version.id, requestId: action === "request" ? null : pending?.id ?? null,
        baseRevision: action === "request" ? history.currentDraftRevision : null, reason: action === "withdraw" || action === "return" ? reason : null });
      if (!parsed.success) { setError("請填寫至少五字的撤回或退回原因，再確認操作。"); return; }
      const lease = tryAcquirePendingOperation(); if (!lease) { setError("畫面正在更新或切換分支，請稍候再操作。"); return; }
      operationLease.current = lease;
      try { attempt.current = { input: parsed.data, key: crypto.randomUUID(), ambiguous: false }; }
      catch { releaseKnown(); setError("尚未送出，請重新確認操作。"); return; }
      guard.begin();
    }
    const operation = attempt.current; lock.current = true; setBusy(true); setError(null);
    try {
      const response = await fetchWithTimeout("/api/forms/publications/review", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": operation.key }, body: JSON.stringify(operation.input) });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const failure = parseFormPublicationActionError(body);
        if (!operation.ambiguous && failure && knownNonCommits.has(failure.errors[0]!.code) && [400, 401, 403, 409, 413].includes(response.status)) {
          releaseKnown();
          if (mounted.current) { setError("操作未通過驗證，未變更表單。請關閉後重新載入，確認最新狀態或重新驗證。"); setCompleted(true); }
          return;
        }
        throw new Error("unknown result");
      }
      const receipt = parsePublicationReviewWriteResponse(body, operation.input, response.status);
      if (operation.input.action === "request" && history.requests.some(request => request.id === receipt.event.requestId)) throw new Error("request ID reused");
      const reviewedRequest = history.requests.find(request => request.id === operation.input.requestId);
      if (operation.input.action !== "request" && (!reviewedRequest || receipt.event.formContentHash !== reviewedRequest.formContentHash
        || (operation.input.action === "approve" && receipt.event.branchId !== reviewedRequest.branchId))) throw new Error("unmatched frozen request");
      releaseKnown(); guard.saved();
      if (mounted.current) {
        setUncertain(false); setCompleted(true);
        setNotice(operation.input.action === "request"
          ? receipt.requestStatus === "pending" ? "本輪送審已保存，請由另一位授權管理員覆核。" : `已確認原送審結果：${statuses[receipt.requestStatus]}。這是原操作回條，沒有新增另一輪申請。`
          : operation.input.action === "approve" ? "已核准並發布；欄位與送審證據不可改寫。"
            : "已保留本輪凍結內容與原因。關閉後請編輯並儲存草稿，再建立全新的送審申請。");
        router.refresh();
      }
    } catch {
      if (attempt.current) { attempt.current.ambiguous = true; if (mounted.current) setUncertain(true); }
      if (mounted.current) setError("操作結果尚未確認。請勿離開，按「以原操作重試」；會沿用原內容與識別碼，不會重複送審。");
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return <>
    <button className="button button--secondary" type="button" ref={trigger} data-publication-review={version.id} disabled={!enabled} title={disabledReason} onClick={open}>審閱欄位／送審歷程</button>
    {hydrated ? createPortal(<dialog className={`drawer ${styles.dialog}`} ref={dialog} aria-labelledby={heading}
      onCancel={event => { if (lock.current || attempt.current || !guard.discard()) event.preventDefault(); }} onClose={returnFocus}>
      <header className="drawer__header"><h2 id={heading}>{version.name} v{version.version}：審閱與送審</h2><button className="button button--quiet" type="button" disabled={busy || uncertain} onClick={close}>關閉</button></header>
      <div className={`drawer__body ${styles.body}`}>
        <p>請逐項核對實際欄位與生效日。送審後固定本輪內容；撤回或退回不刪除歷史，儲存修改後才能重新送審。申請人不能核准或退回自己的申請。</p>
        {demoHistory ? <p className="callout" role="status">合成展示・僅供審閱：內容、人物與歷程均為測試範例，不會讀取或寫入正式資料。</p> : null}
        {busy ? <p role="status">正在確認完整內容…</p> : null}
        {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
        {!history && !busy ? <button className="button button--secondary" type="button" onClick={() => void load()}>重試載入審閱</button> : null}
        {history?.truncated ? <p role="alert">歷次送審超過 100 筆，未完整載入；送審與決定暫停，請聯絡管理員核對。</p> : null}
        {history ? <>
          <div className={styles.fields}><label>審閱內容<select disabled={busy || uncertain || completed} value={selected} onChange={event => { if (lock.current || attempt.current) return; setSelected(event.target.value); setConfirmed(false); }}>
            {history.currentDraft ? <option value="draft">目前已儲存草稿・修訂 {history.currentDraftRevision}</option> : null}
            {history.requests.map(request => <option key={request.id} value={request.id}>{statuses[request.status]}・修訂 {request.baseRevision}・{formatDate(request.requestedAt)}</option>)}
          </select></label></div>
          {payload ? <><p>{selected === "draft" ? "目前已儲存內容；送審會再次核對修訂號。" : "此為當時送審的凍結內容，不會被後來修改取代。"}</p><CustomPublicationFields payload={payload} /></> : <p role="alert">沒有可確認的內容，操作停用。</p>}
          {!currentSelection ? <p role="status">正在查看舊輪次，只供核對。切回最新內容才能操作。</p> : null}
          {needsEdit ? <p role="status">本輪已撤回或退回；請先關閉、編輯並儲存草稿，再重新送審。需實際修改欄位或日期，僅儲存相同內容不算修改。</p> : null}
          {history.currentDraft && !history.currentDraft.effectiveFrom ? <p role="status">草稿缺少生效日，請先編輯並儲存。</p> : null}
          {!canAct && !demoHistory ? <p role="status">本頁沿用既有雙因素工作階段，僅閱覽不需再次驗證；送審、核准、撤回或退回前，須有最近 15 分鐘內的本人驗證。<Link href="/mfa?audience=staff&purpose=sensitive-action">前往重新驗證</Link></p> : null}
          <fieldset className={styles.fields} disabled={busy || uncertain || completed || !canAct || Boolean(demoHistory) || history.truncated || !currentSelection}>
            <legend>確認本輪處理</legend>
            <label className={styles.checkbox}><input type="checkbox" checked={confirmed} onChange={event => { if (lock.current || attempt.current) return; setConfirmed(event.target.checked); }} />我已核對本輪實際欄位、生效日與申請狀態</label>
            {pending ? <label>撤回／退回原因（至少五字）<textarea rows={3} maxLength={1000} value={reason} onChange={event => { if (lock.current || attempt.current) return; setReason(event.target.value); guard.changed(); }} /></label> : null}
            <div className={styles.reviewActions}>
              {history.currentDraft ? <button className="button button--primary" type="button" disabled={blocked || needsEdit || !history.currentDraft.effectiveFrom} onClick={() => void write("request")}>{latest ? "重新送出覆核" : "送出覆核"}</button> : null}
              {pending?.requestedByCurrentUser ? <><p>您是申請人，只能撤回；核准及退回須由另一人處理。</p><button className="button button--secondary" type="button" disabled={blocked} onClick={() => void write("withdraw")}>撤回並修改</button></> : pending ? <><button className="button button--primary" type="button" disabled={blocked} onClick={() => void write("approve")}>核准並發布</button><button className="button button--secondary" type="button" disabled={blocked} onClick={() => void write("return")}>退回修改</button></> : null}
            </div>
          </fieldset>
          {uncertain ? <div className={styles.reviewActions}>
            <p>請保留本視窗。如果驗證已逾期，可另開視窗以相同帳號完成驗證，再回來按原操作重試；這裡不會清除內容或改用新的操作識別碼。</p>
            <a className="button button--secondary" href="/mfa?audience=staff&purpose=sensitive-action" target="_blank" rel="noopener noreferrer">另開視窗重新驗證</a>
            <button className="button button--primary" type="button" disabled={busy} onClick={() => { if (attempt.current) void write(attempt.current.input.action); }}>以原操作重試</button>
          </div> : null}
          <details><summary className={styles.reviewSummary}>歷次送審與處理原因（{history.total} 輪）</summary>{history.requests.length ? <ol>{history.requests.map(request => <li key={request.id}>
            <strong>{statuses[request.status]}・修訂 {request.baseRevision}</strong><p>{request.branchName}・{request.requestedByCurrentUser ? "本人送審" : "另一位授權管理員送審"}・{formatDate(request.requestedAt)}</p>
            <ul>{request.events.map(event => <li key={event.id}>{labels[event.action]}・{event.byCurrentUser ? "本人" : "另一位授權管理員"}・{formatDate(event.createdAt)}{event.reason ? <p>原因：{event.reason}</p> : null}</li>)}</ul>
          </li>)}</ol> : <p>尚未送審。</p>}</details>
        </> : null}
      </div>
    </dialog>, document.body) : null}
  </>;
}
