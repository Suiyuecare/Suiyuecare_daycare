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
import { ImportReadinessPanel } from "./import-readiness-panel";
import { ImportNextSteps, ImportStages } from "./import-stages";
import styles from "./import-readiness.module.css";
import { ImportReminderPreview } from "@/components/care-reminders/import-reminder-preview";

const MAX_BYTES = 25 * 1024 * 1024;

export function ImportWorkspace() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [serviceUnavailable, setServiceUnavailable] = useState(false);
  const uploadKey = useRef<string | null>(null);
  const reparseKey = useRef<string | null>(null);
  const inFlight = useRef(false);

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    if (inFlight.current) return;
    const selected = event.target.files?.[0] ?? null;
    setError(null);
    setNotice(null);
    setServiceUnavailable(false);
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
    if (!file || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    setServiceUnavailable(false);
    uploadKey.current ??= crypto.randomUUID();
    const key = uploadKey.current;
    const body = new FormData();
    body.set("file", file);
    body.set("idempotency_key", key);

    try {
      const bytes = await file.arrayBuffer();
      const fileSha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (value) => value.toString(16).padStart(2, "0")).join("");
      const response = await fetchWithTimeout("/api/imports/html", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body,
      }, 60_000);
      const rawReceipt: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 503) {
          setServiceUnavailable(true);
          throw new Error("暫時無法上傳，請聯絡管理員完成匯入服務設定");
        }
        throw new Error(importErrorMessage(rawReceipt, "上傳結果無法確認；請保留檔案並以相同操作重試。"));
      }
      const receiptEnvelope = parseImportUploadEnvelope(rawReceipt, {
        fileName: file.name, byteLength: file.size, fileSha256, httpStatus: response.status,
      });
      const previewResponse = await fetchWithTimeout(`/api/imports/${receiptEnvelope.data.batch.id}/preview`, { cache: "no-store" });
      const rawPreview: unknown = await previewResponse.json().catch(() => null);
      if (!previewResponse.ok) {
        if (previewResponse.status === 503) {
          setServiceUnavailable(true);
          throw new Error("暫時無法取得解析預覽，請聯絡管理員完成匯入服務設定；上傳結果尚未確認。");
        }
        throw new Error(importErrorMessage(rawPreview, "上傳可能已完成，但無法取得預覽；請以相同操作重試。"));
      }
      const previewEnvelope = parseImportPreviewEnvelope(rawPreview, {
        batchId: receiptEnvelope.data.batch.id, httpStatus: previewResponse.status,
      });
      if (previewEnvelope.data.batch.fileSha256 !== fileSha256 || previewEnvelope.data.batch.byteLength !== file.size) {
        throw new Error("解析預覽與本次檔案不一致；請勿視為完成。");
      }
      setPreview(previewEnvelope.data);
      setNotice(receiptEnvelope.data.duplicate ? "已找到相同檔案，未建立重複批次；僅載入解析預覽，正式入檔尚未完成。" : "已解析，可開始核對。正式入檔尚未完成，個案資料未更新。");
      uploadKey.current = null;
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "匯入處理失敗，資料未變更。");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  async function reparse() {
    if (!preview || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    setServiceUnavailable(false);
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
        if (response.status === 503) {
          setServiceUnavailable(true);
          setError("暫時無法重新解析，請聯絡管理員完成匯入服務設定；結果尚未確認。");
        } else {
          setError(importErrorMessage(rawResult, "重新解析結果無法確認；請以相同操作重試。"));
        }
      } else {
        const receipt = parseImportReparseEnvelope(rawResult, {
          batchId: preview.batch.id,
          mappingVersion: preview.batch.mappingVersion,
          httpStatus: response.status,
        });
        const refreshedResponse = await fetchWithTimeout(`/api/imports/${receipt.data.id}/preview`, { cache: "no-store" });
        const rawRefreshed: unknown = await refreshedResponse.json().catch(() => null);
        if (!refreshedResponse.ok) {
          if (refreshedResponse.status === 503) {
            setServiceUnavailable(true);
            throw new Error("暫時無法刷新解析預覽，請聯絡管理員完成匯入服務設定；結果尚未確認。");
          }
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
        setNotice("已使用相同映射版本重新解析並刷新預覽；正式入檔尚未完成，個案資料未更新。");
        reparseKey.current = null;
      }
    } catch (reparseError) {
      setError(reparseError instanceof Error ? reparseError.message : "重新解析結果未知；請以相同操作重試。");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <>
      <nav aria-label="所在位置" className="context-bar"><span>工作台</span><ChevronRight aria-hidden="true" /><span>系統治理與中央匯入</span><ChevronRight aria-hidden="true" /><span aria-current="page" className="context-bar__crumb">中央 HTML 匯入</span></nav>
      <header className="page-heading"><div><p className="eyebrow">隔離解析・原檔不執行</p><h1>中央 HTML 匯入</h1><p className="page-heading__description">先預覽，再核對。解析或暫存核准都不代表已寫入個案資料。</p></div></header>
      <ImportStages parsed={preview !== null} />

      <section className="content-grid">
        <div className="panel">
          <div className="panel__header"><div className="panel__title"><h2>1. 選擇中央系統下載檔</h2><p>支援 UTF-8 HTML，單檔上限 25MB</p></div><ShieldCheck /></div>
          <div className="panel__body">
            <label className="import-dropzone">
              <input accept=".html,.htm,text/html" disabled={pending} onChange={selectFile} type="file" />
              <span className="empty-card__icon"><UploadCloud /></span>
              <strong>{file ? file.name : "選擇或拖放 HTML 檔案"}</strong>
              <span>{file ? `${(file.size / 1024).toFixed(1)} KB・${preview ? "已取得解析預覽" : "尚未取得解析預覽"}` : "原始頁面不會在瀏覽器開啟，也不會連線到外部網址。"}</span>
            </label>
            {error ? <p className="form-error" role="alert"><XCircle />{error}</p> : null}
            {notice ? <div className="callout" role="status"><CheckCircle2 />{notice}</div> : null}
            {serviceUnavailable ? <details className={styles.management}><summary>管理檢查明細：匯入服務設定</summary><p>匯入服務回覆 HTTP 503。請管理員檢查正式匯入儲存介面、封存服務與部署設定；此回覆不代表已取得完整解析預覽或正式入檔回執。</p><p>本頁不顯示伺服器原始錯誤內容、憑證或附件。</p></details> : null}
            <div className="page-heading__actions import-actions"><button className="button button--secondary" disabled={!preview || pending} onClick={reparse} type="button"><RefreshCcw />重新解析</button><button className="button button--primary" disabled={!file || pending} onClick={upload} type="button">{pending ? "正在隔離解析…" : "上傳並預覽"}</button></div>
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
