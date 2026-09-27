"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { TenantContext } from "@/lib/domain/types";
import { ClientJsonReadError } from "@/lib/api/client-fetch";
import { CmsUploadClientError, describeCmsUploadFile, locateCmsUploadResult, originalCmsUploadId, sameCmsUploadFile,
  sendCmsUpload, type CmsUploadResult } from "@/lib/imports/upload-client";
import { beginCmsUpload, beginCmsUploadRead, canUseCmsUpload, cmsUploadScope, finishCmsUpload, getCmsUploadOperation,
  hasCmsUploadOperation, isCurrentCmsUpload, locateCmsUpload, markCmsUploadStaged, markCmsUploadUnknown, retryCmsUpload,
  quarantineCmsUploadAuthority, useCmsUploadState, type CmsUploadMode, type CmsUploadOperation } from "@/lib/imports/upload-pending";
import styles from "./cms-upload-control.module.css";

/** One shared upload/recovery owner. HTML/File bytes never enter the tab journal,
 * storage, previews or logs. Preview readers belong to their existing workspace. */
type Props = {
  context: TenantContext; mode: CmsUploadMode; clientId?: string | null; enabled: boolean; uploadLabel?: string;
  onPreview: (result: CmsUploadResult, signal: AbortSignal, current: () => boolean) => Promise<void>;
  onDirty?: (dirty: boolean) => void; onBusy?: (busy: boolean) => void;
  onSelectionChanged?: () => void;
};
export function CmsUploadControl(props: Props) {
  const state = useCmsUploadState();
  // Authority changes outside this route must also discard native File state,
  // not merely hide the global journal. Never revive it on a later ABA.
  const key = JSON.stringify([cmsUploadScope(props.context, props.mode, props.clientId ?? null), state.epoch, state.authority]);
  return <CmsUploadControlOwner {...props} key={key} />;
}
function CmsUploadControlOwner({ context, mode, clientId = null, enabled, onPreview, onDirty, onBusy, onSelectionChanged,
  uploadLabel = "上傳並核對資料" }: Props) {
  const state = useCmsUploadState(), scope = cmsUploadScope(context, mode, clientId);
  const scopeKey = JSON.stringify(scope), liveScope = useRef(scopeKey);
  const operation = getCmsUploadOperation(scope);
  const [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [status, setStatus] = useState("");
  const [checked, setChecked] = useState<symbol | null>(null);
  const running = useRef(false), controller = useRef<AbortController | null>(null), mount = useRef({ generation: 0 });
  const input = useRef<HTMLInputElement>(null), statusAnchor = useRef<HTMLDivElement>(null);
  const id = useId();
  const allowed = enabled && canUseCmsUpload(scope);
  useEffect(() => { onBusy?.(busy); return () => onBusy?.(false); }, [busy, onBusy]);
  useEffect(() => { onDirty?.(Boolean(file || operation)); }, [file, operation, onDirty]);
  useEffect(() => {
    const lifecycle = mount.current;
    ++lifecycle.generation;
    return () => { lifecycle.generation++; controller.current?.abort();
      const pending = getCmsUploadOperation(scope);
      if (pending?.phase === "sending") markCmsUploadUnknown(pending, scope); };
    // Context changes invalidate the request owner even if its scope later returns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);
  const foreignPending = hasCmsUploadOperation() && !operation;
  function safeError(cause: unknown) {
    return cause instanceof CmsUploadClientError ? cause.message : cause instanceof ClientJsonReadError && [401, 403].includes(cause.status ?? 0)
      ? "登入或權限已變更，請重新登入後核對原操作。" : "結果尚未確認。請保留原檔，先確認上傳結果，再繼續原操作。";
  }
  async function preview(staged: CmsUploadOperation, result: CmsUploadResult, signal: AbortSignal, generation: number) {
    const current = () => generation === mount.current.generation && liveScope.current === scopeKey && !signal.aborted && isCurrentCmsUpload(staged, scope);
    if (!current()) return;
    await onPreview(result, signal, current);
    if (current() && finishCmsUpload(staged, scope)) {
      setFile(null); setChecked(null); setStatus("已取得核對資料。請逐欄確認後建檔；尚未完成收案。");
      if (input.current) input.current.value = "";
      // Do not steal focus from someone who moved to another control meanwhile.
      if (document.activeElement === document.body || !document.activeElement?.isConnected) statusAnchor.current?.focus();
    }
  }
  async function upload() {
    if (running.current || !allowed || foreignPending || operation && !operation.result && checked !== operation.token) return;
    if (!operation?.result && !file) { setError("請重新選取同一份 HTML 原檔，再繼續原操作。"); input.current?.focus(); return; }
    running.current = true; setBusy(true); setError(""); setStatus("正在核對並上傳原檔…");
    const abort = new AbortController(); controller.current = abort;
    const generation = mount.current.generation;
    let pending: CmsUploadOperation | null = null;
    try {
      if (operation) pending = retryCmsUpload(scope, operation.token,
        operation.reservationId && !operation.result ? operation.recoveryKey ?? crypto.randomUUID() : undefined);
      else {
        const description = await describeCmsUploadFile(file!, mode, abort.signal);
        const key = crypto.randomUUID(), originalId = await originalCmsUploadId(scope, key);
        if (generation !== mount.current.generation || liveScope.current !== scopeKey || abort.signal.aborted) return;
        pending = beginCmsUpload(scope, description, key, originalId);
      }
      if (!pending) throw new CmsUploadClientError();
      const result = pending.result ?? await sendCmsUpload(pending, scope, file!, pending.reservationId !== null, abort.signal);
      if (!isCurrentCmsUpload(pending, scope) || generation !== mount.current.generation || liveScope.current !== scopeKey) return;
      const staged = markCmsUploadStaged(pending, scope, result); if (!staged) return;
      pending = staged; await preview(staged, result, abort.signal, generation);
    } catch (cause) {
      if (pending) markCmsUploadUnknown(pending, scope);
      if (cause instanceof CmsUploadClientError && [401, 403].includes(cause.status ?? 0)) quarantineCmsUploadAuthority(scope);
      if (generation === mount.current.generation && liveScope.current === scopeKey) { setStatus(""); setError(safeError(cause)); }
    } finally {
      if (controller.current === abort) controller.current = null;
      if (generation === mount.current.generation && liveScope.current === scopeKey) { running.current = false; setBusy(false); }
    }
  }
  async function check() {
    if (!operation || running.current || !allowed) return;
    const read = beginCmsUploadRead(scope, operation.token); if (!read) return;
    const generation = mount.current.generation; running.current = true; setBusy(true); setError(""); setStatus("正在確認原上傳結果；不會重送檔案…");
    try {
      const source = await locateCmsUploadResult(read.operation, scope, read.signal);
      if (!read.current() || generation !== mount.current.generation || liveScope.current !== scopeKey) return;
      setChecked(operation.token);
      if (!source) { setStatus("尚未查到原操作。結果仍待確認；如需重試，只會使用原檔與原操作。"); return; }
      const located = locateCmsUpload(read.operation, scope, source.reservation_id); if (!located) return;
      if (source.status === "completed" && source.receipt && mode === "routine-intake") {
        const receipt = source.receipt;
        const result: CmsUploadResult = { batchId: receipt.reservation_id, reservationId: receipt.reservation_id,
          fileSha256: receipt.file_sha256, payloadSha256: receipt.payload_sha256, mappingVersion: receipt.mapping_version,
          contentFingerprint: receipt.content_fingerprint, sectionCount: receipt.section_count, fieldCount: receipt.field_count };
        const staged = markCmsUploadStaged(located, scope, result); if (!staged) return;
        // The read fence stays held through the source preview, not merely lookup.
        await preview(staged, result, read.signal, generation);
      } else setStatus(source.status === "completed" ? "原檔已上傳。請選取同一份原檔，繼續載入核對資料；不會另建來源。" :
        "已找到原上傳。請選取同一份原檔，繼續未完成步驟。");
    } catch (cause) {
      if (cause instanceof ClientJsonReadError && ([401, 403].includes(cause.status ?? 0) || cause.code === "INVALID_RESPONSE") ||
          cause instanceof CmsUploadClientError) quarantineCmsUploadAuthority(scope);
      if (generation === mount.current.generation && liveScope.current === scopeKey) { setStatus(""); setError(safeError(cause)); }
    } finally { read.close(); if (generation === mount.current.generation && liveScope.current === scopeKey) { running.current = false; setBusy(false); } }
  }
  async function select(selected: File | null) {
    if (running.current || !allowed || foreignPending) return;
    if (!selected) { if (!operation) setFile(null); return; }
    // A new file attempt invalidates the previous approval preview even when
    // the selected file is invalid. Unknown operations retain their owner.
    if (!operation) onSelectionChanged?.();
    running.current = true; setBusy(true); setError("");
    const generation = mount.current.generation, abort = new AbortController(); controller.current = abort;
    try {
      const described = await describeCmsUploadFile(selected, mode, abort.signal);
      if (generation !== mount.current.generation || liveScope.current !== scopeKey || abort.signal.aborted) return;
      if (operation && !sameCmsUploadFile(operation.file, described)) {
        setFile(null); if (input.current) input.current.value = "";
        setError("檔案與原上傳不同。請選擇同一份原檔；原操作已保留，不會另建個案。"); input.current?.focus(); return;
      }
      setFile(selected); setStatus(operation ? "原檔核對相同，可繼續原操作。" : "已選取原檔，尚未上傳。");
    } catch { if (generation === mount.current.generation && liveScope.current === scopeKey) { setFile(null);
      if (input.current) input.current.value = "";
      setError(`請選擇非空白、${mode === "general" ? 25 : 4} MB 以下的 HTML 原檔。`); input.current?.focus(); } }
    finally { if (controller.current === abort) controller.current = null;
      if (generation === mount.current.generation && liveScope.current === scopeKey) { running.current = false; setBusy(false); } }
  }
  return <section aria-label="CMS 原檔上傳" aria-busy={busy} className="panel__body">
    <label className="field" htmlFor={`${id}-file`}>CMS HTML（{mode === "general" ? 25 : 4} MB 以下）
      <input ref={input} id={`${id}-file`} type="file" accept=".html,.htm,text/html,application/xhtml+xml" disabled={busy || !allowed || foreignPending}
        aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : `${id}-help`} onChange={event => { void select(event.target.files?.[0] ?? null); }} />
    </label>
    <p id={`${id}-help`}>{operation ? "保留原操作；續做時請重新選取同一份原檔。" : "原檔不會在畫面執行，也不會自動建立個案。"}</p>
    {foreignPending ? <p role="status">另一項 CMS 上傳仍待確認。請回原分支與原個案處理，或安全登出後重新核對。</p> : null}
    {!allowed && !context.demo ? <p role="status">目前無法上傳；請先確認分支、權限與封存服務。</p> : null}
    {operation ? <div className="callout"><span>上傳仍待確認。請先查詢原結果，不要另建個案。</span></div> : null}
    {state.navigationBlocked && operation ? <p role="status">請先處理這次上傳，再切換個案或離開。完整重載無法保留此分頁的原操作。</p> : null}
    <div className="import-actions">
      {operation ? <button type="button" className="button button--secondary" disabled={busy || !allowed} onClick={check}>確認上傳結果</button> : null}
      <button type="button" className={`button button--primary ${styles.primary}`} disabled={busy || !allowed || foreignPending || (!file && !operation?.result) ||
        Boolean(operation && !operation.result && checked !== operation.token)} onClick={upload}>
        {busy ? "處理中，請稍候…" : operation?.result ? "重新載入核對資料" : operation ? "繼續原上傳" : uploadLabel}
      </button>
    </div>
    <div ref={statusAnchor} tabIndex={-1} data-governance-focus-anchor>
      {status ? <p role="status">{status}</p> : null}{error ? <p id={`${id}-error`} className="form-error" role="alert">{error}</p> : null}
    </div>
  </section>;
}
