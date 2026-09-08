"use client";

import { useEffect, useRef, useState } from "react";
import { ClipboardPlus, Link2, ListPlus, LockKeyhole, Stethoscope, Unlink2, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { parseInfectionEventActionError, parseInfectionEventActionSuccess } from "@/lib/infection-events/parser";
import type {
  InfectionAction, InfectionClientOption, InfectionClusterOption, InfectionIncidentItem, InfectionTypeState,
} from "@/lib/infection-events/types";
import styles from "./infection-events.module.css";

export type InfectionEventActionKind = InfectionAction;
const labels: Record<InfectionAction, string> = {
  report: "新增事件", treatment: "新增處置", follow_up: "新增追蹤",
  cluster_link: "連結群聚", cluster_unlink: "解除群聚", close: "完成結案",
};

function icon(kind: InfectionAction) {
  if (kind === "report") return <ClipboardPlus aria-hidden="true" />;
  if (kind === "treatment") return <Stethoscope aria-hidden="true" />;
  if (kind === "follow_up") return <ListPlus aria-hidden="true" />;
  if (kind === "cluster_link") return <Link2 aria-hidden="true" />;
  if (kind === "cluster_unlink") return <Unlink2 aria-hidden="true" />;
  return <LockKeyhole aria-hidden="true" />;
}

function taipeiLocal(value: Date | string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
function taipeiLocalToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) return "";
  const parsed = new Date(`${value}:00+08:00`);
  return Number.isFinite(parsed.getTime()) && taipeiLocal(parsed) === value ? parsed.toISOString() : "";
}

