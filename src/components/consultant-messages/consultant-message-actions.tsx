"use client";

import { useRef, useState } from "react";
import { CheckCheck, Eye, MessageSquarePlus, Paperclip, X } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  fetchWithTimeout,
  isClientFetchTimeoutError,
} from "@/lib/api/client-fetch";
import {
  parseConsultantMessageApiError,
  parseConsultantMessageCreateApiSuccess,
  parseConsultantMessageReceiptApiSuccess,
} from "@/lib/consultant-messages/parser";
import type {
  ConsultantMessageItem,
  ConsultantMessageReceiptAction,
  ConsultantRecipientOption,
} from "@/lib/consultant-messages/types";

import styles from "./consultant-messages.module.css";

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
  return parseConsultantMessageApiError(value)?.errors.find(
    (error) => error.message.trim(),
  )?.message ?? fallback;
}

function trapDialogFocus(event: React.KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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

export function ConsultantMessageCreateAction({
  canManage,
  demo,
  recipients,
}: {
  canManage: boolean;
  demo: boolean;
  recipients: readonly ConsultantRecipientOption[];
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const idempotencyKey = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const enabled = canManage && !demo && recipients.length > 0 && !pending;
  const disabledReason = demo
    ? "展示模式不會寫入資料"
    : !canManage
      ? "目前角色沒有 consultant_messages.manage"
      : recipients.length === 0
        ? "本分支沒有已授權的顧問收件角色"
        : undefined;

  function open() {
    if (!enabled) return;
    idempotencyKey.current = crypto.randomUUID();
    setError(null);
    setNotice(null);
    setCompleted(false);
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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || completed) return;
    const values = new FormData(event.currentTarget);
    const recipientUserIds = values.getAll("recipientUserIds").map(String).sort();
    const occurredAt = taipeiLocalToIso(String(values.get("occurredAt") ?? ""));
    if (!occurredAt || recipientUserIds.length === 0) {
      setError("請選擇至少一位顧問，並確認發生時間。");
      return;
    }
    idempotencyKey.current ??= crypto.randomUUID();
    const input = {
      action: "create" as const,
      subject: String(values.get("subject") ?? "").trim(),
      body: String(values.get("body") ?? "").trim(),
      occurredAt,
      recipientUserIds,
      attachments: [],
      idempotencyKey: idempotencyKey.current,
    };
    setPending(true);
    setError(null);
    try {
      const response = await fetchWithTimeout("/api/consultant-messages", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify({
          action: input.action,
          subject: input.subject,
          body: input.body,
          occurredAt: input.occurredAt,
          recipientUserIds: input.recipientUserIds,
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
        success = parseConsultantMessageCreateApiSuccess(raw, input);
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
        ? `已確認先前相同訊息，沒有建立重複資料。（追蹤碼 ${success.requestId}）`
        : `顧問訊息已建立於系統內；尚未宣稱外部送達。（追蹤碼 ${success.requestId}）`);
      dialog.current?.close();
      window.setTimeout(() => trigger.current?.focus(), 0);
      router.refresh();
    } catch (caught) {
      setError(isClientFetchTimeoutError(caught)
        ? caught.message
        : "網路結果不明；請勿更改內容，直接以相同操作重試。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.actionSlot}>
      <button
        aria-label={!enabled && disabledReason
          ? `新增顧問訊息：${disabledReason}`
          : "新增顧問訊息"}
        className="button button--primary"
        disabled={!enabled}
        onClick={open}
        ref={trigger}
        title={!enabled ? disabledReason : undefined}
        type="button"
      >
        <MessageSquarePlus aria-hidden="true" />新增顧問訊息
      </button>
      {notice ? <span className="sr-only" role="status">{notice}</span> : null}
      <dialog
        aria-describedby="consultant-message-create-description"
        aria-labelledby="consultant-message-create-title"
        className={`core-dialog ${styles.dialog}`}
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        onClose={() => trigger.current?.focus()}
        onKeyDown={trapDialogFocus}
        ref={dialog}
      >
        <form className="core-dialog__surface" onChange={changed} onSubmit={submit}>
          <header className="drawer__header">
            <div>
              <p className="eyebrow">顧問類別限定</p>
              <h2 id="consultant-message-create-title">新增顧問訊息</h2>
              <p id="consultant-message-create-description">
                發布後內容、作者、時間與收件者快照不可覆寫；目前只在系統內顯示。
              </p>
            </div>
            <button
              aria-label="關閉"
              className="icon-button"
              disabled={pending}
              onClick={close}
              type="button"
            ><X aria-hidden="true" /></button>
          </header>
          <div className={`drawer__body ${styles.formBody}`}>
            <fieldset className={styles.formFieldset} disabled={pending}>
            <label className="field">
              <span>主旨 *</span>
              <input autoFocus maxLength={200} name="subject" required />
            </label>
            <label className="field">
              <span>發生時間（台北）*</span>
              <input
                defaultValue={taipeiLocalMinute()}
                max={taipeiLocalMinute()}
                name="occurredAt"
                required
                step={60}
                type="datetime-local"
              />
            </label>
            <label className="field">
              <span>訊息內容 *</span>
              <textarea maxLength={10_000} name="body" required rows={6} />
            </label>
            <fieldset className={styles.recipientFieldset}>
              <legend>顧問收件者 *</legend>
              <p>只列出本分支目前具 read＋receive 權限的專業顧問。</p>
              <div className={styles.recipientChoices}>
                {recipients.map((recipient) => (
                  <label className="check-field" key={recipient.userId}>
                    <input name="recipientUserIds" type="checkbox" value={recipient.userId} />
                    <span>
                      <strong>{recipient.displayName}</strong>
                      <small>{recipient.employeeCode ?? "無員工編號"}・{recipient.roleNames.join("、")}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <section aria-labelledby="consultant-attachment-title" className={styles.attachmentBoundary}>
              <Paperclip aria-hidden="true" />
              <div>
                <h3 id="consultant-attachment-title">附件：未設定</h3>
                <p>可信上傳與掃描管線尚未完成，因此不提供檔案、網址或裝置路徑欄位。</p>
              </div>
            </section>
            </fieldset>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
          </div>
          <footer className="drawer__footer">
            <button
              className="button button--secondary"
              disabled={pending}
              onClick={close}
              type="button"
            >取消</button>
            <button
              className="button button--primary"
              disabled={pending || completed}
              type="submit"
            >{pending ? "建立中…" : "建立訊息"}</button>
          </footer>
        </form>
      </dialog>
    </div>
  );
}

export function ConsultantMessageReceiptAction({
  action,
  canReceive,
  demo,
  message,
}: {
  action: ConsultantMessageReceiptAction;
  canReceive: boolean;
  demo: boolean;
  message: ConsultantMessageItem;
}) {
  const router = useRouter();
  const idempotencyKey = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const label = action === "read" ? "標示已讀" : "確認訊息";
  const alreadyComplete = action === "read"
    ? message.actorReadAt !== null
    : message.actorConfirmedAt !== null;
  const enabled = !demo && canReceive && message.actorIsRecipient &&
    !alreadyComplete && !pending && !completed;

  async function submit() {
    if (!enabled) return;
    idempotencyKey.current ??= crypto.randomUUID();
    const input = {
      action,
      messageId: message.messageId,
      idempotencyKey: idempotencyKey.current,
    };
    setPending(true);
    setError(null);
    try {
      const response = await fetchWithTimeout("/api/consultant-messages", {
        method: "PATCH",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify({ action: input.action, messageId: input.messageId }),
      });
      const raw: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(messageFromError(
          raw,
          "回條結果尚未確認；請使用同一按鈕重試。",
        ));
        return;
      }
      let success;
      try {
        success = parseConsultantMessageReceiptApiSuccess(raw, input);
      } catch {
        const requestId = raw && typeof raw === "object" &&
          "requestId" in raw && typeof raw.requestId === "string"
          ? `（追蹤碼 ${raw.requestId}）` : "";
        setError(`伺服器回條無法核對；請勿視為完成，並以相同操作重試。${requestId}`);
        return;
      }
      if (response.status !== 200 ||
          success.data.messageId !== message.messageId) {
        setError(`伺服器狀態與回條不一致；請以相同操作重試。（追蹤碼 ${success.requestId}）`);
        return;
      }
      setCompleted(true);
      setNotice(`${action === "read" ? "已讀" : "確認"}回條已核對。（追蹤碼 ${success.requestId}）`);
      router.refresh();
    } catch (caught) {
      setError(isClientFetchTimeoutError(caught)
        ? caught.message
        : "網路結果不明；請使用同一按鈕重試，不會新增重複回條。");
    } finally {
      setPending(false);
    }
  }

  if (alreadyComplete) return (
    <span className="status-pill status-pill--success">
      <CheckCheck aria-hidden="true" />{action === "read" ? "已讀" : "已確認"}
    </span>
  );
  if (completed) return (
    <span className="status-pill status-pill--success" role="status">
      <CheckCheck aria-hidden="true" />{notice ?? "回條已核對"}
    </span>
  );
  const disabledReason = demo
    ? "展示模式不會寫入回條"
    : !canReceive
      ? "目前角色沒有 consultant_messages.receive"
      : !message.actorIsRecipient
        ? "只有收件顧問本人可留下回條"
        : undefined;
  return (
    <div className={styles.receiptAction}>
      <button
        aria-label={!enabled && disabledReason ? `${label}：${disabledReason}` : label}
        className={action === "confirm"
          ? "button button--primary"
          : "button button--secondary"}
        disabled={!enabled}
        onClick={submit}
        title={!enabled ? disabledReason : undefined}
        type="button"
      >
        {action === "read" ? <Eye aria-hidden="true" /> : <CheckCheck aria-hidden="true" />}
        {pending ? "確認中…" : label}
      </button>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </div>
  );
}
