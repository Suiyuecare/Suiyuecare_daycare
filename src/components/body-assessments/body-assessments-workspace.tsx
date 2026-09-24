"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PageCatalogEntry } from "@/lib/catalog";
import { bodyObservationsReady, parseBodyAssessmentMutation, parseBodyAssessmentSuccess, type BodyAssessmentInput } from "@/lib/body-assessments/parser";
import { BODY_AREAS, BODY_AREA_LABELS, BODY_OBSERVATION_STATES, BODY_STATE_LABELS,
  type BodyAssessmentRecord, type BodyAssessmentSnapshot, type BodyAssessmentVersion } from "@/lib/body-assessments/types";
import styles from "./body-assessments.module.css";

const stateLabel = { draft: "草稿待簽", signed: "已簽署", corrected: "已簽更正版" };
function time(value: string) { return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value)); }
function localTime(value: string) { return new Date(Date.parse(value) + 8 * 3_600_000).toISOString().slice(0, 16); }
function Observations({ version }: { version: BodyAssessmentVersion }) {
  return <dl className={styles.observations}>{version.observations.map((item) => <div key={item.area}>
    <dt>{BODY_AREA_LABELS[item.area]} · {BODY_STATE_LABELS[item.state]}</dt>
    <dd>{item.description ?? (item.state === "abnormal" ? "異常描述待補" : item.state === "normal" ? "人工標記正常" : "")}</dd>
    {item.reason && <dd>理由：{item.reason}</dd>}
    {item.state === "abnormal" && <dd>人工處置：{item.disposition ?? "待工作人員填寫；目前不能簽署"}</dd>}
  </div>)}</dl>;
}
type EditorRow = { area: string; state: string; description: string; reason: string; disposition: string };
type Editor = { record: BodyAssessmentRecord | null; clientId: string; observedAt: string; rows: EditorRow[]; reason: string; snapshotAt: string };
type Props = { page: PageCatalogEntry; snapshot: BodyAssessmentSnapshot; canManage: boolean; canSign: boolean; actorUserId: string };
export function BodyAssessmentsWorkspace({ page, snapshot, canManage, canSign, actorUserId }: Props) {
  const router = useRouter(); const [editor, setEditor] = useState<Editor | null>(null);
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false); const [receipt, setReceipt] = useState("");
  const [invalidSnapshot, setInvalidSnapshot] = useState<string | null>(null);
  const [expired, setExpired] = useState(false); const [signTarget, setSignTarget] = useState<string | null>(null);
  const pending = useRef<BodyAssessmentInput | null>(null); const inFlight = useRef(false);
  useEffect(() => { const tick = () => setExpired(Date.now() > Date.parse(snapshot.staleAfter));
    const id = setInterval(tick, 1000); return () => clearInterval(id); }, [snapshot.staleAfter]);
  const incomplete = snapshot.clientsTruncated || snapshot.recordsTruncated;
  const blocked = snapshot.demo || expired || incomplete || busy || uncertain || receipt.length > 0 || invalidSnapshot === snapshot.generatedAt;
  function openEditor(record: BodyAssessmentRecord | null) {
    setMessage(""); setSignTarget(null);
    setEditor({ record, snapshotAt: snapshot.generatedAt, clientId: record?.client_id ?? snapshot.filters.clientId ?? "", observedAt: record ? localTime(record.observed_at) : "",
      rows: record?.observations.map((o) => ({ area: o.area, state: o.state, description: o.description ?? "", reason: o.reason ?? "", disposition: o.disposition ?? "" })) ?? [], reason: "" });
  }
  function updateRow(index: number, patch: Partial<EditorRow>) {
    setEditor((current) => current ? { ...current, rows: current.rows.map((r, i) => i === index ? { ...r, ...patch } : r) } : null);
  }
  async function send(input: BodyAssessmentInput) {
    if (inFlight.current || snapshot.demo || (!uncertain && Date.now() > Date.parse(snapshot.staleAfter))) {
      setMessage("目前不能送出，請重新載入資料確認。"); return;
    }
    inFlight.current = true; setBusy(true); setMessage(""); pending.current = input;
    try {
      const response = await fetch("/api/body-assessments", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", "idempotency-key": input.idempotencyKey, "x-body-assessment-operation": input.payload.action },
        body: JSON.stringify(input.payload) });
      const envelope: unknown = await response.json();
      if (!envelope || typeof envelope !== "object" || !("status" in envelope) || !("data" in envelope) || !("errors" in envelope)) throw new Error("invalid envelope");
      if (!response.ok || envelope.status !== "ok") {
        const errors = Array.isArray(envelope.errors) ? envelope.errors : [];
        if (response.status === 409 && errors.some((error) => error && typeof error === "object" &&
          ["BODY_ASSESSMENT_VERSION_CONFLICT", "BODY_ASSESSMENT_IDEMPOTENCY_CONFLICT"].includes(error.code))) {
          pending.current = null; setUncertain(false); setInvalidSnapshot(snapshot.generatedAt);
          setMessage("本次操作未接受：版本或操作鍵已有衝突，請重新載入後重新開啟紀錄核對。"); return;
        }
        if ([400, 401, 403, 413].includes(response.status)) {
          pending.current = null; setUncertain(false);
          setMessage(response.status === 403 ? "權限或最近 15 分鐘雙因素驗證不足，請完成驗證後再操作。" : "輸入或工作階段未通過驗證，請確認欄位後重試。"); return;
        }
        throw new Error("unconfirmed response");
      }
      const confirmed = parseBodyAssessmentSuccess(envelope, input, { organizationId: snapshot.organizationId, branchId: snapshot.branchId, userId: actorUserId }, response.status);
      setReceipt(`已保存第 ${confirmed.version} 版（${stateLabel[confirmed.record_state]}），操作回執 ${confirmed.operation_id}`);
      setUncertain(false); pending.current = null; setEditor(null); setSignTarget(null); router.refresh();
    } catch {
      setUncertain(true); setMessage("結果尚未確認。已保留本次內容與操作鍵，請按「重試相同操作」核對，避免另建重複紀錄。");
    } finally { inFlight.current = false; setBusy(false); }
  }
  function submitEditor() {
    if (!editor || blocked) return;
    if (editor.snapshotAt !== snapshot.generatedAt) { setMessage("畫面資料已更新，請取消編輯並重新開啟紀錄核對。"); return; }
    const record = editor.record;
    try {
      const observations = editor.rows.map((row) => ({ area: row.area, state: row.state,
        description: row.state === "missing" || row.state === "not_applicable" ? null : row.description.trim() || null,
        reason: row.state === "missing" || row.state === "not_applicable" ? row.reason.trim() || null : null,
        disposition: row.state === "abnormal" ? row.disposition.trim() || null : null }));
      const action = record ? record.record_state === "draft" ? "revise" : "correct" : "create";
      const input = parseBodyAssessmentMutation({ action, client_id: editor.clientId,
        assessment_key: record?.assessment_key ?? null, previous_version_id: record?.version_id ?? null,
        expected_version: record?.version ?? 0, expected_content_hash: record?.content_hash ?? null,
        observed_at: `${editor.observedAt}:00+08:00`, observations, instrument: "manual_nonstandard_body_observation_v1", reason: editor.reason }, crypto.randomUUID());
      void send(input);
    } catch { setMessage("請完整選取個案、時間、部位與狀態；缺值及不適用須理由，更正簽署須補齊異常描述與人工處置，且更正理由至少 8 字。"); }
  }
  function sign(record: BodyAssessmentRecord) {
    if (blocked || !canSign || !bodyObservationsReady(record.observations) || record.historyTruncated) return;
    void send(parseBodyAssessmentMutation({ action: "sign", client_id: record.client_id, assessment_key: record.assessment_key,
      previous_version_id: record.version_id, expected_version: record.version, expected_content_hash: record.content_hash,
      reason: "本人確認已核對所選部位的人工觀察與處置" }, crypto.randomUUID()));
  }
  return <section className={styles.workspace} aria-label="身體評估工作區">
    <header className={styles.header}><div><p>個案照護 · 人工身體觀察</p><h1>{page.title}</h1>
      <p>逐一選取本次實際觀察的部位。未列出的部位不代表已評估或正常。</p></div>
      <button type="button" disabled={blocked || !canManage || snapshot.clients.length === 0} onClick={() => openEditor(null)}>新增評估草稿</button></header>
    <p className={styles.notice}>本頁為非標準化人工觀察紀錄，不提供診斷或量表分數。照片／附件服務尚未設定，現階段僅能保存文字觀察。</p>
    {snapshot.demo && <p className={styles.notice}>唯讀展示模式：以下個案、紀錄與簽署歷程皆為合成示例。</p>}
    {incomplete && <p role="alert">可用資料範圍不完整，已停用寫入。請縮小查詢範圍或聯絡管理人員。</p>}
    {expired && <p role="alert">資料已超過 5 分鐘，請重新載入後再操作。</p>}
    <div className={styles.toolbar}><form method="get" action={`/app/${page.slug}`} className={styles.filters}>
      <label>個案<select name="client" defaultValue={snapshot.filters.clientId ?? ""}><option value="">全部個案</option>
        {snapshot.clients.map((c) => <option key={c.clientId} value={c.clientId}>{c.displayName}</option>)}</select></label>
      <label>狀態<select name="state" defaultValue={snapshot.filters.state}><option value="all">全部狀態</option>
        <option value="draft">草稿待簽</option><option value="signed">已簽署</option><option value="corrected">已簽更正版</option></select></label>
      <button type="submit">查詢</button>
    </form><button type="button" onClick={() => { setReceipt(""); router.refresh(); }} disabled={busy || uncertain}>重新載入</button></div>
    <p>{snapshot.matchingTotal} 筆評估 · 更新於 {time(snapshot.generatedAt)}</p>
    {message && <p role="alert" className={styles.notice}>{message}</p>}
    {uncertain && <button type="button" disabled={busy} onClick={() => pending.current && void send(pending.current)}>重試相同操作</button>}
    {receipt && <p role="status">{receipt}</p>}
    {editor && <form className={styles.editor} onSubmit={(e) => { e.preventDefault(); submitEditor(); }}>
      <h2>{editor.record ? editor.record.record_state === "draft" ? "修訂草稿" : "建立更正簽署版" : "新增評估草稿"}</h2>
      <fieldset disabled={blocked}><legend>本次人工觀察</legend><div className={styles.filters}>
        <label>個案<select value={editor.clientId} required disabled={!!editor.record} onChange={(e) => setEditor({ ...editor, clientId: e.target.value })}>
          <option value="">請選擇個案</option>{snapshot.clients.map((c) => <option key={c.clientId} value={c.clientId}>{c.displayName}</option>)}</select></label>
        <label>觀察時間（臺灣時間）<input type="datetime-local" required value={editor.observedAt} onChange={(e) => setEditor({ ...editor, observedAt: e.target.value })} /></label></div>
        {editor.rows.map((row, index) => <fieldset className={styles.rowEditor} key={index}><legend>部位觀察 {index + 1}</legend>
          <label>部位<select required value={row.area} onChange={(e) => updateRow(index, { area: e.target.value })}>
            <option value="">請明確選擇部位</option>{BODY_AREAS.map((a) => <option key={a} value={a} disabled={editor.rows.some((r, i) => i !== index && r.area === a)}>{BODY_AREA_LABELS[a]}</option>)}</select></label>
          <label>觀察狀態<select required value={row.state} onChange={(e) => updateRow(index, { state: e.target.value, description: "", reason: "", disposition: "" })}>
            <option value="">請明確選擇狀態</option>{BODY_OBSERVATION_STATES.map((s) => <option key={s} value={s}>{BODY_STATE_LABELS[s]}</option>)}</select></label>
          {(row.state === "normal" || row.state === "abnormal") && <label>觀察描述{row.state === "abnormal" ? "（簽署前必填）" : "（其他部位須註明位置）"}<textarea maxLength={2000} value={row.description} onChange={(e) => updateRow(index, { description: e.target.value })} /></label>}
          {row.state === "abnormal" && <label>人工處置／追蹤安排（簽署前必填）<textarea maxLength={2000} value={row.disposition} onChange={(e) => updateRow(index, { disposition: e.target.value })} /></label>}
          {(row.state === "missing" || row.state === "not_applicable") && <label>理由<textarea required maxLength={1000} value={row.reason} onChange={(e) => updateRow(index, { reason: e.target.value })} /></label>}
          <button type="button" onClick={() => setEditor({ ...editor, rows: editor.rows.filter((_, i) => i !== index) })}>移除部位 {index + 1}</button>
        </fieldset>)}
        <button type="button" disabled={editor.rows.length >= BODY_AREAS.length} onClick={() => setEditor({ ...editor, rows: [...editor.rows, { area: "", state: "", description: "", reason: "", disposition: "" }] })}>加入觀察部位</button>
        <label>{editor.record?.record_state !== "draft" && editor.record ? "更正理由（至少 8 字）" : "建立／修訂理由"}<textarea required maxLength={1000} value={editor.reason} onChange={(e) => setEditor({ ...editor, reason: e.target.value })} /></label>
        <div className={styles.actions}><button type="submit">{editor.record && editor.record.record_state !== "draft" ? "確認內容並簽署更正版" : "保存草稿"}</button>
          <button type="button" onClick={() => setEditor(null)}>取消編輯</button></div></fieldset>
      {editor.record && editor.record.record_state !== "draft" && <p>更正會保留前版與本次理由；需最近 15 分鐘內完成雙因素驗證。</p>}
    </form>}
    {snapshot.records.length === 0 && <p className={styles.empty}>目前查詢範圍尚無身體評估紀錄。</p>}
    {snapshot.records.map((record) => <article className={styles.record} key={record.version_id}>
      <header><h2>{record.client_display_name}</h2><span>{stateLabel[record.record_state]} · 第 {record.version} 版</span></header>
      <p>觀察於 {time(record.observed_at)} · 記錄人 {record.actor_display_name}</p><Observations version={record} />
      <p>本版理由：{record.reason}</p>
      {record.signed_at && <p>已由：{record.actor_display_name} · {time(record.signed_at)} · {record.signature_purpose}</p>}
      <div className={styles.actions}>
        <button type="button" disabled={blocked || record.historyTruncated || (record.record_state === "draft" ? !canManage : !canSign)} onClick={() => openEditor(record)}>{record.record_state === "draft" ? "修訂草稿" : "建立更正版"}</button>
        {record.record_state === "draft" && <button type="button" disabled={blocked || !canSign || record.historyTruncated || !bodyObservationsReady(record.observations)} onClick={() => { setEditor(null); setSignTarget(record.version_id); }}>核對並簽署</button>}
      </div>
      {record.record_state === "draft" && !bodyObservationsReady(record.observations) && <p>異常描述或人工處置待補，尚不能簽署。</p>}
      {signTarget === record.version_id && <div className={styles.notice}><p>簽署將固定目前所列部位、觀察與處置，並保留第 {record.version} 版原稿；需最近 15 分鐘內完成雙因素驗證。</p>
        <button type="button" disabled={blocked} onClick={() => sign(record)}>本人確認已核對所選部位的人工觀察與處置</button></div>}
      <details><summary>紀錄詳情與版本歷程（前版 {record.historyTotal} 筆）</summary>
        <p className={styles.hash}>本版識別：{record.version_id}<br />內容雜湊：{record.content_hash}</p>
        {record.historyTruncated && <p role="alert">僅顯示最近 50 個前版，歷程不完整，已停用此筆寫入。</p>}
        {record.history.map((version) => <section className={styles.history} key={version.version_id}>
          <h3>第 {version.version} 版 · {stateLabel[version.record_state]}</h3><p>{time(version.created_at)} · {version.actor_display_name} · {version.reason}</p>
          <Observations version={version} />{version.signed_at && <p>已由：{version.actor_display_name} · {version.signature_purpose}</p>}
          <p className={styles.hash}>內容雜湊：{version.content_hash}</p></section>)}
      </details>
    </article>)}
    {!snapshot.demo && <p><Link href="/mfa?audience=staff&purpose=sensitive-action">重新完成雙因素驗證</Link></p>}
  </section>;
}
