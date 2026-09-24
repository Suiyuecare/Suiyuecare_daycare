"use client";
import { useEffect, useId, useRef, useState } from "react";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { TAIPEI_ABCD_TEMPLATE, TAIPEI_SECTIONS, taipeiFields, type TaipeiField, type TaipeiForm } from "@/lib/taipei-abcd/catalog";
import { parseTaipeiAnswers, validateTaipeiSnapshot } from "@/lib/taipei-abcd/parser";
import { taipeiDraftTotals, taipeiProgress } from "@/lib/taipei-abcd/progress";
import type { TaipeiAbcdPrefill, TaipeiAnswer, TaipeiAnswers, TaipeiDraft, TaipeiDraftMutation, TaipeiDraftSnapshot, TaipeiMonthlySources } from "@/lib/taipei-abcd/types";
import { isIntegrationError } from "@/lib/integrations/errors";
import styles from "./taipei-abcd.module.css";
import { TaipeiAbcdReview } from "./taipei-abcd-review";
import type { transitionReceiptSchema } from "@/lib/taipei-abcd/workflow";

export type TaipeiAbcdIntakeStepProps = { clientId: string; organizationId: string; branchId: string;
  usageYear?: 115; readOnly?: boolean; prefill?: TaipeiAbcdPrefill[]; demo?: boolean; today?: string; onDirty?: (dirty: boolean) => void;
  onBusy?: (busy: boolean) => void };
const missing: TaipeiAnswer = { state: "missing", value: null, reason: null };
function dateLabel(value: string) { return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
const measureLabels: Record<string, string> = { temperature: "體溫", pulse: "脈搏", respiratory_rate: "呼吸", blood_pressure_systolic: "收縮壓", blood_pressure_diastolic: "舒張壓", weight: "體重" };

function AnswerInput({ field, answer, disabled, onChange, invalid = false, errorId }: { field: TaipeiField; answer: TaipeiAnswer; disabled: boolean; onChange: (next: TaipeiAnswer) => void; invalid?: boolean; errorId?: string }) {
  const id = useId(); const current = answer.value;
  const changeValue = (value: TaipeiAnswer["value"]) => onChange({ state: value === "" || value === null || (Array.isArray(value) && !value.length) ? "missing" : "recorded", value: value === "" || (Array.isArray(value) && !value.length) ? null : value, reason: null });
  return <div className={styles.field} data-taipei-field={field.key}>
    <label htmlFor={`${id}-state`}>{field.label}</label>
    <select id={`${id}-state`} aria-label={`${field.label}資料狀態`} aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined} value={answer.state} disabled={disabled} onChange={e => {
      const state = e.target.value as TaipeiAnswer["state"];
      onChange({ state, value: state === "recorded" ? (current ?? "") : null, reason: state === "not_applicable" ? "" : null });
    }}>
      <option value="missing">未填／待確認</option><option value="recorded">已核對填寫</option><option value="not_applicable">不適用（需原因）</option>
      {answer.state === "unconfirmed" && <option value="unconfirmed">來源預填，尚未核對</option>}
    </select>
    {field.help && <small>{field.help}</small>}
    {answer.state === "not_applicable" ? <><label htmlFor={`${id}-reason`}>不適用原因</label><textarea id={`${id}-reason`} rows={2} maxLength={1000} value={answer.reason ?? ""} disabled={disabled} onChange={e => onChange({ ...answer, reason: e.target.value })} /></> : <>
      {field.kind === "choice" ? <select aria-label={`${field.label}內容`} value={typeof current === "string" ? current : ""} disabled={disabled} onChange={e => changeValue(e.target.value)}><option value="">請選擇</option>{field.options?.map(o => <option key={o} value={o}>{o}</option>)}</select> : field.kind === "multi" ?
        <div className={styles.choices} role="group" aria-label={`${field.label}內容`}>{field.options?.map(o => <label key={o}><input type="checkbox" checked={Array.isArray(current) && current.includes(o)} disabled={disabled} onChange={e => { const selected = Array.isArray(current) ? current : []; changeValue(e.target.checked ? [...selected, o] : selected.filter(x => x !== o)); }} />{o}</label>)}</div> :
        field.kind === "text" ? <textarea aria-label={`${field.label}內容`} rows={2} maxLength={4000} value={typeof current === "string" ? current : ""} disabled={disabled} onChange={e => changeValue(e.target.value)} /> :
        <input aria-label={`${field.label}內容`} type={field.kind === "date" ? "date" : "number"} min={field.min} max={field.max} step={field.kind === "number" ? "any" : undefined} value={typeof current === "string" || typeof current === "number" ? current : ""} disabled={disabled} onChange={e => changeValue(e.target.value === "" ? null : field.kind === "number" ? Number(e.target.value) : e.target.value)} />}
      {answer.state === "unconfirmed" && <button type="button" disabled={disabled} onClick={() => onChange({ ...answer, state: "recorded" })}>我已核對此來源值</button>}
    </>}
  </div>;
}