export function InfectionEventAction({ kind, instance, incident, clients, clusters, canManage, canClose,
  hasRecentAal2, demo }: {
  kind: InfectionEventActionKind; instance: string; incident?: InfectionIncidentItem;
  clients: readonly InfectionClientOption[]; clusters: readonly InfectionClusterOption[];
  canManage: boolean; canClose: boolean; hasRecentAal2: boolean; demo: boolean;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const key = useRef<string | null>(null);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [occurredLocal, setOccurredLocal] = useState("");
  const [capturedNowLocal, setCapturedNowLocal] = useState("");
  const [typeState, setTypeState] = useState<InfectionTypeState>("missing");
  const reportableClients = clients.filter((client) => client.canReport);
  const [selectedClientId, setSelectedClientId] = useState(reportableClients[0]?.clientId ?? "");
  const [clusterChoice, setClusterChoice] = useState(clusters[0]?.clusterId ?? "__new__");
  const selectedClient = reportableClients.find((client) => client.clientId === selectedClientId);
  const selectedCluster = clusters.find((cluster) => cluster.clusterId === clusterChoice);
  const closed = incident?.handlingStatus === "closed";
  const allowed = kind === "close" ? canClose && hasRecentAal2 : canManage;
  const linkageValid = kind !== "cluster_link" || incident?.currentClusterId === null;
  const unlinkageValid = kind !== "cluster_unlink" || incident?.currentClusterId !== null;
  const enabled = !demo && allowed && !pending && !closed && linkageValid && unlinkageValid &&
    (kind !== "report" || reportableClients.length > 0);
  const label = labels[kind];
  const dialogId = `infection-event-${kind}-${instance}-${incident?.id ?? "new"}`;
  const occurredIso = taipeiLocalToIso(occurredLocal);
  const disabledReason = demo ? "展示模式不會寫入資料" : closed ? "事件已結案，歷史不可追加"
    : kind === "close" && !canClose ? "目前角色沒有 quality_events.close"
      : kind === "close" && !hasRecentAal2 ? "結案前須於同一工作階段完成最近 15 分鐘 AAL2"
        : kind !== "close" && !canManage ? "目前角色沒有 quality_events.manage"
          : kind === "cluster_link" && !linkageValid ? "目前已有群聚，須先明確解除"
            : kind === "cluster_unlink" && !unlinkageValid ? "目前沒有可解除的群聚"
              : kind === "report" && reportableClients.length === 0 ? "目前沒有可新增事件的有效個案" : undefined;

  function open() {
    if (!enabled) return;
    const now = taipeiLocal(new Date());
    setCapturedNowLocal(now); setOccurredLocal(now); setSelectedClientId(reportableClients[0]?.clientId ?? "");
    setClusterChoice(clusters[0]?.clusterId ?? "__new__"); setTypeState("missing");
    setError(null); setNotice(null); setCompleted(false); key.current = crypto.randomUUID();
    dialog.current?.showModal();
  }
  function close() { if (!pendingRef.current) dialog.current?.close(); }
  function changed() { if (error) { key.current = crypto.randomUUID(); setError(null); } }
  function trap(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0]; const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || !event.currentTarget.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || completed || !occurredIso || (kind !== "report" && !incident)) return;
    key.current ??= crypto.randomUUID();
    const values = new FormData(event.currentTarget);
    let body: Record<string, unknown>;
    let expectedClusterId: string | null | undefined;
    let expectedClusterLabel: string | null | undefined;
    if (kind === "report") {
      const typeText = String(values.get("infectionTypeText") ?? "").trim();
      body = { action: kind, clientId: selectedClientId, occurredAt: occurredIso,
        location: String(values.get("location") ?? ""), eventSummary: String(values.get("eventSummary") ?? ""),
        infectionTypeState: typeState, infectionTypeText: typeState === "provided" ? typeText : null };
    } else if (kind === "close") {
      body = { action: kind, clientId: incident!.clientId, incidentId: incident!.id, occurredAt: occurredIso,
        closureOutcome: String(values.get("closureOutcome") ?? ""), closureReason: String(values.get("closureReason") ?? ""),
        expectedChainVersion: incident!.chainVersion };
    } else if (kind === "cluster_link") {
      expectedClusterId = clusterChoice === "__new__" ? null : clusterChoice;
      expectedClusterLabel = clusterChoice === "__new__"
        ? String(values.get("newClusterLabel") ?? "").trim() : selectedCluster?.label ?? "";
      body = { action: kind, clientId: incident!.clientId, incidentId: incident!.id, occurredAt: occurredIso,
        clusterId: expectedClusterId, clusterLabel: expectedClusterLabel, expectedChainVersion: incident!.chainVersion };
    } else if (kind === "cluster_unlink") {
      expectedClusterId = incident!.currentClusterId;
      expectedClusterLabel = incident!.currentClusterLabel;
      body = { action: kind, clientId: incident!.clientId, incidentId: incident!.id, occurredAt: occurredIso,
        clusterId: expectedClusterId, clusterLabel: expectedClusterLabel, expectedChainVersion: incident!.chainVersion };
    } else {
      body = { action: kind, clientId: incident!.clientId, incidentId: incident!.id, occurredAt: occurredIso,
        entryText: String(values.get("entryText") ?? ""), expectedChainVersion: incident!.chainVersion };
    }
    pendingRef.current = true; setPending(true); setError(null);
    try {
      const response = await fetchWithTimeout("/api/infection-events", { method: kind === "report" ? "POST" : "PATCH", cache: "no-store",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key.current,
          ...(kind === "report" ? {} : { "X-Infection-Action": kind }) }, body: JSON.stringify(body) });
      const raw: unknown = await response.json().catch(() => null);
      const responseRequestId = typeof raw === "object" && raw !== null &&
        "requestId" in raw && typeof raw.requestId === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(raw.requestId)
        ? raw.requestId : null;
      if (!response.ok) {
        const envelope = parseInfectionEventActionError(raw);
        setError(`${envelope?.errors.find((item) => item.message.trim())?.message ?? "操作尚未確認完成；請保留內容並使用原操作重試。"}${envelope ? `（請求 ${envelope.requestId}）` : ""}`);
        return;
      }
      let success;
      try {
        success = parseInfectionEventActionSuccess(raw, { action: kind,
          clientId: kind === "report" ? selectedClientId : incident!.clientId,
          ...(incident ? { incidentId: incident.id, expectedChainVersion: incident.chainVersion } : {}),
          ...((kind === "cluster_link" || kind === "cluster_unlink")
            ? { clusterId: expectedClusterId, clusterLabel: expectedClusterLabel } : {}) });
      } catch {
        setError(`伺服器回覆不完整或不相符；請勿更改內容，直接使用原操作重試。${responseRequestId ? `（請求 ${responseRequestId}）` : ""}`);
        return;
      }
      if ((kind === "report" && response.status !== (success.data.replayed ? 200 : 201)) ||
        (kind !== "report" && response.status !== 200)) {
        setError(`伺服器狀態與完成憑證不一致；請勿視為完成。${responseRequestId ? `（請求 ${responseRequestId}）` : ""}`); return;
      }
      setCompleted(true); setNotice(success.data.replayed ? "已確認先前相同操作，沒有建立重複紀錄。" : `${label}已完成。`);
      dialog.current?.close(); window.setTimeout(() => trigger.current?.focus(), 0); router.refresh();
    } catch (caught) { setError(isClientFetchTimeoutError(caught)
      ? "連線逾時，操作結果未知；請保留內容並使用原操作重試。"
      : "網路狀態不明；請勿關閉或修改內容，直接按原按鈕重試。"); }
    finally { pendingRef.current = false; setPending(false); }
  }

  return <div className={styles.actionSlot}>
    <button aria-label={!enabled && disabledReason ? `${label}：${disabledReason}` : label}
      className={`button ${kind === "report" || kind === "close" ? "button--primary" : "button--secondary"} ${styles.actionButton}`}
      disabled={!enabled} onClick={open} ref={trigger} title={!enabled ? disabledReason : undefined} type="button">{icon(kind)}{label}</button>
    {notice ? <span className="sr-only" role="status">{notice}</span> : null}
    <dialog aria-describedby={`${dialogId}-description`} aria-labelledby={dialogId} className={`core-dialog ${styles.dialog}`}
      onCancel={(event) => { if (pending) event.preventDefault(); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }}
      onClose={() => trigger.current?.focus()} onKeyDown={trap} ref={dialog}>
      <form className="core-dialog__surface" onChange={changed} onSubmit={submit}>
        <header className="drawer__header"><div><p className="eyebrow">感染事件・不可變時間軸</p><h2 id={dialogId}>{label}</h2>
          <p id={`${dialogId}-description`}>所有內容皆由機構人員人工輸入；系統不診斷、不推論群聚，也不自動判定法定通報。</p></div>
          <button aria-label="關閉" className="icon-button" disabled={pending} onClick={close} type="button"><X aria-hidden="true" /></button></header>
        <div className="drawer__body"><fieldset className={styles.fields} disabled={pending || completed}>
          {kind === "report" ? <>
            <label className="field"><span>個案 *</span><select name="clientId" onChange={(event) => setSelectedClientId(event.target.value)} required value={selectedClientId}>{reportableClients.map((client) => <option key={client.clientId} value={client.clientId}>{client.displayName}</option>)}</select></label>
            <label className="field"><span>事件時間（台北）*</span><input max={capturedNowLocal || undefined} min={selectedClient?.admittedOn ? `${selectedClient.admittedOn}T00:00` : undefined} onChange={(event) => setOccurredLocal(event.target.value)} required type="datetime-local" value={occurredLocal} /></label>
            <label className="field"><span>發生位置 *</span><input maxLength={240} name="location" required /></label>
            <label className="field"><span>感染類型資訊 *</span><select onChange={(event) => setTypeState(event.target.value as InfectionTypeState)} value={typeState}><option value="provided">已人工提供</option><option value="missing">缺值</option><option value="not_applicable">不適用</option></select></label>
            <label className={`field ${styles.full}`}><span>事件描述 *</span><textarea maxLength={2000} name="eventSummary" required /></label>
            <label className={`field ${styles.full}`}><span>感染類型人工文字{typeState === "provided" ? " *" : ""}</span><input disabled={typeState !== "provided"} maxLength={240} name="infectionTypeText" required={typeState === "provided"} /></label>
          </> : <>
            <div className={styles.incidentContext}><strong>{incident?.clientDisplayName}</strong><span>{incident?.eventSummary}</span><span>目前鏈版本 v{incident?.chainVersion}</span></div>
            <label className="field"><span>紀錄發生時間（台北）*</span><input max={capturedNowLocal || undefined} min={incident ? taipeiLocal(incident.timeline.at(-1)?.occurredAt ?? incident.occurredAt) : undefined} onChange={(event) => setOccurredLocal(event.target.value)} required type="datetime-local" value={occurredLocal} /></label>
            {kind === "close" ? <><label className={`field ${styles.full}`}><span>結案結果 *</span><textarea maxLength={2000} name="closureOutcome" required /></label><label className={`field ${styles.full}`}><span>結案理由 *</span><textarea maxLength={1000} name="closureReason" required /></label><label className={`check-field ${styles.full}`}><input required type="checkbox" /><span>我已在同一工作階段完成最近 15 分鐘 AAL2。</span></label></>
              : kind === "cluster_link" ? <><label className={`field ${styles.full}`}><span>群聚目標 *</span><select onChange={(event) => setClusterChoice(event.target.value)} value={clusterChoice}>{clusters.map((cluster) => <option key={cluster.clusterId} value={cluster.clusterId}>{cluster.label}（{cluster.clusterId.slice(0, 8)}）</option>)}<option value="__new__">建立新群聚 UUID</option></select></label>{clusterChoice === "__new__" ? <label className={`field ${styles.full}`}><span>新群聚人工名稱 *</span><input maxLength={120} name="newClusterLabel" required /></label> : <p className={styles.full}>將精確連結 UUID {selectedCluster?.clusterId}；相同名稱不會自動合併。</p>}</>
                : kind === "cluster_unlink" ? <div className={styles.incidentContext}><strong>解除目前群聚</strong><span>{incident?.currentClusterLabel}（{incident?.currentClusterId}）</span><span>解除會追加新紀錄，不會刪除原連結。</span></div>
                  : <label className={`field ${styles.full}`}><span>{kind === "treatment" ? "處置內容" : "追蹤內容"} *</span><textarea maxLength={2000} name="entryText" required /></label>}
          </>}
        </fieldset>{error ? <p className="form-error" role="alert">{error}</p> : null}</div>
        <footer className="drawer__footer"><button className="button button--secondary" disabled={pending} onClick={close} type="button">取消</button><button className="button button--primary" disabled={pending || completed} type="submit">{pending ? "確認中…" : label}</button></footer>
      </form>
    </dialog>
  </div>;
}

export function InfectionEventFreshness({ staleAfter, demo }: { staleAfter: string; demo: boolean }) {
  const [expired, setExpired] = useState(false);
  useEffect(() => { if (demo) return; const timer = window.setTimeout(() => setExpired(true), Math.max(0, new Date(staleAfter).getTime() - Date.now())); return () => window.clearTimeout(timer); }, [demo, staleAfter]);
  if (demo) return <span>合成展示快照</span>;
  return expired ? <span className={styles.stale} role="status">資料已過期，請重新載入</span> : <span>資料為目前快照</span>;
}
