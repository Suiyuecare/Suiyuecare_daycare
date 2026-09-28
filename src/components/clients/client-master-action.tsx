"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { DailyFieldError, DailyValidationSummary, useDailyFormValidation } from "@/components/core-care/daily-form-validation";
import { CLIENT_WRITE_TIMEOUT_MS, ClientFetchTimeoutError, fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { tryAcquirePendingOperation } from "@/lib/navigation/pending-operation-lock";
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

function knownFirstRejection(status: number, envelope: unknown) {
  if (status < 400 || status >= 500 || !envelope || typeof envelope !== "object" || Array.isArray(envelope)) return false;
  const errors = (envelope as { errors?: unknown }).errors;
  return Array.isArray(errors) && errors.some((error) =>
    error !== null && typeof error === "object" && !Array.isArray(error) &&
    typeof (error as { code?: unknown }).code === "string");
}

function validBirthDate(value: string, today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || value < "1900-01-01" || value > today) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month! - 1 && parsed.getUTCDate() === day;
}

async function readEnvelopeBeforeDeadline(response: Response, startedAt: number): Promise<unknown> {
  const remaining = CLIENT_WRITE_TIMEOUT_MS - (Date.now() - startedAt);
  if (remaining <= 0) throw new ClientFetchTimeoutError(CLIENT_WRITE_TIMEOUT_MS);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      response.json().catch(() => null),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ClientFetchTimeoutError(CLIENT_WRITE_TIMEOUT_MS)), remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  const focusAnchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const operation = useRef<{
    key: string;
    body: string;
    expectedClientId?: string;
    expectedRowVersion: number;
  } | null>(null);
  const operationLease = useRef<(() => void) | null>(null);
  const inFlight = useRef(false);
  const uncertain = useRef(false);
  const alive = useRef(true);
  const [pending, setPending] = useState(false);
  const [retryRequired, setRetryRequired] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const validation = useDailyFormValidation();
  const editing = kind === "edit";
  const eligibleClient = !editing || Boolean(client?.editable);
  const hasWriteAuthority = editing ? canManage : canCreate;
  const enabled =
    !demo && hasWriteAuthority && hasRecentAal2 && eligibleClient && !pending && !completed && !retryRequired;
  const label = editing ? "編輯本機欄位" : "新增本機個案";
  const dialogId = `client-master-${kind}-${instance}`;
  const descriptionId = `${dialogId}-description`;
  const disabledReason = demo
    ? "展示模式不寫入任何資料"
    : completed
      ? "已保存，請先核對更新後的個案清單"
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

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (!pending && !retryRequired) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending, retryRequired]);

  function releaseOperation() {
    operationLease.current?.();
    operationLease.current = null;
  }

  function open() {
    if (!enabled || inFlight.current || uncertain.current) return;
    operation.current = null;
    setError(null);
    setNotice(null);
    setNeedsReauth(false);
    setCompleted(false);
    setRetryRequired(false);
    validation.reset();
    form.current?.reset();
    dialog.current?.showModal();
  }

  function close() {
    if (!inFlight.current && !uncertain.current) dialog.current?.close();
  }

  function changed(target: EventTarget) {
    validation.clearChanged(target);
    if (!error || uncertain.current || inFlight.current) return;
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
    if (validation.composing.current || inFlight.current || completed || demo || !hasWriteAuthority || !hasRecentAal2 || !eligibleClient || (editing && !client)) return;
    const currentForm = event.currentTarget;
    if (operation.current?.expectedClientId && operation.current.expectedClientId !== client?.id) {
      setError("原個案範圍已變更。請重新載入原個案核對，不會另建操作。");
      return;
    }
    if (!operation.current) {
      let values: FormData;
      try {
        values = new FormData(currentForm);
      } catch {
        setError("無法讀取這份表單，尚未送出。請再試一次。");
        return;
      }
      const clientCode = String(values.get("client_code") ?? "");
      const displayName = String(values.get("display_name") ?? "");
      const birthDate = String(values.get("date_of_birth") ?? "");
      const fieldErrors: Record<string, string> = {};
      if (clientCode && !clientCode.trim()) fieldErrors.client_code = "請填寫個案代碼。";
      if (displayName && !displayName.trim()) fieldErrors.display_name = "請填寫顯示姓名。";
      if (birthDate && !validBirthDate(birthDate, today)) fieldErrors.date_of_birth = `出生日期須介於 1900-01-01 與 ${today}。`;
      if (!currentForm.querySelector<HTMLInputElement>('input[name="acknowledgement"]')?.checked) fieldErrors.acknowledgement = "請確認本機欄位與中央資料的界線。";
      if (!validation.validate(currentForm, fieldErrors)) return;
      const release = tryAcquirePendingOperation();
      if (!release) {
        setError("畫面正在更新或切換分支，請先完成目前作業；尚未送出。");
        return;
      }
      operationLease.current = release;
      try {
        operation.current = {
          key: crypto.randomUUID(),
          body: JSON.stringify({
            ...(editing ? { client_id: client!.id, expected_row_version: client!.rowVersion } : {}),
            client_code: clientCode,
            display_name: displayName,
            date_of_birth: birthDate || null,
          }),
          expectedClientId: client?.id,
          expectedRowVersion: editing ? client!.rowVersion + 1 : 1,
        };
      } catch {
        releaseOperation();
        setError("無法建立這次操作，尚未送出。請再試一次。");
        return;
      }
    }
    const submitted = operation.current;
    inFlight.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    setNeedsReauth(false);

    try {
      const startedAt = Date.now();
      const response = await fetchWithTimeout("/api/clients", {
        method: editing ? "PATCH" : "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": submitted.key,
        },
        body: submitted.body,
      });
      const envelope = await readEnvelopeBeforeDeadline(response, startedAt);
      if (!response.ok) {
        if (knownFirstRejection(response.status, envelope) && !uncertain.current) {
          operation.current = null;
          releaseOperation();
          if (alive.current) {
            setNeedsReauth(needsAal2(envelope));
            setError(responseMessage(envelope, "主檔尚未建立；請確認欄位後再試。"));
          }
          return;
        }
        uncertain.current = true;
        if (alive.current) {
          setRetryRequired(true);
          setNeedsReauth(needsAal2(envelope));
          setError(responseMessage(envelope, "原操作結果尚未確認；請只重試原操作，不要另建一筆。"));
        }
        return;
      }
      let result;
      try {
        result = parseClientMasterSuccessResponse({
          value: envelope,
          operation: editing ? "update" : "create",
          httpStatus: response.status,
          expectedClientId: submitted.expectedClientId,
          expectedRowVersion: submitted.expectedRowVersion,
        });
      } catch (error) {
        if (!(error instanceof ClientMasterResponseContractError)) throw error;
        uncertain.current = true;
        if (alive.current) {
          setRetryRequired(true);
          setError("伺服器回覆不完整；原內容已保留，請只重試原操作。");
        }
        return;
      }

      uncertain.current = false;
      operation.current = null;
      releaseOperation();
      if (!alive.current) return;
      setRetryRequired(false);
      setCompleted(true);
      setNotice(
        result.replayed
          ? "已確認先前相同操作，沒有建立重複資料。"
          : editing
            ? `本機主檔已更新為 v${result.rowVersion}。`
            : "本機個案已建立；生命週期仍須在收案／異動頁處理。",
      );
      try {
        router.refresh();
      } catch {
        setNotice("原操作已確認保存，但清單尚未更新；請重新讀取後再處理其他個案。");
      }
    } catch (caught) {
      uncertain.current = true;
      if (alive.current) {
        setRetryRequired(true);
        setError(isClientFetchTimeoutError(caught)
          ? "連線逾時，原操作結果仍不明。請只重試原操作。"
          : "網路狀態不明；原內容已保留，請只重試原操作。");
      }
    } finally {
      inFlight.current = false;
      if (alive.current) setPending(false);
    }
  }

  return (
    <div className="core-composer" ref={focusAnchor} tabIndex={-1}>
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
          if (inFlight.current || uncertain.current) event.preventDefault();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        onClose={() => {
          if (trigger.current && !trigger.current.disabled) trigger.current.focus();
          else focusAnchor.current?.focus();
        }}
        onKeyDown={keepFocusInside}
        ref={dialog}
      >
        <form
          aria-busy={pending}
          className="core-dialog__surface"
          noValidate
          onChange={(event) => changed(event.target)}
          onCompositionEnd={validation.onCompositionEnd}
          onCompositionStart={validation.onCompositionStart}
          onKeyDown={validation.onKeyDown}
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
              disabled={pending || retryRequired}
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
            <DailyValidationSummary validation={validation} />
            <fieldset className="core-dialog__fieldset" disabled={pending || retryRequired || completed}>
            <div className={styles.fields}>
              <label className="field">
                <span id={validation.labelId("client_code")}>個案代碼 *</span>
                <input
                  {...validation.field("client_code", `${dialogId}-client-code-hint`)}
                  autoComplete="off"
                  defaultValue={client?.clientCode ?? ""}
                  maxLength={64}
                  name="client_code"
                  required
                />
                <small className="field-hint" id={`${dialogId}-client-code-hint`}>同一機構不可重複。</small>
                <DailyFieldError name="client_code" validation={validation} />
              </label>
              <label className="field">
                <span id={validation.labelId("date_of_birth")}>出生日期</span>
                <input
                  {...validation.field("date_of_birth")}
                  defaultValue={client?.dateOfBirth ?? ""}
                  max={today}
                  min="1900-01-01"
                  name="date_of_birth"
                  type="date"
                />
                <DailyFieldError name="date_of_birth" validation={validation} />
              </label>
              <label className={`field ${styles.wideField}`}>
                <span id={validation.labelId("display_name")}>顯示姓名 *</span>
                <input
                  {...validation.field("display_name", `${dialogId}-display-name-hint`)}
                  autoComplete="off"
                  defaultValue={client?.displayName ?? ""}
                  maxLength={120}
                  name="display_name"
                  required
                />
                <small className="field-hint" id={`${dialogId}-display-name-hint`}>列表不顯示國民身分證號等加密識別欄位。</small>
                <DailyFieldError name="display_name" validation={validation} />
              </label>
            </div>
            <div className={styles.acknowledgement}>
              <label className="check-field">
                <input {...validation.field("acknowledgement", undefined, false)} name="acknowledgement" required type="checkbox" />
                <span>我確認只更新上述本機欄位；中央主權及生命週期資料須走各自的受治理流程。</span>
              </label>
              <DailyFieldError name="acknowledgement" validation={validation} />
            </div>
            </fieldset>
            {error ? (
              <div>
                <p className="form-error" role="alert">{error}</p>
                {retryRequired ? <p role="status">結果尚未確認。欄位已鎖定，請只用下方按鈕重試原操作。</p> : null}
                {needsReauth ? (
                  <Link className="reauth-link reauth-link--inline" href="/mfa?audience=staff&purpose=sensitive-action" rel="noopener noreferrer" target="_blank">
                    <ShieldCheck aria-hidden="true" />重新完成雙因素驗證
                  </Link>
                ) : null}
              </div>
            ) : null}
            {notice ? <p className={styles.successNotice} role="status">{notice}</p> : null}
          </div>
          <footer className="drawer__footer">
            <button className="button button--secondary" disabled={pending || retryRequired} onClick={close} type="button">
              {completed ? "關閉" : "取消"}
            </button>
            <button className={`button button--primary ${styles.submitButton}`} disabled={pending || completed || demo || !hasWriteAuthority || !hasRecentAal2 || !eligibleClient} type="submit">
              {pending ? "確認中…" : completed ? "已完成" : retryRequired ? "重試確認原操作" : editing ? "確認更新" : "確認建立"}
            </button>
          </footer>
        </form>
      </dialog>
    </div>
  );
}
