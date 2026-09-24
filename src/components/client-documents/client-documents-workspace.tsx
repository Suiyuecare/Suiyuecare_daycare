"use client";
import { useEffect, useRef, useState } from "react";
import { DOCUMENT_CATEGORIES, DOCUMENT_LABELS, MAX_DOCUMENT_BYTES, documentReceiptSchema, documentsSnapshotSchema, reviewInputSchema, reviewReceiptSchema, type DocumentCategory, type DocumentsSnapshot, type DocumentRow } from "@/lib/client-documents/schema";
import styles from "./client-documents.module.css";
import { DocumentHistoryPanel } from "./document-history-panel";

type Props = { clientId: string; canManage: boolean; demo?: boolean; today: string; onDirty?: (dirty: boolean) => void; onBusy?: (busy: boolean) => void };
const LABELS = { missing: "待補件", scanning: "等待上傳完成／安全檢查", needs_review: "待人工覆核", reviewed: "文件已覆核", needs_replacement: "需要補正／換檔", not_applicable: "已確認不適用", restricted: "無此類附件檢視權限" };
type ApiBody = { status?: string; data?: unknown; errors?: { message?: string }[] };
async function api(url: string, options?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...options, signal: options?.signal ?? AbortSignal.timeout(25000) });
  const body = await response.json() as ApiBody;
  if (!response.ok || body.status !== "ok") throw new Error(body.errors?.[0]?.message ?? "附件操作尚未確認，請重試。");
  return body.data;
}
async function read(clientId: string, signal?: AbortSignal) {
  const data = await api(`/api/client-documents?client=${encodeURIComponent(clientId)}`, { signal }) as { snapshot?: unknown; uploadConfigured?: boolean };
  const snapshot = documentsSnapshotSchema.parse(data.snapshot);
  if (snapshot.clientId !== clientId) throw new Error("附件清單與目前個案不一致，請重新載入。");
  return { snapshot, uploadConfigured: data.uploadConfigured === true };
}
function demoRows(): DocumentRow[] { return DOCUMENT_CATEGORIES.map((category) => ({ category, accessible: true, canManage: false, documentId: null, documentVersion: 0, reviewVersion: 0, status: "missing", scanStatus: null, canDownload: false, mimeType: null, fileSizeBytes: null, reservedAt: null, reviewReason: null })); }
export function ClientDocumentsWorkspace(props: Props) { return <DocumentsEditor key={props.clientId} {...props} />; }
function DocumentsEditor({ clientId, canManage, demo = false, today, onDirty, onBusy }: Props) {
  const [snapshot, setSnapshot] = useState<DocumentsSnapshot | null>(demo ? { clientId, generatedAt: `${today}T00:00:00+08:00`, rows: demoRows(), history: [], historyTruncated: false } : null);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<DocumentCategory | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyDirty, setHistoryDirty] = useState(false);
  const [summaryStale, setSummaryStale] = useState(false);
  const [files, setFiles] = useState<Partial<Record<DocumentCategory, File>>>({});
  const [details, setDetails] = useState<Partial<Record<DocumentCategory, Partial<Record<"documentLabel" | "provider" | "documentDate" | "validUntil" | "periodFrom" | "periodTo", string>>>>>({});
  const [reasons, setReasons] = useState<Partial<Record<DocumentCategory, string>>>({});
  const [decisions, setDecisions] = useState<Partial<Record<DocumentCategory, "reviewed" | "needs_replacement" | "not_applicable">>>({});
  const [download, setDownload] = useState<{ category: DocumentCategory; url: string } | null>(null);
  const keys = useRef(new Map<string, string>()); const locked = useRef(false);
  const callbacks = useRef({ onDirty, onBusy });
  const mounted = useRef(true);
  const hasDraft = historyDirty || Object.values(files).some(Boolean) || Object.values(reasons).some((reason) => Boolean(reason?.trim())) || Object.keys(decisions).length > 0 || Object.keys(details).length > 0;
  useEffect(() => { callbacks.current = { onDirty, onBusy }; }, [onDirty, onBusy]);
  useEffect(() => { callbacks.current.onDirty?.(hasDraft); }, [hasDraft]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; callbacks.current.onDirty?.(false); callbacks.current.onBusy?.(false); }; }, []);
  function operationKey(fingerprint: string) { if (!keys.current.has(fingerprint)) keys.current.set(fingerprint, crypto.randomUUID()); return keys.current.get(fingerprint)!; }
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
    void read(clientId, controller.signal).then((data) => { setSnapshot(data.snapshot); setConfigured(data.uploadConfigured); }).catch(() => setError("附件清單無法取得，請重新載入；目前不能判定是否缺件。")).finally(() => { clearTimeout(timer); setLoading(false); });
    return () => { controller.abort(); clearTimeout(timer); };
  }, [clientId, demo]);
  useEffect(() => { if (!download) return; const timer = setTimeout(() => setDownload(null), 55000); return () => clearTimeout(timer); }, [download]);
  async function refresh() { const data = await read(clientId); if (mounted.current) { setSnapshot(data.snapshot); setConfigured(data.uploadConfigured); setSummaryStale(false); } return data.snapshot; }
  async function retryRead() { if (locked.current || historyDirty || demo) return; setLoading(true); setError(""); try { await refresh(); } catch { setError("附件清單仍無法取得，請稍後重試。"); } finally { setLoading(false); } }
  async function execute(row: DocumentRow, action: "upload" | "review" | "download") {
    if (locked.current || historyDirty || summaryStale || demo || !snapshot) return;
    locked.current = true; callbacks.current.onBusy?.(true); setBusy(row.category); setError(""); setMessage(""); setDownload(null);
    try {
      if (action === "upload") {
        const file = files[row.category]; if (!file || file.size === 0 || file.size > MAX_DOCUMENT_BYTES) throw new Error("請選擇不超過 4MB 的 PDF、JPEG 或 PNG。");
        const metadata = { documentLabel: details[row.category]?.documentLabel ?? DOCUMENT_LABELS[row.category], provider: details[row.category]?.provider ?? "", documentDate: details[row.category]?.documentDate ?? "", validUntil: details[row.category]?.validUntil ?? "", periodFrom: details[row.category]?.periodFrom ?? "", periodTo: details[row.category]?.periodTo ?? "" };
        const fingerprint = `upload:${row.category}:${row.documentVersion}:${file.name}:${file.size}:${file.lastModified}:${JSON.stringify(metadata)}`;
        const form = new FormData(); form.set("clientId", clientId); form.set("category", row.category); form.set("expectedDocumentVersion", String(row.documentVersion)); form.set("idempotency_key", operationKey(fingerprint)); form.set("file", file);
        for (const [key, value] of Object.entries(metadata)) form.set(key, value);
        const data = await api("/api/client-documents", { method: "POST", headers: { "x-client-document-action": "upload" }, body: form }) as { receipt?: unknown };
        const receipt = documentReceiptSchema.parse(data.receipt);
        if (receipt.clientId !== clientId || receipt.category !== row.category || receipt.version !== row.documentVersion + 1) throw new Error("附件回條不一致，請以原操作重試。");
        // Do not advance the visible base version until the mutation receipt is
        // verified. Otherwise an uncertain read would turn Retry into a new upload.
        const verified = await read(clientId);
        const latest = verified.snapshot.rows.find((item) => item.category === row.category);
        if (latest?.documentId !== receipt.id || latest.documentVersion !== receipt.version || latest.scanStatus !== receipt.scanStatus) throw new Error("已取得上傳回條，但讀回狀態有差異；請重新載入核對。");
        setSnapshot(verified.snapshot); setConfigured(verified.uploadConfigured);
        keys.current.delete(fingerprint); setFiles((value) => { const next = { ...value }; delete next[row.category]; return next; });
        setDetails((value) => { const next = { ...value }; delete next[row.category]; return next; });
        setMessage(receipt.scanStatus === "clean" ? "附件已儲存、通過安全檢查並重新讀回，請繼續人工覆核。" : "附件已隔離，安全檢查未通過；禁止下載，請提供新檔案。");
      } else if (action === "review") {
        const base = { clientId, category: row.category, expectedDocumentVersion: row.documentVersion, expectedReviewVersion: row.reviewVersion, decision: decisions[row.category] ?? "reviewed", reason: reasons[row.category] ?? "" };
        const fingerprint = JSON.stringify(base); const parsed = reviewInputSchema.safeParse({ ...base, idempotency_key: operationKey(fingerprint) });
        if (!parsed.success) throw new Error("請填寫至少三字的覆核／不適用理由。");
        const data = await api("/api/client-documents", { method: "PATCH", headers: { "content-type": "application/json", "x-client-document-action": "review" }, body: JSON.stringify(parsed.data) }) as { receipt?: unknown };
        const receipt = reviewReceiptSchema.parse(data.receipt);
        if (receipt.clientId !== clientId || receipt.category !== row.category || receipt.reviewVersion !== row.reviewVersion + 1 || receipt.decision !== base.decision) throw new Error("覆核回條不一致，請使用原操作重試。");
        const verified = await read(clientId);
        const latest = verified.snapshot.rows.find((item) => item.category === row.category);
        const categoryDecision = latest?.categoryReviewDecision === undefined ? latest?.status : latest.categoryReviewDecision;
        if (latest?.reviewVersion !== receipt.reviewVersion || categoryDecision !== receipt.decision) throw new Error("覆核後的資料有差異，請重新載入核對。");
        setSnapshot(verified.snapshot); setConfigured(verified.uploadConfigured);
        keys.current.delete(fingerprint);
        setReasons((current) => { const next = { ...current }; delete next[row.category]; return next; });
        setDecisions((current) => { const next = { ...current }; delete next[row.category]; return next; });
        setMessage("文件處置已儲存並重新讀回；不代表已核定醫囑或本中心已執行給藥。");
      } else {
        const data = await api("/api/client-documents", { method: "POST", headers: { "content-type": "application/json", "x-client-document-action": "download" }, body: JSON.stringify({ clientId, documentId: row.documentId, idempotency_key: crypto.randomUUID() }) }) as { url?: string; documentId?: string; version?: number; expiresSeconds?: number };
        const url = new URL(data.url ?? "");
        if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co") || !url.pathname.startsWith("/storage/v1/object/sign/client-intake-documents/") || data.documentId !== row.documentId || data.version !== row.documentVersion || data.expiresSeconds !== 60) throw new Error("下載回條不符合安全限制，請重試。");
        setDownload({ category: row.category, url: url.href }); setMessage("下載已留下稽核紀錄；此連結只在一分鐘內有效，請勿轉傳。");
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "附件操作尚未確認；原檔與輸入均保留，請重試。"); }
    finally { locked.current = false; if (mounted.current) { callbacks.current.onBusy?.(false); setBusy(null); } }
  }
  return <section className={styles.workspace} aria-label="個案附件與補件">
    <div><h2>個案附件與補件</h2><p>分別上傳身分證、藥袋、用藥計畫、歷史給藥紀錄及體檢資料。每份附件先安全檢查，再由授權人員覆核。</p><p>藥袋與歷史文件不會自動變成有效醫囑，也不算本中心已給藥。</p></div>
    {demo ? <p className={styles.notice}>合成示範：目前顯示六類待補件；不讀取、不上傳任何真實個案附件。</p> : !configured && !loading ? <p className={styles.notice}>附件安全檢查服務尚未完成設定，目前不能上傳。請先保管原檔，交由管理員完成設定後再補件。</p> : null}
    {loading ? <p role="status">正在讀取附件清單…</p> : null}
    {error ? <p role="alert" className={styles.notice}>{error}</p> : null}
    {message ? <p role="status" className={styles.notice}>{message}</p> : null}
    {!demo ? <button type="button" disabled={busy !== null || loading || historyBusy || historyDirty} onClick={() => void retryRead()}>重新載入附件清單</button> : null}
    {!snapshot && !loading ? <p>尚未取得附件清單，不能判定是否已完成補件。</p> : null}
    {snapshot ? <DocumentHistoryPanel clientId={clientId} canManage={canManage} demo={demo} disabled={busy !== null || loading} today={today}
      onBusy={(value) => { if (!mounted.current) return; locked.current = value; setHistoryBusy(value); callbacks.current.onBusy?.(value); }}
      onDirty={(value) => { if (!mounted.current) return; setHistoryDirty(value); if (value) callbacks.current.onDirty?.(true); }}
      onChanged={async () => {
        if (!mounted.current) return;
        setSummaryStale(true); setDownload(null);
        try { await refresh(); }
        catch (failure) { if (mounted.current) setError("逐份處置已儲存，但補件摘要尚未更新。已收起舊摘要，請重新載入附件清單；不必再儲存同一處置。"); throw failure; }
      }} /> : null}
    <p>以下是各類最新文件的補件狀態，不代表所有藥袋都已覆核。需要處理特定文件，請使用上方「逐份文件與歷史」。</p>
    {summaryStale ? <p role="status">補件摘要待更新，暫不提供舊版本操作。</p> : null}
    <div className={styles.grid}>{!summaryStale && snapshot?.rows.map((row) => {
      const permitted = canManage && row.canManage && !demo;
      const disabled = busy !== null || loading || historyBusy || historyDirty;
      return <article className={styles.card} key={row.category} aria-label={DOCUMENT_LABELS[row.category]}>
        <h3>{DOCUMENT_LABELS[row.category]}</h3><p className={styles.status}>{LABELS[row.status]}</p>
        {row.accessible ? <>
          <p>文件第 {row.documentVersion} 版／覆核第 {row.reviewVersion} 版</p>
          {row.documentReviewReason ? <p>此份文件處置理由：{row.documentReviewReason}</p> : null}
          {row.reviewReason ? <p>類別覆核／不適用註記：{row.reviewReason}</p> : null}
          {row.documentDisposition === "inactive" ? <p>此份文件已停用，請至逐份文件清單確認；原檔保留。</p> : null}
          {row.documentHistoricalOnly ? <p>最新文件僅供歷史查考，不作目前使用依據。</p> : null}
          <details><summary>新增{DOCUMENT_LABELS[row.category]}／上傳新版本</summary>
          <form onSubmit={(event) => { event.preventDefault(); void execute(row, "upload"); }}>
            <p>新增文件會保留既有原檔。不同藥袋請分別命名，例如「早午餐藥袋」、「晚餐藥袋」。</p>
            <div className={styles.metadata}>{([
              ["documentLabel", "文件名稱", "text"], ["provider", "院所／開立單位", "text"], ["documentDate", "文件日期", "date"], ["validUntil", "有效期限", "date"],
              ...(row.category.startsWith("medication_") ? [["periodFrom", "用藥／歷史紀錄起日", "date"], ["periodTo", "用藥／歷史紀錄迄日", "date"]] : []),
            ] as ["documentLabel" | "provider" | "documentDate" | "validUntil" | "periodFrom" | "periodTo", string, string][]).map(([key, label, type]) => <label key={key}>{DOCUMENT_LABELS[row.category]}{label}<input type={type} maxLength={type === "text" ? 120 : undefined} disabled={disabled || !permitted || !configured} value={details[row.category]?.[key] ?? (key === "documentLabel" ? DOCUMENT_LABELS[row.category] : "")} onChange={(event) => { callbacks.current.onDirty?.(true); setDetails((current) => ({ ...current, [row.category]: { ...current[row.category], [key]: event.target.value } })); }} /></label>)}</div>
            <p>未知日期可留空；填寫用藥期間時，起日及迄日須一起提供。</p>
            <label>{DOCUMENT_LABELS[row.category]}檔案（上限 4MB）<input key={`${row.category}-${row.documentVersion}`} type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={disabled || !permitted || !configured} onChange={(event) => { const file = event.target.files?.[0]; if (file) callbacks.current.onDirty?.(true); setFiles((current) => ({ ...current, [row.category]: file })); }} /></label>
            <button type="submit" disabled={disabled || !permitted || !configured || !files[row.category]}>{busy === row.category ? "處理中…" : row.documentVersion ? "新增文件／新版本" : "上傳附件"}</button>
          </form></details>
          <details><summary>{DOCUMENT_LABELS[row.category]}最新文件處置／本案不適用</summary>
          <form onSubmit={(event) => { event.preventDefault(); void execute(row, "review"); }}>
            <label>{DOCUMENT_LABELS[row.category]}處置<select value={decisions[row.category] ?? "reviewed"} disabled={disabled || !permitted} onChange={(event) => { callbacks.current.onDirty?.(true); setDecisions({ ...decisions, [row.category]: event.target.value as "reviewed" | "needs_replacement" | "not_applicable" }); }}>
              <option value="reviewed" disabled={row.scanStatus !== "clean"}>文件內容已核對</option><option value="needs_replacement" disabled={row.scanStatus !== "clean"}>請補正／換檔</option><option value="not_applicable">本案不適用（須理由）</option>
            </select></label>
            <label>{DOCUMENT_LABELS[row.category]}覆核／不適用理由<textarea minLength={3} maxLength={300} required disabled={disabled || !permitted} value={reasons[row.category] ?? ""} onChange={(event) => { callbacks.current.onDirty?.(true); setReasons({ ...reasons, [row.category]: event.target.value }); }} /></label>
            <button type="submit" disabled={disabled || !permitted || (row.scanStatus !== "clean" && decisions[row.category] !== "not_applicable")}>儲存文件處置</button>
          </form></details>
          <button type="button" disabled={disabled || !row.canDownload || demo} onClick={() => void execute(row, "download")}>取得安全下載連結</button>
          {download?.category === row.category ? <a href={download.url} rel="noreferrer" download>下載 {DOCUMENT_LABELS[row.category]}（一分鐘內有效）</a> : null}
          {!row.canDownload && row.documentId ? <p>目前無法下載，請確認安全檢查狀態及下載權限。</p> : null}
        </> : <p>這類文件包含敏感資料；請由具備對應職務授權的人員處理。</p>}
      </article>;
    })}</div>
    {snapshot?.historyTruncated ? <p className={styles.notice}>最新文件摘要未包含全部歷史；請使用「逐份文件與歷史」分頁查閱較早文件。</p> : null}
  </section>;
}
