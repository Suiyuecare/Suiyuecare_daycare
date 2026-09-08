"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseTransportExecutionMutation,
  parseTransportExecutionReceipt,
} from "@/lib/transport-execution/parser";
import type {
  TransportExecutionEventType,
  TransportExecutionMutationInput,
  TransportExecutionSnapshot,
} from "@/lib/transport-execution/types";

import styles from "./transport-execution.module.css";

type State = { kind: "idle" | "working" | "success" | "error"; text: string };
type Choice = { value: string; label: string; eventType: TransportExecutionEventType };

function localDateTime(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    minute: "2-digit", hourCycle: "h23" }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function isoFromTaipei(value: FormDataEntryValue | null) {
  const raw = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(raw)) throw new Error(
    "請輸入有效的台北實際時間。",
  );
  return new Date(`${raw}:00+08:00`).toISOString();
}

function resultUnknown(error: unknown) {
  if (isClientFetchTimeoutError(error) || error instanceof TypeError) return (
    "連線中斷或逾時，結果未知；內容未修改時請使用相同操作鍵重試。"
  );
  return error instanceof Error ? error.message : "接送執行操作未完成。";
}

async function envelope(response: Response) {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" &&
      Array.isArray((payload as { errors?: unknown }).errors) ?
      ((payload as { errors: Array<{ message?: unknown }> }).errors[0]?.message) : null;
    throw new Error(typeof message === "string" ? message : "接送執行操作未完成。");
  }
  if (!payload || typeof payload !== "object" ||
    (payload as { status?: unknown }).status !== "ok" ||
    !Array.isArray((payload as { errors?: unknown }).errors) ||
    (payload as { errors: unknown[] }).errors.length !== 0 ||
    !("data" in payload) || (payload as { data: unknown }).data === null) {
    throw new Error("接送執行成功回應不完整；請保留相同操作鍵重新核對。");
  }
  return (payload as { data: unknown }).data;
}

function choicesFor(input: {
  trip: TransportExecutionSnapshot["trips"][number];
  canRecord: boolean; canException: boolean; canComplete: boolean; recent: boolean;
}): Choice[] {
  const { trip } = input;
  if (trip.status === "completed") return [];
  if (trip.status === "not_started") return input.canRecord ? [{ value: "trip_started",
    label: "開始趟次", eventType: "trip_started" }] : [];
  const choices: Choice[] = [];
  if (input.canRecord) for (const passenger of trip.passengers) {
    if (passenger.pairingStatus === "pending") choices.push({
      value: `passenger_boarded:${passenger.clientId}`,
      label: `上車：${passenger.displayName}`, eventType: "passenger_boarded",
    });
    if (passenger.pairingStatus === "onboard") choices.push({
      value: `passenger_alighted:${passenger.clientId}`,
      label: `下車：${passenger.displayName}`, eventType: "passenger_alighted",
    });
  }
  if (input.canException && input.recent) choices.push({ value: "exception_recorded",
    label: "登記人工例外", eventType: "exception_recorded" });
  if (input.canComplete && input.recent && trip.unmatchedPassengerCount === 0) {
    choices.push({ value: "trip_completed", label: "完成並簽署趟次",
      eventType: "trip_completed" });
  }
  return choices;
}

