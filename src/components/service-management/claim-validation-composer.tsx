"use client";

import styles from "./claim-validation.module.css";

import { FormEvent, MouseEvent, useMemo, useRef, useState } from "react";
import { FileCheck2, ShieldCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { isConfirmedClaimValidationRejection, parseClaimValidationEnvelope,
  type ClaimValidationExpected } from "@/lib/service-management/claim-validation-client";

type DraftBatch = {
  id: string;
  periodLabel: string;
  totalAmount: string;
  itemCount: number;
};

function displayMoney(value: string) {
  const [whole, fraction = "00"] = value.split(".");
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",")}.${fraction.padEnd(2, "0")}`;
}

export function ClaimValidationComposer({
  batches,
  enabled,
  hasRecentAal2,
  demo,
}: {
  batches: readonly DraftBatch[];
  enabled: boolean;
  hasRecentAal2: boolean;
  demo: boolean;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const idempotencyKey = useRef<string | null>(null);
  const inFlight = useRef(false);
  const frozenRequest = useRef<ClaimValidationExpected | null>(null);
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const [submittedBatch, setSubmittedBatch] = useState<(DraftBatch & { demo: boolean }) | null>(null);
  const [consentTuple, setConsentTuple] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(batches[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selected = useMemo(
    () => batches.find((batch) => batch.id === selectedId) ?? batches[0],
    [batches, selectedId],
  );
  const displayedBatch = (outcomeUnknown || pending) && submittedBatch ? submittedBatch : selected;
  const displayedDemo = (outcomeUnknown || pending) && submittedBatch ? submittedBatch.demo : demo;
  const currentTuple = displayedBatch ? JSON.stringify([displayedBatch.id, displayedBatch.totalAmount,
    displayedBatch.itemCount, displayedBatch.periodLabel, displayedDemo]) : null;
  const confirmed = currentTuple !== null && consentTuple === currentTuple;
  const options = displayedBatch && !batches.some((batch) => batch.id === displayedBatch.id)
    ? [displayedBatch, ...batches] : batches.map((batch) => batch.id === displayedBatch?.id ? displayedBatch : batch);
  const ready = enabled && hasRecentAal2 && Boolean(selected || outcomeUnknown && submittedBatch);

  function open(event: MouseEvent<HTMLButtonElement>) {
    trigger.current = event.currentTarget;
    if (inFlight.current) return;
    if (!outcomeUnknown) { idempotencyKey.current = null; setConsentTuple(null); }
    setError(null);
    setNotice(null);
    dialog.current?.showModal();
  }

  function close() {
    if (inFlight.current) return;
    dialog.current?.close();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !ready || !confirmed || !selected && !frozenRequest.current ||
      new FormData(event.currentTarget).get("confirmed") !== "on") return;
    idempotencyKey.current ??= crypto.randomUUID();
    const expected = frozenRequest.current ?? { claimBatchId: selected!.id,
      itemCount: selected!.itemCount, totalAmount: selected!.totalAmount,
      demo, idempotencyKey: idempotencyKey.current };
    if (!frozenRequest.current) setSubmittedBatch({ ...selected!, demo });
    frozenRequest.current = expected;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetchWithTimeout("/api/claims/validate", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": expected.idempotencyKey,
        },
        body: JSON.stringify({
          claim_batch_id: expected.claimBatchId,
          expected_total_amount: expected.totalAmount,
          expected_item_count: expected.itemCount,
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        if (!outcomeUnknown && isConfirmedClaimValidationRejection(payload, response.status)) {
          frozenRequest.current = null; idempotencyKey.current = null;
        }
        throw new Error("VALIDATION_FAILED");
      }
      parseClaimValidationEnvelope(payload, response.status, expected);
      dialog.current?.close();
      setNotice(
        expected.demo
          ? "展示請求已通過相同欄位驗證；展示批次不會凍結。"
          : "申報草稿已驗證並凍結明細；正式格式完成前仍不能下載或送件。",
      );
      idempotencyKey.current = null; frozenRequest.current = null; setOutcomeUnknown(false);
      if (!expected.demo) router.refresh();
    } catch (caught) {
      setOutcomeUnknown(frozenRequest.current !== null);
      setError(isClientFetchTimeoutError(caught)
        ? caught.message
        : "批次未確認完成驗證。請檢查明細、簽署服務、有效計畫與總額；直接重試會沿用同一冪等鍵。");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  const disabledReason = !enabled
    ? "目前角色沒有申報驗證權限"
    : !hasRecentAal2
      ? "請先完成最近 15 分鐘內的雙因素重新驗證"
      : !selected
        ? "目前沒有可驗證且已取得總額的草稿批次"
        : undefined;

  return (
    <div className="core-composer">
      <button
        className="button button--secondary"
        disabled={!ready || pending}
        onClick={open}
        ref={trigger}
        title={disabledReason}
        type="button"
      >
        <FileCheck2 aria-hidden="true" />{outcomeUnknown ? "核對上次申報驗證" : "驗證草稿"}
      </button>
      {notice ? (
        <p className="core-composer__notice" role="status">
          {notice}
        </p>
      ) : null}
      <dialog
        aria-labelledby="claim-validation-dialog-title"
        className="core-dialog"
        onCancel={(event) => { if (inFlight.current) event.preventDefault(); }}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        onClose={() => trigger.current?.focus()}
        ref={dialog}
      >
        <form className="core-dialog__surface" onSubmit={submit}>
          <header className="drawer__header">
            <div>
              <p className="eyebrow">申報明細凍結</p>
              <h2 id="claim-validation-dialog-title">驗證申報草稿</h2>
              <p>這一步只驗證並凍結明細，不會產生主管機關檔案或送件。</p>
            </div>
            <button
              aria-label="關閉"
              className="icon-button"
              onClick={close}
              disabled={pending}
              type="button"
            >
              <X aria-hidden="true" />
            </button>
          </header>
          <div className="drawer__body core-dialog__body">
            <div className="callout core-care-callout">
              <ShieldCheck aria-hidden="true" />
              <span>
                資料庫會重新核對每筆完成且已簽署的服務、當日有效計畫、證據雜湊及確認筆數與總額；任一不符時整批不變更。
              </span>
            </div>
            <label className="field">
              <span>草稿批次 *</span>
              <select
                disabled={pending || outcomeUnknown}
                name="claim_batch_id"
                onChange={(event) => {
                  if (inFlight.current || outcomeUnknown) return;
                  setSelectedId(event.currentTarget.value);
                  idempotencyKey.current = null; frozenRequest.current = null;
                  setError(null); setNotice(null); setConsentTuple(null);
                }}
                required
                value={displayedBatch?.id ?? ""}
              >
                {options.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {batch.periodLabel}・{batch.itemCount} 筆・
                    {displayMoney(batch.totalAmount)}
                  </option>
                ))}
              </select>
            </label>
            {outcomeUnknown ? <p className="form-error" role="alert">
              上次結果未知，已保留原批次、筆數、金額及操作鍵；重新開啟仍只核對原請求，不會改送其他批次。
            </p> : null}
            {displayedBatch ? (
              <dl className="core-care-card-grid claim-confirmation-summary">
                <div><dt>申報期間</dt><dd>{displayedBatch.periodLabel}</dd></div>
                <div><dt>明細筆數</dt><dd>{displayedBatch.itemCount} 筆</dd></div>
                <div><dt>確認總額</dt><dd>{displayMoney(displayedBatch.totalAmount)}</dd></div>
                <div><dt>完成後狀態</dt><dd>已驗證、明細凍結</dd></div>
              </dl>
            ) : null}
            <label className={styles.consent}>
              <input checked={confirmed} onChange={(event) => setConsentTuple(event.target.checked ? currentTuple : null)}
                disabled={pending} name="confirmed" required type="checkbox" />
              <span>我已核對上列筆數與總額，並了解這不是正式送件。</span>
            </label>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <footer className="drawer__footer">
            <button className="button button--secondary" disabled={pending} onClick={close} type="button">
              取消
            </button>
            <button className="button button--primary" disabled={pending || !ready} type="submit">
              {pending ? "驗證中…" : outcomeUnknown ? "核對原請求結果" : "確認驗證並凍結"}
            </button>
          </footer>
        </form>
      </dialog>
    </div>
  );
}
