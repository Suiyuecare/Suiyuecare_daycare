"use client";

import { useRef, useState } from "react";
import { FileCheck2, Send, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseFormPublicationActionError,
  parseFormPublicationActionSuccess,
} from "@/lib/form-governance/parser";
import type { FormGovernanceVersion } from "@/lib/form-governance/types";

import styles from "./form-rule-versions.module.css";

type ActionKind = "request" | "approve";

function formatPeriod(version: FormGovernanceVersion) {
  if (!version.effectiveFrom) return "尚未設定";
  return `${version.effectiveFrom} ～ ${version.effectiveTo ?? "持續有效"}`;
}

export function FormPublicationAction({
  kind,
  instance,
  version,
  enabled,
  disabledReason,
}: {
  kind: ActionKind;
  instance: "desktop" | "mobile";
  version: FormGovernanceVersion;
  enabled: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const idempotencyKey = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isRequest = kind === "request";
  const label = isRequest ? "送出覆核" : "核准並發布";
  const form = useRef<HTMLFormElement>(null);
  const dialogId = `form-publication-${instance}-${kind}-${version.id}`;
  const descriptionId = `${dialogId}-description`;

  function open() {
    if (!enabled) return;
    idempotencyKey.current ??= crypto.randomUUID();
    setError(null);
    setNotice(null);
    setCompleted(false);
    form.current?.reset();
    dialog.current?.showModal();
  }

  function close() {
    if (!pending) dialog.current?.close();
  }

  function keepFocusInside(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        !event.currentTarget.contains(document.activeElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || completed) return;
    idempotencyKey.current ??= crypto.randomUUID();
    setPending(true);
    setError(null);
    setNotice(null);
    const endpoint = isRequest
      ? "/api/forms/publications/request"
      : "/api/forms/publications/approve";
    const body = isRequest
      ? { form_version_id: version.id }
      : { request_id: version.publication?.id };

    try {
      const response = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const errorEnvelope = parseFormPublicationActionError(payload);
        setError(
          errorEnvelope?.errors[0]?.message ??
            "操作尚未確認完成；請保留此視窗並直接重試。",
        );
        return;
      }
      try {
        parseFormPublicationActionSuccess(
          payload,
          isRequest
            ? {
                kind: "request",
                formVersionId: version.id,
                httpStatus: response.status,
              }
            : {
                kind: "approve",
                formVersionId: version.id,
                publicationRequestId: version.publication?.id ?? "",
                httpStatus: response.status,
              },
        );
      } catch {
        setError("伺服器回覆不完整；請勿重建內容，直接以相同操作重試。");
        return;
      }

      setCompleted(true);
      setNotice(
        isRequest
          ? "送審已保存，需由另一位具權限人員核准。"
          : "核准與發布已在同一交易完成。",
      );
      router.refresh();
    } catch (caught) {
      setError(isClientFetchTimeoutError(caught)
        ? caught.message
        : "網路狀態不明；請勿關閉或重建操作，直接按原按鈕重試。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.actionSlot}>
      <button
        aria-label={!enabled && disabledReason ? `${label}：${disabledReason}` : label}
        className={`button ${isRequest ? "button--secondary" : "button--primary"} ${styles.actionButton}`}
        disabled={!enabled}
        onClick={open}
        ref={trigger}
        title={!enabled ? disabledReason : undefined}
        type="button"
      >
        {isRequest ? <Send aria-hidden="true" /> : <FileCheck2 aria-hidden="true" />}
        {label}
      </button>
      <dialog
        aria-describedby={descriptionId}
        aria-labelledby={dialogId}
        className={`core-dialog ${styles.dialog}`}
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        onClose={() => trigger.current?.focus()}
        onKeyDown={keepFocusInside}
        ref={dialog}
      >
        <form className="core-dialog__surface" onSubmit={submit} ref={form}>
          <header className="drawer__header">
            <div>
              <p className="eyebrow">雙人 AAL2 發布流程</p>
              <h2 id={dialogId}>{isRequest ? "確認送出覆核" : "確認核准並發布"}</h2>
              <p id={descriptionId}>{version.name}・第 {version.version} 版</p>
            </div>
            <button
              aria-label="關閉"
              className="icon-button"
              disabled={pending}
              onClick={close}
              type="button"
            >
              <X aria-hidden="true" />
            </button>
          </header>
          <div className={`drawer__body core-dialog__body ${styles.dialogBody}`}>
            <div className={`callout ${styles.securityCallout}`}>
              <ShieldCheck aria-hidden="true" />
              <span>
                {isRequest
                  ? "送審會由伺服器鎖定名稱、欄位、公式、日期與內容雜湊；申請人不能核准自己的申請。"
                  : "核准前會再次比對完整內容、生效期間與獨立重新驗證證據；成功後版本立即發布且不可改寫。"}
              </span>
            </div>
            <dl className={styles.dialogSummary}>
              <div><dt>命名空間</dt><dd>{version.formKey}</dd></div>
              <div><dt>生效期間</dt><dd>{formatPeriod(version)}</dd></div>
              <div><dt>欄位數</dt><dd>{version.schemaFieldCount}</dd></div>
              <div><dt>計分／規則數</dt><dd>{version.scoringRuleCount}</dd></div>
              {version.publication ? (
                <div className={styles.summaryWide}>
                  <dt>申請證據</dt>
                  <dd>{version.publication.requesterLabel}・{new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short" }).format(new Date(version.publication.requestedAt))}</dd>
                </div>
              ) : null}
            </dl>
            <label className="check-field">
              <input disabled={completed} required type="checkbox" />
              <span>
                {isRequest
                  ? "我確認此版本的名稱、生效期間、欄位與規則已完成內部檢查，並同意送交另一人覆核。"
                  : "我已獨立檢查內容與期間，確認自己不是申請人，並同意發布這個不可改寫的版本。"}
              </span>
            </label>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            {notice ? <p className={styles.successNotice} role="status">{notice}</p> : null}
          </div>
          <footer className="drawer__footer">
            <button className="button button--secondary" disabled={pending} onClick={close} type="button">
              {completed ? "關閉" : "取消"}
            </button>
            <button className="button button--primary" disabled={pending || completed} type="submit">
              {pending ? "確認中…" : completed ? "已完成" : label}
            </button>
          </footer>
        </form>
      </dialog>
      {!enabled && disabledReason?.includes("重新驗證") ? (
        <Link className={styles.reauthLink} href="/mfa?audience=staff&purpose=sensitive-action">
          重新驗證
        </Link>
      ) : null}
    </div>
  );
}
