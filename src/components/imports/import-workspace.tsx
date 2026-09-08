"use client";

import { ChangeEvent, useRef, useState } from "react";
import { CheckCircle2, ChevronRight, FileCode2, LockKeyhole, RefreshCcw, ShieldCheck, UploadCloud, XCircle } from "lucide-react";

import { fetchWithTimeout } from "@/lib/api/client-fetch";
import {
  importErrorMessage,
  parseImportPreviewEnvelope,
  parseImportReparseEnvelope,
  parseImportUploadEnvelope,
} from "@/lib/imports/client-contract";
import type { ImportPreview } from "@/lib/imports/types";
import { StatusPill } from "@/components/ui/status-pill";
import { ImportReadinessPanel } from "./import-readiness-panel";

const MAX_BYTES = 25 * 1024 * 1024;

export function ImportWorkspace() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const uploadKey = useRef<string | null>(null);
  const reparseKey = useRef<string | null>(null);

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setError(null);
    setNotice(null);
    setPreview(null);
    uploadKey.current = null;
    reparseKey.current = null;
    if (!selected) return setFile(null);
    if (!/\.html?$/iu.test(selected.name)) {
      setError("請選擇中央系統下載的 .html 或 .htm 檔案。");
      return setFile(null);
    }
    if (selected.size > MAX_BYTES) {
      setError("檔案超過 25MB，未送到伺服器。");
      return setFile(null);
    }
    setFile(selected);
  }

  async function upload() {
    if (!file) return;
    setPending(true);
    setError(null);
    setNotice(null);
    uploadKey.current ??= crypto.randomUUID();
    const key = uploadKey.current;
    const body = new FormData();
    body.set("file", file);
    body.set("idempotency_key", key);

    try {
      const response = await fetchWithTimeout("/api/imports/html", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body,
      }, 60_000);
      const rawReceipt: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(importErrorMessage(rawReceipt, "上傳結果無法確認；請保留檔案並以相同操作重試。"));
      }
      const receiptEnvelope = parseImportUploadEnvelope(rawReceipt, {
        fileName: file.name, byteLength: file.size, httpStatus: response.status,
      });
      const previewResponse = await fetchWithTimeout(`/api/imports/${receiptEnvelope.data.batch.id}/preview`, { cache: "no-store" });
      const rawPreview: unknown = await previewResponse.json().catch(() => null);
      if (!previewResponse.ok) {
        throw new Error(importErrorMessage(rawPreview, "上傳可能已完成，但無法取得預覽；請以相同操作重試。"));
      }
      const previewEnvelope = parseImportPreviewEnvelope(rawPreview, {
        batchId: receiptEnvelope.data.batch.id, httpStatus: previewResponse.status,
      });
      setPreview(previewEnvelope.data);
      setNotice(receiptEnvelope.data.duplicate ? "已找到相同檔案，未建立重複批次。" : "解析完成。正式資料尚未變更。 ");
      uploadKey.current = null;
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "匯入處理失敗，資料未變更。");
    } finally {
      setPending(false);
    }
  }

  async function reparse() {
    if (!preview) return;
    setPending(true);
    setError(null);
    reparseKey.current ??= crypto.randomUUID();
    const key = reparseKey.current;
    try {
      const response = await fetchWithTimeout(`/api/imports/${preview.batch.id}/reparse`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ idempotency_key: key, mapping_version: preview.batch.mappingVersion }),
      }, 60_000);
      const rawResult: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(importErrorMessage(rawResult, "重新解析結果無法確認；請以相同操作重試。"));
      } else {
        const receipt = parseImportReparseEnvelope(rawResult, {
          batchId: preview.batch.id,
          mappingVersion: preview.batch.mappingVersion,
          httpStatus: response.status,
        });
        const refreshedResponse = await fetchWithTimeout(`/api/imports/${receipt.data.id}/preview`, { cache: "no-store" });
        const rawRefreshed: unknown = await refreshedResponse.json().catch(() => null);
        if (!refreshedResponse.ok) {
          throw new Error(importErrorMessage(rawRefreshed, "重新解析已回覆完成，但無法刷新預覽；請以相同操作重試。"));
        }
        const refreshed = parseImportPreviewEnvelope(rawRefreshed, {
          batchId: receipt.data.id, httpStatus: refreshedResponse.status,
        });
        if (refreshed.data.batch.version !== receipt.data.version ||
            refreshed.data.batch.contentFingerprint !== receipt.data.contentFingerprint) {
          throw new Error("重新解析回執與預覽快照不一致；請勿視為完成。");
        }
        setPreview(refreshed.data);
        setNotice("已使用相同映射版本重新解析並刷新預覽；結果可重現。 ");
        reparseKey.current = null;
      }
    } catch (reparseError) {
      setError(reparseError instanceof Error ? reparseError.message : "重新解析結果未知；請以相同操作重試。");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <nav aria-label="所在位置" className="context-bar"><span>工作台</span><ChevronRight aria-hidden="true" /><span>系統治理與中央匯入</span><ChevronRight aria-hidden="true" /><span aria-current="page" className="context-bar__crumb">中央 HTML 匯入</span></nav>
      <header className="page-heading"><div><p className="eyebrow">隔離解析・原檔不執行</p><h1>中央 HTML 匯入</h1><p className="page-heading__description">先在隔離區解析、遮罩與比對。正式資料提升目前尚未開放；完成欄位映射、衝突確認、WORM 封存及最近 15 分鐘 AAL2 驗證後，才可進入核准交易。</p></div></header>

      <section className="content-grid">
        <div className="panel">
          <div className="panel__header"><div className="panel__title"><h2>1. 選擇中央系統下載檔</h2><p>支援 UTF-8 HTML，單檔上限 25MB</p></div><ShieldCheck /></div>
          <div className="panel__body">
            <label className="import-dropzone">
              <input accept=".html,.htm,text/html" onChange={selectFile} type="file" />
              <span className="empty-card__icon"><UploadCloud /></span>
              <strong>{file ? file.name : "選擇或拖放 HTML 檔案"}</strong>
              <span>{file ? `${(file.size / 1024).toFixed(1)} KB・尚未送出` : "原始頁面不會在瀏覽器開啟，也不會連線到外部網址。"}</span>
            </label>
            {error ? <p className="form-error" role="alert"><XCircle />{error}</p> : null}
            {notice ? <div className="callout" role="status"><CheckCircle2 />{notice}</div> : null}
            <div className="page-heading__actions import-actions"><button className="button button--secondary" disabled={!preview || pending} onClick={reparse} type="button"><RefreshCcw />重新解析</button><button className="button button--primary" disabled={!file || pending} onClick={upload} type="button">{pending ? "正在隔離解析…" : "上傳並預覽"}</button></div>
          </div>

          {preview ? <ImportPreviewPanel preview={preview} /> : null}
        </div>
        <aside className="panel">
          <div className="panel__header"><div className="panel__title"><h2>安全邊界</h2><p>每次匯入都必須通過</p></div><LockKeyhole /></div>
          <div className="panel__body"><ul className="acceptance-list"><li>不執行 JavaScript、表單、redirect 或外部資源。</li><li>敏感值只顯示遮罩，不寫入一般應用紀錄。</li><li>相同檔案雜湊不建立重複批次。</li><li>未知欄位不丟棄，必須先完成人工映射。</li><li>正式核准目前停用；啟用前必須驗證單一交易失敗時正式資料變更為 0。</li></ul></div>
        </aside>
      </section>
    </>
  );
}

