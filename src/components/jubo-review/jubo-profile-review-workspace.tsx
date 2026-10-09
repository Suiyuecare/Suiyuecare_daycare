"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Clock3, FileSearch, RotateCcw, ShieldCheck } from "lucide-react";
import { useCoreDraftGuard } from "@/components/app/core-draft-guard";

import {
  juboReviewPreviewSchema, juboReviewQueueSchema, juboReviewReceiptLookupSchema, juboReviewReceiptSchema,
  type JuboReviewPreview, type JuboReviewQueue, type JuboReviewRequest,
} from "@/lib/jubo-review/model";
import { tryAcquirePendingOperation } from "@/lib/navigation/pending-operation-lock";

import styles from "./jubo-profile-review.module.css";

type Decision = JuboReviewRequest["decision"];
type ApiError = { code?: string; message?: string };
type ReviewAttempt = { request: JuboReviewRequest; sourceSheetRow: number; expiresAt: string; reviewVersion: number; ambiguous: boolean };

class ReviewHttpError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) { super(message); }
}

const knownNonCommitCodes = new Set([
  "AUTH_REQUIRED", "JUBO_REAUTH_REQUIRED", "JUBO_REVIEW_DENIED", "JUBO_REVIEW_INVALID",
  "JUBO_REVIEW_ORIGIN_DENIED", "JUBO_REVIEW_JSON_REQUIRED",
]);

const queueUrl = "/api/jubo-profile-review/queue";
const previewUrl = "/api/jubo-profile-review/preview";
const decisionUrl = "/api/jubo-profile-review/decision";
const receiptUrl = "/api/jubo-profile-review/receipt";
const sensitiveHeaders = { "Content-Type": "application/json" };
const decisionLabels: Record<string, string> = {
  unreviewed: "待覆核", approved: "已核准", held: "暫緩", rejected: "退回", stale: "來源已變更",
};
const columns: Array<{ key: keyof JuboReviewPreview["originalMappedValues"]; label: string; display: (profile: JuboReviewPreview["displayProfile"]) => string | number | null }> = [
  { key: "displayName", label: "姓名", display: (p) => p.displayName },
  { key: "sex", label: "性別", display: (p) => ({ male: "男", female: "女", other: "其他", unknown: "未確認" })[p.sex] },
  { key: "dateOfBirth", label: "出生日期", display: (p) => p.dateOfBirth },
  { key: "identityNumber", label: "身分證字號", display: (p) => p.identityNumber },
  { key: "registeredAddress", label: "戶籍地址", display: (p) => p.registeredAddress },
  { key: "residentialAddress", label: "居住地址", display: (p) => p.residentialAddress },
  { key: "cmsLevel", label: "CMS 等級", display: (p) => p.cmsLevel },
  { key: "disability", label: "身障註記", display: (p) => p.disability },
  { key: "primaryContactName", label: "主要聯絡人", display: (p) => p.contacts.find((c) => c.isPrimary)?.name ?? null },
  { key: "primaryContactPhone", label: "聯絡電話", display: (p) => p.contacts.find((c) => c.isPrimary)?.phone ?? null },
  { key: "proxyName", label: "代理人", display: (p) => p.contacts.find((c) => !c.isPrimary)?.name ?? null },
  { key: "proxyPhone", label: "代理電話", display: (p) => p.contacts.find((c) => !c.isPrimary)?.phone ?? null },
];

