"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ClipboardPlus, FilePenLine, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { parseWeightActionError, parseWeightActionSuccess } from "@/lib/weight-management/parser";
import type { RecordWeightInput, WeightClientOption, WeightManagementItem, WeightMutationInput } from "@/lib/weight-management/types";

import styles from "./weight-management.module.css";

type Kind = "record" | "correct" | "void" | "acknowledge";
const labels: Record<Kind, string> = { record: "新增體重", correct: "更正量測", void: "作廢量測", acknowledge: "確認警示" };

function taipeiLocal(value: Date | string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function icon(kind: Kind) {
  if (kind === "record") return <ClipboardPlus aria-hidden="true" />;
  if (kind === "correct") return <FilePenLine aria-hidden="true" />;
  if (kind === "void") return <Trash2 aria-hidden="true" />;
  return <CheckCircle2 aria-hidden="true" />;
}

export function WeightAction({ kind, instance, item, clients, canManage, hasRecentAal2, demo }: { kind: Kind; instance: string; item?: WeightManagementItem; clients: readonly WeightClientOption[]; canManage: boolean; hasRecentAal2: boolean; demo: boolean }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const key = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [occurredLocal, setOccurredLocal] = useState("");
  const recordable = clients.filter((client) => client.canRecord);
  const recentRequired = kind !== "record";
  const eligible = kind === "record"
    ? recordable.length > 0
    : Boolean(item?.currentObservationId) &&
      (kind !== "acknowledge" ||
        Boolean(
          item?.alertStatus === "unacknowledged" &&
            item.priorObservationId &&
            item.ruleVersionId,
        ));
  const enabled = !demo && canManage && (!recentRequired || hasRecentAal2) && eligible && !pending;
  const id = `weight-${kind}-${instance}`;

  function open() {
    if (!enabled) return;
    setOccurredLocal(taipeiLocal(new Date())); setPending(false); setCompleted(false); setError(null);
    key.current = crypto.randomUUID(); dialog.current?.showModal();
  }
  function close() { if (!pending) dialog.current?.close(); }
  function changed() { if (error) { key.current = crypto.randomUUID(); setError(null); } }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || completed) return;
    key.current ??= crypto.randomUUID();
    const values = new FormData(event.currentTarget);
    let input: RecordWeightInput | WeightMutationInput;
    if (kind === "record") {
      input = { action: "record", clientId: String(values.get("clientId") ?? ""), observedAt: new Date(`${occurredLocal}:00+08:00`).toISOString(), weightKg: String(values.get("weightKg") ?? ""), source: String(values.get("source") ?? ""), idempotencyKey: key.current };
    } else if (kind === "acknowledge") {
      input = { action: "acknowledge", clientId: item!.clientId, currentObservationId: item!.currentObservationId!, currentCorrectionVersion: item!.currentCorrectionVersion, priorObservationId: item!.priorObservationId!, priorCorrectionVersion: item!.priorCorrectionVersion, ruleVersionId: item!.ruleVersionId!, acknowledgementNote: String(values.get("note") ?? ""), idempotencyKey: key.current };
    } else {
      input = { action: kind, clientId: item!.clientId, observationId: item!.currentObservationId!, expectedCorrectionVersion: item!.currentCorrectionVersion, replacementWeightKg: kind === "correct" ? String(values.get("replacementWeightKg") ?? "") : null, correctionReason: String(values.get("reason") ?? ""), idempotencyKey: key.current };
    }
    setPending(true); setError(null);
    try {
      const response = await fetchWithTimeout("/api/weight-management", { method: kind === "record" ? "POST" : "PATCH", cache: "no-store", headers: { "Content-Type": "application/json", "Idempotency-Key": key.current }, body: JSON.stringify(Object.fromEntries(Object.entries(input).filter(([field]) => field !== "idempotencyKey"))) });
      const raw: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(parseWeightActionError(raw)?.errors[0]?.message ?? "操作尚未確認完成；請保留內容並以原操作重試。"); return;
      }
      try { parseWeightActionSuccess(raw, input); } catch { setError("伺服器完成憑證不完整；請勿修改內容，直接用原操作重試。"); return; }
      setCompleted(true); dialog.current?.close(); window.setTimeout(() => trigger.current?.focus(), 0); router.refresh();
    } catch (caught) { setError(isClientFetchTimeoutError(caught)
      ? "連線逾時，操作結果未知；請保留內容並使用原操作重試。"
      : "網路狀態不明；請勿關閉或修改內容，直接按原按鈕重試。"); }
    finally { setPending(false); }
  }

  const reason = demo ? "展示模式唯讀" : !canManage ? "缺少 quality_events.manage" : recentRequired && !hasRecentAal2 ? "需最近 15 分鐘 AAL2" : !eligible ? "目前資料不允許此操作" : undefined;
  return <div className={styles.actionSlot}>
    <button aria-label={reason ? `${labels[kind]}：${reason}` : labels[kind]} className={`button ${kind === "record" || kind === "acknowledge" ? "button--primary" : "button--secondary"} ${styles.actionButton}`} disabled={!enabled} onClick={open} ref={trigger} title={reason} type="button">{icon(kind)}{labels[kind]}</button>
    <dialog aria-labelledby={id} className={`core-dialog ${styles.dialog}`} onCancel={(event) => { if (pending) event.preventDefault(); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }} ref={dialog}>
      <form className="core-dialog__surface" onChange={changed} onSubmit={submit}>
        <header className="drawer__header"><div><p className="eyebrow">體重管理・不可改寫證據</p><h2 id={id}>{labels[kind]}</h2><p>{kind === "record" ? "單位固定公斤；缺測不會建立 0 公斤資料。" : kind === "acknowledge" ? "確認只凍結本月、上月與當時規則，不代表診斷。" : "原量測保留；更正或作廢會追加一筆有理由的終端版本。"}</p></div><button aria-label="關閉" className="icon-button" disabled={pending} onClick={close} type="button"><X aria-hidden="true" /></button></header>
        <div className="drawer__body"><fieldset className={styles.fields} disabled={pending || completed}>
          {kind === "record" ? <>
            <label className="field"><span>個案 *</span><select name="clientId" required>{recordable.map((client) => <option key={client.clientId} value={client.clientId}>{client.displayName}</option>)}</select></label>
            <label className="field"><span>量測時間（台北）*</span><input max={taipeiLocal(new Date())} onChange={(event) => setOccurredLocal(event.target.value)} required type="datetime-local" value={occurredLocal} /></label>
            <label className="field"><span>體重（kg）*</span><input inputMode="decimal" max="999999.99" min="0.01" name="weightKg" required step="0.01" type="number" /></label>
            <label className="field"><span>來源 *</span><input maxLength={120} name="source" placeholder="例如：人工量測" required /></label>
          </> : <>
            <div className={styles.context}><strong>{item?.clientDisplayName}</strong><span>目前有效值 {item?.currentWeightKg} kg・更正鏈 v{item?.currentCorrectionVersion}</span></div>
            {kind === "correct" ? <label className="field"><span>更正後體重（kg）*</span><input defaultValue={item?.currentWeightKg ?? ""} inputMode="decimal" max="999999.99" min="0.01" name="replacementWeightKg" required step="0.01" type="number" /></label> : null}
            {kind === "acknowledge" ? <label className={`field ${styles.full}`}><span>確認說明 *</span><textarea maxLength={1000} name="note" required /></label> : <label className={`field ${styles.full}`}><span>{kind === "void" ? "作廢理由" : "更正理由"} *</span><textarea maxLength={1000} name="reason" required /></label>}
            <label className={`check-field ${styles.full}`}><input required type="checkbox" /><span>我確認原始量測不會被刪除，且已在同一工作階段完成最近 15 分鐘 AAL2。</span></label>
          </>}
        </fieldset>{error ? <p className="form-error" role="alert">{error}</p> : null}</div>
        <footer className="drawer__footer"><button className="button button--secondary" disabled={pending} onClick={close} type="button">取消</button><button className="button button--primary" disabled={pending || completed} type="submit">{pending ? "確認中…" : labels[kind]}</button></footer>
      </form>
    </dialog>
  </div>;
}

export function WeightFreshness({ staleAfter, demo }: { staleAfter: string; demo: boolean }) {
  const [expiredBoundary, setExpiredBoundary] = useState<string | null>(null);
  useEffect(() => {
    if (demo) return;
    const remaining = Date.parse(staleAfter) - Date.now();
    const timer = window.setTimeout(() => setExpiredBoundary(staleAfter), Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [demo, staleAfter]);
  if (demo) return <span>合成示範快照</span>;
  return expiredBoundary === staleAfter
    ? <span className={styles.stale} role="status">資料已逾 60 秒，操作前請重新載入</span>
    : <span>資料在時效內</span>;
}
