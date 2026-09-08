"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseHandHygieneApiError,
  parseHandHygieneApiSuccess,
  parseHandHygieneCorrectionInput,
} from "@/lib/hand-hygiene/parser";
import type {
  HandHygieneEvent,
  HandHygieneSnapshot,
} from "@/lib/hand-hygiene/types";

import styles from "./hand-hygiene.module.css";

function failureMessage(value: unknown) {
  if (isClientFetchTimeoutError(value)) return value.message;
  if (value instanceof Error && value.message.includes("fetch")) {
    return "網路中斷，結果未知；內容未修改時請使用相同操作鍵重試。";
  }
  return "修正結果未確認；請重新檢查，內容未修改時可使用相同操作鍵重試。";
}

export function HandHygieneMatchAction({
  canManage,
  event,
  snapshot,
}: {
  canManage: boolean;
  event: HandHygieneEvent;
  snapshot: HandHygieneSnapshot;
}) {
  const router = useRouter();
  const operationKey = useRef<string | null>(null);
  const uncertain = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [matchStatus, setMatchStatus] = useState(event.matchStatus);
  if (!canManage || snapshot.demo) return null;

  return <details className={styles.actionDetails}>
    <summary>修正配對</summary>
    <form onChange={() => {
      if (uncertain.current) {
        operationKey.current = null;
        uncertain.current = false;
        setMessage(null);
      }
    }} onSubmit={async (submitEvent) => {
      submitEvent.preventDefault();
      if (pending) return;
      const form = submitEvent.currentTarget;
      const formData = new FormData(form);
      const key = operationKey.current ?? crypto.randomUUID();
      operationKey.current = key;
      setPending(true);
      setMessage(null);
      try {
        const input = parseHandHygieneCorrectionInput({
          action: "correct_match",
          eventId: event.eventId,
          expectedCorrectionSequence: event.correctionSequence,
          matchStatus,
          staffMembershipId: matchStatus === "matched"
            ? formData.get("staffMembershipId")
            : null,
          reason: formData.get("reason"),
        }, key);
        const response = await fetchWithTimeout("/api/hand-hygiene/corrections", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": input.idempotencyKey,
          },
          body: JSON.stringify({
            action: input.action,
            eventId: input.eventId,
            expectedCorrectionSequence: input.expectedCorrectionSequence,
            matchStatus: input.matchStatus,
            staffMembershipId: input.staffMembershipId,
            reason: input.reason,
          }),
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const parsed = parseHandHygieneApiError(payload);
          if (parsed) throw new Error(`API:${parsed.errors[0]!.message}`);
          throw new Error("INVALID_RESPONSE");
        }
        parseHandHygieneApiSuccess(
          payload,
          input,
          snapshot.organizationId,
          snapshot.branchId,
          response.status,
        );
        operationKey.current = null;
        uncertain.current = false;
        setMessage("配對修正已追加保存；來源事件與先前修正均未被覆寫。");
        router.refresh();
      } catch (error) {
        uncertain.current = operationKey.current !== null;
        setMessage(error instanceof Error && error.message.startsWith("API:")
          ? error.message.slice(4)
          : failureMessage(error));
      } finally {
        setPending(false);
      }
    }}>
      <fieldset className={styles.actionGrid} disabled={pending}>
        <label><span>修正後狀態</span><select value={matchStatus}
          onChange={(changeEvent) => setMatchStatus(changeEvent.target.value as typeof matchStatus)}>
          <option value="matched">已配對員工</option>
          <option value="unmatched">未配對</option>
          <option value="excluded">排除（不納入候選計數）</option>
        </select></label>
        <label><span>員工</span><select defaultValue={event.staffMembershipId ?? ""}
          disabled={matchStatus !== "matched"} name="staffMembershipId"
          required={matchStatus === "matched"}>
          <option value="">請選擇事件發生時適用的人員</option>
          {snapshot.staffOptions.map((staff) => <option key={staff.staffMembershipId}
            value={staff.staffMembershipId}>
            {staff.employeeCode ? `${staff.employeeCode} · ` : ""}{staff.displayName}
            {staff.isCurrent ? "" : "（非現職）"}
          </option>)}
        </select></label>
        <label className={styles.wide}><span>修正理由</span><textarea name="reason"
          maxLength={1000} required rows={3} /></label>
        <button className="button button--primary" disabled={pending} type="submit">
          {pending ? "確認中…" : "追加配對修正"}
        </button>
      </fieldset>
      {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form>
  </details>;
}
