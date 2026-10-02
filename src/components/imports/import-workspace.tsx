"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronRight, FileCode2, LockKeyhole, RefreshCcw, ShieldCheck, XCircle } from "lucide-react";

import { CLIENT_WRITE_TIMEOUT_MS, ClientJsonReadError, fetchJsonWithTimeout } from "@/lib/api/client-fetch";
import {
  ImportClientContractError,
  parseImportPreviewEnvelope,
  parseImportReparseEnvelope,
} from "@/lib/imports/client-contract";
import type { TenantContext } from "@/lib/domain/types";
import type { CmsUploadResult } from "@/lib/imports/upload-client";
import { canUseCmsUpload, cmsUploadScope, getCmsUploadOperation, getCmsUploadState,
  hasCmsUploadOperation, quarantineCmsUploadAuthority, useCmsUploadState } from "@/lib/imports/upload-pending";
import { hasPendingOperations, hasViewTransition, tryAcquirePendingOperation,
  usePendingOperations, useViewTransitionPending } from "@/lib/navigation/pending-operation-lock";
import type { ImportPreview } from "@/lib/imports/types";
import { CmsUploadControl } from "./cms-upload-control";
import { ImportReadinessPanel } from "./import-readiness-panel";
import { ImportNextSteps, ImportStages } from "./import-stages";
import styles from "./import-readiness.module.css";
import { ImportReminderPreview } from "@/components/care-reminders/import-reminder-preview";

type AcceptedPreview = { data: ImportPreview; authority: string; epoch: number };
type ReparseIntent = { key: string; body: string; source: ImportPreview; authority: string; epoch: number;
  receipt: ReturnType<typeof parseImportReparseEnvelope>["data"] | null };

/** The legacy reparse remains component-local. Unknown writes retain their
 * original key while mounted; a full reload is not a recovery guarantee. */
