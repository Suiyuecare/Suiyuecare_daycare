"use client";

import { KeyboardEvent, useRef, useState } from "react";
import { CheckCheck, Eye, ShieldCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout } from "@/lib/api/client-fetch";
import {
  parseNotificationAcknowledgementError,
  parseNotificationAcknowledgementRequestId,
  parseNotificationAcknowledgementSuccess,
} from "@/lib/notification-center/parser";
import type {
  NotificationAcknowledgementTarget,
  NotificationCenterItem,
} from "@/lib/notification-center/types";

import styles from "./notification-center.module.css";

function focusableElements(dialog: HTMLDialogElement) {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      "button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])",
    ),
  ).filter(
    (element) =>
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true" &&
      !element.closest("[hidden]"),
  );
}

export function NotificationAcknowledgementAction({
  item,
  enabled,
  disabledReason,
  instance,
}: {
  item: NotificationCenterItem;
  enabled: boolean;
  disabledReason?: string;
  instance: "desktop" | "mobile";
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] =
    useState<NotificationAcknowledgementTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const target: NotificationAcknowledgementTarget =
    item.requiresConfirmation && item.confirmedAt === null
      ? "confirmed"
      : "read";
  const actionable =
    item.status === "queued" ||
    item.status === "sent" ||
    item.status === "delivered" ||
    (item.status === "read" && target === "confirmed");

  if (!actionable) {
    return (
      <span className={styles.completedAction}>
        <CheckCheck aria-hidden="true" />
        {item.status === "confirmed" ? "已確認" : item.status === "read" ? "已讀" : "不可操作"}
      </span>
    );
  }

  async function acknowledge() {
    setPending(true);
    setError(null);
    try {
      const response = await fetchWithTimeout("/api/notifications/acknowledge", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify({
          delivery_id: item.deliveryId,
          target_status: target,
        }),
      });
      const raw: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const envelope = parseNotificationAcknowledgementError(raw);
        const requestId =
          envelope?.requestId ?? parseNotificationAcknowledgementRequestId(raw);
        const first = envelope?.errors[0];
        throw new Error(
          first?.message
            ? `${first.message}（請求識別碼 ${envelope!.requestId}）`
            : `通知操作未確認完成；請保留原畫面並直接重試。${
                requestId ? `（請求識別碼 ${requestId}）` : ""
              }`,
        );
      }
      try {
        parseNotificationAcknowledgementSuccess(
          raw,
          { deliveryId: item.deliveryId, targetStatus: target },
          response.status,
        );
      } catch {
        const requestId = parseNotificationAcknowledgementRequestId(raw);
        throw new Error(
          `伺服器回覆不完整；請以相同操作直接重試。${
            requestId ? `（請求識別碼 ${requestId}）` : ""
          }`,
        );
      }
      setCompleted(target);
      if (target === "confirmed") dialog.current?.close();
      setNotice(target === "confirmed" ? "已確認通知。" : "已標示為已讀。");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : "通知操作未確認完成；請沿用相同操作直接重試。",
      );
    } finally {
      setPending(false);
    }
  }

  function keepFocusInside(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const controls = focusableElements(event.currentTarget);
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const actionLabel = completed
    ? completed === "confirmed"
      ? "已確認"
      : "已讀"
    : target === "confirmed"
      ? "確認最高優先通知"
      : "標示已讀";
  const actionDisabled = !enabled || pending;
  const title = !enabled ? disabledReason : undefined;
  return (
    <div className={styles.actionBox}>
      <button
        aria-disabled={completed ? "true" : undefined}
        aria-label={!enabled && disabledReason ? `${actionLabel}：${disabledReason}` : actionLabel}
        className={target === "confirmed" ? "button button--primary" : "button button--secondary"}
        disabled={actionDisabled}
        onClick={() => {
          if (completed) return;
          setError(null);
          setNotice(null);
          if (target === "confirmed") dialog.current?.showModal();
          else void acknowledge();
        }}
        ref={trigger}
        title={title}
        type="button"
      >
        {target === "confirmed" ? <ShieldCheck aria-hidden="true" /> : <Eye aria-hidden="true" />}
        {pending && target === "read" ? "處理中…" : actionLabel}
      </button>
      {notice ? <small className={styles.successText} role="status">{notice}</small> : null}
      {error && target !== "confirmed" ? (
        <small className={styles.errorText} role="alert">{error}</small>
      ) : null}
      {target === "confirmed" ? (
        <dialog
          aria-labelledby={`notification-confirm-${instance}-${item.deliveryId}`}
          className={`core-dialog ${styles.dialog}`}
          onCancel={(event) => {
            if (pending) event.preventDefault();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget && !pending) {
              dialog.current?.close();
            }
          }}
          onClose={() => setTimeout(() => trigger.current?.focus(), 0)}
          onKeyDown={keepFocusInside}
          ref={dialog}
        >
          <div className="core-dialog__surface">
            <header className="drawer__header">
              <div>
                <p className="eyebrow">不可逆確認</p>
                <h2 id={`notification-confirm-${instance}-${item.deliveryId}`}>
                  確認最高優先通知
                </h2>
              </div>
              <button
                aria-label="關閉"
                className="icon-button"
                disabled={pending}
                onClick={() => dialog.current?.close()}
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <div className="drawer__body core-dialog__body">
              <div className="callout core-care-callout">
                <ShieldCheck aria-hidden="true" />
                <span>確認會以伺服器時間寫入不可變操作收據；完成後不能退回未讀。</span>
              </div>
              <div className={styles.confirmSummary}>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </div>
              {error ? <p className={styles.dialogError} role="alert">{error}</p> : null}
            </div>
            <footer className="drawer__footer">
              <button
                className="button button--secondary"
                disabled={pending}
                onClick={() => dialog.current?.close()}
                type="button"
              >
                返回
              </button>
              <button
                className="button button--primary"
                disabled={pending}
                onClick={() => void acknowledge()}
                type="button"
              >
                <CheckCheck aria-hidden="true" />
                {pending ? "確認中…" : "確認並留下收據"}
              </button>
            </footer>
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
