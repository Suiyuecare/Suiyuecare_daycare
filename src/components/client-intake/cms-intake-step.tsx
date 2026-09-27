"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { z } from "zod";
import { cmsPreviewSchema, intakeTargetLabels, type CmsIntakePreview, type IntakeSnapshot } from "@/lib/client-intake/model";
import { intakeErrorMessage, intakeRequest } from "@/lib/client-intake/client";
import type { TenantContext } from "@/lib/domain/types";
import { fetchJsonWithTimeout } from "@/lib/api/client-fetch";
import { CmsUploadControl } from "@/components/imports/cms-upload-control";
import { canUseCmsUpload, cmsUploadScope, getCmsUploadState, useCmsUploadState } from "@/lib/imports/upload-pending";
import type { CmsUploadResult } from "@/lib/imports/upload-client";
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

export function CmsIntakeStep({ context, current, canImport, canApprove, demo, onSaved, onManual, onDirty, onBusy, profileHasDraft = false, archiveConfigured = false }: {
  context: TenantContext; current: IntakeSnapshot | null; canImport: boolean; canApprove: boolean; demo: boolean;
  onSaved: (id: string) => Promise<void>; onManual: () => void; onDirty: (dirty: boolean) => void;
  onBusy?: (busy: boolean) => void; profileHasDraft?: boolean; archiveConfigured?: boolean;
}) {
  const uploadState = useCmsUploadState();
  const scope = cmsUploadScope(context, "routine-intake", current?.clientId ?? null);
  const scopeKey = JSON.stringify(scope), currentScope = useRef(scopeKey);
  useLayoutEffect(() => { currentScope.current = scopeKey; }, [scopeKey]);
  const [previewScope, setPreviewScope] = useState("");
  const [previewEpoch, setPreviewEpoch] = useState(-1);
  const [preview, setPreview] = useState<CmsIntakePreview | null>(null);
  const [choices, setChoices] = useState<Record<string, Decision>>({});
  const [clientCode, setClientCode] = useState(current?.profile.clientCode ?? "");
  const [commitBusy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false), [uploadDirty, setUploadDirty] = useState(false);
  const busy = commitBusy || uploadBusy;
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [sourceReviewReason, setSourceReviewReason] = useState("");
  const [unknownLimit, setUnknownLimit] = useState(50);
  const [committed, setCommitted] = useState<string | null>(null);
  const operation = useRef<{ payload: string; key: string } | null>(null);
  const inFlight = useRef(false);
  const selectionChanged = useCallback(() => {
    setPreview(null); setPreviewScope(""); setPreviewEpoch(-1); setChoices({}); setConfirmed(false);
    setCommitted(null); setError("");
  }, []);
  useEffect(() => { onBusy?.(busy); return () => onBusy?.(false); }, [busy, onBusy]);
  useEffect(() => { onDirty(uploadDirty || Boolean(preview && !committed)); }, [uploadDirty, preview, committed, onDirty]);
  const groups = new Map<string, CmsIntakePreview["fields"]>();
  for (const field of preview?.fields ?? []) if (field.intakeTarget) groups.set(field.intakeTarget, [...(groups.get(field.intakeTarget) ?? []), field]);
  const ready = preview && !preview.sourceIsOlder && [...groups.keys()].every((target) => Boolean(choices[target]?.choice)) && groups.has("displayName") && groups.has("identityNumber") && confirmed && clientCode.trim() && (!preview.current || sourceReviewReason.trim().length >= 10);
  async function readPreview(receipt: CmsUploadResult, signal: AbortSignal, stillCurrent: () => boolean) {
    const { payload } = await fetchJsonWithTimeout(`/api/client-intake/imports?batch=${receipt.batchId}${current ? `&client=${current.clientId}` : ""}`, { signal });
    const envelope = z.object({ requestId: z.uuid(), status: z.literal("ok"), data: cmsPreviewSchema, errors: z.array(z.never()).length(0) }).strict().parse(payload);
    const result = envelope.data;
    if (result.batchId !== receipt.batchId || (result.current?.clientId ?? null) !== (current?.clientId ?? null) ||
        result.payloadSha256 !== receipt.payloadSha256 || result.mappingVersion !== receipt.mappingVersion ||
        receipt.sectionCount !== null && result.sections.length !== receipt.sectionCount ||
        receipt.fieldCount !== null && result.fields.length !== receipt.fieldCount) throw new Error("來源批次或個案與本次上傳不一致。");
    if (!stillCurrent()) return;
    setPreviewScope(scopeKey); setPreviewEpoch(getCmsUploadState().epoch); setPreview(result); setUnknownLimit(50); if (result.current) setClientCode(result.current.profile.clientCode);
    setChoices({}); setConfirmed(false); setError(""); setCommitted(null);
  }
  async function commit() {
    if (!preview || previewScope !== scopeKey || previewEpoch !== getCmsUploadState().epoch || !canUseCmsUpload(scope) || !ready || busy || uploadDirty || inFlight.current || !canApprove || demo || profileHasDraft) return;
    const epoch = getCmsUploadState().epoch;
    const payload = JSON.stringify({ batchId: preview.batchId, payloadSha256: preview.payloadSha256, clientId: preview.current?.clientId ?? null, expectedVersion: preview.current?.profileVersion ?? 0, expectedClientVersion: preview.current?.clientRowVersion ?? 0, clientCode, sourceReviewReason: sourceReviewReason.trim() || null, decisions: [...groups.keys()].map((target) => ({ target, ...choices[target] })) });
    if (operation.current?.payload !== payload) operation.current = { payload, key: crypto.randomUUID() };
    setBusy(true); inFlight.current = true; setError("");
    try {
      const receipt = z.object({ clientId: z.uuid(), persisted: z.literal(true), formallyImported: z.literal(true) }).parse(await intakeRequest("/api/client-intake/imports/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...JSON.parse(payload), idempotency_key: operation.current.key }) }));
      if (currentScope.current !== scopeKey || epoch !== getCmsUploadState().epoch || !canUseCmsUpload(scope)) return;
      if (preview.current && receipt.clientId !== preview.current.clientId) throw new Error("匯入回條與目前個案不一致，已停止開啟。請保留來源並重新核對。");
      setCommitted(receipt.clientId); onDirty(false); await onSaved(receipt.clientId);
    } catch (e) {
      if (currentScope.current === scopeKey && epoch === getCmsUploadState().epoch && canUseCmsUpload(scope)) setError(intakeErrorMessage(e));
    } finally { setBusy(false); inFlight.current = false; }
  }
  const showSource = !demo && !uploadDirty && canUseCmsUpload(scope) && previewScope === scopeKey && previewEpoch === uploadState.epoch;
  return <section className={styles.form}>
    <div><h2>匯入 CMS 資料</h2><p>選擇中央系統下載的 HTML，核對後建立個案。</p></div>
    {current && canUseCmsUpload(scope) ? <p className={styles.notice}>目前正在更新：{current.profile.displayName}。系統仍會用精確身分識別核對，不依姓名合併。</p> : null}
    {!demo && !archiveConfigured ? <div className={styles.notice} role="status"><p>HTML 匯入暫停；請保留原檔，可先手動建檔。</p></div> : null}
    <CmsUploadControl context={context} mode="routine-intake" clientId={current?.clientId ?? null} enabled={!commitBusy && !demo && canImport && archiveConfigured}
      onPreview={readPreview} onDirty={setUploadDirty} onBusy={setUploadBusy} onSelectionChanged={selectionChanged} />
    <div className={styles.inline}><button type="button" onClick={onManual} disabled={busy || uploadDirty}>沒有 CMS 檔？手動建檔</button></div>
    {demo ? <p className={styles.notice}>合成資料試看：不接收真實 HTML，也不連線至中央系統。</p> : !canImport ? <p className={styles.notice}>您尚未取得匯入權限，可請收案負責人協助。</p> : null}
    {showSource && preview?.imported && preview.importReceipt ? <div className={styles.notice}><p>這份檔案已完成建檔，沒有再建立第二位個案。</p><button type="button" disabled={busy} onClick={() => onSaved(preview.importReceipt!.clientId)}>開啟已建立個案</button></div> : null}
    {showSource && preview && !preview.imported && !committed ? <>
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
    {showSource && committed ? <div role="status"><p>個案資料已正式存入，若下一步沒有載入，可重新開啟。</p><button type="button" onClick={() => onSaved(committed)}>開啟已建立個案</button></div> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
  </section>;
}