export function ImportWorkspace({ context }: { context: TenantContext }) {
  const uploadState = useCmsUploadState();
  const foreignWrite = usePendingOperations();
  const viewTransition = useViewTransitionPending();
  const scope = useMemo(() => cmsUploadScope(context, "general", null), [context]);
  const [accepted, setAccepted] = useState<AcceptedPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [reparseUnknown, setReparseUnknown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [serviceUnavailable, setServiceUnavailable] = useState(false);
  const reparseIntent = useRef<ReparseIntent | null>(null);
  const inFlight = useRef(false);
  const owner = useRef({ mounted: false, generation: 0, authority: scope.authority, epoch: uploadState.epoch });
  const activeReparse = useRef<AbortController | null>(null);
  const activeLease = useRef<(() => void) | null>(null);
  useEffect(() => {
    const lifecycle = owner.current;
    lifecycle.mounted = true;
    lifecycle.generation += 1;
    return () => { lifecycle.mounted = false; lifecycle.generation += 1; activeReparse.current?.abort();
      activeLease.current?.(); activeLease.current = null; };
  }, []);
  useLayoutEffect(() => {
    owner.current.authority = scope.authority; owner.current.epoch = uploadState.epoch;
    activeReparse.current?.abort();
  }, [scope.authority, uploadState.epoch]);
  const preview = canUseCmsUpload(scope) && accepted?.authority === scope.authority &&
    accepted.epoch === uploadState.epoch && !uploadState.operation ? accepted.data : null;

  const onDirty = useCallback((dirty: boolean) => {
    if (dirty) { setAccepted(null); setNotice(null); }
  }, []);
  const onSelectionChanged = useCallback(() => {
    setAccepted(null); setError(null); setNotice(null); setServiceUnavailable(false);
  }, []);
  const onBusy = useCallback((busy: boolean) => setUploadBusy(busy), []);
  const onPreview = useCallback(async (result: CmsUploadResult, signal: AbortSignal, current: () => boolean) => {
    const epoch = getCmsUploadState().epoch;
    const generation = owner.current.generation;
    const staged = getCmsUploadOperation(scope);
    const valid = () => owner.current.mounted && owner.current.generation === generation && !signal.aborted &&
      current() && canUseCmsUpload(scope) && getCmsUploadState().epoch === epoch &&
      owner.current.authority === scope.authority && owner.current.epoch === epoch;
    if (!staged || !valid()) throw new ClientJsonReadError("ABORTED");
    try {
      const deadline = performance.now() + CLIENT_WRITE_TIMEOUT_MS;
      const { response, payload } = await fetchJsonWithTimeout(`/api/imports/${result.batchId}/preview`, { signal });
      if (!valid()) throw new ClientJsonReadError("ABORTED");
      const parsed = parseImportPreviewEnvelope(payload, { batchId: result.batchId, httpStatus: response.status }).data;
      const batch = parsed.batch;
      if (batch.fileSha256 !== result.fileSha256 || batch.fileSha256 !== staged.file.sha256 ||
          batch.byteLength !== staged.file.size || batch.mappingVersion !== result.mappingVersion ||
          result.contentFingerprint !== null && batch.contentFingerprint !== result.contentFingerprint ||
          result.sectionCount !== null && batch.sectionCount !== result.sectionCount ||
          result.fieldCount !== null && batch.fieldCount !== result.fieldCount) throw new ImportClientContractError();
      // The general preview contract has no payloadSha256. Do not manufacture
      // a JSONB hash or borrow routine-intake evidence to fill that absence.
      if (result.payloadSha256 !== null) throw new ImportClientContractError();
      if (performance.now() >= deadline) throw new ClientJsonReadError("UNAVAILABLE");
      if (!valid()) throw new ClientJsonReadError("ABORTED");
      setAccepted({ data: parsed, authority: scope.authority, epoch });
      setNotice("已解析，可開始核對。正式入檔尚未完成，個案資料未更新。");
      setError(null); setServiceUnavailable(false);
    } catch (failure) {
      if (!valid()) throw new ClientJsonReadError("ABORTED");
      setAccepted(null); setNotice(null);
      if (failure instanceof ImportClientContractError || failure instanceof ClientJsonReadError &&
          (failure.code === "INVALID_RESPONSE" || failure.status === 401 || failure.status === 403)) {
        setError("登入、權限或資料回覆已變更，請重新登入後核對原操作；請勿視為完成。");
        quarantineCmsUploadAuthority(scope);
      }
      if (failure instanceof ClientJsonReadError && failure.status === 503) setServiceUnavailable(true);
      throw new ClientJsonReadError(failure instanceof ClientJsonReadError ? failure.code : "INVALID_RESPONSE",
        failure instanceof ClientJsonReadError ? failure.status : 200);
    }
  }, [scope]);

  async function reparse() {
    if (!preview || inFlight.current || uploadBusy || hasCmsUploadOperation() || hasViewTransition() || !canUseCmsUpload(scope)) return;
    const epoch = getCmsUploadState().epoch;
    const existing = reparseIntent.current;
    if (existing && (existing.authority !== scope.authority || existing.epoch !== epoch)) return;
    if (hasPendingOperations()) return;
    const release = tryAcquirePendingOperation();
    if (!release) return;
    activeLease.current = release;
    let key: string;
    try { key = existing?.key ?? crypto.randomUUID(); }
    catch { release(); activeLease.current = null; setError("目前無法建立安全操作，請重新登入後核對原資料。"); return; }
    const intent = existing ?? { key, body: "", source: preview, authority: scope.authority,
      epoch, receipt: null };
    if (!existing) intent.body = JSON.stringify({ idempotency_key: intent.key, mapping_version: preview.batch.mappingVersion });
    reparseIntent.current = intent;
    const controller = new AbortController(); activeReparse.current = controller;
    const generation = owner.current.generation;
    const current = () => owner.current.mounted && generation === owner.current.generation && !controller.signal.aborted &&
      reparseIntent.current === intent && canUseCmsUpload(scope) && getCmsUploadState().epoch === epoch &&
      owner.current.authority === scope.authority && owner.current.epoch === epoch;
    inFlight.current = true;
    setReparseUnknown(true);
    setPending(true);
    setError(null);
    setNotice(null);
    setServiceUnavailable(false);
    try {
      if (!current()) throw new ClientJsonReadError("ABORTED");
      if (!intent.receipt) {
        const receipt = await boundedReparse(intent, controller.signal);
        if (!current()) throw new ClientJsonReadError("ABORTED");
        if (receipt.fileSha256 !== intent.source.batch.fileSha256 || receipt.byteLength !== intent.source.batch.byteLength ||
            receipt.version !== intent.source.batch.version + 1) throw new ImportClientContractError();
        intent.receipt = receipt;
      }
      const deadline = performance.now() + CLIENT_WRITE_TIMEOUT_MS;
      const { response, payload } = await fetchJsonWithTimeout(`/api/imports/${intent.receipt.id}/preview`, { signal: controller.signal });
      if (!current()) throw new ClientJsonReadError("ABORTED");
      const refreshed = parseImportPreviewEnvelope(payload, { batchId: intent.receipt.id, httpStatus: response.status }).data;
      if (JSON.stringify(refreshed.batch) !== JSON.stringify(intent.receipt)) throw new ImportClientContractError();
      if (performance.now() >= deadline) throw new ClientJsonReadError("UNAVAILABLE");
      if (!current()) throw new ClientJsonReadError("ABORTED");
      setAccepted({ data: refreshed, authority: scope.authority, epoch });
      setNotice("已使用相同映射版本重新解析並刷新預覽；正式入檔尚未完成，個案資料未更新。");
      reparseIntent.current = null; setReparseUnknown(false);
    } catch (failure) {
      if (current()) {
        const denied = failure instanceof ImportClientContractError || failure instanceof ClientJsonReadError &&
          (failure.code === "INVALID_RESPONSE" || failure.status === 401 || failure.status === 403);
        if (denied) { setAccepted(null); quarantineCmsUploadAuthority(scope); }
        const unavailable = failure instanceof ClientJsonReadError && failure.status === 503;
        setServiceUnavailable(unavailable); setReparseUnknown(true);
        setError(unavailable ? "暫時無法重新解析，請聯絡管理員完成匯入服務設定；結果尚未確認。" :
          "重新解析結果尚未確認；請以原操作重試，不要另建操作。");
      }
    } finally {
      if (activeReparse.current === controller) {
        activeReparse.current = null; inFlight.current = false;
        if (owner.current.mounted) setPending(false);
      }
      release(); if (activeLease.current === release) activeLease.current = null;
    }
  }

  return (
    <>
      <nav aria-label="所在位置" className="context-bar"><span>工作台</span><ChevronRight aria-hidden="true" /><span>系統治理與中央匯入</span><ChevronRight aria-hidden="true" /><span aria-current="page" className="context-bar__crumb">中央 HTML 匯入</span></nav>
      <header className="page-heading"><div><p className="eyebrow">隔離解析・原檔不執行</p><h1>中央 HTML 匯入</h1><p className="page-heading__description">這是管理用的來源解析頁。要建立個案並接續每週安排、表單與文件，請使用收案工作台。</p></div><Link className="button button--primary" href="/app/client-intake">前往個案匯入與收案</Link></header>
      <ImportStages parsed={preview !== null} />

      <section className="content-grid">
        <div className="panel">
          <div className="panel__header"><div className="panel__title"><h2>1. 選擇中央系統下載檔</h2><p>支援 UTF-8 HTML，單檔上限 25MB</p></div><ShieldCheck /></div>
          <div className="panel__body">
            <CmsUploadControl context={context} mode="general" enabled={!pending && !reparseUnknown}
              uploadLabel="上傳並預覽" onPreview={onPreview} onDirty={onDirty} onBusy={onBusy} onSelectionChanged={onSelectionChanged} />
            {error ? <p className="form-error" role="alert"><XCircle />{error}</p> : null}
            {notice && preview ? <div className="callout" role="status"><CheckCircle2 />{notice}</div> : null}
            {serviceUnavailable ? <details className={styles.management}><summary>管理檢查明細：匯入服務設定</summary><p>匯入服務回覆 HTTP 503。請管理員檢查正式匯入儲存介面、封存服務與部署設定；此回覆不代表已取得完整解析預覽或正式入檔回執。</p><p>本頁不顯示伺服器原始錯誤內容、憑證或附件。</p></details> : null}
            <div className="page-heading__actions import-actions"><button className="button button--secondary"
              disabled={!preview || pending || uploadBusy || Boolean(uploadState.operation) || viewTransition || foreignWrite}
              onClick={reparse} type="button"><RefreshCcw />{pending ? "正在重新解析…" : "重新解析"}</button></div>
            {reparseUnknown && !pending ? <p className="text-muted">重新解析原操作仍待確認；本頁保留原鍵供重試。離開或完整重載尚不能恢復此原操作，請勿另建批次。</p> : null}
          </div>

          {preview ? <ImportPreviewPanel preview={preview} /> : null}
        </div>
        <aside className="panel">
          <div className="panel__header"><div className="panel__title"><h2>安全邊界</h2><p>每次匯入都必須通過</p></div><LockKeyhole /></div>
          <div className="panel__body"><ul className="acceptance-list"><li>原始 HTML 不會開啟、不執行程式，也不連線外部資源。</li><li>預覽仍可能含敏感資料，僅供有權限人員核對；不得複製到公開管道。</li><li>相同檔案不建立重複批次。</li><li>未知欄位、衝突與警示必須先核對，不會靜默忽略。</li><li>正式入檔尚未開放，不會更新個案、核定計畫或服務紀錄。</li></ul></div>
          <ImportNextSteps />
        </aside>
      </section>
    </>
  );
}

/** Existing reparse wire, bounded independently through JSON and validation.
 * It never retries or exposes provider errors. Scope ownership is fenced by
 * the caller on both sides of this transport. */
async function boundedReparse(intent: ReparseIntent, ownerSignal: AbortSignal) {
  if (ownerSignal.aborted) throw new ClientJsonReadError("ABORTED");
  const abort = new AbortController();
  const expires = performance.now() + CLIENT_WRITE_TIMEOUT_MS;
  const error = () => new ClientJsonReadError(ownerSignal.aborted ? "ABORTED" : "UNAVAILABLE");
  const cancel = () => abort.abort();
  let remove = () => {};
  const stopped = new Promise<never>((_, reject) => {
    const onAbort = () => reject(error());
    abort.signal.addEventListener("abort", onAbort, { once: true });
    remove = () => abort.signal.removeEventListener("abort", onAbort);
  });
  ownerSignal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, CLIENT_WRITE_TIMEOUT_MS);
  const assertCurrent = () => { if (abort.signal.aborted || performance.now() >= expires) throw error(); };
  try {
    if (ownerSignal.aborted) cancel();
    const work = (async () => {
      assertCurrent();
      let response: Response;
      try { response = await fetch(`/api/imports/${intent.source.batch.id}/reparse`, { method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": intent.key }, body: intent.body,
        credentials: "same-origin", cache: "no-store", redirect: "error", signal: abort.signal }); }
      catch { throw error(); }
      assertCurrent();
      if (response.status !== 200 || response.redirected) throw new ClientJsonReadError("UNAVAILABLE", response.status);
      let payload: unknown;
      try { payload = await response.json(); } catch { assertCurrent(); throw new ClientJsonReadError("INVALID_RESPONSE", 200); }
      assertCurrent();
      const parsed = parseImportReparseEnvelope(payload, { batchId: intent.source.batch.id,
        mappingVersion: intent.source.batch.mappingVersion, httpStatus: response.status }).data;
      assertCurrent(); return parsed;
    })();
    return await Promise.race([work, stopped]);
  } finally { clearTimeout(timer); remove(); ownerSignal.removeEventListener("abort", cancel); }
}

