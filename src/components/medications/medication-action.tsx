"use client";

import {
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  useRef,
  useState,
} from "react";
import { FileSignature, ShieldCheck, UserCheck, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { fetchWithTimeout } from "@/lib/api/client-fetch";
import type { MedicationOutcome } from "@/lib/integrations/medications";
import {
  parseMedicationActionError,
  parseMedicationActionSuccess,
  parseMedicationResponseRequestId,
  type MedicationActionExpectation,
} from "@/lib/medications/action-response";
import type { MedicationAdministrationRecord } from "@/lib/medications/types";

const statusLabels: Record<MedicationOutcome, string> = {
  administered: "已服用",
  refused: "拒絕服用",
  held: "暫停服用",
  missed: "漏服",
};

function defaultTaipeiLocal(serviceDate: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
  return `${serviceDate}T${parts.hour}:${parts.minute}`;
}

export function taipeiLocalToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) {
    throw new Error("INVALID_LOCAL_DATETIME");
  }
  const parsed = new Date(`${value}:00+08:00`);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("INVALID_LOCAL_DATETIME");
  }
  const roundTrip = new Date(parsed.getTime() + 8 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 16);
  if (roundTrip !== value) throw new Error("INVALID_LOCAL_DATETIME");
  return parsed.toISOString();
}

function olderThanProvisionalThreshold(value: string) {
  return Date.now() - new Date(value).getTime() > 60 * 60 * 1_000;
}