function timestamp(value: string) {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function cellValue(value: string | number | null) {
  return value === null || value === "" ? "未提供" : String(value);
}

async function privateJson(url: string, body?: object, signal?: AbortSignal) {
  const deadline = AbortSignal.timeout(url === decisionUrl ? 25_000 : 15_000);
  const response = await fetch(url, {
    method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
    headers: body ? sensitiveHeaders : undefined, body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
  });
  // The response is kept in component memory only; never put private fields in URLs or storage.
  const envelope: unknown = await response.json();
  if (!envelope || typeof envelope !== "object") throw new Error("INVALID_RESPONSE");
  const record = envelope as { status?: unknown; data?: unknown; errors?: ApiError[] };
  if (!response.ok || record.status !== "ok") {
    const first = Array.isArray(record.errors) ? record.errors[0] : undefined;
    throw new ReviewHttpError(first?.code === "JUBO_REAUTH_REQUIRED"
      ? "重新驗證已逾時；驗證後再載入。"
      : typeof first?.message === "string" ? first.message : "暫時無法載入；請稍後重試。",
    typeof first?.code === "string" ? first.code : "UNKNOWN", response.status);
  }
  return record.data;
}

function safeError(cause: unknown, fallback: string) {
  if (!(cause instanceof Error) || cause.name === "AbortError" || cause.name === "TimeoutError" || cause.message === "INVALID_RESPONSE") return fallback;
  return cause.message;
}

export function JuboProfileReviewWorkspace({ branchName, recentAal2 }: { branchName: string; recentAal2: boolean }) {
  const reviewDraftGuard = useCoreDraftGuard();
  const [queue, setQueue] = useState<JuboReviewQueue | null>(null);
  const [selectedPairId, setSelectedPairId] = useState("");
  const [selectedRowId, setSelectedRowId] = useState("");
  const [preview, setPreview] = useState<JuboReviewPreview | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decision, setDecision] = useState<Decision>("held");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [attemptExpiry, setAttemptExpiry] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const previewController = useRef<AbortController | null>(null);
  const queueController = useRef<AbortController | null>(null);
  const uncertainSource = useRef<{ pairId: string; sourceRowId: string; reviewVersion: number } | null>(null);
  const attempt = useRef<ReviewAttempt | null>(null);
  const sending = useRef(false);
  // This lease is deliberately kept across uncertain results and unmounts.
  // AppShell branch changes, logout and reload must not make a second write look safe.
  const operationLease = useRef<(() => void) | null>(null);
  function releaseKnownAttempt() {
    operationLease.current?.(); operationLease.current = null;
    attempt.current = null; uncertainSource.current = null;
    setAttemptExpiry(null);
  }

  const loadQueue = useCallback(async () => {
    queueController.current?.abort();
    const controller = new AbortController(); queueController.current = controller;
    previewController.current?.abort();
    setPreview(null); setSelectedRowId(""); setError(""); setQueueBusy(true);
    try {
      const parsed = juboReviewQueueSchema.safeParse(await privateJson(queueUrl, undefined, controller.signal));
      if (!parsed.success) throw new Error("清單格式未通過核對，請聯絡管理員。");
      setQueue(parsed.data);
      setSelectedPairId((previous) => parsed.data.pairs.some((pair) => pair.pairId === previous)
        ? previous : parsed.data.pairs[0]?.pairId ?? "");
      const pending = uncertainSource.current;
      if (pending) {
        const latest = parsed.data.pairs.find((pair) => pair.pairId === pending.pairId)
          ?.sourceRows.find((row) => row.sourceRowId === pending.sourceRowId);
        setUncertain(true);
        if (latest && latest.reviewVersion > pending.reviewVersion)
          setError(`第 ${latest.sourceSheetRow} 列已有新版本 v${latest.reviewVersion}，但尚未證明是本次操作；請以原操作核對。`);
        else setError("尚未確認原送出結果。請以原操作核對，暫勿建立新一次覆核。");
      } else setUncertain(false);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setQueue(null); setError(safeError(cause, "清單暫時無法載入，請重試。"));
      }
    } finally { if (!controller.signal.aborted) setQueueBusy(false); }
  }, []);

  useEffect(() => {
    const timer = recentAal2 ? window.setTimeout(() => void loadQueue(), 0) : null;
    return () => { if (timer !== null) window.clearTimeout(timer);
      queueController.current?.abort(); previewController.current?.abort(); };
  }, [loadQueue, recentAal2]);

  useEffect(() => {
    if (!preview && !uncertain) return;
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, [preview, uncertain]);

  const selectedPair = queue?.pairs.find((pair) => pair.pairId === selectedPairId);
  const selectedRow = selectedPair?.sourceRows.find((row) => row.sourceRowId === selectedRowId);
  const expires = preview ? Date.parse(preview.expiresAt) <= now : true;
  const hasUnsaved = reason.length > 0 || confirmed || decision !== "held";
  function trackDraft(nextDecision: Decision, nextReason: string, nextConfirmed: boolean) {
    if (nextReason.length > 0 || nextConfirmed || nextDecision !== "held") reviewDraftGuard.changed();
    else reviewDraftGuard.saved();
  }
  function cancelDraft() {
    setReason(""); setConfirmed(false); setDecision("held"); reviewDraftGuard.saved();
  }

  async function selectRow(sourceRowId: string) {
    if (!selectedPair || decisionBusy || uncertain || hasUnsaved) return;
    previewController.current?.abort();
    const controller = new AbortController(); previewController.current = controller;
    setSelectedRowId(sourceRowId); setPreview(null); setError(""); setMessage("");
    setReason(""); setConfirmed(false); setDecision("held"); reviewDraftGuard.saved(); setPreviewBusy(true);
    try {
      const parsed = juboReviewPreviewSchema.safeParse(await privateJson(previewUrl,
        { pairId: selectedPair.pairId, sourceRowId }, controller.signal));
      if (!parsed.success || parsed.data.pairId !== selectedPair.pairId || parsed.data.sourceRowId !== sourceRowId) {
        throw new Error("預覽與來源不一致，請重新讀取。");
      }
      setPreview(parsed.data);
    } catch (cause) {
      if (!controller.signal.aborted) setError(safeError(cause, "此筆暫時無法預覽，請重試。"));
    } finally { if (!controller.signal.aborted) setPreviewBusy(false); }
  }

  async function submitDecision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview || expires || !confirmed || reason.trim().length < 10 || decisionBusy || uncertain || attempt.current) return;
    const lease = tryAcquirePendingOperation();
    if (!lease) { setError("另有操作正在處理，請先確認結果後再覆核。"); return; }
    operationLease.current = lease;
    try {
      attempt.current = { request: {
        pairId: preview.pairId, sourceRowId: preview.sourceRowId, previewId: preview.previewId,
        sourceRowSha256: preview.sourceRowSha256, mappingReviewSha256: preview.mappingReviewSha256,
        previewSha256: preview.previewSha256, decision, reason: reason.trim(),
        idempotencyKey: crypto.randomUUID(),
      }, sourceSheetRow: preview.sourceSheetRow, expiresAt: preview.expiresAt,
      reviewVersion: selectedRow?.reviewVersion ?? 0, ambiguous: false };
      setAttemptExpiry(preview.expiresAt);
    } catch {
      releaseKnownAttempt(); setError("尚未送出，請重新確認後再試。"); return;
    }
    await sendAttempt();
  }

  async function sendAttempt() {
    const current = attempt.current;
    if (!current || sending.current) return;
    sending.current = true;
    setDecisionBusy(true); setError(""); setMessage("");
    try {
      const parsed = juboReviewReceiptSchema.safeParse(await privateJson(decisionUrl, current.request));
      if (!parsed.success || parsed.data.decision !== current.request.decision) throw new Error("回執未能核對；請先查清單狀態。");
      releaseKnownAttempt(); setUncertain(false);
      setReason(""); setConfirmed(false); setDecision("held"); setPreview(null); reviewDraftGuard.saved();
      setMessage(`第 ${current.sourceSheetRow} 列已記錄「${decisionLabels[current.request.decision]}」，審核版本 ${parsed.data.reviewVersion}。`);
      await loadQueue();
    } catch (cause) {
      if (!current.ambiguous && cause instanceof ReviewHttpError && [400, 401, 403, 415].includes(cause.status)
        && knownNonCommitCodes.has(cause.code)) {
        releaseKnownAttempt(); setUncertain(false); setPreview(null); setReason(""); setConfirmed(false); setDecision("held"); reviewDraftGuard.saved();
        setError(`${safeError(cause, "操作未通過驗證。")} 未建立本次覆核，請重新驗證或預覽。`);
        return;
      }
      // A timeout or broken response might have committed. Never create a second attempt automatically.
      current.ambiguous = true;
      uncertainSource.current = { pairId: current.request.pairId, sourceRowId: current.request.sourceRowId,
        reviewVersion: current.reviewVersion };
      setUncertain(true); setPreview(null); setReason(""); setConfirmed(false); setDecision("held");
      setError(`${safeError(cause, "結果尚未確認。")} 請以原操作核對；不要另開新一次覆核。`);
    } finally { sending.current = false; setDecisionBusy(false); }
  }

  async function checkAttemptReceipt() {
    const current = attempt.current;
    if (!current || sending.current) return;
    sending.current = true;
    setDecisionBusy(true); setError("");
    try {
      // This route is read-only. An expired preview or AAL2 must never trigger
      // another call to the write endpoint after an ambiguous first response.
      const parsed = juboReviewReceiptLookupSchema.safeParse(await privateJson(receiptUrl, current.request));
      if (!parsed.success ||
        (parsed.data.status === "found" && parsed.data.receipt.decision !== current.request.decision)) {
        throw new Error("原操作回執未能核對；請聯絡管理員。");
      }
      if (parsed.data.status === "unconfirmed") {
        setError("尚未查到原操作回執；原請求仍可能在處理。請稍後再查，勿重新送出。");
        return;
      }
      releaseKnownAttempt(); setUncertain(false); setPreview(null);
      setQueue(null);
      setMessage(`第 ${current.sourceSheetRow} 列已查到原操作回執：${decisionLabels[current.request.decision]}，審核版本 ${parsed.data.receipt.reviewVersion}。請重新驗證後更新清單。`);
    } catch (cause) {
      setError(`${safeError(cause, "暫時查不到原操作回執。")} 原結果仍未確認；請稍後再查或聯絡管理員。`);
    } finally { sending.current = false; setDecisionBusy(false); }
  }

  function selectPair(pairId: string) {
    if (hasUnsaved || decisionBusy || uncertain) return;
    previewController.current?.abort(); setSelectedPairId(pairId); setSelectedRowId("");
    setPreview(null); setError(""); setMessage(""); reviewDraftGuard.saved();
  }

  return <main className={styles.workspace}>
    <header className={styles.heading}>
      <div><p className="eyebrow">資料移轉 · 人工覆核</p><h1><FileSearch aria-hidden="true" />JUBO 個案主檔</h1>
        <p>{branchName} · 逐筆核對後才可進入下一關；此頁不建立正式個案。</p></div>
      <button className="button button--secondary" onClick={() => void loadQueue()} disabled={queueBusy || decisionBusy || hasUnsaved} type="button">
        <RotateCcw aria-hidden="true" size={18} />核對狀態
      </button>
    </header>

    {!recentAal2 && !queue ? <section className={styles.notice} role="status"><ShieldCheck aria-hidden="true" />
      <div><strong>請先完成近期驗證</strong><p>完成後回到此頁，按「核對狀態」。</p></div>
      <a className="button button--secondary" href="/mfa?audience=staff&purpose=sensitive-action" rel="noopener noreferrer" target="_blank">前往驗證</a>
    </section> : null}
    {error ? <div className={styles.error} role="alert"><AlertCircle aria-hidden="true" />{error}</div> : null}
    {message ? <div className={styles.success} role="status"><Check aria-hidden="true" />{message}</div> : null}
    {uncertain && attemptExpiry ? <div className={styles.warning} role="status"><ShieldCheck aria-hidden="true" />
      <span>這筆覆核尚待確認；切換分支、登出與重新整理會被暫停。僅查原操作回執，不重送覆核。</span>
      <button className="button button--secondary" disabled={decisionBusy}
        onClick={() => void checkAttemptReceipt()} type="button">查原操作回執</button>
      {Date.parse(attemptExpiry) <= now ? <span>預覽已逾時，仍可查回執；查無結果請聯絡管理員。</span> : null}
    </div> : null}
    {queueBusy ? <p className={styles.loading} role="status">清單讀取中…</p> : null}
    {!queueBusy && queue?.pairs.length === 0 ? <section className={styles.empty}><FileSearch aria-hidden="true" />
      <h2>目前沒有可覆核的 23 筆來源組</h2><p>這不代表已完成移轉；請在管理端確認來源配對與核准狀態。</p>
    </section> : null}
    {queue && queue.pairs.length > 0 ? <>
      <section className={styles.summary} aria-label="來源組選擇">
        <div><small>可覆核來源組</small><strong>{queue.eligiblePairCount}</strong></div>
        <label>來源組<select aria-label="來源組" disabled={hasUnsaved || decisionBusy || uncertain}
          onChange={(event) => selectPair(event.target.value)} value={selectedPairId}>
          {queue.pairs.map((pair, index) => <option key={pair.pairId} value={pair.pairId}>
            第 {index + 1} 組 · 核驗 {timestamp(pair.verifiedAt)}
          </option>)}
        </select></label>
        {queue.eligiblePairCount > queue.pairs.length ? <small>僅列最近 {queue.pairs.length} 組</small> : null}
      </section>
      {selectedPair ? <div className={styles.layout}>
        <section className={styles.list} aria-labelledby="source-list-title">
          <div className={styles.listHeading}><h2 id="source-list-title">來源列</h2><span>23 筆</span></div>
          {hasUnsaved ? <p className={styles.switchHint}>切換來源列前，請先取消本筆輸入。</p> : null}
          <div className={styles.rows}>{selectedPair.sourceRows.map((row) => <button
            aria-current={row.sourceRowId === selectedRowId ? "true" : undefined}
            className={styles.rowButton} data-active={row.sourceRowId === selectedRowId}
            disabled={decisionBusy || uncertain || hasUnsaved}
            key={row.sourceRowId} onClick={() => void selectRow(row.sourceRowId)} type="button">
            <span>第 {row.sourceSheetRow} 列</span><span>{decisionLabels[row.decision]}</span>
            {row.reviewVersion ? <small>v{row.reviewVersion}</small> : null}
          </button>)}</div>
        </section>
        <section className={styles.detail} aria-labelledby="detail-title">
          {!selectedRow ? <div className={styles.empty}><FileSearch aria-hidden="true" /><h2 id="detail-title">選擇來源列</h2><p>查看原值、轉換後內容與差異。</p></div> : null}
          {selectedRow && previewBusy ? <div className={styles.empty} role="status">第 {selectedRow.sourceSheetRow} 列讀取中…</div> : null}
          {selectedRow && !previewBusy && !preview ? <div className={styles.empty}>
            <h2 id="detail-title">預覽未載入</h2><button className="button button--secondary" onClick={() => void selectRow(selectedRow.sourceRowId)} type="button">重新預覽</button>
          </div> : null}
          {preview ? <>
            <div className={styles.detailHeader}><div><p className="eyebrow">來源第 {preview.sourceSheetRow} 列 · 映射 v2</p><h2 id="detail-title">逐欄核對</h2></div>
              <span><Clock3 aria-hidden="true" size={16} />有效至 {timestamp(preview.expiresAt)}</span></div>
            {preview.normalizationRequiresConfirmation ? <div className={styles.warning} role="status"><AlertCircle aria-hidden="true" />有文字轉換，請特別確認標示欄位。</div> : null}
            <table className={styles.compare} aria-label="原值與轉換後欄位">
              <thead><tr><th scope="col">欄位</th><th scope="col">原始值</th><th scope="col">匯入顯示值</th></tr></thead>
              <tbody>{columns.map(({ key, label, display }) => {
                const source = preview.originalMappedValues[key];
                const mapped = display(preview.displayProfile);
                const changed = cellValue(source.value) !== cellValue(mapped);
                const normalized = preview.normalizationFieldIndices.nfkc.includes(source.index) ||
                  preview.normalizationFieldIndices.contactSeparator.includes(source.index);
                return <tr data-changed={changed} key={key}>
                  <th scope="row">{label}{normalized ? <small>已轉換</small> : null}</th>
                  <td data-label="原始值">{cellValue(source.value)}</td>
                  <td data-label="匯入顯示值">{cellValue(mapped)}{changed ? <small>有差異</small> : null}</td>
                </tr>;
              })}</tbody>
            </table>
            <div className={styles.sourceNote}>來源列指紋 {preview.sourceRowSha256.slice(0, 8)}… · 用於確認來源版本</div>
            {expires ? <div className={styles.warning} role="alert">預覽已逾時；請重新讀取，再作決定。
              {hasUnsaved ? <button className="button button--secondary" onClick={cancelDraft} type="button">取消本筆輸入</button> : null}
              <button className="button button--secondary" disabled={hasUnsaved} onClick={() => void selectRow(preview.sourceRowId)} type="button">重新預覽</button>
            </div> : <form className={styles.form} method="post" onSubmit={(event) => void submitDecision(event)}>
              <fieldset><legend>覆核決定</legend><div className={styles.choices}>
                {(["approved", "held", "rejected"] as const).map((value) => <label key={value}>
                  <input checked={decision === value} name="decision" onChange={() => { setDecision(value); trackDraft(value, reason, confirmed); }} type="radio" value={value} />
                  {decisionLabels[value]}</label>)}
              </div></fieldset>
              <label className={styles.reason}>覆核理由（至少 10 字）
                <textarea maxLength={1000} minLength={10} onChange={(event) => { setReason(event.target.value); trackDraft(decision, event.target.value, confirmed); }} required rows={3}
                  value={reason} placeholder="寫下已核對的差異與處理依據" />
              </label>
              <label className={styles.confirm}><input checked={confirmed} onChange={(event) => { setConfirmed(event.target.checked); trackDraft(decision, reason, event.target.checked); }} type="checkbox" />
                我已核對此列原值、轉換與差異，且了解這不是正式收案。</label>
              <div className={styles.actions}><button className="button button--primary" disabled={!confirmed || reason.trim().length < 10 || decisionBusy}
                type="submit">{decisionBusy ? "送出中…" : `記錄：${decisionLabels[decision]}`}</button>
                {hasUnsaved ? <button className="button button--secondary" onClick={cancelDraft} type="button">取消本筆輸入</button> : null}
              </div>
            </form>}
          </> : null}
        </section>
      </div> : null}
    </> : null}
  </main>;
}
