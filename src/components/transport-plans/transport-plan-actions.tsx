"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseTransportPlanMutation,
  parseTransportPlanReceipt,
  transportPlanMutationPayload,
} from "@/lib/transport-plans/parser";
import type {
  DecideTransportTripInput,
  CancelTransportTripInput,
  SaveTransportTripInput,
  TransportPlanSnapshot,
} from "@/lib/transport-plans/types";

import styles from "./transport-plans.module.css";

type State = { kind: "idle" | "working" | "success" | "error"; text: string };

function useOperationKey() {
  const key = useRef<string | null>(null);
  const failed = useRef(false);
  return {
    current() { key.current ??= crypto.randomUUID(); return key.current; },
    failed() { failed.current = true; },
    succeeded() { key.current = null; failed.current = false; },
    changed() { if (failed.current) { key.current = null; failed.current = false; } },
  };
}

function localDateTime(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function isoFromTaipei(value: FormDataEntryValue | null) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(text)) throw new Error(
    "請使用有效的台北日期時間。",
  );
  return new Date(`${text}:00+08:00`).toISOString();
}

async function responsePayload(response: Response) {
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message = (payload as { error?: { message?: unknown } })?.error?.message;
    throw new Error(typeof message === "string" ? message : "交通計畫操作未完成。");
  }
  return payload;
}

function resultUnknown(error: unknown) {
  if (isClientFetchTimeoutError(error) || error instanceof TypeError) return (
    "連線中斷或逾時，結果未知；內容未修改時請使用相同操作鍵重試。"
  );
  return error instanceof Error ? error.message : "交通計畫操作未完成。";
}

function Reauth() {
  return <section className={styles.reauth}><h2>交通計畫操作前需重新驗證</h2>
    <p>建立、修訂、發布、駁回及衝突覆核，都需同一工作階段最近 15 分鐘 AAL2。</p>
    <Link className="button button--secondary" href="/mfa?audience=staff&purpose=sensitive-action">前往雙重驗證</Link>
  </section>;
}

