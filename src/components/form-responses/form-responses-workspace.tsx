"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { useCoreDraftGuard } from "@/components/core-care/client-continuation";
import { tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";
import { parseResponseReceipt, parseResponseSnapshot, responseInputSchema, validateFormAnswers, type FormAnswer, type FormAnswers, type ResponseInput, type ResponseRecord, type ResponseSnapshot } from "@/lib/custom-form-responses/contract";
import type { CustomFormSchema } from "@/lib/form-governance/custom-draft";
import { CustomResponsePrintAction, type PrintActor } from "./custom-response-print-action";
import styles from "./form-responses.module.css";

const envelope = z.object({ requestId: z.uuid(), status: z.literal("ok"), data: z.unknown(), errors: z.tuple([]) }).strict();
const errorEnvelope = z.object({ requestId: z.uuid(), status: z.literal("error"), data: z.null(), errors: z.array(z.object({ code: z.string(), message: z.string(), field: z.string().optional() }).strict()).min(1) }).strict();
const definiteErrors = new Set(["INVALID_CUSTOM_RESPONSE", "CUSTOM_RESPONSE_FORBIDDEN", "CUSTOM_RESPONSE_CONFLICT", "CUSTOM_RESPONSE_BLOCKED", "AUTH_REQUIRED", "AAL2_REQUIRED", "REQUEST_TOO_LARGE", "ROUTINE_CARE_NOT_AUTHORIZED", "BRANCH_CONTEXT_REQUIRED"]);
type Editor = { formVersionId: string; schema: CustomFormSchema; record: ResponseRecord | null; serviceDate: string };

export function FormResponsesWorkspace({ clients, initialClient, today, canWrite, canSign, canPrint = false, printActor, demo = false, demoSnapshot }: {
  clients: { id: string; label: string }[]; initialClient: string; today: string; canWrite: boolean; canSign: boolean; canPrint?: boolean; printActor?: PrintActor; demo?: boolean; demoSnapshot?: ResponseSnapshot;
}) {
  const draftGuard = useCoreDraftGuard();
  const [clientId, setClientId] = useState(initialClient);
  const [snapshot, setSnapshot] = useState<ResponseSnapshot | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [answers, setAnswers] = useState<FormAnswers>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  const attempt = useRef<{ key: string; clientId: string; input: ResponseInput; body: string; previous: ResponseRecord | null; schema: CustomFormSchema; ambiguous: boolean } | null>(null);
  const operationLease = useRef<(() => void) | null>(null);
  const viewLease = useRef<(() => void) | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // An unresolved write keeps its opaque tab-wide lease. A late correlated
      // receipt can still release it, but unmounting cannot prove rollback.
      if (!attempt.current) { operationLease.current?.(); operationLease.current = null; }
      viewLease.current?.(); viewLease.current = null;
    };
  }, []);
  function changed() { draftGuard.changed(); setDirty(true); setMessage(""); }
  function releaseKnownOperation() {
    operationLease.current?.(); operationLease.current = null;
    attempt.current = null;
    draftGuard.finish();
  }
  const locked = busy || uncertain || printBusy;
  const historical = Boolean(editor?.record && snapshot?.records.some((r) => r.recordKey === editor.record!.recordKey && r.revision > editor.record!.revision));
  function answer(key: string, value: FormAnswer) { if (demo || historical || printBusy || lock.current || attempt.current) return; setAnswers((current) => ({ ...current, [key]: value })); changed(); }
  function start(record: ResponseRecord) {
    if (lock.current || attempt.current || locked || dirty) return;
    setEditor({ formVersionId: record.formVersionId, schema: record.schema, record, serviceDate: record.serviceDate });
    setAnswers(record.answers); setReason(""); setError(""); setMessage("");
  }
  async function load(more = false) {
    if (lock.current || printBusy || uncertain || dirty || !clientId) return;
    if (demo) {
      if (demoSnapshot?.clientId !== clientId) { setError("請選擇合成展示個案。"); return; }
      try { setSnapshot(parseResponseSnapshot(demoSnapshot, clientId)); setEditor(null); setAnswers({}); setError(""); setMessage(""); }
      catch { setError("合成展示資料未完整確認。"); }
      return;
    }
    const releaseView = tryAcquireViewTransition();
    if (!releaseView) { setError("另有操作尚待確認或畫面正在更新，請完成後再載入表單。"); return; }
    viewLease.current = releaseView;
    lock.current = true; setBusy(true); setError("");
    const cursor = more ? snapshot?.records.at(-1) : null;
    const query = new URLSearchParams({ clientId });
    if (cursor) { query.set("before", cursor.createdAt); query.set("beforeId", cursor.id); }
    try {
      const response = await fetchWithTimeout(`/api/forms/responses?${query}`, { cache: "no-store" });
      const raw: unknown = await response.json();
      if (!response.ok) throw new Error(errorEnvelope.safeParse(raw).data?.errors[0]?.message ?? "表單暫時無法載入，請重試。");
      const body = envelope.parse(raw);
      const data = z.object({ snapshot: z.unknown(), demo: z.literal(false) }).strict().parse(body.data);
      const next = parseResponseSnapshot(data.snapshot, clientId);
      if (!mounted.current) return;
      setSnapshot((current) => more && current?.clientId === clientId ? { ...next, records: [...current.records, ...next.records.filter((r) => !current.records.some((old) => old.id === r.id))] } : next);
      if (!more) { setEditor(null); setAnswers({}); setMessage(""); }
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "表單暫時無法載入。"); }
    finally { releaseView(); if (viewLease.current === releaseView) viewLease.current = null; lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function write(action: ResponseInput["action"]) {
    if (demo || historical || printBusy || lock.current || !editor || !snapshot || (!canWrite && action !== "sign") || (action === "sign" && !canSign)) return;
    if (!attempt.current) {
      const input = responseInputSchema.safeParse({ action, formVersionId: editor.formVersionId, previousId: editor.record?.id ?? null,
        baseRevision: editor.record?.revision ?? null, serviceDate: editor.serviceDate, answers: action === "save" ? answers : null, reason: action === "correct" ? reason : null });
      const problems = action === "correct" ? [] : validateFormAnswers(editor.schema, answers, action === "sign");
      if (!input.success || problems.length) { setError(problems.join("；") || "請確認日期、原紀錄及更正原因。"); return; }
      if (action === "sign" && dirty) { setError("請先儲存填答，再簽署已保存的版本。"); return; }
      const release = tryAcquirePendingOperation();
      if (!release) { setError("畫面正在更新或切換分支，請稍候再送出；尚未建立本筆操作。"); return; }
      operationLease.current = release;
      try {
        attempt.current = { key: crypto.randomUUID(), clientId, input: input.data,
          body: JSON.stringify({ clientId, input: input.data }), previous: editor.record ? structuredClone(editor.record) : null,
          schema: structuredClone(editor.schema), ambiguous: false };
      } catch {
        releaseKnownOperation(); setError("無法建立本筆操作，尚未送出。請核對輸入後再試。"); return;
      }
      draftGuard.begin();
    }
    const operation = attempt.current;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetchWithTimeout("/api/forms/responses", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": operation.key }, body: operation.body });
      const raw: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const failure = errorEnvelope.safeParse(raw);
        if (!operation.ambiguous && [400,401,403,409,413].includes(response.status) && failure.success && definiteErrors.has(failure.data.errors[0]!.code)) {
          releaseKnownOperation(); if (!dirty) draftGuard.saved();
          if (mounted.current) { setUncertain(false); setError(failure.data.errors[0]!.message); } return;
        }
        throw new Error("結果未確認");
      }
      const body = envelope.parse(raw);
      const result = z.object({ receipt: z.unknown(), persisted: z.literal(true), demo: z.literal(false) }).strict().parse(body.data);
      const receipt = parseResponseReceipt(result.receipt, operation.input, operation.clientId, undefined, operation.previous, operation.schema);
      if (response.status !== (receipt.replayed ? 200 : 201)) throw new Error("回條狀態不一致");
      releaseKnownOperation(); draftGuard.saved();
      if (!mounted.current) return;
      setUncertain(false); setDirty(false); setAnswers(receipt.record.answers); setReason("");
      setEditor({ formVersionId: receipt.record.formVersionId, schema: receipt.record.schema, record: receipt.record, serviceDate: receipt.record.serviceDate });
      setSnapshot((current) => current ? { ...current, records: [receipt.record, ...current.records.filter((r) => r.id !== receipt.record.id)], total: Math.max(current.total, current.records.length + 1) } : current);
      setMessage(receipt.record.status === "signed" ? "已簽署；此版本已鎖定，更正需建立新版。" : "已保存填答；尚未簽署。");
    } catch {
      operation.ambiguous = true;
      if (mounted.current) { setUncertain(true); setError("儲存結果尚未確認。內容與操作識別碼已保留，請按「核對並重試原操作」；不要重新建立另一筆。"); }
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return <div className={styles.workspace}>
    <header><p className="eyebrow">個案紀錄</p><h1>機構自訂表單填答</h1><p>只使用已發布的機構自訂表單，不代替官方量表或自動計分。填答會保存於個案；簽署後只能建立更正版。</p></header>
    {demo && <p role="status" className="callout">合成展示模式：不會讀取或寫入正式個案。正式表單需由機構發布後使用。</p>}
    <section className={`panel ${styles.controls}`} aria-label="選擇個案">
      <label>個案<select value={clientId} disabled={locked || dirty} onChange={(event) => { if (printBusy || lock.current || attempt.current || dirty) return; setClientId(event.target.value); setSnapshot(null); setEditor(null); setAnswers({}); setMessage(""); }}><option value="">請選擇個案</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <button className="button button--primary" disabled={locked || dirty || !clientId || (demo && !demoSnapshot)} onClick={() => void load()}>載入個案表單</button>
    </section>
    {busy && <p role="status">正在核對資料，請稍候…</p>}{error && <p role="alert" className="callout">{error}</p>}{message && <p role="status" className="callout">{message}</p>}
    {uncertain && <button className="button button--primary" disabled={busy} onClick={() => void write(attempt.current?.input.action ?? "save")}>核對並重試原操作</button>}
    {snapshot && <>
      <section className="panel"><h2>{demo ? "檢視合成展示表單" : "新增填答"}</h2>{!snapshot.forms.length ? <p>尚無生效中的機構自訂表單，請由表單管理者完成發布。</p> : <label>已發布表單<select aria-label="已發布表單" value={editor?.record ? "" : editor?.formVersionId ?? ""} disabled={locked || dirty || (!canWrite && !demo)} onChange={(event) => {
        if (printBusy || lock.current || attempt.current || dirty) return;
        const form = snapshot.forms.find((f) => f.id === event.target.value);
        setEditor(form ? { formVersionId: form.id, schema: form.schema, record: null, serviceDate: today } : null); setAnswers({}); setReason(""); setError("");
      }}><option value="">選擇表單</option>{snapshot.forms.map((f) => <option key={f.id} value={f.id}>{f.name}・第 {f.version} 版</option>)}</select></label>}</section>
      {editor && <section className="panel" aria-label="填答內容"><h2>{editor.record ? `紀錄版本 ${editor.record.revision}・${editor.record.status === "signed" ? "已簽署" : "草稿"}` : "新的個案填答"}</h2>
        {historical && <p role="status">此為歷史版本，僅供查閱。請選擇此紀錄最新版本接續處理。</p>}
        <label>紀錄日期<input type="date" value={editor.serviceDate} max={today} disabled={demo || locked || Boolean(editor.record)} onChange={(e) => { if (printBusy || lock.current || attempt.current || demo) return; setEditor({ ...editor, serviceDate: e.target.value }); changed(); }} /></label>
        <fieldset disabled={demo || historical || locked || !canWrite || editor.record?.status === "signed"}><legend>填答欄位</legend>{editor.schema.fields.map((field) => {
          const a = answers[field.key] ?? { state: "missing" as const };
          const value = a.state === "answered" ? a.value : "";
          return <div key={field.key} className={styles.field}><label htmlFor={`answer-${field.key}`}>{field.label}{field.required ? "（必填）" : "（選填）"}</label>
            <select aria-label={`${field.label}填答狀態`} value={a.state} onChange={(e) => answer(field.key, e.target.value === "answered" ? { state: "answered", value: "" } : e.target.value === "not_applicable" ? { state: "not_applicable", reason: "" } : { state: "missing" })}>
              <option value="missing">未填</option><option value="answered">填寫</option>{!field.required && <option value="not_applicable">不適用</option>}
            </select>
            {a.state === "not_applicable" ? <input id={`answer-${field.key}`} aria-label={`${field.label}不適用原因`} value={a.reason} maxLength={500} onChange={(e) => answer(field.key, { state: "not_applicable", reason: e.target.value })} placeholder="請填不適用原因" />
              : a.state === "answered" ? field.type === "boolean" || field.type === "select" ? <select id={`answer-${field.key}`} value={String(value)} onChange={(e) => answer(field.key, e.target.value === "" ? { state: "missing" } : { state: "answered", value: field.type === "boolean" ? e.target.value === "true" : e.target.value })}>
                <option value="">請選擇</option>{field.type === "boolean" ? <><option value="true">是</option><option value="false">否</option></> : field.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                : <input id={`answer-${field.key}`} type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} value={String(value)} step={field.type === "number" ? "any" : undefined}
                  min={field.type === "number" ? field.minimum : undefined} max={field.type === "number" ? field.maximum : undefined} maxLength={field.type === "text" ? field.maxLength : undefined}
                  onChange={(e) => answer(field.key, { state: "answered", value: field.type === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value })} /> : <span id={`answer-${field.key}`}>尚未填寫，不會當成 0 或否。</span>}
          </div>;
        })}</fieldset>
        {editor.record?.status === "signed" ? <><label>更正原因<input value={reason} maxLength={500} disabled={demo || historical || locked || !canWrite} onChange={(e) => { if (printBusy || lock.current || attempt.current || demo || historical) return; setReason(e.target.value); changed(); }} /></label><button className="button button--secondary" disabled={demo || historical || locked || !canWrite || !reason.trim()} onClick={() => void write("correct")}>建立更正版</button></>
          : <div className={styles.actions}><button className="button button--primary" disabled={demo || historical || locked || !canWrite} onClick={() => void write("save")}>儲存填答草稿</button>
            <button className="button button--secondary" disabled={demo || historical || locked || dirty || !editor.record || !canSign} onClick={() => void write("sign")}>本人確認並簽署已保存版本</button>
            {!canSign && !demo && <span>正式簽署需簽署權限與近期身分驗證；儲存草稿不會代簽。 <Link href="/mfa?audience=staff&purpose=sensitive-action">前往身分驗證</Link></span>}</div>}
        {dirty && !locked && <button className="button button--quiet" onClick={() => { if (draftGuard.discard()) { setDirty(false); setEditor(null); setAnswers({}); setReason(""); } }}>捨棄本次未儲存輸入</button>}
        {editor.record && <CustomResponsePrintAction key={editor.record.id} record={editor.record} actor={printActor} canPrint={canPrint} demo={demo} blocked={busy || uncertain} dirty={dirty} onBusyChange={setPrintBusy} />}
      </section>}
      <section className="panel"><h2>填答與更正歷程</h2><p>已載入 {snapshot.records.length} 個版本。{snapshot.hasMore ? "還有較早紀錄可載入。" : "此清單已載入至最早紀錄。"}</p>
        {!snapshot.records.length && <p>此個案尚無機構自訂表單填答。</p>}
        <ul className={styles.history}>{snapshot.records.map((r) => { const latest = !snapshot.records.some((other) => other.recordKey === r.recordKey && other.revision > r.revision); return <li key={r.id}>
          <strong>{snapshot.forms.find((f) => f.id === r.formVersionId)?.name ?? "歷史機構表單"}</strong><span>{r.serviceDate}・版本 {r.revision}・{r.status === "signed" ? "已簽署" : "草稿"}{r.correctionSourceId ? "・更正版" : ""}</span>
          <button className="button button--secondary" disabled={locked || dirty} onClick={() => start(r)}>{latest ? "查看／接續處理" : "查看歷史版本"}</button>{!latest && <span>歷史版本不可覆寫；儲存時後端會阻擋過期版本。</span>}
        </li>; })}</ul>
        {snapshot.hasMore && <button className="button button--secondary" disabled={locked || dirty} onClick={() => void load(true)}>載入更早的 50 個版本</button>}
      </section>
    </>}
  </div>;
}
