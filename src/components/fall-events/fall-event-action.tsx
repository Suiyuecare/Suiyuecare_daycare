"use client";

import { useEffect, useRef, useState } from "react";
import { ClipboardPlus, HeartPulse, ListPlus, LockKeyhole, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseFallEventActionError,
  parseFallEventActionSuccess,
} from "@/lib/fall-events/parser";
import type {
  FallClientOption,
  FallIncidentItem,
  FallInjuryState,
} from "@/lib/fall-events/types";

import styles from "./fall-events.module.css";

export type FallEventActionKind = "report" | "treatment" | "follow_up" | "close";

const labels: Record<FallEventActionKind, string> = {
  report: "新增事件",
  treatment: "新增處置",
  follow_up: "新增追蹤",
  close: "完成結案",
};

function actionIcon(kind: FallEventActionKind) {
  if (kind === "report") return <ClipboardPlus aria-hidden="true" />;
  if (kind === "treatment") return <HeartPulse aria-hidden="true" />;
  if (kind === "follow_up") return <ListPlus aria-hidden="true" />;
  return <LockKeyhole aria-hidden="true" />;
}

function taipeiLocal(value: Date | string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function taipeiLocalToIso(value: string) {
  const parsed = new Date(`${value}:00+08:00`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}

export function FallEventAction({
  kind,
  instance,
  incident,
  clients,
  canManage,
  canClose,
  hasRecentAal2,
  demo,
}: {
  kind: FallEventActionKind;
  instance: string;
  incident?: FallIncidentItem;
  clients: readonly FallClientOption[];
  canManage: boolean;
  canClose: boolean;
  hasRecentAal2: boolean;
  demo: boolean;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const idempotencyKey = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [occurredLocal, setOccurredLocal] = useState("");
  const [capturedNowLocal, setCapturedNowLocal] = useState("");
  const [injuryState, setInjuryState] = useState<FallInjuryState>("missing");
  const reportableClients = clients.filter((client) => client.canReport);
  const [selectedClientId, setSelectedClientId] = useState(reportableClients[0]?.clientId ?? "");
  const selectedClient = reportableClients.find((client) => client.clientId === selectedClientId);
  const closed = incident?.handlingStatus === "closed";
  const allowed = kind === "close" ? canClose && hasRecentAal2 : canManage;
  const enabled = !demo && allowed && !pending && !closed &&
    (kind !== "report" || reportableClients.length > 0);
  const label = labels[kind];
  const dialogId = `fall-event-${kind}-${instance}-${incident?.id ?? "new"}`;
  const descriptionId = `${dialogId}-description`;
  const occurredIso = occurredLocal ? taipeiLocalToIso(occurredLocal) : "";
  const capturedNowIso = capturedNowLocal ? taipeiLocalToIso(capturedNowLocal) : "";
  const lateReport = kind === "report" && occurredIso !== "" && capturedNowIso !== "" &&
    new Date(capturedNowIso).getTime() - new Date(occurredIso).getTime() >= 24 * 60 * 60 * 1000;
  const reportMaxLocal = selectedClient?.endedOn && capturedNowLocal &&
    selectedClient.endedOn < capturedNowLocal.slice(0, 10)
    ? `${selectedClient.endedOn}T23:59`
    : capturedNowLocal || undefined;
  const disabledReason = demo
    ? "展示模式不會寫入資料"
    : closed
      ? "事件已結案，歷史不可追加"
      : kind === "close" && !canClose
        ? "目前角色沒有 quality_events.close"
        : kind === "close" && !hasRecentAal2
          ? "結案前須於同一工作階段完成最近 15 分鐘 AAL2 驗證"
          : kind !== "close" && !canManage
            ? "目前角色沒有 quality_events.manage"
            : kind === "report" && reportableClients.length === 0
              ? "目前沒有可新增事件的有效個案"
              : undefined;

  function open() {
    if (!enabled) return;
    const nowLocal = taipeiLocal(new Date());
    setCapturedNowLocal(nowLocal);
    setOccurredLocal(nowLocal);
    setSelectedClientId(reportableClients[0]?.clientId ?? "");
    setInjuryState("missing");
    setError(null);
    setNotice(null);
    setCompleted(false);
    idempotencyKey.current = crypto.randomUUID();
    dialog.current?.showModal();
  }

  function close() {
    if (!pending) dialog.current?.close();
  }

  function changed() {
    if (!error) return;
    idempotencyKey.current = crypto.randomUUID();
    setError(null);
  }

  function keepFocusInside(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey &&
      (document.activeElement === first || !event.currentTarget.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || completed || !occurredIso || (kind !== "report" && !incident)) return;
    idempotencyKey.current ??= crypto.randomUUID();
    const values = new FormData(event.currentTarget);
    let body: Record<string, unknown>;
    if (kind === "report") {
      const injuryText = String(values.get("injuryDegreeText") ?? "").trim();
      const lateReason = String(values.get("lateEntryReason") ?? "").trim();
      body = {
        action: "report",
        clientId: String(values.get("clientId") ?? ""),
        occurredAt: occurredIso,
        location: String(values.get("location") ?? ""),
        eventSummary: String(values.get("eventSummary") ?? ""),
        injuryDegreeState: injuryState,
        injuryDegreeText: injuryState === "provided" ? injuryText : null,
        lateEntryReason: lateReport ? lateReason : null,
      };
    } else if (kind === "close") {
      body = {
        action: "close",
        clientId: incident!.clientId,
        incidentId: incident!.id,
        occurredAt: occurredIso,
        closureOutcome: String(values.get("closureOutcome") ?? ""),
        closureReason: String(values.get("closureReason") ?? ""),
        expectedChainVersion: incident!.chainVersion,
      };
    } else {
      body = {
        action: kind,
        clientId: incident!.clientId,
        incidentId: incident!.id,
        occurredAt: occurredIso,
        entryText: String(values.get("entryText") ?? ""),
        expectedChainVersion: incident!.chainVersion,
      };
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetchWithTimeout("/api/fall-events", {
        method: kind === "report" ? "POST" : "PATCH",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify(body),
      });
      const raw: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const envelope = parseFallEventActionError(raw);
        setError(envelope?.errors.find((item) => item.message.trim())?.message ??
          "操作尚未確認完成；請保留內容並使用原操作重試。");
        return;
      }
      let success;
      try {
        success = parseFallEventActionSuccess(raw, {
          action: kind,
          clientId: kind === "report" ? selectedClientId : incident!.clientId,
          ...(incident ? {
            incidentId: incident.id,
            expectedChainVersion: incident.chainVersion,
          } : {}),
        });
      } catch {
        setError("伺服器回覆不完整；請勿更改內容，直接使用原操作重試。");
        return;
      }
      if (
        (kind === "report" && response.status !== (success.data.replayed ? 200 : 201)) ||
        (kind !== "report" && response.status !== 200)
      ) {
        setError("伺服器狀態與完成憑證不一致；請勿視為完成。");
        return;
      }
      setCompleted(true);
      setNotice(success.data.replayed
        ? "已確認先前相同操作，沒有建立重複紀錄。"
        : kind === "report" ? "跌倒事件已建立。"
          : kind === "close" ? "事件已以不可修改的結案紀錄完成。"
            : "事件時間軸已追加新紀錄。");
      dialog.current?.close();
      window.setTimeout(() => trigger.current?.focus(), 0);
      router.refresh();
    } catch (caught) {
      setError(isClientFetchTimeoutError(caught)
        ? "連線逾時，操作結果未知；請保留內容並使用原操作重試。"
        : "網路狀態不明；請勿關閉或修改內容，直接按原按鈕重試。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.actionSlot}>
      <button
        aria-label={!enabled && disabledReason ? `${label}：${disabledReason}` : label}
        className={`button ${kind === "report" || kind === "close" ? "button--primary" : "button--secondary"} ${styles.actionButton}`}
        disabled={!enabled}
        onClick={open}
        ref={trigger}
        title={!enabled ? disabledReason : undefined}
        type="button"
      >
        {actionIcon(kind)}{label}
      </button>
      {notice ? <span className="sr-only" role="status">{notice}</span> : null}
      <dialog
        aria-describedby={descriptionId}
        aria-labelledby={dialogId}
        className={`core-dialog ${styles.dialog}`}
        onCancel={(event) => { if (pending) event.preventDefault(); }}
        onClick={(event) => { if (event.target === event.currentTarget) close(); }}
        onClose={() => trigger.current?.focus()}
        onKeyDown={keepFocusInside}
        ref={dialog}
      >
        <form className="core-dialog__surface" onChange={changed} onSubmit={submit}>
          <header className="drawer__header">
            <div>
              <p className="eyebrow">跌倒事件・不可變時間軸</p>
              <h2 id={dialogId}>{label}</h2>
              <p id={descriptionId}>{kind === "report"
                ? "傷害程度為機構人工文字，不套用臨床分類；事件逾 24 小時補登必須填寫稽核理由。"
                : kind === "close"
                  ? "結案會追加結果與理由，不會覆寫事件或既有處置。"
                  : "新內容會依目前鏈版本追加；已提交紀錄不能修改或刪除。"}</p>
            </div>
            <button aria-label="關閉" className="icon-button" disabled={pending} onClick={close} type="button"><X aria-hidden="true" /></button>
          </header>
          <div className="drawer__body">
            <fieldset className={styles.fields} disabled={pending || completed}>
              {kind === "report" ? (
                <>
                  <label className="field"><span>個案 *</span><select name="clientId" onChange={(event) => setSelectedClientId(event.target.value)} required value={selectedClientId}>{reportableClients.map((client) => <option key={client.clientId} value={client.clientId}>{client.displayName}</option>)}</select></label>
                  <label className="field"><span>事件時間（台北）*</span><input max={reportMaxLocal} min={selectedClient?.admittedOn ? `${selectedClient.admittedOn}T00:00` : undefined} name="occurredAt" onChange={(event) => setOccurredLocal(event.target.value)} required type="datetime-local" value={occurredLocal} /></label>
                  <label className="field"><span>地點 *</span><input maxLength={240} name="location" required /></label>
                  <label className="field"><span>傷害資訊狀態 *</span><select name="injuryDegreeState" onChange={(event) => setInjuryState(event.target.value as FallInjuryState)} value={injuryState}><option value="provided">已提供機構文字</option><option value="missing">缺值</option><option value="not_applicable">不適用</option></select></label>
                  <label className={`field ${styles.full}`}><span>事件內容 *</span><textarea maxLength={2000} name="eventSummary" required /></label>
                  <label className={`field ${styles.full}`}><span>傷害程度文字{injuryState === "provided" ? " *" : ""}</span><input disabled={injuryState !== "provided"} maxLength={240} name="injuryDegreeText" required={injuryState === "provided"} /></label>
                  {lateReport ? <label className={`field ${styles.full} ${styles.lateField}`}><span>逾 24 小時補登理由 *</span><textarea maxLength={1000} name="lateEntryReason" required /><small>這是稽核與回填治理界線，不是臨床或法定通報門檻。</small></label> : null}
                </>
              ) : (
                <>
                  <div className={styles.incidentContext}><strong>{incident?.clientDisplayName}</strong><span>{incident?.eventSummary}</span><span>目前鏈版本 v{incident?.chainVersion}</span></div>
                  <label className="field"><span>{kind === "close" ? "結案時間" : "紀錄發生時間"}（台北）*</span><input max={capturedNowLocal || undefined} min={incident ? taipeiLocal(incident.timeline.at(-1)?.occurredAt ?? incident.occurredAt) : undefined} onChange={(event) => setOccurredLocal(event.target.value)} required type="datetime-local" value={occurredLocal} /></label>
                  {kind === "close" ? <>
                    <label className={`field ${styles.full}`}><span>結案結果 *</span><textarea maxLength={2000} name="closureOutcome" required /></label>
                    <label className={`field ${styles.full}`}><span>結案理由 *</span><textarea maxLength={1000} name="closureReason" required /></label>
                    <label className={`check-field ${styles.full}`}><input required type="checkbox" /><span>我已在同一工作階段完成最近 15 分鐘 AAL2 驗證，並確認結果與理由。</span></label>
                  </> : <label className={`field ${styles.full}`}><span>{kind === "treatment" ? "處置內容" : "追蹤內容"} *</span><textarea maxLength={2000} name="entryText" required /></label>}
                </>
              )}
            </fieldset>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
          </div>
          <footer className="drawer__footer">
            <button className="button button--secondary" disabled={pending} onClick={close} type="button">取消</button>
            <button className="button button--primary" disabled={pending || completed} type="submit">{pending ? "確認中…" : label}</button>
          </footer>
        </form>
      </dialog>
    </div>
  );
}

export function FallEventFreshness({ staleAfter, demo }: { staleAfter: string; demo: boolean }) {
  const [expiredBoundary, setExpiredBoundary] = useState<string | null>(null);
  useEffect(() => {
    if (demo) return;
    const timer = window.setTimeout(
      () => setExpiredBoundary(staleAfter),
      Math.max(0, new Date(staleAfter).getTime() - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [demo, staleAfter]);
  if (demo) return <span>合成展示快照</span>;
  return expiredBoundary === staleAfter
    ? <span className={styles.stale} role="status">資料已過期，請重新載入</span>
    : <span>資料為目前快照</span>;
}