function MonthlySources({ sources, saved = false }: { sources: TaipeiMonthlySources | null; saved?: boolean }) {
  if (!sources) return <p>尚未載入實際紀錄。到站安排或核定計畫不算已執行。</p>;
  return <div>
    <p className={styles.muted}>來源快照：{dateLabel(sources.capturedAt)}。{saved ? "這是已保存版本的凍結來源，與本版送審、核准及 PDF 相同；新紀錄不會改寫此版。" : "這是目前最新來源；另存草稿時才會重新取得實際紀錄並凍結於新版本，不會改寫舊版。"}</p>
    <details><summary>C1 當月實際量測：{sources.measurements.length} 筆</summary><div className={styles.sectionBody}>
      {!sources.measurements.length && <p>尚無量測，請先至生命徵象頁記錄實際量測；不能用 CMS 數值充當當月執行。</p>}
      {sources.measurements.map(m => <div className={styles.source} key={m.id}><strong>{dateLabel(m.measuredAt)} · {measureLabels[m.kind] ?? m.kind}</strong><p>{m.numericValue ?? m.textValue ?? "未記錄"} {m.unit ?? ""}</p><p className={styles.muted}>紀錄者：{m.recordedBy ?? "來源未提供"}；來源紀錄 {m.id}</p></div>)}
    </div></details>
    <details><summary>C2／C3 當月已簽署照顧紀錄：{sources.careRecords.length} 筆</summary><div className={styles.sectionBody}>
      {!sources.careRecords.length && <p>尚無可引用的已簽署照顧紀錄。請先完成原始照顧執行、活動參與及互動紀錄。</p>}
      {sources.careRecords.map(r => <div className={styles.source} key={r.id}><strong>{dateLabel(r.occurredAt)} · 第 {r.version} 版</strong><dl><dt>照顧項目</dt><dd>{typeof r.data.care_item === "string" ? r.data.care_item : "來源未提供"}</dd><dt>觀察與處置</dt><dd>{typeof r.data.note === "string" ? r.data.note : "來源未提供，需補原始紀錄"}</dd></dl><p className={styles.muted}>紀錄者 {r.recordedBy}；來源紀錄 {r.id}</p></div>)}
    </div></details>
    <p className={styles.muted}>執行摘要仍須核對到照顧問題、活動參與與同儕互動；有來源筆數不等於 C 表已完成。</p>
  </div>;
}

