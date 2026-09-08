"use client";

import { useId, useRef, useState } from "react";
import { FileWarning, MessageSquarePlus, PencilLine, X } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  fetchWithTimeout,
  isClientFetchTimeoutError,
} from "@/lib/api/client-fetch";
import {
  parseCareCommunicationApiError,
  parseCareCommunicationApiSuccess,
} from "@/lib/care-communications/parser";
import type {
  CareCommunicationClientOption,
  CareCommunicationCorrectionInput,
  CareCommunicationCreateInput,
  CareCommunicationItem,
} from "@/lib/care-communications/types";

import styles from "./care-communications.module.css";

function taipeiLocalMinute() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}

function taipeiLocalToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) return null;
  const parsed = new Date(`${value}:00+08:00`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function messageFromError(value: unknown, fallback: string) {
  return parseCareCommunicationApiError(value)?.errors.find(
    (error) => error.message.trim(),
  )?.message ?? fallback;
}

function trapDialogFocus(event: React.KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => element.getClientRects().length > 0);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  if (event.shiftKey &&
      (document.activeElement === first ||
        !event.currentTarget.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function AttachmentBoundary({ headingId }: { headingId: string }) {
  return (
    <section aria-labelledby={headingId} className={styles.attachmentBoundary}>
      <FileWarning aria-hidden="true" />
      <div>
        <h3 id={headingId}>附件：未設定</h3>
        <p>可信上傳、雜湊與掃毒管線尚未完成，因此不提供檔案、網址或裝置路徑欄位。</p>
      </div>
    </section>
  );
}

function unknownFailure(caught: unknown) {
  return isClientFetchTimeoutError(caught)
    ? caught.message
    : "網路結果不明；請勿更改內容，直接以相同操作重試。";
}

export function CareCommunicationCreateAction({
  canManage,
  clients,
  demo,
  hasRecentAal2,
}: {
  canManage: boolean;
  clients: readonly CareCommunicationClientOption[];
  demo: boolean;
  hasRecentAal2: boolean;
}) {
  const router = useRouter();
  const titleId = useId();
  const descriptionId = useId();
  const attachmentHeadingId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const idempotencyKey = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const eligibleClients = clients.filter(
    (client) => client.authorizedFamilyCount > 0,
  );
  const enabled = canManage && !demo && hasRecentAal2 &&
    eligibleClients.length > 0 && !pending;
  const disabledReason = demo
    ? "展示模式唯讀"
    : !hasRecentAal2
      ? "最近 15 分鐘內須重新完成雙因素驗證"
      : !canManage
        ? "目前角色沒有建立權限"
        : eligibleClients.length === 0
          ? "沒有具 messages.read 授權的家屬收件人"
          : undefined;

  function open() {
    if (!enabled) return;
    idempotencyKey.current ??= crypto.randomUUID();
    setError(null);
    setCompleted(false);
    dialog.current?.showModal();
  }

  function close() {
    if (pending) return;
    if (!error) idempotencyKey.current = null;
    dialog.current?.close();
  }

  function changed() {
    if (!error) return;
    idempotencyKey.current = crypto.randomUUID();
    setError(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || completed) return;
    const values = new FormData(event.currentTarget);
    const occurredAt = taipeiLocalToIso(String(values.get("occurredAt") ?? ""));
    if (!occurredAt) {
      setError("請確認發生時間。");
      return;
    }
    idempotencyKey.current ??= crypto.randomUUID();
    const input: CareCommunicationCreateInput = {
      action: "create",
      clientId: String(values.get("clientId") ?? "").toLowerCase(),
      subject: String(values.get("subject") ?? "").trim(),
      body: String(values.get("body") ?? "").trim(),
      occurredAt,
      attachments: [],
      idempotencyKey: idempotencyKey.current,
    };
    setPending(true);
    setError(null);
    try {
      const response = await fetchWithTimeout("/api/care-communications", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify({
          action: input.action,
          clientId: input.clientId,
          subject: input.subject,
          body: input.body,
          occurredAt: input.occurredAt,
          attachments: input.attachments,
        }),
      });
      const raw: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(messageFromError(
          raw,
          "操作結果尚未確認；請保留內容並以相同操作重試。",
        ));
        return;
      }
      let success;
      try {
        success = parseCareCommunicationApiSuccess(raw, input);
      } catch {
        const requestId = raw && typeof raw === "object" &&
          "requestId" in raw && typeof raw.requestId === "string"
          ? `（追蹤碼 ${raw.requestId}）` : "";
        setError(`伺服器回覆無法核對；請勿視為完成，並以相同操作重試。${requestId}`);
        return;
      }
      if (response.status !== (success.data.replayed ? 200 : 201)) {
        setError(`HTTP 狀態與完成憑證不一致；請以相同操作重試。（追蹤碼 ${success.requestId}）`);
        return;
      }
      setCompleted(true);
      setNotice(success.data.replayed
        ? `已核對先前相同操作，沒有新增重複資料。（追蹤碼 ${success.requestId}）`
        : `待送紀錄已建立；尚未送達、已讀或確認。（追蹤碼 ${success.requestId}）`);
      idempotencyKey.current = null;
      dialog.current?.close();
      window.setTimeout(() => trigger.current?.focus(), 0);
      router.refresh();
    } catch (caught) {
      setError(unknownFailure(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.actionSlot}>
      <button
        aria-label={!enabled && disabledReason
          ? `新增待送紀錄：${disabledReason}`
          : "新增待送紀錄"}
        className="button button--primary"
        disabled={!enabled}
        onClick={open}
        ref={trigger}
        title={!enabled ? disabledReason : undefined}
        type="button"
      ><MessageSquarePlus aria-hidden="true" />新增待送紀錄</button>
      {notice ? <p className={styles.actionNotice} role="status">{notice}</p> : null}
      <dialog
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        className={`core-dialog ${styles.dialog}`}
        onCancel={(event) => { if (pending) event.preventDefault(); }}
        onClick={(event) => { if (event.target === event.currentTarget) close(); }}
        onClose={() => trigger.current?.focus()}
        onKeyDown={trapDialogFocus}
        ref={dialog}
      >
        <form className="core-dialog__surface" onChange={changed} onSubmit={submit}>
          <header className="drawer__header">
            <div>
              <p className="eyebrow">家屬授權快照・系統內待送</p>
              <h2 id={titleId}>新增照顧溝通紀錄</h2>
              <p id={descriptionId}>
                建立後作者、發生／送出時間、個案與家屬授權快照不可覆寫。
              </p>
            </div>
            <button aria-label="關閉" className="icon-button" disabled={pending} onClick={close} type="button"><X aria-hidden="true" /></button>
          </header>
          <div className={`drawer__body ${styles.formBody}`}>
            <fieldset className={styles.formFieldset} disabled={pending}>
              <label className="field">
                <span>個案 *</span>
                <select autoFocus name="clientId" required>
                  <option value="">請選擇個案</option>
                  {eligibleClients.map((client) => (
                    <option key={client.clientId} value={client.clientId}>
                      {client.displayName}（{client.clientCode}）・已授權 {client.authorizedFamilyCount} 位
                    </option>
                  ))}
                </select>
              </label>
              <label className="field"><span>主旨 *</span><input maxLength={200} name="subject" required /></label>
              <label className="field">
                <span>發生時間（台北）*</span>
                <input defaultValue={taipeiLocalMinute()} max={taipeiLocalMinute()} name="occurredAt" required step={60} type="datetime-local" />
              </label>
              <label className="field"><span>訊息內容 *</span><textarea maxLength={10_000} name="body" required rows={6} /></label>
              <AttachmentBoundary headingId={attachmentHeadingId} />
            </fieldset>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
          </div>
          <footer className="drawer__footer">
            <button className="button button--secondary" disabled={pending} onClick={close} type="button">取消</button>
            <button className="button button--primary" disabled={pending || completed} type="submit">{pending ? "建立中…" : "建立待送紀錄"}</button>
          </footer>
        </form>
      </dialog>
    </div>
  );
}

export function CareCommunicationCorrectionAction({
  canCorrect,
  demo,
  hasRecentAal2,
  item,
}: {
  canCorrect: boolean;
  demo: boolean;
  hasRecentAal2: boolean;
  item: CareCommunicationItem;
}) {
  const router = useRouter();
  const titleId = useId();
  const descriptionId = useId();
  const attachmentHeadingId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const idempotencyKey = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const enabled = canCorrect && item.current && !demo && hasRecentAal2 && !pending;
  const disabledReason = !item.current
    ? "只能從目前版本建立更正"
    : demo
      ? "展示模式唯讀"
      : !hasRecentAal2
        ? "最近 15 分鐘內須重新完成雙因素驗證"
        : !canCorrect
          ? "目前角色沒有更正權限"
          : undefined;

  function open() {
    if (!enabled) return;
    idempotencyKey.current ??= crypto.randomUUID();
    setError(null);
    setCompleted(false);
    dialog.current?.showModal();
  }
  function close() {
    if (pending) return;
    if (!error) idempotencyKey.current = null;
    dialog.current?.close();
  }
  function changed() {
    if (!error) return;
    idempotencyKey.current = crypto.randomUUID();
    setError(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || completed) return;
    const values = new FormData(event.currentTarget);
    idempotencyKey.current ??= crypto.randomUUID();
    const input: CareCommunicationCorrectionInput = {
      action: "correct",
      clientId: item.clientId,
      communicationKey: item.communicationKey,
      previousVersionId: item.versionId,
      expectedVersion: item.version,
      subject: String(values.get("subject") ?? "").trim(),
      body: String(values.get("body") ?? "").trim(),
      correctionReason: String(values.get("correctionReason") ?? "").trim(),
      attachments: [],
      idempotencyKey: idempotencyKey.current,
    };
    setPending(true);
    setError(null);
    try {
      const response = await fetchWithTimeout("/api/care-communications", {
        method: "PATCH",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify({
          action: input.action,
          clientId: input.clientId,
          communicationKey: input.communicationKey,
          previousVersionId: input.previousVersionId,
          expectedVersion: input.expectedVersion,
          subject: input.subject,
          body: input.body,
          correctionReason: input.correctionReason,
          attachments: input.attachments,
        }),
      });
      const raw: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(messageFromError(
          raw,
          "更正結果尚未確認；請保留內容並以相同操作重試。",
        ));
        return;
      }
      let success;
      try {
        success = parseCareCommunicationApiSuccess(raw, input);
      } catch {
        const requestId = raw && typeof raw === "object" &&
          "requestId" in raw && typeof raw.requestId === "string"
          ? `（追蹤碼 ${raw.requestId}）` : "";
        setError(`伺服器回覆無法核對；請勿視為完成，並以相同操作重試。${requestId}`);
        return;
      }
      if (response.status !== (success.data.replayed ? 200 : 201)) {
        setError(`HTTP 狀態與完成憑證不一致；請以相同操作重試。（追蹤碼 ${success.requestId}）`);
        return;
      }
      setCompleted(true);
      setNotice(success.data.replayed
        ? `已核對先前相同更正，沒有新增重複版本。（追蹤碼 ${success.requestId}）`
        : `更正版 v${success.data.communicationVersion} 已建立；原紀錄仍保留。（追蹤碼 ${success.requestId}）`);
      idempotencyKey.current = null;
      dialog.current?.close();
      window.setTimeout(() => trigger.current?.focus(), 0);
      router.refresh();
    } catch (caught) {
      setError(unknownFailure(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.correctionAction}>
      <button
        aria-label={!enabled && disabledReason
          ? `建立更正：${disabledReason}`
          : `為 ${item.subject} 建立更正`}
        className="button button--secondary"
        disabled={!enabled}
        onClick={open}
        ref={trigger}
        title={!enabled ? disabledReason : undefined}
        type="button"
      ><PencilLine aria-hidden="true" />建立更正</button>
      {notice ? <p className={styles.actionNotice} role="status">{notice}</p> : null}
      <dialog
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        className={`core-dialog ${styles.dialog}`}
        onCancel={(event) => { if (pending) event.preventDefault(); }}
        onClick={(event) => { if (event.target === event.currentTarget) close(); }}
        onClose={() => trigger.current?.focus()}
        onKeyDown={trapDialogFocus}
        ref={dialog}
      >
        <form className="core-dialog__surface" onChange={changed} onSubmit={submit}>
          <header className="drawer__header">
            <div>
              <p className="eyebrow">不可變歷程・狹義更正</p>
              <h2 id={titleId}>建立第 {item.version + 1} 版更正</h2>
              <p id={descriptionId}>
                原始版本、發生時間、個案及收件授權快照均保留；不可用更正移轉對象。
              </p>
            </div>
            <button aria-label="關閉" className="icon-button" disabled={pending} onClick={close} type="button"><X aria-hidden="true" /></button>
          </header>
          <div className={`drawer__body ${styles.formBody}`}>
            <fieldset className={styles.formFieldset} disabled={pending}>
              <label className="field"><span>主旨 *</span><input autoFocus defaultValue={item.subject} maxLength={200} name="subject" required /></label>
              <label className="field"><span>訊息內容 *</span><textarea defaultValue={item.body} maxLength={10_000} name="body" required rows={6} /></label>
              <label className="field"><span>更正理由 *</span><textarea maxLength={500} minLength={2} name="correctionReason" required rows={3} /></label>
              <AttachmentBoundary headingId={attachmentHeadingId} />
            </fieldset>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
          </div>
          <footer className="drawer__footer">
            <button className="button button--secondary" disabled={pending} onClick={close} type="button">取消</button>
            <button className="button button--primary" disabled={pending || completed} type="submit">{pending ? "建立中…" : "建立更正版"}</button>
          </footer>
        </form>
      </dialog>
    </div>
  );
}
