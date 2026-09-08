"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseInsulinApiError,
  parseInsulinApiSuccess,
} from "@/lib/insulin-administrations/parser";
import type {
  InsulinAdministrationItem,
  InsulinAdministrationSnapshot,
  InsulinExecutionInput,
  InsulinLateAuthorizationInput,
  InsulinMutationInput,
  InsulinReviewInput,
} from "@/lib/insulin-administrations/types";

import styles from "./insulin-administrations.module.css";

type Draft =
  | Pick<InsulinLateAuthorizationInput,
    "action" | "medicationPlanId" | "scheduledFor" | "lateReason">
  | Omit<InsulinExecutionInput, "idempotencyKey">
  | Omit<InsulinReviewInput, "idempotencyKey">;

function attachIdempotencyKey(draft: Draft, idempotencyKey: string): InsulinMutationInput {
  if (draft.action === "authorize_late") {
    return {
      ...draft,
      administrationKey: null,
      previousEventId: null,
      expectedSequence: 0,
      idempotencyKey,
    };
  }
  return { ...draft, idempotencyKey };
}

function useInsulinMutation(snapshot: InsulinAdministrationSnapshot) {
  const router = useRouter();
  const keyRef = useRef(crypto.randomUUID());
  const attemptedRef = useRef<string | null>(null);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const submit = async (draft: Draft) => {
    const canonical = JSON.stringify(draft);
    if (attemptedRef.current !== null && attemptedRef.current !== canonical) {
      keyRef.current = crypto.randomUUID();
    }
    attemptedRef.current = canonical;
    const input = attachIdempotencyKey(draft, keyRef.current);
    setPending(true);
    setSuccess(false);
    setMessage(null);
    try {
      const response = await fetchWithTimeout("/api/insulin-administrations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": keyRef.current,
          "x-insulin-operation": input.action,
        },
        body: JSON.stringify(draft),
      });
      const raw: unknown = await response.json();
      if (!response.ok) {
        setMessage(parseInsulinApiError(raw)?.errors[0]?.message ??
          "操作未完成；請保留內容並以相同操作鍵重試。");
        return;
      }
      parseInsulinApiSuccess(
        raw, input, snapshot.organizationId, snapshot.branchId, response.status,
      );
      setSuccess(true);
      setMessage("已新增不可變事件，正在重新取得伺服器快照。");
      router.refresh();
    } catch (error) {
      setMessage(isClientFetchTimeoutError(error)
        ? "連線逾時，結果未知；請直接重試，相同內容會沿用原操作鍵。"
        : "網路中斷，結果未知；請直接重試，相同內容會沿用原操作鍵。");
    } finally {
      setPending(false);
    }
  };
  return { online, pending, message, success, submit };
}

function Result({ state }: { state: ReturnType<typeof useInsulinMutation> }) {
  return <>
    {!state.online ? <p className={styles.warning} role="status">
      目前離線；本頁不保存草稿，重新連線前不會送出。
    </p> : null}
    {state.message ? <p className={state.success ? styles.success : styles.warning}
      role="status">{state.message}</p> : null}
  </>;
}

export function InsulinAdministrationActions({ item, snapshot }: {
  item: InsulinAdministrationItem;
  snapshot: InsulinAdministrationSnapshot;
}) {
  const state = useInsulinMutation(snapshot);
  if (snapshot.demo) return <span className={styles.readOnly}>合成唯讀，不送出</span>;
  if (item.state === "completed") return <span className={styles.readOnly}>雙人覆核完成</span>;

  if (item.state === "pending_review") {
    if (!snapshot.canReview || !item.administrationKey || !item.eventId) {
      return <span className={styles.readOnly}>需另一位具有效資格的人員覆核</span>;
    }
    return <div className={styles.actionBox}>
      <button className="button button--secondary" disabled={!state.online || state.pending}
        type="button" onClick={() => void state.submit({
          action: "review", administrationKey: item.administrationKey!,
          previousEventId: item.eventId!, expectedSequence: item.eventSequence,
        })}>{state.pending ? "送出中…" : "獨立覆核"}</button>
      <Result state={state} />
    </div>;
  }

  if (item.state === "scheduled" && item.isLate) {
    if (!snapshot.canAuthorizeLate) return <span className={styles.readOnly}>
      已逾時，須具資格督導先授權補登
    </span>;
    const authorize = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      void state.submit({
        action: "authorize_late", medicationPlanId: item.medicationPlanId,
        scheduledFor: item.scheduledFor, lateReason: String(data.get("lateReason")),
      });
    };
    return <form className={styles.actionBox} onSubmit={authorize}>
      <label><span>補登授權理由</span><textarea name="lateReason" minLength={2}
        maxLength={1000} required /></label>
      <button className="button button--secondary" disabled={!state.online || state.pending}
        type="submit">{state.pending ? "送出中…" : "主管授權補登"}</button>
      <Result state={state} />
    </form>;
  }

  if (!snapshot.canExecute) return <span className={styles.readOnly}>
    需具有效資格且完成近期 AAL2 才可施打
  </span>;
  const execute = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const lateChain = item.state === "late_authorized";
    void state.submit({
      action: "execute",
      administrationKey: lateChain ? item.administrationKey : null,
      previousEventId: lateChain ? item.eventId : null,
      expectedSequence: lateChain ? 1 : 0,
      medicationPlanId: item.medicationPlanId,
      scheduledFor: item.scheduledFor,
      doseText: item.orderedDoseText,
      doseUnit: item.doseUnit,
      siteCode: String(data.get("siteCode")),
      siteText: String(data.get("siteText")),
    });
  };
  return <details className={styles.actionBox}>
    <summary>{item.state === "late_authorized" ? "依授權補登施打" : "記錄施打"}</summary>
    <form onSubmit={execute}>
      <p>計畫劑量：<strong>{item.orderedDoseText} {item.doseUnit}</strong>（不可由本頁改寫）</p>
      <label><span>施打部位代碼</span><select name="siteCode" defaultValue="ABDOMEN_LEFT">
        <option value="ABDOMEN_LEFT">ABDOMEN_LEFT</option>
        <option value="ABDOMEN_RIGHT">ABDOMEN_RIGHT</option>
        <option value="LEFT_ARM">LEFT_ARM</option>
        <option value="RIGHT_ARM">RIGHT_ARM</option>
        <option value="LEFT_THIGH">LEFT_THIGH</option>
        <option value="RIGHT_THIGH">RIGHT_THIGH</option>
      </select></label>
      <label><span>部位文字</span><input name="siteText" minLength={2} maxLength={120}
        defaultValue="左腹部" required /></label>
      <button className="button button--secondary" disabled={!state.online || state.pending}
        type="submit">{state.pending ? "送出中…" : "簽署施打並送覆核"}</button>
      <Result state={state} />
    </form>
  </details>;
}
