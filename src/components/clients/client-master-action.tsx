"use client";

import { useRef, useState } from "react";
import { Pencil, Plus, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import type { ClientMasterItem } from "@/lib/clients/master-types";
import {
  ClientMasterResponseContractError,
  parseClientMasterSuccessResponse,
} from "@/lib/clients/master-response";

import styles from "./client-master.module.css";

function responseMessage(
  envelope: unknown,
  fallback: string,
) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return fallback;
  }
  const errors = (envelope as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return fallback;
  for (const error of errors) {
    if (!error || typeof error !== "object" || Array.isArray(error)) continue;
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function needsAal2(envelope: unknown) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return false;
  }
  const errors = (envelope as { errors?: unknown }).errors;
  return (
    Array.isArray(errors) &&
    errors.some(
      (error) =>
        error !== null &&
        typeof error === "object" &&
        !Array.isArray(error) &&
        (error as { code?: unknown }).code === "AAL2_REQUIRED",
    )
  );
}

export function ClientMasterAction({
  kind,
  instance,
  client,
  canManage,
  canCreate = canManage,
  hasRecentAal2,
  demo,
  today,
}: {
  kind: "create" | "edit";
  instance: string;
  client?: ClientMasterItem;
  canManage: boolean;
  canCreate?: boolean;
  hasRecentAal2: boolean;
  demo: boolean;
  today: string;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const idempotencyKey = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const editing = kind === "edit";
  const eligibleClient = !editing || Boolean(client?.editable);
  const hasWriteAuthority = editing ? canManage : canCreate;
  const enabled =
    !demo && hasWriteAuthority && hasRecentAal2 && eligibleClient && !pending;
  const label = editing ? "編輯本機欄位" : "新增本機個案";
  const dialogId = `client-master-${kind}-${instance}`;
  const descriptionId = `${dialogId}-description`;
  const disabledReason = demo
    ? "展示模式不寫入任何資料"
    : !hasWriteAuthority
      ? editing
        ? "此表單包含生日欄位，需要 clients.read、clients.manage 與 clients.demographics.read"
        : "此表單包含生日欄位，新增需要 clients.read、clients.manage、clients.demographics.read 與 clients.view_all"
      : !hasRecentAal2
        ? "請先完成最近 15 分鐘內的雙因素重新驗證"
        : client?.editBlockReason === "central_authority"
          ? "中央主權欄位只能經受治理的中央匯入更新"
          : client?.editBlockReason === "terminal_status"
            ? "轉出、結案或死亡個案不可修改主檔"
            : undefined;

  function open() {
    if (!enabled) return;
    idempotencyKey.current = crypto.randomUUID();
    setError(null);
    setNotice(null);
    setNeedsReauth(false);
    setCompleted(false);
    form.current?.reset();
    dialog.current?.showModal();
  }

  function close() {
    if (!pending) dialog.current?.close();
  }

  function changed() {
    if (!error) return;
    idempotencyKey.current = crypto.randomUUID();
    setError(null);
    setNeedsReauth(false);
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
    if (pending || completed || (editing && !client)) return;
    idempotencyKey.current ??= crypto.randomUUID();
    setPending(true);
    setError(null);
    setNotice(null);
    setNeedsReauth(false);
    const values = new FormData(event.currentTarget);
    const body = {
      ...(editing
        ? {
            client_id: client!.id,
            expected_row_version: client!.rowVersion,
          }
        : {}),
      client_code: String(values.get("client_code") ?? ""),
      display_name: String(values.get("display_name") ?? ""),
      date_of_birth: String(values.get("date_of_birth") ?? "") || null,
    };

    try {
      const response = await fetchWithTimeout("/api/clients", {
        method: editing ? "PATCH" : "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify(body),
      });
      const envelope: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        if (needsAal2(envelope)) {
          setNeedsReauth(true);
        }
        setError(
          responseMessage(
            envelope,
            "主檔尚未確認完成；請保留此視窗並直接重試。",
          ),
        );
        return;
      }
      let result;
      try {
        result = parseClientMasterSuccessResponse({
          value: envelope,
          operation: editing ? "update" : "create",
          httpStatus: response.status,
          expectedClientId: client?.id,
          expectedRowVersion: editing ? client!.rowVersion + 1 : 1,
        });
      } catch (error) {
        if (!(error instanceof ClientMasterResponseContractError)) throw error;
        setError("伺服器回覆不完整；請勿重建內容，直接以相同操作重試。");
        return;
      }

      setCompleted(true);
      setNotice(
        result.replayed
          ? "已確認先前相同操作，沒有建立重複資料。"
          : editing
            ? `本機主檔已更新為 v${result.rowVersion}。`
            : "本機個案已建立；生命週期仍須在收案／異動頁處理。",
      );
      router.refresh();
    } catch (caught) {
      setError(isClientFetchTimeoutError(caught)
        ? caught.message
        : "網路狀態不明；請勿關閉或修改內容，直接按原按鈕重試。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="core-composer">
      <button
        aria-label={!enabled && disabledReason ? `${label}：${disabledReason}` : label}
        className={`button ${editing ? "button--secondary" : "button--primary"}`}
        disabled={!enabled}
        onClick={open}
        ref={trigger}
        title={!enabled ? disabledReason : undefined}
        type="button"
      >
        {editing ? <Pencil aria-hidden="true" /> : <Plus aria-hidden="true" />}
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
        <form
          className="core-dialog__surface"
          onChange={changed}
          onSubmit={submit}
          ref={form}
        >
          <header className="drawer__header">
            <div>
              <p className="eyebrow">本機主檔・AAL2 寫入</p>
              <h2 id={dialogId}>{label}</h2>
              <p id={descriptionId}>
                {editing
                  ? `${client?.displayName}・目前 v${client?.rowVersion}`
                  : "只建立本機來源主檔，不會冒充中央系統資料。"}
              </p>
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
          <div className="drawer__body core-dialog__body">
            <div className={`callout ${styles.securityCallout}`}>
              <ShieldCheck aria-hidden="true" />
              <span>
                只有個案代碼、顯示姓名、出生日期屬於這個流程的本機可編輯欄位；機構、分支、建立人、來源、服務狀態、密文識別碼與資料版本均由伺服器決定。
              </span>
            </div>
            {editing && client ? (
              <dl className={styles.dialogSummary}>
                <div><dt>資料主權</dt><dd>本機可編輯</dd></div>
                <div><dt>目前版本</dt><dd>v{client.rowVersion}</dd></div>
                <div><dt>服務狀態</dt><dd>{client.status}</dd></div>
                <div><dt>來源系統</dt><dd>{client.sourceSystem}</dd></div>
              </dl>
            ) : null}
            <div className={styles.fields}>
              <label className="field">
                <span>個案代碼 *</span>
                <input
                  autoComplete="off"
                  defaultValue={client?.clientCode ?? ""}
                  maxLength={64}
                  name="client_code"
                  required
                />
                <small className="field-hint">同一機構不可重複。</small>
              </label>
              <label className="field">
                <span>出生日期</span>
                <input
                  defaultValue={client?.dateOfBirth ?? ""}
                  max={today}
                  min="1900-01-01"
                  name="date_of_birth"
                  type="date"
                />
              </label>
              <label className={`field ${styles.wideField}`}>
                <span>顯示姓名 *</span>
                <input
                  autoComplete="off"
                  defaultValue={client?.displayName ?? ""}
                  maxLength={120}
                  name="display_name"
                  required
                />
                <small className="field-hint">列表不顯示國民身分證號等加密識別欄位。</small>
              </label>
            </div>
            <label className="check-field">
              <input disabled={completed} required type="checkbox" />
              <span>
                我確認只更新上述本機欄位；中央主權及生命週期資料須走各自的受治理流程。
              </span>
            </label>
            {error ? (
              <div>
                <p className="form-error" role="alert">{error}</p>
                {needsReauth ? (
                  <Link className="reauth-link reauth-link--inline" href="/mfa?audience=staff">
                    <ShieldCheck aria-hidden="true" />重新完成雙因素驗證
                  </Link>
                ) : null}
              </div>
            ) : null}
            {notice ? <p className={styles.successNotice} role="status">{notice}</p> : null}
          </div>
          <footer className="drawer__footer">
            <button className="button button--secondary" disabled={pending} onClick={close} type="button">
              {completed ? "關閉" : "取消"}
            </button>
            <button className="button button--primary" disabled={pending || completed} type="submit">
              {pending ? "確認中…" : completed ? "已完成" : editing ? "確認更新" : "確認建立"}
            </button>
          </footer>
        </form>
      </dialog>
    </div>
  );
}