function ImportPreviewPanel({ preview }: { preview: ImportPreview }) {
  const security = preview.batch.security;
  return (
    <section className="import-preview" aria-labelledby="preview-heading">
      <div className="panel__header"><div className="panel__title"><h2 id="preview-heading">2. 解析預覽</h2><p>核對來源欄位；此處不是正式個案資料。</p></div><span className="status-pill status-pill--warning">僅供核對</span></div>
      <div className="metric-grid import-metrics"><article className="metric-card"><div className="metric-card__top">區段</div><div className="metric-card__value"><strong>{preview.batch.sectionCount}</strong><span>個</span></div></article><article className="metric-card"><div className="metric-card__top">欄位</div><div className="metric-card__value"><strong>{preview.batch.fieldCount}</strong><span>個</span></div></article><article className="metric-card"><div className="metric-card__top">解析警示</div><div className="metric-card__value"><strong>{preview.batch.warningCount}</strong><span>個</span></div></article><article className="metric-card"><div className="metric-card__top">外部請求</div><div className="metric-card__value"><strong>{security.externalRequestCount}</strong><span>次</span></div></article></div>
      <div className="panel__body"><div className="callout"><FileCode2 /><span>原始內容未被渲染，外部請求為 {security.externalRequestCount} 次。請核對下方警示與未知欄位。</span></div>
        <details className={styles.management}><summary>管理檢查明細：解析批次</summary><dl className={styles.provenance}>
          <div><dt>批次 ID／版本</dt><dd>{preview.batch.id}／{preview.batch.version}</dd></div>
          <div><dt>來源回執狀態（不是正式入檔狀態）</dt><dd><code>{preview.batch.status}</code>；即使回執為 imported，也不能作為正式入檔證據。</dd></div>
          <div><dt>檔案 SHA-256</dt><dd><code>{preview.batch.fileSha256}</code></dd></div>
          <div><dt>內容指紋</dt><dd><code>{preview.batch.contentFingerprint}</code></dd></div>
          <div><dt>安全解析</dt><dd>已封鎖 {security.scriptElementsBlocked} 個程式區塊與 {security.externalReferencesBlocked} 個外部參照；不代表已完成附件掃毒或七年封存。</dd></div>
        </dl></details>
      </div>
      <ImportReadinessPanel key={`${preview.batch.id}:${preview.batch.version}`} input={{ fields: preview.fields,
        sections: preview.sections, warnings: preview.warnings, conflictCount: preview.conflicts.length,
        mappingVersion: preview.batch.mappingVersion }} />
      <ImportReminderPreview preview={preview} />
    </section>
  );
}
