"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { customDraftPayloadSchema, parseCustomDraftReadResponse, parseCustomDraftSaveResponse, testCustomForm,
  type CustomDraftDocument, type CustomDraftPayload, type CustomFormField } from "@/lib/form-governance/custom-draft";
import { parseFormPublicationActionError } from "@/lib/form-governance/parser";
import styles from "./custom-form-draft-editor.module.css";

function initialPayload(): CustomDraftPayload {
  return { formKey: "tenant.custom.", name: "", category: "行政表單", effectiveFrom: null, effectiveTo: null,
    schema: { builder: "tenant-custom.v1", fields: [{ key: "item_1", label: "", type: "text", required: true, maxLength: 500 }] } };
}
function changeType(field: CustomFormField, type: CustomFormField["type"]): CustomFormField {
  const base = { key: field.key, label: field.label, required: field.required };
  if (type === "text") return { ...base, type, maxLength: 500 };
  if (type === "number") return { ...base, type, minimum: 0, maximum: 100 };
  if (type === "select") return { ...base, type, options: ["選項一", "選項二"] };
  return { ...base, type };
}

function describeField(field: CustomFormField) {
  const type = { text: "文字", number: "數字", date: "日期", boolean: "是／否", select: "單選" }[field.type];
  const rule = field.type === "text" ? `最多 ${field.maxLength} 字` : field.type === "number" ? `${field.minimum} 至 ${field.maximum}`
    : field.type === "select" ? field.options.join("、") : "";
  return `${field.label}（${field.key}）・${type}・${field.required ? "必填" : "選填"}${rule ? `・${rule}` : ""}`;
}

// A status alone cannot prove that a write failed. Only a validated error
// envelope and a known status/code pair can reject an initial attempt. A later
// rejection cannot disprove that an earlier ambiguous request already committed.
function definiteSaveFailure(value: unknown, status: number) {
  const envelope = parseFormPublicationActionError(value);
  const code = envelope?.errors[0]?.code;
  if (!code) return null;
  const known: Record<number, readonly string[]> = {
    400: ["INVALID_CUSTOM_FORM_DRAFT", "IDEMPOTENCY_KEY_REQUIRED", "INVALID_JSON"],
    401: ["AUTH_REQUIRED"],
    403: ["CUSTOM_FORM_NOT_AUTHORIZED", "AAL2_REQUIRED", "DEMO_READ_ONLY", "BRANCH_CONTEXT_REQUIRED"],
    409: ["CUSTOM_FORM_CONFLICT", "CUSTOM_FORM_LOCKED"],
    413: ["REQUEST_TOO_LARGE"],
  };
  return known[status]?.includes(code) ? { code, message: envelope.errors[0]!.message } : null;
}