export function TransportTripComposer({ canManage, hasRecentAal2, snapshot }: {
  canManage: boolean; hasRecentAal2: boolean; snapshot: TransportPlanSnapshot;
}) {
  const router = useRouter();
  const operation = useOperationKey();
  const [selected, setSelected] = useState("new");
  const [state, setState] = useState<State>({ kind: "idle", text: "" });
  if (!canManage || snapshot.demo) return null;
  if (snapshot.policyStatus !== "manual_unstandardized") return <section
    className={styles.blocked} role="alert"><h2>交通資源規則未唯一生效</h2>
    <p>車輛容量與駕駛人工授權必須由機構發布同一有效版本；在此之前建立與修訂皆 fail closed。</p>
  </section>;
  if (!hasRecentAal2) return <Reauth />;
  const existing = snapshot.trips.find(({ tripKey }) => tripKey === selected) ?? null;
  const defaultStart = existing ? localDateTime(existing.startsAt) :
    `${snapshot.filters.serviceDate}T08:00`;
  const defaultEnd = existing ? localDateTime(existing.endsAt) :
    `${snapshot.filters.serviceDate}T09:00`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ kind: "working", text: "正在鎖定規則、資源與乘員衝突…" });
    try {
      const data = new FormData(event.currentTarget);
      const selectedClients = data.getAll("passenger").map(String);
      const input = parseTransportPlanMutation({ action: "save_trip",
        mode: existing ? "revise" : "create", trip_key: existing?.tripKey ?? null,
        previous_version_id: existing?.tripVersionId ?? null,
        expected_version: existing?.version ?? 0,
        expected_content_hash: existing?.contentHash ?? null,
        direction: data.get("direction"), service_date: snapshot.filters.serviceDate,
        starts_at: isoFromTaipei(data.get("starts_at")),
        ends_at: isoFromTaipei(data.get("ends_at")), vehicle_code: data.get("vehicle"),
        driver_membership_id: data.get("driver"), pickup_label: data.get("pickup"),
        dropoff_label: data.get("dropoff"), passengers: selectedClients.map((clientId) => ({
          client_id: clientId, pickup_label: data.get(`pickup:${clientId}`),
          dropoff_label: data.get(`dropoff:${clientId}`),
        })), revision_reason: data.get("reason"),
      }, operation.current()) as SaveTransportTripInput;
      const response = await fetchWithTimeout("/api/transport-plans", {
        method: "POST", cache: "no-store", headers: { "content-type": "application/json",
          "idempotency-key": input.idempotencyKey,
          "x-transport-plan-operation": "save_trip" },
        body: JSON.stringify({
          action: input.action, mode: input.mode, trip_key: input.tripKey,
          previous_version_id: input.previousVersionId,
          expected_version: input.expectedVersion,
          expected_content_hash: input.expectedContentHash, direction: input.direction,
          service_date: input.serviceDate, starts_at: input.startsAt, ends_at: input.endsAt,
          vehicle_code: input.vehicleCode, driver_membership_id: input.driverMembershipId,
          pickup_label: input.pickupLabel, dropoff_label: input.dropoffLabel,
          passengers: input.passengers.map((item) => ({ client_id: item.clientId,
            pickup_label: item.pickupLabel, dropoff_label: item.dropoffLabel })),
          revision_reason: input.revisionReason,
        }),
      });
      const payload = await responsePayload(response) as { data?: unknown };
      const receipt = parseTransportPlanReceipt(payload.data, input);
      operation.succeeded();
      setState({ kind: "success", text: receipt.conflictCount ?
        `草稿已凍結 ${receipt.conflictCount} 項可解釋衝突，不會自動發布。` :
        "草稿已凍結且未偵測到衝突；仍須另一位人員核准。" });
      router.refresh();
    } catch (error) {
      operation.failed(); setState({ kind: "error", text: resultUnknown(error) });
    }
  }

  return <details className={styles.composer}><summary>建立趟次／建立不可變更正版</summary>
    <form key={existing?.tripVersionId ?? "new"} onInput={() => {
      operation.changed(); if (state.kind === "error") setState({ kind: "idle", text: "" });
    }} onSubmit={submit}>
      <fieldset className={styles.formGrid} disabled={state.kind === "working"}>
        <label className={styles.wide}><span>操作</span><select value={selected}
          onChange={(event) => { setSelected(event.target.value); operation.changed(); }}>
          <option value="new">建立新趟次</option>{snapshot.trips.filter((trip) => trip.status !== "cancelled").map((trip) =>
            <option key={trip.tripKey} value={trip.tripKey}>修訂：{trip.vehicle.name}・
              {localDateTime(trip.startsAt)}・v{trip.version}</option>)}</select></label>
        <label><span>方向</span><select defaultValue={existing?.direction ?? "pickup"}
          name="direction"><option value="pickup">到中心接入</option>
          <option value="dropoff">由中心送回</option></select></label>
        <label><span>車輛</span><select defaultValue={existing?.vehicle.code ?? ""}
          name="vehicle" required><option disabled value="">選擇車輛</option>
          {snapshot.vehicles.map((item) => <option key={item.code} value={item.code}>
            {item.name}・容量 {item.capacity}</option>)}</select></label>
        <label><span>駕駛</span><select defaultValue={existing?.driver.membershipId ?? ""}
          name="driver" required><option disabled value="">選擇已授權駕駛</option>
          {snapshot.drivers.map((item) => <option key={item.membershipId}
            value={item.membershipId}>{item.displayName}・{item.authorizationLabel}</option>)}</select></label>
        <label><span>預計開始（台北）</span><input defaultValue={defaultStart}
          name="starts_at" required type="datetime-local" /></label>
        <label><span>預計結束（台北）</span><input defaultValue={defaultEnd}
          name="ends_at" required type="datetime-local" /></label>
        <label><span>趟次起點</span><input defaultValue={existing?.pickupLabel ?? ""}
          maxLength={240} name="pickup" required /></label>
        <label><span>趟次終點</span><input defaultValue={existing?.dropoffLabel ?? ""}
          maxLength={240} name="dropoff" required /></label>
        <fieldset className={styles.passengers}><legend>乘員與逐人上下車點</legend>
          {snapshot.clients.map((client) => {
            const current = existing?.passengers.find(({ clientId }) => clientId === client.clientId);
            return <div className={styles.passengerRow} key={client.clientId}>
              <label className={styles.check}><input defaultChecked={Boolean(current)}
                name="passenger" type="checkbox" value={client.clientId} />
                <span>{client.displayName}・{client.clientCode}</span></label>
              <label><span>上車點</span><input defaultValue={current?.pickupLabel ?? "機構人工確認"}
                maxLength={240} name={`pickup:${client.clientId}`} /></label>
              <label><span>下車點</span><input defaultValue={current?.dropoffLabel ?? "機構人工確認"}
                maxLength={240} name={`dropoff:${client.clientId}`} /></label>
            </div>;
          })}
        </fieldset>
        <label className={styles.wide}><span>{existing ? "修訂理由" : "建立理由"}</span>
          <textarea defaultValue={existing ? "依最新接送安排建立更正版。" :
            "依機構已發布交通資源規則建立草稿。"} maxLength={1000}
            name="reason" required rows={3} /></label>
        <button className="button button--primary" type="submit">檢查並凍結趟次草稿</button>
      </fieldset>
      {state.kind !== "idle" ? <p className={state.kind === "error" ?
        styles.error : styles.message} role="status">{state.text}</p> : null}
    </form>
  </details>;
}