function ImportPreviewPanel({ preview }: { preview: ImportPreview }) {
  const security = preview.batch.security;
  return (
    <section className="import-preview" aria-labelledby="preview-heading">
      <div className="panel__header"><div className="panel__title"><h2 id="preview-heading">2. 解析預覽</h2><p>批次 {preview.batch.id.slice(0, 8)}・映射 {preview.batch.mappingVersion}</p></div><StatusPill status={preview.batch.status} /></div>
      <div className="metric-grid import-metrics"><article className="metric-card"><div className="metric-card__top">區段</div><div className="metric-card__value"><strong>{preview.batch.sectionCount}</strong><span>個</span></div></article><article className="metric-card"><div className="metric-card__top">欄位</div><div className="metric-card__value"><strong>{preview.batch.fieldCount}</strong><span>個</span></div></article><article className="metric-card"><div className="metric-card__top">待映射／警示</div><div className="metric-card__value"><strong>{preview.batch.warningCount}</strong><span>個</span></div></article><article className="metric-card"><div className="metric-card__top">外部請求</div><div className="metric-card__value"><strong>{security.externalRequestCount}</strong><span>次</span></div></article></div>
      <div className="panel__body"><div className="callout"><FileCode2 /><span>已封鎖 {security.scriptElementsBlocked} 個程式區塊與 {security.externalReferencesBlocked} 個外部參照；原始內容未被渲染。</span></div></div>
      <ImportReadinessPanel key={`${preview.batch.id}:${preview.batch.version}`} input={{ fields: preview.fields,
        sections: preview.sections, warnings: preview.warnings, conflictCount: preview.conflicts.length,
        mappingVersion: preview.batch.mappingVersion }} />
    </section>
  );
}