export function CustomFormDraftEditor({ versionId, enabled, canSave = enabled, disabledReason, instance = "create" }: {
  versionId?: string; enabled: boolean; canSave?: boolean; disabledReason?: string; instance?: string;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const attempt = useRef<{ key: string; body: { formVersionId: string | null; baseRevision: number | null; payload: CustomDraftPayload } } | null>(null);
  const [document, setDocument] = useState<CustomDraftDocument | null>(null);
  const [payload, setPayload] = useState(initialPayload);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retainInput, setRetainInput] = useState(false);
  const [conflict, setConflict] = useState<"stale" | "locked" | null>(null);
  const [comparison, setComparison] = useState<CustomDraftDocument | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [test, setTest] = useState<ReturnType<typeof testCustomForm> | null>(null);
  const id = `custom-form-${instance}-${versionId ?? "new"}`;
  const locked = pending || uncertain || completed || conflict === "locked" || Boolean(versionId && !document);
  const schemaCheck = customDraftPayloadSchema.safeParse(payload);

  function update(value: CustomDraftPayload) { setPayload(value); setTest(null); setAnswers({}); }
  function field(index: number, value: CustomFormField) {
    update({ ...payload, schema: { ...payload.schema, fields: payload.schema.fields.map((entry, position) => position === index ? value : entry) } });
  }
  async function open() {
    if (!enabled) return;
    dialog.current?.showModal();
    if (uncertain || (retainInput && !completed)) return;
    attempt.current = null;
    setRetainInput(false); setConflict(null); setComparison(null);
    setCompleted(false); setError(null); setNotice(null); setTest(null); setAnswers({});
    if (!versionId) { setDocument(null); setPayload(initialPayload()); return; }
    setPending(true); setDocument(null);
    try {
      const response = await fetchWithTimeout(`/api/forms/drafts/${versionId}`, { cache: "no-store" });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) { setError(parseFormPublicationActionError(body)?.errors[0]?.message ?? "草稿暫時無法讀取，請關閉後重試。"); return; }
      const loaded = parseCustomDraftReadResponse(body, versionId);
      setDocument(loaded); setPayload(loaded.payload);
    } catch { setError("草稿尚未完整載入；不會使用舊資料覆蓋，請關閉後重試。"); }
    finally { setPending(false); }
  }
  async function reloadForComparison() {
    if (!versionId || pending || uncertain) return;
    setPending(true); setError(null); setComparison(null);
    try {
      const response = await fetchWithTimeout(`/api/forms/drafts/${versionId}`, { cache: "no-store" });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const failure = definiteSaveFailure(body, response.status);
        if (failure?.code === "CUSTOM_FORM_LOCKED") setConflict("locked");
        setError(failure?.message ?? "最新草稿尚未完整讀取；您的輸入仍保留，可再次載入核對。");
        return;
      }
      // Loading never advances the baseline or replaces local input. Only the
      // explicit acknowledgement below adopts a freshly reviewed revision.
      setComparison(parseCustomDraftReadResponse(body, versionId));
    } catch { setError("最新草稿尚未完整讀取；您的輸入仍保留，可再次載入核對。"); }
    finally { setPending(false); }
  }
  async function save() {
    if (pending || completed || conflict || !canSave || (versionId && !document)) return;
    if (!attempt.current) {
      const validated = customDraftPayloadSchema.safeParse(payload);
      if (!validated.success) { setError("請先完成表單名稱、代碼與所有欄位設定。"); return; }
      attempt.current = { key: crypto.randomUUID(), body: { formVersionId: document?.formVersionId ?? null, baseRevision: document?.revision ?? null, payload: validated.data } };
    }
    setPending(true); setError(null);
    try {
      const response = await fetchWithTimeout("/api/forms/drafts", { method: "POST", headers: {
        "Content-Type": "application/json", "Idempotency-Key": attempt.current.key,
      }, body: JSON.stringify(attempt.current.body) });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const failure = definiteSaveFailure(body, response.status);
        setError(failure?.message ?? "儲存結果尚未確認，請用原操作重試。");
        if (failure && !uncertain) {
          attempt.current = null; setUncertain(false); setRetainInput(true); setComparison(null);
          if (failure.code === "CUSTOM_FORM_LOCKED") setConflict("locked");
          else if (failure.code === "CUSTOM_FORM_CONFLICT" && versionId) setConflict("stale");
          else if (failure.code === "CUSTOM_FORM_CONFLICT") setNotice("您的輸入已保留。請修改已被使用的表單代碼，再儲存草稿；不會重送原衝突操作。");
        } else {
          setUncertain(true);
          if (failure) setNotice("先前儲存結果仍未確認；本次被拒絕不表示先前未儲存。請先處理登入或權限問題，再以原操作核對，勿另建第二份。");
        }
        return;
      }
      parseCustomDraftSaveResponse(body, attempt.current.body, response.status);
      setCompleted(true); setUncertain(false); attempt.current = null;
      setNotice("草稿已儲存，尚未發布。請關閉視窗，在版本清單送出覆核。"); router.refresh();
    } catch { setUncertain(true); setError("網路或回覆狀態不明；內容已保留，請按「重試原儲存」。不會建立第二份表單。"); }
    finally { setPending(false); }
  }

  return <>
    <button ref={trigger} type="button" className="button button--secondary" disabled={!enabled} title={disabledReason} onClick={() => void open()}>
      {versionId ? "編輯自訂草稿" : "建立自訂表單"}
    </button>
    <dialog ref={dialog} className={`core-dialog ${styles.dialog}`} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
      onCancel={(event) => { if (pending) event.preventDefault(); }} onClose={() => trigger.current?.focus()}>
      <div className="core-dialog__surface">
        <header className="drawer__header"><div><h2 id={`${id}-title`}>{versionId ? "編輯自訂草稿" : "建立自訂表單"}</h2>
          <p id={`${id}-description`}>只建立機構自己的欄位，不改官方表單。試填不保存，也不計分或產生個案紀錄。</p></div>
          <button type="button" className="button button--secondary" disabled={pending} onClick={() => dialog.current?.close()}>關閉</button></header>
        <div className={`drawer__body core-dialog__body ${styles.body}`}>
          {!canSave ? <p className="callout" role="status">目前可在畫面試做表單；展示模式或尚未重新驗證時不會儲存正式資料。</p> : null}
          {pending ? <p role="status">正在確認資料…</p> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {notice ? <p role="status">{notice}</p> : null}
          {uncertain ? <p role="alert">此操作結果未確認，暫時鎖定輸入，避免重試時改變內容。關閉重開仍會保留原操作。</p> : null}
          {conflict ? <section className={styles.fields} aria-label="草稿衝突核對">
            <h3>{conflict === "locked" ? "此版本已鎖定，不能再儲存" : "先核對最新草稿，再決定修改"}</h3>
            <p>{conflict === "locked" ? "您的輸入仍保留於此視窗，但不會覆寫已送審或已發布版本。請回版本清單確認狀態。" : "您的輸入已保留。載入最新版本只供比較，不會覆蓋輸入，也不會自動變更儲存基準。"}</p>
            {conflict === "stale" ? <button type="button" className="button button--secondary" disabled={pending} onClick={() => void reloadForComparison()}>載入最新草稿並核對</button> : null}
            {comparison ? <div>
              <h4>您保留的輸入（原修訂 {document?.revision}）</h4>
              <p>生效：{payload.effectiveFrom ?? "未設定"} ～ {payload.effectiveTo ?? "持續有效"}</p>
              <ol>{payload.schema.fields.map((item, index) => <li key={index}>{describeField(item)}</li>)}</ol>
              <h4>伺服器最新草稿（修訂 {comparison.revision}）</h4>
              <p>生效：{comparison.payload.effectiveFrom ?? "未設定"} ～ {comparison.payload.effectiveTo ?? "持續有效"}</p>
              <ol>{comparison.payload.schema.fields.map((item, index) => <li key={index}>{describeField(item)}</li>)}</ol>
              <button type="button" className="button button--secondary" disabled={pending} onClick={() => {
                setDocument(comparison); setComparison(null); setConflict(null); setError(null); attempt.current = null;
                setNotice("已採用核對後的修訂版；您的欄位修改仍保留，尚未儲存。再次儲存時仍會檢查有無其他更新。");
              }}>已核對，保留我的內容並繼續編輯</button>
            </div> : null}
          </section> : null}
          <fieldset disabled={locked} className={styles.fields}><legend>1. 表單名稱與期間</legend>
            <label>表單名稱<input value={payload.name} disabled={Boolean(versionId)} maxLength={120} onChange={(e) => update({ ...payload, name: e.target.value })} /></label>
            <label>表單代碼<input value={payload.formKey} disabled={Boolean(versionId)} maxLength={74} onChange={(e) => update({ ...payload, formKey: e.target.value })} aria-describedby={`${id}-code-help`} /></label>
            <p id={`${id}-code-help`}>以 tenant.custom. 開頭，加至少兩位英文小寫代碼，例如 tenant.custom.daily_check。建立後名稱、類型及代碼固定。</p>
            <label>類型<select value={payload.category} disabled={Boolean(versionId)} onChange={(e) => update({ ...payload, category: e.target.value as CustomDraftPayload["category"] })}>
              {["照顧表單", "品質表單", "行政表單"].map((label) => <option key={label}>{label}</option>)}</select></label>
            <label>生效日<input type="date" value={payload.effectiveFrom ?? ""} onChange={(e) => update({ ...payload, effectiveFrom: e.target.value || null })} /></label>
            <label>結束日（可留空）<input type="date" value={payload.effectiveTo ?? ""} onChange={(e) => update({ ...payload, effectiveTo: e.target.value || null })} /></label>
          </fieldset>
          <fieldset disabled={locked} className={styles.fields}><legend>2. 欄位設定（最多 40 題）</legend>
            {payload.schema.fields.map((item, index) => <fieldset className={styles.fieldCard} key={index}><legend>第 {index + 1} 題</legend>
              <label>題目<input value={item.label} maxLength={120} onChange={(e) => field(index, { ...item, label: e.target.value })} /></label>
              <label>欄位代碼<input value={item.key} maxLength={40} onChange={(e) => field(index, { ...item, key: e.target.value })} /></label>
              <label>輸入方式<select value={item.type} onChange={(e) => field(index, changeType(item, e.target.value as CustomFormField["type"]))}>
                <option value="text">文字</option><option value="number">數字</option><option value="date">日期</option><option value="boolean">是／否</option><option value="select">單選</option></select></label>
              <label className={styles.checkbox}><input type="checkbox" checked={item.required} onChange={(e) => field(index, { ...item, required: e.target.checked })} />必填</label>
              {item.type === "text" ? <label>最多字數<input type="number" min={1} max={4000} value={item.maxLength} onChange={(e) => field(index, { ...item, maxLength: e.target.valueAsNumber })} /></label> : null}
              {item.type === "number" ? <><label>最小值<input type="number" value={item.minimum} onChange={(e) => field(index, { ...item, minimum: e.target.valueAsNumber })} /></label><label>最大值<input type="number" value={item.maximum} onChange={(e) => field(index, { ...item, maximum: e.target.valueAsNumber })} /></label></> : null}
              {item.type === "select" ? <label>選項（每行一個，2 至 20 個）<textarea value={item.options.join("\n")} rows={3} onChange={(e) => field(index, { ...item, options: e.target.value.split("\n") })} /></label> : null}
              <button className="button button--secondary" type="button" disabled={payload.schema.fields.length === 1} onClick={() => update({ ...payload, schema: { ...payload.schema, fields: payload.schema.fields.filter((_, i) => i !== index) } })}>移除第 {index + 1} 題</button>
            </fieldset>)}
            <button className="button button--secondary" type="button" disabled={payload.schema.fields.length >= 40} onClick={() => {
              const used = new Set(payload.schema.fields.map((item) => item.key)); let next = 1; while (used.has(`item_${next}`)) next++;
              update({ ...payload, schema: { ...payload.schema, fields: [...payload.schema.fields, { key: `item_${next}`, label: "", required: false, type: "text", maxLength: 500 }] } });
            }}>新增一題</button>
          </fieldset>
          {!schemaCheck.success ? <div role="status"><p>尚需完成：</p><ul>{schemaCheck.error.issues.slice(0, 8).map((issue, i) => <li key={i}>{issue.path.join(".")}：{issue.message}</li>)}</ul></div> : <fieldset className={styles.fields}><legend>3. 試填與檢查（請勿輸入真實個資）</legend>
            {payload.schema.fields.map((item) => <label key={item.key}>{item.label}{item.required ? "（必填）" : "（選填）"}
              {item.type === "select" || item.type === "boolean" ? <select value={answers[item.key] === undefined ? "" : String(answers[item.key])} onChange={(e) => {
                setTest(null); setAnswers({ ...answers, [item.key]: e.target.value === "" ? undefined : item.type === "boolean" ? e.target.value === "true" : e.target.value });
              }}><option value="">尚未填寫</option>{item.type === "select" ? item.options.map((option) => <option key={option}>{option}</option>) : <><option value="true">是</option><option value="false">否</option></>}</select>
                : <input type={item.type === "text" ? "text" : item.type} value={String(answers[item.key] ?? "")} onChange={(e) => { setTest(null); setAnswers({ ...answers, [item.key]: item.type === "number" && e.target.value !== "" ? e.target.valueAsNumber : e.target.value }); }} />}
            </label>)}
            <button type="button" className="button button--secondary" onClick={() => setTest(testCustomForm(payload.schema, answers))}>檢查試填</button>
            {test ? <div role="status"><p>{test.valid ? `已檢查 ${test.checked} 題，試填符合設定。` : "試填還有未完成項目："}</p><ul>{test.errors.map((message) => <li key={message}>{message}</li>)}</ul><p>此結果不是正式評估、簽署或計分。</p></div> : null}
          </fieldset>}
        </div>
        <footer className="drawer__footer"><button type="button" className="button button--secondary" disabled={pending} onClick={() => dialog.current?.close()}>關閉</button>
          <button type="button" className="button button--primary" disabled={!canSave || pending || completed || Boolean(conflict) || (!uncertain && !schemaCheck.success) || Boolean(versionId && !document)} onClick={() => void save()}>{pending ? "儲存中…" : completed ? "已儲存" : uncertain ? "重試原儲存" : "儲存草稿"}</button></footer>
      </div>
    </dialog>
  </>;
}