function TaipeiAbcdEditor({ clientId, organizationId, branchId, usageYear = 115, readOnly = false, prefill = [], demo = false, today, onDirty, onBusy }: TaipeiAbcdIntakeStepProps) {
  const [form, setForm] = useState<TaipeiForm>("A"); const [month, setMonth] = useState(() => today && /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/u.test(today) ? Number(today.slice(5, 7)) : 1);
  const [snapshot, setSnapshot] = useState<TaipeiDraftSnapshot | null>(null); const [answers, setAnswers] = useState<TaipeiAnswers>({});
  const [loading, setLoading] = useState(!demo); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(demo ? "展示模式：可以查看完整欄位；不會寫入正式資料。" : null); const [dirty, setDirty] = useState(false); const [reload, setReload] = useState(0);
  const [reviewDirty, setReviewDirty] = useState(false);
  const [invalidField, setInvalidField] = useState<string | null>(null); const editorRef = useRef<HTMLElement>(null); const errorId = useId();
  const pending = useRef<TaipeiDraftMutation | null>(null); const requestGeneration = useRef(0); const inFlight = useRef(false);
  const effectiveMonth = form === "C" ? month : 0; const identity = `${organizationId}/${branchId}/${clientId}/${form}/${effectiveMonth}`;
  useEffect(() => {
    let current = true; const generation = ++requestGeneration.current; const controller = new AbortController();
    pending.current = null;
    if (demo) return () => { current = false; controller.abort(); };
    const query = new URLSearchParams({ client: clientId, form, year: String(usageYear), month: String(effectiveMonth) });
    fetchWithTimeout(`/api/taipei-abcd/drafts?${query}`, { cache: "no-store", signal: controller.signal }, 15000).then(async response => {
      const result = await response.json(); if (!response.ok || !result.data) throw new Error(result.errors?.[0]?.message ?? "表單載入失敗，請重試。");
      const next = validateTaipeiSnapshot(result.data, { organizationId, branchId, clientId, form, usageYear, month: effectiveMonth });
      if (current && generation === requestGeneration.current) { setSnapshot(next); setAnswers(next.latest?.answers ?? {}); }
    }).catch(cause => { if (current) setError(controller.signal.aborted ? "載入逾時，請檢查連線後重試。" : cause instanceof Error ? cause.message : "目前無法讀取表單。"); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [organizationId, branchId, clientId, form, effectiveMonth, usageYear, reload, demo]);
  useEffect(() => { if (!dirty && !reviewDirty) return; const handler = (e: BeforeUnloadEvent) => e.preventDefault(); window.addEventListener("beforeunload", handler); return () => window.removeEventListener("beforeunload", handler); }, [dirty, reviewDirty]);
  useEffect(() => { onDirty?.(dirty || reviewDirty); }, [dirty, reviewDirty, onDirty]);
  useEffect(() => { onBusy?.(saving); return () => onBusy?.(false); }, [saving, onBusy]);
  useEffect(() => {
    if (!invalidField || !editorRef.current) return;
    const field = [...editorRef.current.querySelectorAll<HTMLElement>("[data-taipei-field]")].find((node) => node.dataset.taipeiField === invalidField);
    const section = field?.closest("details"); if (section) section.open = true;
    field?.querySelector<HTMLElement>("select")?.focus();
  }, [invalidField]);
  const disabled = readOnly || demo || loading || saving || !snapshot?.canEdit;
  const progress = taipeiProgress(form, answers); const totals = taipeiDraftTotals(answers);
  function changeAnswer(key: string, answer: TaipeiAnswer) { setAnswers(old => ({ ...old, [key]: answer })); setDirty(true); setMessage(null); pending.current = null; }
  function resetView() { setLoading(!demo); setSnapshot(null); setAnswers({}); setDirty(false); setReviewDirty(false); setError(null); setInvalidField(null); setMessage(demo ? "展示模式：可以查看完整欄位；不會寫入正式資料。" : null); pending.current = null; }
  function changeForm(next: TaipeiForm) { if (next === form || saving || ((dirty || reviewDirty) && !window.confirm("尚有未儲存的草稿或審核理由，切換將放棄本頁輸入。確定切換？"))) return; resetView(); setForm(next); }
  async function refreshReview(receipt: ReturnType<typeof transitionReceiptSchema.parse>) {
    const query = new URLSearchParams({ client: clientId, form, year: String(usageYear), month: String(effectiveMonth) });
    const response = await fetchWithTimeout(`/api/taipei-abcd/drafts?${query}`, { cache: "no-store" }); const body = await response.json();
    if (!response.ok || !body.data) throw new Error("審核操作已有回條，但尚未讀回；請保留原操作重試。");
    const next = validateTaipeiSnapshot(body.data, { organizationId, branchId, clientId, form, usageYear, month: effectiveMonth });
    if (next.latest?.id !== receipt.draftId || next.workflow?.sequence !== receipt.sequence || next.workflow?.state !== receipt.state || !next.workflow.events.some(e => e.id === receipt.eventId)) throw new Error("已存審核回條與最新版本不同，請重新載入核對。");
    setSnapshot(next); setAnswers(next.latest.answers); setDirty(false);
  }
  async function save() {
    if (disabled || !snapshot || inFlight.current) return;
    inFlight.current = true;
    setSaving(true); setError(null); setInvalidField(null); setMessage(null); const generation = requestGeneration.current;
    try {
      const normalized = Object.fromEntries(Object.entries(answers).map(([key, a]) => [key, { ...a, value: typeof a.value === "string" ? a.value.trim() : a.value, reason: a.reason?.trim() || null }]));
      parseTaipeiAnswers(form, normalized);
      const payload = pending.current ?? { client_id: clientId, form, usage_year: usageYear, month: effectiveMonth, template_key: TAIPEI_ABCD_TEMPLATE.key,
        source_revision: TAIPEI_ABCD_TEMPLATE.sourceRevision, source_sha256: TAIPEI_ABCD_TEMPLATE.sourceSha256,
        expected_version: snapshot.latest?.version ?? 0, expected_content_hash: snapshot.latest?.contentHash ?? null,
        answers: normalized, idempotency_key: crypto.randomUUID() };
      pending.current = payload;
      const response = await fetchWithTimeout("/api/taipei-abcd/drafts", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": payload.idempotency_key }, body: JSON.stringify(payload), cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.data?.draft) throw new Error(result.errors?.[0]?.message ?? "尚無法確認儲存結果，請保持內容並重試。");
      const row = result.data.draft as TaipeiDraft;
      validateTaipeiSnapshot({ ...snapshot, latest: row },
        { organizationId, branchId, clientId, form, usageYear, month: effectiveMonth });
      const verifyQuery = new URLSearchParams({ client: clientId, form, year: String(usageYear), month: String(effectiveMonth) });
      const verifyResponse = await fetchWithTimeout(`/api/taipei-abcd/drafts?${verifyQuery}`, { cache: "no-store" });
      const verification = await verifyResponse.json();
      if (!verifyResponse.ok || !verification.data) throw new Error("伺服器已回報儲存，但最新資料尚未讀回。請保留內容重試；不需重新建立另一份表單。");
      const next = validateTaipeiSnapshot(verification.data, { organizationId, branchId, clientId, form, usageYear, month: effectiveMonth });
      if (!next.latest || next.latest.id !== row.id || next.latest.version !== row.version || next.latest.contentHash !== row.contentHash) throw new Error("儲存後的版本尚未核對一致，或已有其他人更新。請保留輸入並重新載入核對。");
      if (generation === requestGeneration.current) { setSnapshot(next); setAnswers(row.answers); setDirty(false); pending.current = null; setMessage(`已保存 ${form} 表草稿第 ${row.version} 版，可重新載入核對。尚未正式發布或簽署。`); }
    } catch (cause) { if (generation === requestGeneration.current) {
      const invalid = isIntegrationError(cause) && cause.field ? taipeiFields(form).find((field) => field.key === cause.field) : undefined;
      if (invalid) { setInvalidField(invalid.key); setError(`「${invalid.label}」的內容或資料狀態尚未完成。已開啟該欄位；請填妥內容、補上不適用原因，或改回未填／待確認。草稿尚未儲存。`); }
      else setError(cause instanceof Error ? cause.message : "儲存失敗，請重試。");
    } }
    finally { inFlight.current = false; if (generation === requestGeneration.current) setSaving(false); }
  }
  const suggestions = prefill.filter(p => taipeiFields(form).some(f => f.key === p.fieldKey && f.prefillAllowed) && (!answers[p.fieldKey] || answers[p.fieldKey].state === "missing"));
  return <section ref={editorRef} className={styles.workspace} aria-label="臺北市 A B C 收案表單" key={identity}>
    <h3>補齊個案資料與照顧評估</h3>
    <div className={styles.notice}><p>115 年度臺北市表單 · 原稿 114.11 修訂。這裡保存逐欄草稿，不代表官方表單已發布、評估已完成或任何人已簽署。</p><p>D 表是小規模多機能臨時住宿紀錄，本機構純日照範圍不適用，不需填寫。</p></div>
    <div className={styles.tabs} role="group" aria-label="選擇表別">{(["A", "B", "C"] as const).map(x => <button type="button" key={x} aria-pressed={form === x} onClick={() => changeForm(x)} disabled={saving}>{x} 表 · {x === "A" ? "基本資料" : x === "B" ? "需求與照顧計畫" : "當月執行"}</button>)}</div>
    {form === "C" && <label>115 年度月份 <select value={month} disabled={saving} onChange={e => { if ((!dirty && !reviewDirty) || window.confirm("切換月份會放棄未存草稿或審核理由，確定切換？")) { resetView(); setMonth(Number(e.target.value)); } }}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} 月</option>)}</select></label>}
    {loading && <p role="status">正在載入此個案的 {form} 表……</p>}
    {error && <div className={styles.error} role="alert" id={errorId}><p>{error}</p><button type="button" disabled={saving} onClick={() => { if ((!dirty && !reviewDirty) || window.confirm("重新載入會放棄未存輸入或審核理由，確定繼續？")) { resetView(); setReload(x => x + 1); } }}>重新載入</button></div>}
    {message && <p role="status">{message}</p>}
    {!loading && <>
      <p>{snapshot?.latest ? `已存第 ${snapshot.latest.version} 版` : "尚無已存草稿"} · 已填 {progress.recorded} 項 · 不適用 {progress.notApplicable} 項 · 待核對 {progress.unconfirmed} 項 · 未填 {progress.missing} 項</p>
      <p className={styles.muted}>未填欄位含條件式補充欄，不代表每一項都必填。最終完整性須由表單核准規則與負責人覆核，不能以比例判定收案通過。</p>
      {suggestions.length > 0 && <details><summary>可核對的來源建議：{suggestions.length} 項</summary><div className={styles.sectionBody}>{suggestions.map(s => <div key={s.fieldKey}><p>{taipeiFields(form).find(f => f.key === s.fieldKey)?.label} · 來源：{s.sourceLabel}</p><button type="button" disabled={disabled} onClick={() => { const answer: TaipeiAnswer = { state: "unconfirmed", value: s.value, reason: null }; try { parseTaipeiAnswers(form, { [s.fieldKey]: answer }); changeAnswer(s.fieldKey, answer); } catch { setError("來源值與欄位格式不符，請人工核對後填寫。"); } }}>帶入為待核對</button></div>)}</div></details>}
      {form === "C" && <>
        {snapshot?.latest && <section aria-label="C 表已保存版本來源"><h4>已保存第 {snapshot.latest.version} 版的來源</h4><MonthlySources sources={snapshot.latest.sourceSnapshot} saved /></section>}
        {snapshot?.latest ? <details><summary>查看目前最新來源（不屬於已保存版本）</summary><MonthlySources sources={snapshot.currentSources} /></details> : <section aria-label="C 表目前最新來源"><h4>目前最新來源（尚未保存）</h4><MonthlySources sources={snapshot?.currentSources ?? null} /></section>}
      </>}
      {TAIPEI_SECTIONS[form].map((section, index) => <details key={section.code} open={index === 0}><summary>{section.code} · {section.title}</summary><div className={styles.sectionBody}>
        <p className={styles.muted}>原表第 {section.sourcePages.join("、")} 頁{section.help ? ` · ${section.help}` : ""}</p>
        <div className={styles.fields}>{section.fields.map(field => <AnswerInput key={field.key} field={field} answer={answers[field.key] ?? missing} disabled={disabled} invalid={invalidField === field.key} errorId={errorId} onChange={next => changeAnswer(field.key, next)} />)}</div>
      </div></details>)}
      {form === "B" && <div className={styles.notice}><p>草稿核對小計：營養 {totals.nutrition ?? "未填齊"}／14；SPPB {totals.sppb ?? "未填齊"}／12；跌倒因子 {totals.fallFactors ?? "未填齊"}／12；SPMSQ 錯誤 {totals.spmsqErrors ?? "未填齊"}／10。</p><p>小計不會產生診斷或照顧決策；未核對／不適用不當作 0 分。</p></div>}
      <div className={styles.toolbar}><button className={styles.primary} type="button" disabled={disabled} onClick={save}>{saving ? "儲存中……" : `儲存 ${form} 表草稿`}</button><span>{dirty ? "尚有未存內容" : "僅保存草稿，不代替簽署"}</span></div>
      {snapshot && !demo && <TaipeiAbcdReview key={`${identity}/${snapshot.latest?.id ?? "new"}`} snapshot={snapshot} unsavedAnswers={dirty} disabled={readOnly || loading || saving} onBusy={setSaving} onDirty={setReviewDirty} onChanged={refreshReview} />}
      <details><summary>簽署與版本</summary><div className={styles.sectionBody}><p>A 表填表人／主管、B 表護理／社工／主管、C 表服務提供者／個管／主管簽署，須待正式範本雙人核准流程接通後，由本人依權限操作；本頁沒有代簽按鈕。</p><p>每次儲存新增版本，舊版本不可更新或刪除。草稿不能送出為正式官方完成表。</p>{snapshot?.history.map(r => <p key={r.id}>草稿第 {r.version} 版 · {dateLabel(r.createdAt)}</p>)}</div></details>
    </>}
  </section>;
}

export function TaipeiAbcdIntakeStep(props: TaipeiAbcdIntakeStepProps) {
  return <TaipeiAbcdEditor key={`${props.organizationId}/${props.branchId}/${props.clientId}/${props.usageYear ?? 115}`} {...props} />;
}
