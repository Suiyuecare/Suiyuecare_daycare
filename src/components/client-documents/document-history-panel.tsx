"use client";
import { useEffect, useRef, useState } from "react";
import { DOCUMENT_CATEGORIES, DOCUMENT_LABELS, type DocumentCategory } from "@/lib/client-documents/schema";
import { documentHistoryPageSchema, documentLifecycleInputSchema, validateDocumentLifecycleReceipt,
  type DocumentHistoryPage, type DocumentLifecycleHistoryRow, type DocumentLifecycleInput } from "@/lib/client-documents/lifecycle";
import styles from "./client-documents.module.css";

type Props = { clientId: string; canManage: boolean; demo: boolean; disabled: boolean; today: string;
  onDirty: (value: boolean) => void; onBusy: (value: boolean) => void; onChanged: () => Promise<unknown> };
const dispositions = { unreviewed: "待逐份覆核", reviewed: "此文件已覆核", needs_replacement: "此文件待補正", inactive: "此文件已停用" };
class HistoryError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
async function request(url: string, options?: RequestInit) {
  const response = await fetch(url, { ...options, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const body = await response.json();
  if (!response.ok || body.status !== "ok") throw new HistoryError(response.status, body.errors?.[0]?.code ?? "UNCONFIRMED");
  return body.data;
}

export function DocumentHistoryPanel(props: Props) { return <HistoryEditor key={props.clientId} {...props} />; }
function HistoryEditor({ clientId, canManage, demo, disabled, today, onDirty, onBusy, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<DocumentCategory | "">("medication_bag");
  const [pages, setPages] = useState<DocumentHistoryPage[]>([]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<DocumentLifecycleHistoryRow | null>(null);
  const [reason, setReason] = useState("");
  const [disposition, setDisposition] = useState<DocumentLifecycleInput["disposition"]>("reviewed");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState<DocumentLifecycleInput | null>(null);
  const [conflict, setConflict] = useState(false);
  const [recovery, setRecovery] = useState<DocumentLifecycleInput | null>(null);
  const [download, setDownload] = useState<{ id: string; url: string } | null>(null);
  const locked = useRef(false); const uncertain = useRef(false); const mounted = useRef(true);
  const callbacks = useRef({ onDirty, onBusy, onChanged });
  useEffect(() => { callbacks.current = { onDirty, onBusy, onChanged }; }, [onDirty, onBusy, onChanged]);
  useEffect(() => { callbacks.current.onDirty(Boolean(selected || pending)); }, [selected, pending]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; callbacks.current.onDirty(false); callbacks.current.onBusy(false); }; }, []);
  const page = pages[index];
  useEffect(() => {
    if (!page) return;
    const expire = () => { setPages([]); setIndex(0); setStale(true); setDownload(null); };
    const remaining = Date.parse(page.expiresAt) - Date.now();
    if (remaining <= 0) { expire(); return; }
    const timer = setTimeout(expire, remaining); return () => clearTimeout(timer);
  }, [page]);
  useEffect(() => { if (!download) return; const timer = setTimeout(() => setDownload(null), 55_000); return () => clearTimeout(timer); }, [download]);
  function begin() { if (locked.current || disabled || demo) return false; locked.current = true; setBusy(true); callbacks.current.onBusy(true); setError(""); setDownload(null); return true; }
  function end() { locked.current = false; if (mounted.current) { setBusy(false); callbacks.current.onBusy(false); } }
  async function fetchPage(filter: DocumentCategory | "", cursor?: string) {
    const query = new URLSearchParams({ client: clientId, limit: "50" });
    if (filter) query.set("category", filter); if (cursor) query.set("cursor", cursor);
    const data = await request(`/api/client-documents/history?${query}`);
    const result = documentHistoryPageSchema.parse(data.snapshot);
    if (result.clientId !== clientId || result.category !== (filter || null) || result.pageSize !== 50 ||
      Date.parse(result.expiresAt) <= Date.now()) throw new HistoryError(503, "INVALID_HISTORY");
    return result;
  }
  async function load(first = true) {
    if (selected || pending || !begin()) return;
    try {
      const next = await fetchPage(category, first ? undefined : page?.nextCursor ?? undefined);
      if (!mounted.current) return;
      if (!first && (!page || next.snapshotId !== page.snapshotId || next.generatedAt !== page.generatedAt ||
        next.expiresAt !== page.expiresAt || next.organizationId !== page.organizationId || next.branchId !== page.branchId ||
        pages.length >= 100 || next.rows.some((row) => pages.some((old) => old.rows.some((item) => item.id === row.id))))) {
        throw new HistoryError(503, "INVALID_HISTORY_CONTINUATION");
      }
      setPages(first ? [next] : [...pages, next]); setIndex(first ? 0 : pages.length); setStale(false);
    } catch (failure) {
      if (!mounted.current) return;
      setPages([]); setIndex(0);
      setError(failure instanceof HistoryError && failure.status === 409 ? "本次查詢已過期或範圍有變動，請從最新資料重新查詢。" : "逐份文件清單暫時無法確認，請重試；沒有將未知資料算作已完成。");
    } finally { end(); }
  }
  function choose(row: DocumentLifecycleHistoryRow) {
    if (busy || disabled || pending || stale || demo || !canManage || !row.canManage) return;
    setSelected(row); setConfirmed(false); setError(""); setMessage("");
    setReason(recovery?.documentId === row.id ? recovery.reason : "");
    setDisposition(recovery?.documentId === row.id ? recovery.disposition : row.scanStatus === "clean" ? "reviewed" : "inactive");
    callbacks.current.onDirty(true);
  }
  async function save() {
    if (conflict || (!pending && (!selected || stale || !confirmed)) || !begin()) return;
    let input = pending;
    try {
      if (!input && selected) {
        input = documentLifecycleInputSchema.parse({ clientId, documentId: selected.id, category: selected.category,
          expectedReviewRevision: selected.reviewRevision, disposition, reason, idempotency_key: crypto.randomUUID() });
        setPending(input); uncertain.current = false;
      }
      if (!input) return;
      const data = await request("/api/client-documents/lifecycle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      if (!validateDocumentLifecycleReceipt(data.receipt, input)) throw new HistoryError(503, "INVALID_RECEIPT");
      if (!mounted.current) return;
      setPending(null); setSelected(null); setRecovery(null); setReason(""); setConfirmed(false); uncertain.current = false;
      callbacks.current.onDirty(false); setPages([]); setIndex(0);
      setMessage("這份文件的處置已儲存。原檔仍保留；不會變更醫囑或產生給藥紀錄。");
      // A verified receipt proves the write; a later read failure is not a reason
      // to submit another mutation or show an old snapshot as the new result.
      try {
        await callbacks.current.onChanged();
        const next = await fetchPage(category);
        if (mounted.current) { setPages([next]); setStale(false); }
      } catch { if (mounted.current) setError("處置已有成功回條，但清單更新失敗，請重新查詢確認。不要再次新增相同處置。"); }
    } catch (failure) {
      if (!mounted.current) return;
      if (input && failure instanceof HistoryError && failure.status === 409 && !uncertain.current) {
        setConflict(true); setError("文件版本已變更，這次處置未套用。請保留理由，重新查詢並選取文件比對後再確認。");
      } else if (input) {
        uncertain.current = true;
        setError("原次儲存尚未確認。內容與操作已保留，請用下方按鈕重試確認，不要重新建立處置；若權限已變更請聯絡主管。");
      } else { setError("請填寫至少三字、最多三百字的處置理由，並確認文件與處置。"); }
    } finally { end(); }
  }
  async function getDownload(row: DocumentLifecycleHistoryRow) {
    if (pending || selected || stale || !row.canDownload || !begin()) return;
    try {
      const data = await request("/api/client-documents", { method: "POST", headers: { "content-type": "application/json", "x-client-document-action": "download" },
        body: JSON.stringify({ clientId, documentId: row.id, idempotency_key: crypto.randomUUID() }) });
      const url = new URL(data.url);
      if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co") || !url.pathname.startsWith("/storage/v1/object/sign/client-intake-documents/") ||
        data.documentId !== row.id || data.version !== row.version || data.expiresSeconds !== 60) throw new Error("Invalid download receipt");
      if (mounted.current) setDownload({ id: row.id, url: url.href });
    } catch { if (mounted.current) setError("無法取得這份文件的安全下載連結，請確認權限及安全檢查狀態後重試。"); }
    finally { end(); }
  }
  const readLocked = busy || disabled || Boolean(selected || pending);
  return <section className={styles.historyPanel} aria-label="逐份文件與歷史">
    <h3>逐份文件與歷史</h3>
    <p>多張藥袋分開覆核與停用；原始文件不刪除。停用文件不等於停藥，已覆核也不等於有效醫囑。</p>
    {!open ? <button type="button" disabled={disabled || busy} onClick={() => { setOpen(true); if (!demo) void load(); }}>查看逐份文件與歷史</button> : <>
      <div className={styles.historyControls}>
        <label>查閱文件類別<select value={category} disabled={readLocked} onChange={(event) => { setCategory(event.target.value as DocumentCategory | ""); setPages([]); setIndex(0); setStale(false); setDownload(null); }}>
          <option value="">所有有權限的類別</option>{DOCUMENT_CATEGORIES.map((value) => <option key={value} value={value}>{DOCUMENT_LABELS[value]}</option>)}
        </select></label>
        <button type="button" disabled={readLocked || demo} onClick={() => void load()}>從最新資料查詢</button>
      </div>
      {demo ? <p className={styles.notice}>合成展示不讀取文件。正式使用時可每頁查閱 50 份，並針對每份文件處理；目前沒有假文件或可用下載連結。</p> : null}
      {busy ? <p role="status">正在核對文件資料…</p> : null}
      {stale ? <p role="status" className={styles.notice}>這份查詢已超過五分鐘，已收起舊資料；請重新查詢。</p> : null}
      {error ? <p role="alert" className={styles.notice}>{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {recovery ? <p className={styles.notice}>保留的原處置：第 {recovery.expectedReviewRevision} 次覆核後，擬改為「{dispositions[recovery.disposition]}」。請重新選取同一份文件，比對新狀態；不會自動套用。</p> : null}
      {page ? <>
        <p>第 {index + 1} 頁，本頁 {page.rows.length} 份。查詢時間：{new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei", dateStyle: "short", timeStyle: "short" }).format(new Date(page.generatedAt))}。以下為同一次查詢，不包含後續新文件。</p>
        {!page.rows.length ? <p>這個範圍目前沒有文件，請至下方對應類別補件；沒有權限的類別不會列出。</p> : null}
        <ul className={styles.history}>{page.rows.map((row) => <li key={row.id}>
          <strong>{row.documentLabel ?? DOCUMENT_LABELS[row.category]}・第 {row.version} 份／版</strong>
          <span>{dispositions[row.disposition]}／安全檢查：{row.scanStatus === "clean" ? "通過" : row.scanStatus === "reserved" ? "尚未完成" : "未通過"}／逐份覆核第 {row.reviewRevision} 版</span>
          <span>院所／單位：{row.provider ?? "未提供"}；文件日期：{row.documentDate ?? "未提供"}</span>
          <span>有效期限：{row.validUntil ?? "未提供"}{row.validUntil && row.validUntil < today ? "（已過期，不能視為現行依據）" : ""}</span>
          {row.periodFrom ? <span>用藥／歷史期間：{row.periodFrom} 至 {row.periodTo}</span> : null}
          {row.reviewReason ? <span>上次逐份處置理由：{row.reviewReason}</span> : null}
          {row.historicalOnly ? <span>僅供歷史查考，不作目前使用依據。</span> : null}
          <div className={styles.historyActions}>
            <button type="button" disabled={readLocked || demo || !canManage || !row.canManage} onClick={() => choose(row)}>處理第 {row.version} 份{DOCUMENT_LABELS[row.category]}</button>
            <button type="button" disabled={readLocked || demo || !row.canDownload} onClick={() => void getDownload(row)}>{row.historicalOnly ? "下載歷史文件" : "取得此文件下載連結"}</button>
            {download?.id === row.id ? <a href={download.url} rel="noreferrer" download>下載此文件（一分鐘內有效，請勿轉傳）</a> : null}
          </div>
        </li>)}</ul>
        <nav className={styles.historyActions} aria-label="文件歷史分頁">
          <button type="button" disabled={readLocked || index === 0} onClick={() => { setIndex(index - 1); setDownload(null); }}>上一頁</button>
          <button type="button" disabled={readLocked || (!pages[index + 1] && !page.nextCursor)} onClick={() => { if (pages[index + 1]) { setIndex(index + 1); setDownload(null); } else void load(false); }}>下一頁</button>
        </nav>
      </> : null}
      {selected ? <form className={styles.dispositionForm} onSubmit={(event) => { event.preventDefault(); void save(); }} aria-label="這份文件的處置">
        <h4>處理：{selected.documentLabel ?? DOCUMENT_LABELS[selected.category]}（第 {selected.version} 份／版）</h4>
        <p>目前是「{dispositions[selected.disposition]}」、逐份覆核第 {selected.reviewRevision} 版；只處理這一份，不影響其他藥袋。</p>
        <label>這份文件的新處置<select value={disposition} disabled={busy || Boolean(pending) || stale} onChange={(event) => { setDisposition(event.target.value as DocumentLifecycleInput["disposition"]); setConfirmed(false); }}>
          <option value="reviewed" disabled={selected.scanStatus !== "clean"}>{selected.disposition === "inactive" ? "重新覆核並採用此文件" : "這份文件已核對"}</option>
          <option value="needs_replacement">這份文件需要補正</option><option value="inactive">停用這份文件（保留原檔）</option>
        </select></label>
        <label>逐份處置理由<textarea required minLength={3} maxLength={300} value={reason} disabled={busy || Boolean(pending) || stale} onChange={(event) => { setReason(event.target.value); setConfirmed(false); }} /></label>
        <label className={styles.confirmation}><input type="checkbox" checked={confirmed} disabled={busy || Boolean(pending) || stale} onChange={(event) => setConfirmed(event.target.checked)} />我已確認文件、目前版本與處置；此操作不會變更醫囑。</label>
        {!pending ? <div className={styles.historyActions}><button type="submit" disabled={busy || disabled || stale || !confirmed}>確認儲存這份處置</button><button type="button" disabled={busy} onClick={() => { setSelected(null); setReason(""); setConfirmed(false); }}>取消此次編輯</button></div> : null}
      </form> : null}
      {pending && !conflict ? <button type="button" disabled={busy || disabled} onClick={() => void save()}>重試確認原次文件處置</button> : null}
      {pending && conflict ? <button type="button" disabled={busy} onClick={() => { setRecovery(pending); setPending(null); setSelected(null); setConflict(false); setPages([]); setIndex(0); setError(""); setConfirmed(false); callbacks.current.onDirty(false); }}>保留理由，重新查詢後逐份比對</button> : null}
    </>}
  </section>;
}