export function TransportTripCancellation({ canApprove, hasRecentAal2, snapshot }: {
  canApprove: boolean; hasRecentAal2: boolean; snapshot: TransportPlanSnapshot;
}) {
  const router = useRouter();
  const pending = useRef<{ input: CancelTransportTripInput; body: string } | null>(null);
  const busy = useRef(false);
  const [hasPending, setHasPending] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle", text: "" });
  const published = snapshot.trips.filter((trip) => trip.status !== "cancelled" && (trip.cancellationTarget || trip.status === "published"));
  if (!canApprove || snapshot.demo || published.length === 0) return null;
  if (!hasRecentAal2) return null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setState({ kind: "working", text: "正在確認趟次版本與執行狀態…" });
    try {
      if (!pending.current) {
        const form = new FormData(event.currentTarget);
        const trip = published.find((item) => item.tripVersionId === form.get("trip"));
        if (!trip) throw new Error("請重新選擇已發布趟次。");
        const target = trip.cancellationTarget;
        const input = parseTransportPlanMutation({ action: "cancel_trip", trip_version_id: target?.id ?? trip.tripVersionId,
          expected_trip_key: trip.tripKey, expected_version: target?.version ?? trip.version, expected_content_hash: target?.hash ?? trip.contentHash,
          expected_conflict_count: target?.conflictCount ?? trip.conflicts.length, expected_rule_version_id: target?.ruleId ?? trip.ruleVersionId,
          reason: form.get("reason") }, crypto.randomUUID()) as CancelTransportTripInput;
        pending.current = { input, body: JSON.stringify({ action: "cancel_trip", ...transportPlanMutationPayload(input) }) };
        setHasPending(true);
      }
      const { input, body } = pending.current;
      const response = await fetchWithTimeout("/api/transport-plans", { method: "PATCH", cache: "no-store",
        headers: { "content-type": "application/json", "idempotency-key": input.idempotencyKey,
          "x-transport-plan-operation": "cancel_trip" }, body });
      const payload = await response.json() as { data?: Record<string, unknown>; errors?: { message?: string }[] };
      if (!response.ok) throw new Error(payload.errors?.[0]?.message ?? "取消尚未確認，請用原內容重試或重新載入核對。");
      const row = payload.data;
      if (!row || row.persisted !== true || row.demo !== false) throw new Error("取消回執無效，請保留原操作重試。");
      parseTransportPlanReceipt({ operation_id: row.operationId, action: row.action, decision: row.decision,
        trip_version_id: row.tripVersionId, trip_key: row.tripKey, version: row.version, status: row.status,
        conflict_count: row.conflictCount, content_hash: row.contentHash, rule_version_id: row.ruleVersionId,
        committed_at: row.committedAt, replayed: row.replayed }, input);
      pending.current = null;
      setHasPending(false);
      setState({ kind: "success", text: "趟次已取消並保留發布歷史；接送需求將重新列為待派，請安排替代接送並聯絡相關人員。" });
      router.refresh();
    } catch (error) {
      setState({ kind: "error", text: resultUnknown(error) });
    } finally { busy.current = false; }
  }
  return <details className={styles.composer}><summary>取消已發布趟次</summary>
    <p>只可取消尚未開始的趟次；已有執行紀錄時，請記錄例外並確認乘客安全後完成趟次。外部通知仍需人工聯絡。</p>
    <form onSubmit={submit}>
      <fieldset className={styles.formGrid} disabled={state.kind === "working" || hasPending || state.kind === "success"}>
        <label><span>取消趟次</span><select name="trip">{published.map((trip) => <option key={trip.tripVersionId} value={trip.tripVersionId}>
          {trip.cancellationTarget?.vehicleName ?? trip.vehicle.name}・{localDateTime(trip.cancellationTarget?.startsAt ?? trip.startsAt)}・已發布 v{trip.cancellationTarget?.version ?? trip.version}</option>)}</select></label>
        <label className={styles.wide}><span>取消理由（至少 8 字）</span><textarea name="reason" minLength={8} maxLength={1000} required rows={3} /></label>
      </fieldset>
      <button type="submit" className="button button--secondary" disabled={state.kind === "working" || state.kind === "success"}>
        {hasPending ? "以原內容重試取消" : "確認取消趟次"}</button>
      {state.text ? <p role="status" className={state.kind === "error" ? styles.error : styles.message}>{state.text}</p> : null}
    </form>
  </details>;
}