export function MedicationAction({
  row,
  serviceDate,
  canRecord,
  canVerify,
  hasRecentAal2,
  currentUserId,
  demo,
  instance,
}: {
  row: MedicationAdministrationRecord;
  serviceDate: string;
  canRecord: boolean;
  canVerify: boolean;
  hasRecentAal2: boolean;
  currentUserId: string;
  demo: boolean;
  instance: "desktop" | "mobile";
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const isRecord = row.finalizationState === "scheduled";
  const isVerification = row.finalizationState === "pending_verification";
  const isSamePerson = row.executor?.id === currentUserId;
  const permitted = isRecord
    ? canRecord
    : isVerification
      ? canVerify && !isSamePerson
      : false;
  const enabled = permitted && !demo && hasRecentAal2;
  const [status, setStatus] = useState<MedicationOutcome>("administered");
  const [occurredAt, setOccurredAt] = useState(
    defaultTaipeiLocal(serviceDate),
  );
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);

  if (!isRecord && !isVerification) {
    return <span className="medication-action-done">已完成</span>;
  }

  function resetForOpen() {
    setStatus("administered");
    setOccurredAt(defaultTaipeiLocal(serviceDate));
    setReason("");
    setError(null);
    setNotice(null);
    setNeedsReauth(false);
    idempotencyKey.current = crypto.randomUUID();
  }

  function open(event: MouseEvent<HTMLButtonElement>) {
    trigger.current = event.currentTarget;
    resetForOpen();
    dialog.current?.showModal();
  }

  function close() {
    if (!pending) dialog.current?.close();
  }

  function keepFocusInside(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        "button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])",
      ),
    ).filter(
      (element) =>
        !element.hasAttribute("disabled") &&
        element.getAttribute("aria-hidden") !== "true" &&
        !element.closest("[hidden]"),
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function changed() {
    if (error) {
      setError(null);
      setNeedsReauth(false);
      idempotencyKey.current = crypto.randomUUID();
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNeedsReauth(false);
    try {
      const recordOccurredAt = isRecord
        ? taipeiLocalToIso(occurredAt)
        : null;
      const recordPayload = isRecord
        ? {
            medication_administration_id: row.id,
            status,
            occurred_at: recordOccurredAt!,
            ...(status === "administered"
              ? {
                  actual_dose: row.plannedDose,
                  dose_unit: row.doseUnit,
                }
              : { reason: reason.trim() }),
          }
        : { medication_administration_id: row.id };
      const expectation: MedicationActionExpectation = isRecord
        ? {
            kind: "record",
            medicationAdministrationId: row.id,
            status,
            occurredAt: recordOccurredAt!,
            mustRequireSecondVerification:
              row.highRisk || row.requiresSecondVerification,
          }
        : {
            kind: "verify",
            medicationAdministrationId: row.id,
            status: row.status as MedicationOutcome,
            occurredAt: row.occurredAt!,
            executionSignedAt: row.executionSignedAt!,
          };
      const response = await fetchWithTimeout(
        isRecord
          ? "/api/medications/administrations/record"
          : "/api/medications/administrations/verify",
        {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey.current,
          },
          body: JSON.stringify(recordPayload),
        },
      );
      const rawEnvelope: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const envelope = parseMedicationActionError(rawEnvelope);
        const firstError = envelope?.errors[0];
        if (
          firstError?.code.includes("NOT_AUTHORIZED") ||
          firstError?.code === "AAL2_REQUIRED"
        ) {
          setNeedsReauth(true);
        }
        throw new Error(
          (firstError?.message
            ? `${firstError.message}（請求識別碼 ${envelope!.requestId}）`
            : null) ||
            (isRecord
              ? "用藥簽署尚未確認。請保留內容並直接重試。"
              : "第二人覆核尚未確認。請直接重試。"),
        );
      }

      let success;
      try {
        success = parseMedicationActionSuccess(
          rawEnvelope,
          expectation,
          response.status,
        );
      } catch {
        const responseRequestId = parseMedicationResponseRequestId(rawEnvelope);
        throw new Error(
          `伺服器回覆不完整；請勿改動內容，直接以相同操作重試。${
            responseRequestId ? `（請求識別碼 ${responseRequestId}）` : ""
          }`,
        );
      }

      // A trusted success must close even though the request remains in its
      // pending state until `finally`; user-driven close paths stay locked.
      dialog.current?.close();
      const result = success.data;
      setNotice(
        result.replayed
          ? "已確認先前相同簽署收據；沒有建立重複紀錄。"
          : result.finalizationState === "pending_verification"
            ? "第一人執行簽署已保存；仍須由另一位具權限人員獨立覆核才算完成。"
            : isRecord
              ? "用藥結果已完成簽署。"
              : "第二人獨立覆核完成，這筆用藥已正式簽署。",
      );
      idempotencyKey.current = crypto.randomUUID();
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : isRecord
            ? "用藥簽署尚未確認。請保留內容並沿用相同冪等鍵重試。"
            : "第二人覆核尚未確認。請沿用相同冪等鍵重試。",
      );
    } finally {
      setPending(false);
    }
  }

  const occurredIso = (() => {
    try {
      return taipeiLocalToIso(occurredAt);
    } catch {
      return new Date().toISOString();
    }
  })();
  const provisionalSecondPerson =
    row.highRisk ||
    row.requiresSecondVerification ||
    olderThanProvisionalThreshold(row.scheduledFor) ||
    olderThanProvisionalThreshold(occurredIso);
  const disabledReason = demo
    ? "展示模式只讀，不會送出或保存用藥簽署"
    : !permitted
      ? isSamePerson
        ? "執行人不可覆核自己的紀錄"
        : isRecord
          ? "目前角色沒有 medications.administer 權限"
          : "目前角色沒有 medications.verify 權限"
      : !hasRecentAal2
        ? "請先完成最近 15 分鐘內的雙因素重新驗證"
        : undefined;
  const dialogTitle = isRecord ? "記錄並簽署用藥結果" : "第二人獨立覆核";
  const dialogId = `medication-dialog-${instance}-${row.id}`;

  return (
    <div className="medication-action">
      <button
        aria-label={
          !enabled && disabledReason
            ? `${isRecord ? "記錄並簽署" : "獨立覆核"}：${disabledReason}`
            : isRecord
              ? "記錄並簽署"
              : "獨立覆核"
        }
        className={isRecord ? "button button--primary" : "button button--secondary"}
        disabled={!enabled}
        onClick={open}
        ref={trigger}
        title={disabledReason}
        type="button"
      >
        {isRecord ? <FileSignature aria-hidden="true" /> : <UserCheck aria-hidden="true" />}
        {isRecord ? "記錄並簽署" : "獨立覆核"}
      </button>
      {notice ? <p className="medication-action__notice" role="status">{notice}</p> : null}
      <dialog
        aria-labelledby={dialogId}
        className="core-dialog"
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
        <form className="core-dialog__surface" onChange={changed} onSubmit={submit}>
          <header className="drawer__header">
            <div>
              <p className="eyebrow">AAL2 簽署交易</p>
              <h2 id={dialogId}>{dialogTitle}</h2>
              <p>{row.clientDisplayName}・{row.medicationName}</p>
            </div>
            <button aria-label="關閉" className="icon-button" disabled={pending} onClick={close} type="button">
              <X aria-hidden="true" />
            </button>
          </header>
          <div className="drawer__body core-dialog__body">
            <div className="callout core-care-callout">
              <ShieldCheck aria-hidden="true" />
              <span>
                {isRecord
                  ? provisionalSecondPerson
                    ? "這筆符合高風險、既有覆核標記或暫定逾時條件。第一人簽署後仍須第二位不同人員覆核，才會列為完成。"
                    : "確認後由伺服器保存執行人、時間、簽署目的、內容雜湊與本次重新驗證證據。"
                  : `執行人為 ${row.executor?.displayName ?? "—"}；您必須是另一位具權限人員，確認後才會建立最終簽署。`}
              </span>
            </div>

            <dl className="medication-dialog-summary">
              <div><dt>排程</dt><dd>{new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(row.scheduledFor))}</dd></div>
              <div><dt>計畫劑量</dt><dd>{row.plannedDose} {row.doseUnit}</dd></div>
              <div><dt>途徑</dt><dd>{row.route}</dd></div>
              <div><dt>覆核條件</dt><dd>{provisionalSecondPerson ? "需第二人" : "一般一次簽署"}</dd></div>
            </dl>

            {isRecord ? (
              <>
                <label className="field">
                  <span>執行狀態 *</span>
                  <select autoFocus onChange={(event) => setStatus(event.currentTarget.value as MedicationOutcome)} required value={status}>
                    {Object.entries(statusLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>實際發生日期與時間 *</span>
                  <input
                    max={`${serviceDate}T23:59`}
                    min={`${serviceDate}T00:00`}
                    onChange={(event) => setOccurredAt(event.currentTarget.value)}
                    required
                    type="datetime-local"
                    value={occurredAt}
                  />
                  <small>只接受最近 24 小時至未來 5 分鐘；伺服器會以 Asia/Taipei 再驗證。</small>
                </label>
                {status === "administered" ? (
                  <div className="medication-dose-lock" aria-label="實際服用劑量">
                    <span>實際服用劑量</span>
                    <strong>{row.plannedDose} {row.doseUnit}</strong>
                    <small>第一版採保守規則：必須等於已簽計畫。任何劑量差異暫不允許簽署。</small>
                  </div>
                ) : (
                  <label className="field">
                    <span>{statusLabels[status]}原因 *</span>
                    <textarea
                      autoFocus
                      maxLength={1_000}
                      onChange={(event) => setReason(event.currentTarget.value)}
                      placeholder="客觀記錄原因與已採取的處置；請勿加入不必要個資。"
                      required
                      value={reason}
                    />
                  </label>
                )}
              </>
            ) : (
              <div className="medication-verification-copy">
                <strong>第一人紀錄</strong>
                <p>
                  {statusLabels[row.status as MedicationOutcome]}
                  {row.actualDose !== null ? `・${row.actualDose} ${row.actualDoseUnit}` : ""}
                  {row.reason ? `・原因：${row.reason}` : ""}
                </p>
              </div>
            )}

            <label className="check-field">
              <input required type="checkbox" />
              <span>
                {isRecord
                  ? "我確認以上執行結果正確，並同意以目前身分完成第一人簽署。"
                  : "我已獨立核對排程、計畫劑量、執行結果及第一人身分，並同意完成第二人簽署。"}
              </span>
            </label>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            {needsReauth ? (
              <Link className="reauth-link reauth-link--inline" href="/mfa?audience=staff&purpose=sensitive-action">
                <ShieldCheck aria-hidden="true" />重新完成雙因素驗證
              </Link>
            ) : null}
          </div>
          <footer className="drawer__footer">
            <button className="button button--secondary" disabled={pending} onClick={close} type="button">取消</button>
            <button className="button button--primary" disabled={pending} type="submit">
              {pending ? "簽署中…" : isRecord ? "確認執行並簽署" : "完成獨立覆核"}
            </button>
          </footer>
        </form>
      </dialog>
    </div>
  );
}
