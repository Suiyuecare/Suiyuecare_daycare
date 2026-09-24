"use client";
import { useEffect, useRef, useState } from "react";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import type { TaipeiDraftSnapshot } from "@/lib/taipei-abcd/types";
import { emptyWorkflow, sectionReviewItems, TAIPEI_WORKFLOW_LABELS, transitionReceiptSchema, transitionSchema, type TaipeiChecklist } from "@/lib/taipei-abcd/workflow";
import styles from "./taipei-abcd.module.css";
type Receipt = ReturnType<typeof transitionReceiptSchema.parse>;
type Props = { snapshot: TaipeiDraftSnapshot; unsavedAnswers: boolean; disabled: boolean; onBusy: (busy: boolean) => void; onDirty: (dirty: boolean) => void; onChanged: (receipt: Receipt) => Promise<void> };
export function TaipeiAbcdReview({ snapshot, unsavedAnswers, disabled, onBusy, onDirty, onChanged }: Props) {
  const [reason, setReason] = useState(""); const [checklist, setChecklist] = useState<TaipeiChecklist>({});
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const pending = useRef<ReturnType<typeof transitionSchema.parse> | null>(null); const locked = useRef(false);
  const [pdf, setPdf] = useState<{ url: string; hash: string; snapshotId: string } | null>(null);
  const exportKey = useRef<string | null>(null);
  const callbacks = useRef({ onBusy, onDirty, onChanged });
  useEffect(() => { callbacks.current = { onBusy, onDirty, onChanged }; }, [onBusy, onDirty, onChanged]);
  useEffect(() => { callbacks.current.onDirty(Boolean(reason || Object.keys(checklist).length)); }, [reason, checklist]);
  useEffect(() => () => { callbacks.current.onDirty(false); callbacks.current.onBusy(false); }, []);
  useEffect(() => { if (!pdf) return; const timer = setTimeout(() => setPdf(null), 5 * 60000); return () => { clearTimeout(timer); URL.revokeObjectURL(pdf.url); }; }, [pdf]);
  const workflow = snapshot.workflow ?? emptyWorkflow;
  const row = snapshot.latest; const sections = sectionReviewItems(snapshot.form, row?.answers ?? {});
  const blocked = disabled || busy || unsavedAnswers || !row;
  function edit(nextReason: string, nextChecklist = checklist) { setReason(nextReason); setChecklist(nextChecklist); pending.current = null; setMessage(""); }
  async function transition(action: "submit" | "return" | "approve" | "correct") {
    if (blocked || locked.current || !row) return;
    locked.current = true; setBusy(true); callbacks.current.onBusy(true); setError(""); setMessage("");
    try {
      const payload = pending.current ?? transitionSchema.parse({ clientId: row.clientId, draftId: row.id, contentHash: row.contentHash, expectedSequence: workflow.sequence,
        action, reason, checklist: action === "submit" ? checklist : {}, idempotency_key: crypto.randomUUID() });
      if (payload.action !== action) throw new Error("先重試原處置，或調整理由後再改變操作。");
      pending.current = payload;
      const response = await fetchWithTimeout("/api/taipei-abcd/workflow", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": payload.idempotency_key }, body: JSON.stringify(payload), cache: "no-store" });
      const body = await response.json(); if (!response.ok) throw new Error(body.errors?.[0]?.message ?? "尚未確認行政審核結果，請以原操作重試。");
      const receipt = transitionReceiptSchema.parse(body.data);
      if (receipt.idempotencyKey !== payload.idempotency_key || (action !== "correct" && receipt.draftId !== row.id)) throw new Error("回條不一致，請以原操作重試。");
      await callbacks.current.onChanged(receipt);
      pending.current = null; setChecklist({}); setReason(""); setPdf(null); exportKey.current = null;
      setMessage(`${TAIPEI_WORKFLOW_LABELS[receipt.state]}，已重新讀回核對；不代表官方表單完整或已電子簽署。`);
    } catch (cause) { setError(cause instanceof Error && cause.name !== "ZodError" ? cause.message : "請確認所有區段，填寫至少三字的理由；有未填欄位的區段須說明待補原因。"); }
    finally { locked.current = false; setBusy(false); callbacks.current.onBusy(false); }
  }
  async function createPdf() {
    if (blocked || locked.current || !row) return;
    locked.current = true; setBusy(true); callbacks.current.onBusy(true); setError("");
    try {
      exportKey.current ??= crypto.randomUUID();
      const response = await fetchWithTimeout("/api/taipei-abcd/exports", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": exportKey.current },
        body: JSON.stringify({ clientId: row.clientId, draftId: row.id, contentHash: row.contentHash, expectedSequence: workflow.sequence, idempotency_key: exportKey.current }), cache: "no-store" }, 60000);
      if (!response.ok) { const body = await response.json(); throw new Error(body.errors?.[0]?.message ?? "PDF 尚未產生，請重試。"); }
      const hash = response.headers.get("x-pdf-sha256"); const snapshotId = response.headers.get("x-taipei-snapshot-id");
      if (response.headers.get("content-type") !== "application/pdf" || !hash || !/^[a-f0-9]{64}$/.test(hash) || !snapshotId || !/^[a-f0-9-]{36}$/.test(snapshotId)) throw new Error("PDF 回條不完整，已停止預覽。");
      const bytes = await response.arrayBuffer(); const actual = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join("");
      if (actual !== hash) throw new Error("PDF 雜湊不一致，已停止預覽。");
      setPdf({ url: URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })), hash, snapshotId });
      setMessage("已產生欄位對照副本；預覽、列印與下載使用下方同一份 PDF。五分鐘後清除本機預覽連結。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "PDF 尚未確認，請重試。"); }
    finally { locked.current = false; setBusy(false); callbacks.current.onBusy(false); }
  }
  return <section className={styles.review} aria-label="表單行政審核與同版輸出">
    <h3>送審與覆核</h3><p>目前：{TAIPEI_WORKFLOW_LABELS[workflow.state]} · 審核紀錄第 {workflow.sequence} 版</p>
    <p>這是機構行政審核，不是護理、社工或主管電子簽署，也不會將未填內容視為完整。送審後該版凍結；退回可續填，核准後需建立有理由的更正版。</p>
    {unsavedAnswers && <p role="status">先儲存上方表單內容，才能對指定版本送審或輸出。</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}{message && <p role="status">{message}</p>}
    {snapshot.canSubmit && <details><summary>送審前：逐區核對已填與待補內容</summary><div className={styles.sectionBody}>{sections.map(section => <div key={section.code} className={styles.field}>
      <label><input type="checkbox" checked={checklist[section.code]?.confirmed ?? false} disabled={blocked} onChange={e => edit(reason, { ...checklist, [section.code]: { confirmed: e.target.checked, pendingReason: section.missing ? checklist[section.code]?.pendingReason ?? "" : null } })} />{section.code} {section.title}：已核對現有資料及適用性</label>
      <p>未填 {section.missing} 項 · 來源待核對 {section.unconfirmed} 項</p>
      {section.missing > 0 && <label>{section.code} 待補原因與後續處理<textarea value={checklist[section.code]?.pendingReason ?? ""} minLength={3} maxLength={1000} disabled={blocked} onChange={e => edit(reason, { ...checklist, [section.code]: { confirmed: checklist[section.code]?.confirmed ?? false, pendingReason: e.target.value } })} /></label>}
    </div>)}</div></details>}
    {(snapshot.canSubmit || snapshot.canReview || snapshot.canCorrect) && <label>送審／退回／核准／更正理由（至少三字）<textarea value={reason} maxLength={1000} disabled={blocked} onChange={e => edit(e.target.value)} /></label>}
    <div className={styles.toolbar}>
      {snapshot.canSubmit && <button type="button" disabled={blocked} onClick={() => void transition("submit")}>送行政審核</button>}
      {snapshot.canReview && <><button type="button" disabled={blocked} onClick={() => void transition("return")}>退回補件</button><button type="button" disabled={blocked} onClick={() => void transition("approve")}>行政核准（非簽署）</button></>}
      {snapshot.canCorrect && <button type="button" disabled={blocked} onClick={() => void transition("correct")}>建立更正版</button>}
      <button type="button" disabled={blocked || !snapshot.canExport} onClick={() => void createPdf()}>產生同版預覽／列印 PDF</button>
    </div>
    {!snapshot.canExport && <p className={styles.muted}>輸出含敏感資料，需文件輸出權限與近期額外身分確認；不影響一般草稿填寫及行政送審。</p>}
    {pdf && <div className={styles.pdf}><a href={pdf.url} target="_blank" rel="noreferrer">開啟同一份 PDF 預覽與列印</a><a href={pdf.url} download={`taipei-${snapshot.form}-${pdf.snapshotId}.pdf`}>下載同一份 PDF</a><p>官方欄位對照副本，非官方原稿版面，未電子簽署。</p><p className={styles.muted}>PDF SHA-256：{pdf.hash}</p></div>}
    <details><summary>行政審核歷程（不列為簽署）</summary><div className={styles.sectionBody}>{workflow.events.length ? workflow.events.map(event => <p key={event.id}>第 {event.sequence} 版 · {TAIPEI_WORKFLOW_LABELS[event.state]} · 已由：{event.actorName} · {new Date(event.createdAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}<br />理由：{event.reason}</p>) : <p>尚無行政審核紀錄。</p>}</div></details>
  </section>;
}