export function TransportTripDecision({ canApprove, canOverride, currentUserId,
  hasRecentAal2, snapshot }: {
  canApprove: boolean; canOverride: boolean; currentUserId: string;
  hasRecentAal2: boolean; snapshot: TransportPlanSnapshot;
}) {
  const router = useRouter();
  const operation = useOperationKey();
  const reviewable = snapshot.trips.filter((trip) =>
    (trip.status === "draft_ready" || trip.status === "draft_conflicted") &&
    trip.createdByUserId !== currentUserId);
  const [selectedId, setSelectedId] = useState(reviewable[0]?.tripVersionId ?? "");
  const [state, setState] = useState<State>({ kind: "idle", text: "" });
  if (!canApprove || snapshot.demo || reviewable.length === 0) return null;
  if (!hasRecentAal2) return <Reauth />;
  const selected = reviewable.find(({ tripVersionId }) => tripVersionId === selectedId) ?? reviewable[0]!;
  const permitted: DecideTransportTripInput["decision"][] = selected.conflicts.length ?
    canOverride ? ["override", "reject"] : ["reject"] : ["publish", "reject"];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setState({ kind: "working", text: "正在重驗資源衝突與審核分權…" });
    try {
      const data = new FormData(event.currentTarget);
      const decision = String(data.get("decision")) as DecideTransportTripInput["decision"];
      const input = parseTransportPlanMutation({ action: "decide_trip", decision,
        trip_version_id: selected.tripVersionId, expected_trip_key: selected.tripKey,
        expected_version: selected.version, expected_content_hash: selected.contentHash,
        expected_conflict_count: selected.conflicts.length,
        expected_rule_version_id: selected.ruleVersionId, reason: data.get("reason"),
      }, operation.current()) as DecideTransportTripInput;
      const response = await fetchWithTimeout("/api/transport-plans", {
        method: "PATCH", cache: "no-store", headers: { "content-type": "application/json",
          "idempotency-key": input.idempotencyKey,
          "x-transport-plan-operation": `${decision}_trip` },
        body: JSON.stringify({ action: input.action, decision: input.decision,
          trip_version_id: input.tripVersionId, expected_trip_key: input.expectedTripKey,
          expected_version: input.expectedVersion,
          expected_content_hash: input.expectedContentHash,
          expected_conflict_count: input.expectedConflictCount,
          expected_rule_version_id: input.expectedRuleVersionId, reason: input.reason }),
      });
      const payload = await responsePayload(response) as { data?: unknown };
      parseTransportPlanReceipt(payload.data, input);
      operation.succeeded(); setState({ kind: "success", text: decision === "publish" ?
        "無衝突趟次已由獨立人員核准發布。" : decision === "override" ?
          "衝突及覆核理由已凍結，趟次以例外覆核發布。" : "趟次草稿已駁回。" });
      router.refresh();
    } catch (error) {
      operation.failed(); setState({ kind: "error", text: resultUnknown(error) });
    }
  }

  return <details className={styles.composer}><summary>獨立發布、駁回或衝突覆核</summary>
    <form onInput={() => { operation.changed(); if (state.kind === "error")
      setState({ kind: "idle", text: "" }); }} onSubmit={submit}>
      <fieldset className={styles.formGrid}
        disabled={state.kind === "working"}>
        <label className={styles.wide}><span>待審趟次</span><select
          value={selected.tripVersionId} onChange={(event) => setSelectedId(event.target.value)}>
          {reviewable.map((trip) => <option key={trip.tripVersionId}
            value={trip.tripVersionId}>{trip.vehicle.name}・{localDateTime(trip.startsAt)}・
            {trip.conflicts.length} 項衝突</option>)}</select></label>
        <label><span>決定</span><select name="decision">
          {permitted.includes("publish") ? <option value="publish">核准無衝突趟次</option> : null}
          {permitted.includes("override") ? <option value="override">覆核衝突並發布</option> : null}
          <option value="reject">駁回</option></select></label>
        <p className={styles.wide}>{selected.conflicts.length ?
          `目前有 ${selected.conflicts.length} 項衝突；一般發布被禁止。` :
          "未偵測到衝突仍須另一位人員獨立核准。"}</p>
        <label className={styles.wide}><span>審核／覆核理由（至少 8 字）</span>
          <textarea maxLength={1000} minLength={8} name="reason" required rows={3} /></label>
        <button className="button button--primary" type="submit">重驗並送出決定</button>
      </fieldset>{state.kind !== "idle" ? <p className={state.kind === "error" ?
        styles.error : styles.message} role="status">{state.text}</p> : null}
    </form>
  </details>;
}
