"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Camera, Download, RefreshCw, Upload, X } from "lucide-react";
import Image from "next/image";
import { z } from "zod";
import { clinicalReceiptSchema, clinicalSnapshotSchema, type clinicalSourceSchema } from "@/lib/clinical-attachments/schema";
import { formatCareTaipeiTime } from "@/lib/core-care/date";
import { useProtectedCompletionDraft } from "@/lib/navigation/use-protected-completion-draft";
import styles from "./clinical-attachments.module.css";

type Source = z.infer<typeof clinicalSourceSchema>;
type Snapshot = z.infer<typeof clinicalSnapshotSchema>;
const labels = { reserved: "安全檢查待完成", clean: "可查看", infected: "已隔離", failed: "安全檢查失敗" };
const responseSchema = z.object({ data: z.object({ snapshot: clinicalSnapshotSchema, uploadConfigured: z.boolean() }) });
type AttachmentProps = { source: Source; canManage: boolean; demo?: boolean; audience?: "staff" | "family" };
export function ClinicalAttachments(props: AttachmentProps) { return <ClinicalAttachmentsClient key={`${props.source.clientId}:${props.source.sourceKind}:${props.source.sourceId}:${props.source.sourceVersion}`} {...props} />; }
function ClinicalAttachmentsClient({ source, canManage, demo = false, audience = "staff" }: AttachmentProps) {
  const id = useId();
  const [opened, setOpened] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [configured, setConfigured] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [preview, setPreview] = useState<{ url: string; mime: string; label: string } | null>(null);
  const [held, setHeld] = useState(false);
  const [cancelHeld, setCancelHeld] = useState(false);
  const cancelOperation = useRef<{ attachmentId: string; key: string } | null>(null);
  const formElement = useRef<HTMLFormElement | null>(null);
  const operation = useRef<{ key: string; file: File; label: string } | null>(null);
  const xhr = useRef<XMLHttpRequest | null>(null);
  const loader = useRef<AbortController | null>(null);
  const query = new URLSearchParams({ client: source.clientId, kind: source.sourceKind, source: source.sourceId, audience }).toString();
  useProtectedCompletionDraft(Boolean(file || label.trim()), busy, held || cancelHeld);
  async function load() {
    loader.current?.abort();
    const controller = new AbortController(); loader.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/clinical-attachments?${query}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 403 ? "沒有此筆紀錄的附件權限，請聯絡主任。" : "附件暫時無法載入，請重試。");
      const parsed = responseSchema.parse(await response.json());
      if (parsed.data.snapshot.sourceId !== source.sourceId || parsed.data.snapshot.clientId !== source.clientId || parsed.data.snapshot.sourceVersion !== source.sourceVersion || parsed.data.snapshot.sourceKind !== source.sourceKind) throw new Error("紀錄已更新，請重新載入本頁。");
      if (controller.signal.aborted) return;
      setSnapshot(parsed.data.snapshot); setConfigured(parsed.data.uploadConfigured);
    } catch (failure) { if (!controller.signal.aborted || loader.current === controller) { setSnapshot(null); setConfigured(false); setError(failure instanceof Error && failure.name !== "AbortError" ? failure.message : "讀取逾時，請重試。"); } }
    finally { clearTimeout(timeout); if (loader.current === controller) setBusy(false); }
  }
  useEffect(() => () => { loader.current?.abort(); xhr.current?.abort(); }, []);
  useEffect(() => { if (!preview) return; const timer = setTimeout(() => setPreview(null), 55_000); return () => clearTimeout(timer); }, [preview]);
  async function view(row: Snapshot["rows"][number]) {
    setError(""); setPreview(null);
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`/api/clinical-attachments?${query}`, { method: "POST", headers: { "content-type": "application/json", "x-attachment-action": "download" }, body: JSON.stringify({ clientId: source.clientId, sourceKind: source.sourceKind, sourceId: source.sourceId, attachmentId: row.id, idempotency_key: crypto.randomUUID() }), cache: "no-store", signal: controller.signal });
      if (response.status === 401 || response.status === 403) {
        setSnapshot(null); setConfigured(false); setPreview(null);
        throw new Error();
      }
      const payload = z.object({ data: z.object({ url: z.url(), attachmentId: z.uuid() }) }).parse(await response.json());
      if (!response.ok || payload.data.attachmentId !== row.id) throw new Error();
      const url = new URL(payload.data.url);
      const allowedHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://invalid.invalid").host;
      if (url.protocol !== "https:" || url.host !== allowedHost || !url.pathname.includes("/storage/v1/object/sign/clinical-attachments/")) throw new Error();
      setPreview({ url: url.href, mime: row.mimeType, label: row.label });
    } catch { setError("無法查看附件；權限或連結可能已失效，請重試。"); }
    finally { clearTimeout(timeout); }
  }
  async function upload() {
    if (busy || !file || !label.trim()) { setError("請選擇照片／PDF，並填寫附件名稱。"); return; }
    if (file.size > 4 * 1024 * 1024 || file.size < 1 || !["application/pdf", "image/jpeg", "image/png"].includes(file.type)) { setError("請選擇 4 MB 以下的 JPG、PNG 或 PDF。"); return; }
    const next = operation.current ?? { key: crypto.randomUUID(), file, label: label.trim() }; operation.current = next; setHeld(true);
    const form = new FormData(); for (const [key, value] of Object.entries(source)) form.append(key, String(value));
    form.append("label", next.label); form.append("idempotency_key", next.key); form.append("file", next.file);
    setBusy(true); setProgress(0); setError(""); setNotice("上傳中");
    const request = new XMLHttpRequest(); xhr.current = request;
    request.open("POST", `/api/clinical-attachments?${query}`); request.setRequestHeader("x-attachment-action", "upload"); request.timeout = 60_000;
    request.upload.onprogress = (event) => { if (event.lengthComputable) { const amount = Math.round(event.loaded / event.total * 100); setProgress(amount); if (amount === 100) setNotice("已上傳，安全檢查中…"); } };
    request.onerror = request.ontimeout = request.onabort = () => { setBusy(false); setError("結果尚未確認；請保留原檔並按重試，不會重複建立附件。"); setProgress(null); };
    request.onload = () => {
      setBusy(false); setProgress(null);
      if (request.status === 401 || request.status === 403) {
        setSnapshot(null); setConfigured(false); setPreview(null);
      }
      try {
        const result = z.object({ data: z.object({ receipt: clinicalReceiptSchema }) }).parse(JSON.parse(request.responseText));
        if (request.status !== 201 || result.data.receipt.sourceId !== source.sourceId || result.data.receipt.clientId !== source.clientId) throw new Error();
        operation.current = null; setHeld(false); setFile(null); setLabel(""); formElement.current?.reset(); setNotice(labels[result.data.receipt.scanStatus]); void load();
      } catch { setError(request.status === 403 ? "沒有上傳權限或紀錄已簽署，請重新核對。" : "結果尚未確認；請按重試原檔案。"); }
    };
    request.send(form);
  }
  async function cancelUpload(attachmentId?: string) {
    if (busy || held) return;
    const next = cancelOperation.current ?? (attachmentId ? { attachmentId, key: crypto.randomUUID() } : null); if (!next) return;
    cancelOperation.current = next; setCancelHeld(true); setBusy(true); setError("");
    const controller = new AbortController(); loader.current = controller; const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`/api/clinical-attachments?${query}`, { method: "POST", headers: { "content-type": "application/json", "x-attachment-action": "cancel" }, body: JSON.stringify({ clientId: source.clientId, sourceKind: source.sourceKind, sourceId: source.sourceId, attachmentId: next.attachmentId, idempotency_key: next.key }), cache: "no-store", signal: controller.signal });
      if (response.status === 401 || response.status === 403) {
        setSnapshot(null); setConfigured(false); setPreview(null);
      }
      const result = z.object({ data: z.object({ receipt: z.object({ id: z.uuid(), cancelled: z.literal(true) }).strict() }) }).parse(await response.json());
      if (!response.ok || result.data.receipt.id !== next.attachmentId || controller.signal.aborted) throw new Error();
      cancelOperation.current = null; setCancelHeld(false); setNotice("此附件已標記未完成，原始上傳證據保留；可重新上傳。"); setBusy(false); await load();
    } catch { setError("中止結果尚未確認，請重試原操作；不會刪除原始附件。"); }
    finally { clearTimeout(timer); if (loader.current === controller) setBusy(false); }
  }
  return <details className={styles.root} onToggle={(event) => { const next = event.currentTarget.open; setOpened(next); if (next && !demo && !snapshot && !busy) void load(); }}><summary><Camera aria-hidden="true" />照片與附件</summary>{opened ? <div className={styles.body}>
    {demo ? <p>展示模式不讀取或保存附件。</p> : <>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {busy && progress === null ? <p role="status">讀取中…</p> : null}
      {cancelHeld ? <button className="button button--secondary" type="button" disabled={busy} onClick={() => void cancelUpload()}>重試中止上傳</button> : null}
      {snapshot?.rows.length ? <ul className={styles.list}>{snapshot.rows.map((row) => <li key={row.id}><span><strong>{row.label}</strong><small>{labels[row.scanStatus]} · {formatCareTaipeiTime(row.createdAt)}</small></span>{row.canDownload ? <button className="button button--secondary" type="button" disabled={busy || cancelHeld} onClick={() => void view(row)}><Download aria-hidden="true" />查看</button> : canManage && snapshot.canUpload && row.scanStatus === "reserved" ? <button className="button button--secondary" type="button" disabled={busy || held || cancelHeld} onClick={() => void cancelUpload(row.id)}>標記上傳未完成</button> : null}</li>)}</ul> : snapshot ? <p>尚無照片／附件</p> : null}
      {preview ? <section aria-label="短效附件檢視"><div className={styles.actions}><a className="button button--secondary" href={preview.url} target="_blank" rel="noopener noreferrer">開啟 {preview.label}</a><button className="button button--secondary" type="button" onClick={() => setPreview(null)}><X aria-hidden="true" />關閉</button></div>{preview.mime.startsWith("image/") ? <Image unoptimized width={600} height={400} className={styles.preview} src={preview.url} alt={preview.label} /> : <p>PDF 以短效下載連結開啟。</p>}</section> : null}
      {canManage && snapshot?.canUpload && configured ? <form noValidate onSubmit={(event) => { event.preventDefault(); formElement.current = event.currentTarget; void upload(); }} className={styles.form}>
        <label htmlFor={`${id}-label`}>附件名稱<input id={`${id}-label`} value={label} maxLength={120} disabled={busy || held} onChange={(event) => setLabel(event.target.value)} /></label>
        <label htmlFor={`${id}-file`}>JPG／PNG／PDF，最多 4 MB<input id={`${id}-file`} type="file" accept="image/jpeg,image/png,application/pdf" disabled={busy || held} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
        {progress !== null ? <progress max={100} value={progress} aria-label="附件上傳進度" /> : null}
        <div className={styles.actions}><button className="button button--primary" type="submit" disabled={busy || cancelHeld}><Upload aria-hidden="true" />{busy ? "處理中…" : held ? "重試原檔" : "上傳"}</button>{busy && progress !== null ? <button className="button button--secondary" type="button" onClick={() => xhr.current?.abort()}>停止等待</button> : null}{!busy && !held ? <button className="button button--secondary" type="button" onClick={(event) => { setFile(null); setLabel(""); event.currentTarget.form?.reset(); }}>清除</button> : null}</div>
      </form> : snapshot && canManage && snapshot.canUpload ? <p>附件安全檢查尚未啟用；請交由主任保存原檔。</p> : null}
      <button className="button button--secondary" type="button" disabled={busy} onClick={() => void load()}><RefreshCw aria-hidden="true" />更新附件</button>
    </>}
  </div> : null}</details>;
}