export function TransportExecutionActions({ canComplete, canManageAny, canRecord,
  canRecordException, currentUserId, hasRecentAal2, snapshot }: {
  canComplete: boolean; canManageAny: boolean; canRecord: boolean;
  canRecordException: boolean; currentUserId: string; hasRecentAal2: boolean;
  snapshot: TransportExecutionSnapshot;
}) {
  const router = useRouter();
  const key = useRef<string | null>(null);
  const failed = useRef(false);
  const eligible = snapshot.trips.filter((trip) => trip.status !== "completed" &&
    (canManageAny || trip.driverUserId === currentUserId));
  const [tripId, setTripId] = useState(eligible[0]?.planVersionId ?? "");
  const trip = eligible.find(({ planVersionId }) => planVersionId === tripId) ?? eligible[0];
  const choices = trip ? choicesFor({ trip, canRecord, canException: canRecordException,
    canComplete, recent: hasRecentAal2 }) : [];
  const [choiceValue, setChoiceValue] = useState(choices[0]?.value ?? "");
  const choice = choices.find(({ value }) => value === choiceValue) ?? choices[0];
  const [state, setState] = useState<State>({ kind: "idle", text: "" });
  if (!eligible.length || (!canRecord && !canRecordException && !canComplete)) return null;

  function changed() {
    if (failed.current) key.current = null;
    failed.current = false;
    if (state.kind === "error") setState({ kind: "idle", text: "" });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trip || !choice) return;
    setState({ kind: "working", text: "正在鎖定原計畫、事件序號與逐人配對狀態…" });
    key.current ??= crypto.randomUUID();
    try {
      const data = new FormData(event.currentTarget);
      const [, choiceClient] = choice.value.split(":");
      const exceptionSubject = String(data.get("exception_subject") ?? "trip");
      const clientId = choice.eventType === "passenger_boarded" ||
        choice.eventType === "passenger_alighted" ? choiceClient! :
        choice.eventType === "exception_recorded" && exceptionSubject !== "trip" ?
          exceptionSubject : null;
      const rawNote = String(data.get("note") ?? "").trim();
      const input = parseTransportExecutionMutation({ action: "append_event",
        event_type: choice.eventType, plan_version_id: trip.planVersionId,
        expected_trip_key: trip.tripKey,
        expected_plan_content_hash: trip.planContentHash,
        expected_sequence: trip.executionSequence,
        occurred_at: isoFromTaipei(data.get("occurred_at")), client_id: clientId,
        note: choice.eventType === "exception_recorded" ? rawNote :
          choice.eventType === "trip_completed" && rawNote ? rawNote : null,
        resolves_pairing: choice.eventType === "exception_recorded" &&
          data.get("resolves_pairing") === "on",
      }, key.current) as TransportExecutionMutationInput;
      const header = input.eventType === "trip_started" ? "start_trip" :
        input.eventType === "exception_recorded" ? "record_exception" :
          input.eventType === "trip_completed" ? "complete_trip" : input.eventType;
      const response = await fetchWithTimeout("/api/transport-execution", {
        method: "POST", cache: "no-store", headers: { "content-type": "application/json",
          "idempotency-key": input.idempotencyKey,
          "x-transport-execution-operation": header },
        body: JSON.stringify({ action: input.action, event_type: input.eventType,
          plan_version_id: input.planVersionId, expected_trip_key: input.expectedTripKey,
          expected_plan_content_hash: input.expectedPlanContentHash,
          expected_sequence: input.expectedSequence, occurred_at: input.occurredAt,
          client_id: input.clientId, note: input.note,
          resolves_pairing: input.resolvesPairing }),
      });
      const receipt = parseTransportExecutionReceipt(await envelope(response), input);
      key.current = null; failed.current = false;
      setState({ kind: "success", text: receipt.eventType === "trip_completed" ?
        "趟次已完成並建立不可變回執。" :
        `事件 #${receipt.sequence} 已寫入；目前尚有 ${receipt.unmatchedPassengerCount} 人未配對。` });
      router.refresh();
    } catch (error) {
      failed.current = true;
      setState({ kind: "error", text: resultUnknown(error) });
    }
  }

  return <section aria-label="受治理接送執行操作" className={styles.actions}>
    <details className={styles.action}><summary>開始、記錄上下車、登記例外或完成趟次</summary>
      <form onInput={changed} onSubmit={submit}><fieldset className={styles.formGrid}
        disabled={state.kind === "working" || !choice}>
        <label className={styles.wide}><span>原計畫趟次</span><select value={trip?.planVersionId}
          onChange={(event) => { setTripId(event.target.value); setChoiceValue(""); changed(); }}>
          {eligible.map((item) => <option key={item.planVersionId} value={item.planVersionId}>
            {item.vehicleName}・{item.driverDisplayName}・v{item.planVersion}・序號 {item.executionSequence}
          </option>)}</select></label>
        <label><span>事件</span><select value={choice?.value ?? ""}
          onChange={(event) => { setChoiceValue(event.target.value); changed(); }}>
          {choices.length ? choices.map((item) => <option key={item.value} value={item.value}>
            {item.label}</option>) : <option value="">目前沒有可執行動作</option>}
        </select></label><label><span>實際時間（台北）</span><input
          defaultValue={localDateTime(new Date())} name="occurred_at" required type="datetime-local" /></label>
        {choice?.eventType === "exception_recorded" ? <>
          <label><span>例外對象</span><select name="exception_subject"><option value="trip">整個趟次</option>
            {trip?.passengers.map((item) => <option key={item.clientId} value={item.clientId}>
              {item.displayName}</option>)}</select></label>
          <label><span>配對處置</span><span className={styles.checkboxLine}>
            <input name="resolves_pairing" type="checkbox" />
            <span>此理由人工解決所選個案的未配對狀態</span></span></label></> : null}
        {(choice?.eventType === "exception_recorded" || choice?.eventType === "trip_completed") ?
          <label className={styles.wide}><span>{choice.eventType === "exception_recorded" ?
            "例外與處置理由（至少 8 字）" : "完成備註（選填；填寫時至少 8 字）"}</span>
            <textarea maxLength={1000} minLength={choice.eventType === "exception_recorded" ? 8 : undefined}
              name="note" required={choice.eventType === "exception_recorded"} rows={3} /></label> : null}
        <button className="button button--primary" type="submit">鎖內重驗並寫入事件</button>
      </fieldset>{state.kind !== "idle" ? <p className={state.kind === "error" ?
        styles.error : styles.message} role="status">{state.text}</p> : null}</form>
    </details>
    {!hasRecentAal2 && (canRecordException || canComplete) ? <section className={styles.reauth}>
      <h2>例外處置與完成簽署需重新驗證</h2><p>一般開始／上下車仍依目前 AAL2 作業；
        例外及完成需同一工作階段最近 15 分鐘 AAL2。</p>
      <Link className="button button--secondary" href="/mfa?audience=staff">前往雙重驗證</Link>
    </section> : null}
  </section>;
}
