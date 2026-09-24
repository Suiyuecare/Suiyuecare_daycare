"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { cmsPreviewSchema, intakeTargetLabels, MAX_INTAKE_WEB_UPLOAD_BYTES, type CmsIntakePreview, type IntakeSnapshot } from "@/lib/client-intake/model";
import { intakeErrorMessage, intakeRequest } from "@/lib/client-intake/client";
import styles from "./intake.module.css";

type Decision = { fieldId: string; choice: "" | "use_source" | "keep_current" };
function display(value: unknown): string { return value === null || value === undefined || value === "" ? "未提供" : typeof value === "string" ? value : JSON.stringify(value); }
function oldValue(snapshot: IntakeSnapshot | null, key: string) {
  if (!snapshot) return "尚未建檔";
  if (key.startsWith("primaryContact")) {
    const contact = snapshot.profile.contacts.find((c) => c.isPrimary);
    const field = key.replace("primaryContact", "").toLowerCase();
    return display(contact?.[field as keyof NonNullable<typeof contact>]);
  }
  return display(snapshot.profile[key as keyof typeof snapshot.profile]);
}

export function CmsIntakeStep({ current, canImport, canApprove, demo, onSaved, onManual, onDirty, onBusy, profileHasDraft = false, archiveConfigured = false }: {
  current: IntakeSnapshot | null; canImport: boolean; canApprove: boolean; demo: boolean;
  onSaved: (id: string) => Promise<void>; onManual: () => void; onDirty: (dirty: boolean) => void;
  onBusy?: (busy: boolean) => void; profileHasDraft?: boolean; archiveConfigured?: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CmsIntakePreview | null>(null);
  const [choices, setChoices] = useState<Record<string, Decision>>({});
  const [clientCode, setClientCode] = useState(current?.profile.clientCode ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [sourceReviewReason, setSourceReviewReason] = useState("");
  const [unknownLimit, setUnknownLimit] = useState(50);
  const [committed, setCommitted] = useState<string | null>(null);
  const uploadKey = useRef("");
  const operation = useRef<{ payload: string; key: string } | null>(null);
  const inFlight = useRef(false);
  useEffect(() => { onBusy?.(busy); return () => onBusy?.(false); }, [busy, onBusy]);
  const groups = new Map<string, CmsIntakePreview["fields"]>();
  for (const field of preview?.fields ?? []) if (field.intakeTarget) groups.set(field.intakeTarget, [...(groups.get(field.intakeTarget) ?? []), field]);
  const ready = preview && !preview.sourceIsOlder && [...groups.keys()].every((target) => Boolean(choices[target]?.choice)) && groups.has("displayName") && groups.has("identityNumber") && confirmed && clientCode.trim() && (!preview.current || sourceReviewReason.trim().length >= 10);
  async function upload() {
    if (!file || busy || inFlight.current || demo || !canImport || !archiveConfigured) return;
    setBusy(true); inFlight.current = true; setError("");
    try {
      const form = new FormData(); form.set("file", file);
      const receipt = z.object({ reservation_id: z.uuid(), status: z.literal("completed") }).parse(await intakeRequest("/api/client-intake/imports", { method: "POST", headers: { "idempotency-key": uploadKey.current }, body: form }));
      const result = cmsPreviewSchema.parse(await intakeRequest(`/api/client-intake/imports?batch=${receipt.reservation_id}${current ? `&client=${current.clientId}` : ""}`));
      if (result.batchId !== receipt.reservation_id || (result.current?.clientId ?? null) !== (current?.clientId ?? null)) throw new Error("來源批次或個案與本次上傳不一致，請重新核對。 ");
      setPreview(result); setUnknownLimit(50); if (result.current) setClientCode(result.current.profile.clientCode); setChoices({}); setConfirmed(false); onDirty(true);
    } catch (e) { setError(intakeErrorMessage(e)); } finally { setBusy(false); inFlight.current = false; }
  }
  async function commit() {
    if (!preview || !ready || busy || inFlight.current || !canApprove || demo || profileHasDraft) return;
    const payload = JSON.stringify({ batchId: preview.batchId, payloadSha256: preview.payloadSha256, clientId: preview.current?.clientId ?? null, expectedVersion: preview.current?.profileVersion ?? 0, expectedClientVersion: preview.current?.clientRowVersion ?? 0, clientCode, sourceReviewReason: sourceReviewReason.trim() || null, decisions: [...groups.keys()].map((target) => ({ target, ...choices[target] })) });
    if (operation.current?.payload !== payload) operation.current = { payload, key: crypto.randomUUID() };
    setBusy(true); inFlight.current = true; setError("");
    try {
      const receipt = z.object({ clientId: z.uuid(), persisted: z.literal(true), formallyImported: z.literal(true) }).parse(await intakeRequest("/api/client-intake/imports/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...JSON.parse(payload), idempotency_key: operation.current.key }) }));
      if (preview.current && receipt.clientId !== preview.current.clientId) throw new Error("匯入回條與目前個案不一致，已停止開啟。請保留來源並重新核對。");
      setCommitted(receipt.clientId); onDirty(false); await onSaved(receipt.clientId);
    } catch (e) { setError(intakeErrorMessage(e)); } finally { setBusy(false); inFlight.current = false; }
  }
  return <section className={styles.form}>
    <div><h2>從 CMS 開始建立個案</h2><p>上傳長照中央系統下載的 HTML，核對資料後建立待收案個案。HTML 內的附件連結不會自動下載，請在最後一步另行上傳文件。</p></div>
    {current ? <p className={styles.notice}>目前正在更新：{current.profile.displayName}。系統仍會用精確身分識別核對，不依姓名合併。</p> : null}
    {!demo && !archiveConfigured ? <div className={styles.notice} role="status"><p>CMS 封存尚未啟用，可先手動建檔。</p><p>目前不接收 HTML 檔案。請先保存中央下載原檔，待管理員完成安全封存設定及驗收後，再匯入核對。</p></div> : null}
    <label>選擇 CMS HTML（本入口單檔 4 MB 以下）<input type="file" accept=".html,.htm,text/html,application/xhtml+xml" disabled={busy || demo || !canImport || !archiveConfigured} onChange={(e) => {
      const selected = e.target.files?.[0] ?? null;
      setPreview(null); setChoices({}); setConfirmed(false); setCommitted(null); setError(""); uploadKey.current = crypto.randomUUID(); onDirty(false);
      if (selected && (selected.size > MAX_INTAKE_WEB_UPLOAD_BYTES || !/\.html?$/iu.test(selected.name))) { setFile(null); setError("請選擇 4 MB 以下的 HTML 檔。較大檔案請交由管理員安排安全匯入，不要刪除來源資料。 "); return; }
      setFile(selected); onDirty(Boolean(selected));
    }} /></label>
    <div className={styles.inline}><button className="button button--primary" type="button" disabled={!file || busy || demo || !canImport || !archiveConfigured} onClick={upload}>{busy ? "處理中，請稍候…" : "上傳並核對資料"}</button><button type="button" onClick={onManual} disabled={busy}>沒有 CMS 檔？手動建檔</button></div>
    {demo ? <p className={styles.notice}>合成資料試看：不接收真實 HTML，也不連線至中央系統。</p> : !canImport ? <p className={styles.notice}>您尚未取得匯入權限，可請收案負責人協助。</p> : null}
    {preview?.imported && preview.importReceipt ? <div className={styles.notice}><p>這份檔案已完成建檔，沒有再建立第二位個案。</p><button type="button" disabled={busy} onClick={() => onSaved(preview.importReceipt!.clientId)}>開啟已建立個案</button></div> : null}
    {preview && !preview.imported && !committed ? <>
      <h3>逐欄核對後，才會寫入個案資料</h3>
      {preview.sourceIsOlder ? <p role="alert" className={styles.error}>這份來源的官方日期（{preview.sourceOfficialDate}）早於現有版本（{preview.currentSourceOfficialDate}），不能用舊資料覆蓋。</p> : null}
      <p>已辨識 {preview.sections.length} 個區段。尚未對應的資料會保留於匯入來源，不會被丟棄。</p>
      <label>機構個案編號（必填）<input value={clientCode} disabled={Boolean(current) || busy} maxLength={64} onChange={(e) => { setClientCode(e.target.value); setConfirmed(false); }} /></label>
      {[...groups].map(([target, fields]) => {
        const choice = choices[target]; const candidate = fields.find((f) => f.id === choice?.fieldId) ?? fields[0]!;
        return <article key={target} className={styles.sourceCard}>
          <h4>{intakeTargetLabels[target] ?? target}</h4>
          <p>目前資料：{oldValue(preview.current, target)}</p>
          {fields.length > 1 ? <label>此欄有多個來源，請選擇要核對的一筆<select value={candidate.id} disabled={busy} onChange={(e) => { setChoices((v) => ({ ...v, [target]: { fieldId: e.target.value, choice: "" } })); setConfirmed(false); }}>
            {fields.map((f) => <option key={f.id} value={f.id}>{f.source.label}：{display(f.normalizedValue).slice(0, 120)}</option>)}</select></label> : null}
          <p>CMS 來源：{display(candidate.normalizedValue)}</p><small>{candidate.source.sectionTitle} → {candidate.source.label}</small>
          {candidate.intakeValue !== undefined ? <p>建檔值：{display(candidate.intakeValue)}</p> : null}
          {candidate.intakeWarning || candidate.warnings.length ? <p className={styles.error}>這筆來源尚有格式或內容疑義，請先核對；必要欄位不完整時不能建案。</p> : null}
          <label>這一欄如何處理<select disabled={busy} value={choice?.choice ?? ""} onChange={(e) => { setChoices((v) => ({ ...v, [target]: { fieldId: candidate.id, choice: e.target.value as Decision["choice"] } })); setConfirmed(false); }}>
            <option value="">請選擇，不自動覆蓋</option><option value="use_source" disabled={Boolean(candidate.intakeWarning) || candidate.warnings.length > 0}>採用這筆 CMS 資料</option><option value="keep_current" disabled={!preview.current && ["displayName", "identityNumber"].includes(target)}>{preview.current ? "保留目前資料" : "暫不帶入，留待補件"}</option>
          </select></label>
        </article>;
      })}
      {!groups.has("displayName") || !groups.has("identityNumber") ? <p role="alert" className={styles.error}>缺少可辨識的姓名或身分識別，不能直接從此檔建案。請確認下載檔案或使用手動建檔。</p> : null}
      <details><summary>其他來源與待對應內容（{preview.fields.filter((f) => !f.intakeTarget).length} 欄）</summary><p>以下先保留來源，不會直接改成評估或用藥指示。</p>{preview.fields.filter((f) => !f.intakeTarget).slice(0, unknownLimit).map((f) => <p key={f.id}><strong>{f.source.sectionTitle}／{f.source.label}</strong>：{f.normalizedValue}</p>)}{preview.fields.filter((f) => !f.intakeTarget).length > unknownLimit ? <button type="button" onClick={() => setUnknownLimit((value) => value + 50)}>再顯示 50 欄來源</button> : null}{preview.warnings.map((w, i) => <p key={i}>{w.message}</p>)}</details>
      <label className={styles.confirm}><input type="checkbox" disabled={busy} checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />我已確認來源、身分及逐欄選擇。這次不會自動核准收案、簽署評估或建立給藥紀錄。</label>
      {preview.current ? <label>更新依據與來源日期核對（至少 10 字）<textarea value={sourceReviewReason} disabled={busy} rows={3} maxLength={1000} onChange={(e) => { setSourceReviewReason(e.target.value); setConfirmed(false); }} /><small>請說明此次中央資料為何可更新現有版本。上傳時間不代表官方資料比較新；明確較舊的來源仍會被阻擋。</small></label> : null}
      {profileHasDraft ? <p className={styles.notice}>基本資料還有未儲存的修改，請先保存，再重新核對 CMS 預覽，避免覆蓋您剛填的資料。</p> : null}
      <button className="button button--primary" type="button" disabled={!ready || busy || !canApprove || demo || profileHasDraft} onClick={commit}>{busy ? "確認與建檔中…" : current ? "確認更新個案資料" : "確認建立待收案個案"}</button>
    </> : null}
    {committed ? <div role="status"><p>個案資料已正式存入，若下一步沒有載入，可重新開啟。</p><button type="button" onClick={() => onSaved(committed)}>開啟已建立個案</button></div> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
  </section>;
}
