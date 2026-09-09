"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { parseBehaviorEventMutation, parseBehaviorEventReceipt } from "@/lib/behavior-events/parser";
import type { BehaviorEvent, BehaviorEventMutationInput, BehaviorEventSnapshot,
  BehaviorFieldState, BehaviorNarrativeField } from "@/lib/behavior-events/types";

import styles from "./behavior-events.module.css";

type State = { kind: "idle" | "working" | "success" | "error"; text: string };
type ExistingOperation = "revise" | "sign" | "correct" | "void";
const STATE_OPTIONS: Array<{ value: BehaviorFieldState; label: string }> = [
  { value: "recorded", label: "已記錄" }, { value: "missing", label: "缺值（待補）" },
  { value: "not_applicable", label: "不適用" },
];

function localDateTime(iso?: string) {
  const value = iso ? new Date(iso) : new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric",
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function isoFromTaipei(value: FormDataEntryValue | null) {
  const raw = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(raw)) throw new Error("請輸入有效的台北發生時間。");
  return new Date(`${raw}:00+08:00`).toISOString();
}

function resultUnknown(error: unknown) {
  if (isClientFetchTimeoutError(error) || error instanceof TypeError) return "連線中斷或逾時，結果未知；請保留內容並使用相同操作鍵重試。";
  return error instanceof Error ? error.message : "行為事件操作未完成。";
}

async function envelope(response: Response) {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && Array.isArray((payload as { errors?: unknown }).errors)
      ? (payload as { errors: Array<{ message?: unknown }> }).errors[0]?.message : null;
    throw new Error(typeof message === "string" ? message : "行為事件操作未完成。");
  }
  if (!payload || typeof payload !== "object" || (payload as { status?: unknown }).status !== "ok" ||
    !Array.isArray((payload as { errors?: unknown }).errors) || (payload as { errors: unknown[] }).errors.length !== 0 ||
    !("data" in payload) || (payload as { data: unknown }).data === null) {
    throw new Error("行為事件成功回應不完整；請保留相同操作鍵重新核對。");
  }
  return (payload as { data: unknown }).data;
}

function TriField({ label, name, initial }: { label: string; name: string; initial?: BehaviorNarrativeField }) {
  const [state, setState] = useState<BehaviorFieldState>(initial?.state ?? "recorded");
  return <fieldset className={styles.triField}><legend>{label}</legend>
    <label><span>狀態</span><select name={`${name}_state`} value={state}
      onChange={(event) => setState(event.target.value as BehaviorFieldState)}>
      {STATE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
    {state === "recorded" ? <label className={styles.narrative}><span>{label}（人工原文）</span>
      <textarea defaultValue={initial?.text ?? ""} maxLength={4000} minLength={1}
        name={`${name}_text`} required rows={3} /></label> :
      <p className={styles.fieldHint}>{state === "missing" ? "明確保存為缺值；不會當作空字或零。" : "明確保存為不適用；不會從其他文字推論。"}</p>}
  </fieldset>;
}

function fields(data: FormData) {
  const read = (name: string) => {
    const state = String(data.get(`${name}_state`) ?? "") as BehaviorFieldState;
    return { state, text: state === "recorded" ? String(data.get(`${name}_text`) ?? "").trim() : null };
  };
  return { antecedent: read("antecedent"), behavior: read("behavior"),
    intervention: read("intervention"), outcome: read("outcome") };
}

async function send(input: BehaviorEventMutationInput, operation: string) {
  const payload = input.action === "save_event" ? { action: input.action, mode: input.mode,
    event_key: input.eventKey, previous_version_id: input.previousVersionId,
    expected_version: input.expectedVersion, expected_content_hash: input.expectedContentHash,
    client_id: input.clientId, occurred_at: input.occurredAt, event_type: input.eventType,
    antecedent: input.antecedent, behavior: input.behavior, intervention: input.intervention,
    outcome: input.outcome, revision_reason: input.revisionReason } : input.action === "correct_event" ? {
    action: input.action, event_key: input.eventKey, previous_version_id: input.previousVersionId,
    expected_version: input.expectedVersion, expected_content_hash: input.expectedContentHash,
    client_id: input.clientId, occurred_at: input.occurredAt, event_type: input.eventType,
    antecedent: input.antecedent, behavior: input.behavior, intervention: input.intervention,
    outcome: input.outcome, reason: input.reason } : { action: input.action, decision: input.decision,
    client_id: input.clientId, event_key: input.eventKey, previous_version_id: input.previousVersionId,
    expected_version: input.expectedVersion, expected_content_hash: input.expectedContentHash,
    reason: input.reason };
  const response = await fetchWithTimeout("/api/behavior-events", { method: "POST", cache: "no-store",
    headers: { "content-type": "application/json", "idempotency-key": input.idempotencyKey,
      "x-behavior-event-operation": operation }, body: JSON.stringify(payload) });
  return parseBehaviorEventReceipt(await envelope(response), input);
}

export function CreateBehaviorEvent({ canManage, snapshot }: { canManage: boolean; snapshot: BehaviorEventSnapshot }) {
  const router = useRouter(); const key = useRef<string | null>(null); const failed = useRef(false);
  const [state, setState] = useState<State>({ kind: "idle", text: "" });
  if (!canManage || snapshot.demo || !snapshot.clients.length) return null;
  function changed() { if (failed.current) key.current = null; failed.current = false;
    if (state.kind === "error") setState({ kind: "idle", text: "" }); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setState({ kind: "working", text: "正在驗證個案範圍並建立不可變草稿…" });
    key.current ??= crypto.randomUUID();
    try { const data = new FormData(event.currentTarget); const input = parseBehaviorEventMutation({
      action: "save_event", mode: "create", event_key: null, previous_version_id: null,
      expected_version: 0, expected_content_hash: null, client_id: String(data.get("client_id") ?? ""),
      occurred_at: isoFromTaipei(data.get("occurred_at")), event_type: String(data.get("event_type") ?? ""),
      ...fields(data), revision_reason: "建立事件初稿",
    }, key.current); const receipt = await send(input, "create"); key.current = null; failed.current = false;
      setState({ kind: "success", text: `事件草稿 v${receipt.version} 已建立；尚未簽署。` }); router.refresh();
    } catch (error) { failed.current = true; setState({ kind: "error", text: resultUnknown(error) }); }
  }
  return <section aria-label="新增行為與情緒事件" className={styles.actions}><details className={styles.action}>
    <summary>新增獨立事件草稿</summary><form onInput={changed} onSubmit={submit}>
      <fieldset className={styles.formGrid} disabled={state.kind === "working"}>
        <label><span>個案</span><select name="client_id" required>{snapshot.clients.map((client) =>
          <option key={client.clientId} value={client.clientId}>{client.displayName}</option>)}</select></label>
        <label><span>實際發生時間（台北）</span><input defaultValue={localDateTime()} name="occurred_at" required type="datetime-local" /></label>
        <label className={styles.wide}><span>事件類型（人工選擇，不從敘事推論）</span>
          <input list="behavior-event-types" maxLength={120} name="event_type" required />
          <datalist id="behavior-event-types">{snapshot.eventTypes.map((value) => <option key={value} value={value} />)}</datalist></label>
        <TriField label="前因" name="antecedent" /><TriField label="行為" name="behavior" />
        <TriField label="人工處置" name="intervention" /><TriField label="人工結果" name="outcome" />
        <button className="button button--primary" type="submit">建立事件草稿</button>
      </fieldset>{state.kind !== "idle" ? <p className={state.kind === "error" ? styles.error : styles.message} role="status">{state.text}</p> : null}
    </form></details></section>;
}

export function BehaviorEventActions({ canManage, canSign, hasRecentAal2, event }: {
  canManage: boolean; canSign: boolean; hasRecentAal2: boolean; event: BehaviorEvent;
}) {
  const router = useRouter(); const key = useRef<string | null>(null); const failed = useRef(false);
  const available: ExistingOperation[] = event.eventState === "draft" ? [
    ...(canManage ? ["revise" as const] : []), ...(canSign ? ["sign" as const] : []),
  ] : event.eventState === "voided" ? [] : canSign ? ["correct", "void"] : [];
  const [operation, setOperation] = useState<ExistingOperation>(available[0] ?? "revise");
  const [state, setState] = useState<State>({ kind: "idle", text: "" });
  if (!available.length) return <span className={styles.noAction}>無可用操作</span>;
  const contentAction = operation === "revise" || operation === "correct";
  const recentRequired = operation !== "revise";
  function changed() { if (failed.current) key.current = null; failed.current = false;
    if (state.kind === "error") setState({ kind: "idle", text: "" }); }
  async function submit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault(); setState({ kind: "working", text: "正在鎖定事件版本與內容雜湊…" });
    key.current ??= crypto.randomUUID();
    try { const data = new FormData(submitEvent.currentTarget); let input: BehaviorEventMutationInput;
      if (operation === "revise") input = parseBehaviorEventMutation({ action: "save_event", mode: "revise",
        event_key: event.eventKey, previous_version_id: event.versionId, expected_version: event.version,
        expected_content_hash: event.contentHash, client_id: event.clientId,
        occurred_at: isoFromTaipei(data.get("occurred_at")), event_type: String(data.get("event_type") ?? ""),
        ...fields(data), revision_reason: String(data.get("reason") ?? "") }, key.current);
      else if (operation === "correct") input = parseBehaviorEventMutation({ action: "correct_event",
        event_key: event.eventKey, previous_version_id: event.versionId, expected_version: event.version,
        expected_content_hash: event.contentHash, client_id: event.clientId,
        occurred_at: isoFromTaipei(data.get("occurred_at")), event_type: String(data.get("event_type") ?? ""),
        ...fields(data), reason: String(data.get("reason") ?? "") }, key.current);
      else input = parseBehaviorEventMutation({ action: "finalize_event", decision: operation,
        client_id: event.clientId, event_key: event.eventKey, previous_version_id: event.versionId,
        expected_version: event.version, expected_content_hash: event.contentHash,
        reason: operation === "void" ? String(data.get("reason") ?? "") : null }, key.current);
      const receipt = await send(input, operation); key.current = null; failed.current = false;
      setState({ kind: "success", text: `${operation === "void" ? "事件已作廢" : operation === "sign" ? "事件已簽署" : "新版本已建立"}（v${receipt.version}）。` });
      router.refresh();
    } catch (error) { failed.current = true; setState({ kind: "error", text: resultUnknown(error) }); }
  }
  return <details className={styles.rowAction}><summary>事件操作</summary><form onInput={changed} onSubmit={submit}>
    <fieldset className={styles.formGrid} disabled={state.kind === "working" || (recentRequired && !hasRecentAal2)}>
      <label><span>操作</span><select value={operation} onChange={(e) => { setOperation(e.target.value as ExistingOperation); changed(); }}>
        {available.map((item) => <option key={item} value={item}>{item === "revise" ? "修訂草稿" : item === "sign" ? "簽署" : item === "correct" ? "建立有理由更正版" : "必要作廢"}</option>)}</select></label>
      {contentAction ? <><label><span>實際發生時間（台北）</span><input defaultValue={localDateTime(event.occurredAt)} name="occurred_at" required type="datetime-local" /></label>
        <label className={styles.wide}><span>事件類型</span><input defaultValue={event.eventType} maxLength={120} name="event_type" required /></label>
        <TriField initial={event.antecedent} label="前因" name="antecedent" />
        <TriField initial={event.behavior} label="行為" name="behavior" />
        <TriField initial={event.intervention} label="人工處置" name="intervention" />
        <TriField initial={event.outcome} label="人工結果" name="outcome" /></> : null}
      {(operation === "revise" || operation === "correct" || operation === "void") ?
        <label className={styles.wide}><span>{operation === "revise" ? "修訂理由" : operation === "correct" ? "更正理由（至少 8 字）" : "作廢理由（至少 8 字）"}</span>
          <textarea maxLength={1000} minLength={operation === "revise" ? 1 : 8} name="reason" required rows={3} /></label> : null}
      {operation === "sign" ? <p className={styles.wide}><strong>簽署確認：</strong>我確認這是人員人工記錄的事件內容，
        系統未自動診斷或從敘事推論，並同意以目前版本與內容雜湊建立不可變簽署證據。</p> : null}
      <button className="button button--primary" type="submit">鎖定版本並送出</button>
    </fieldset>{recentRequired && !hasRecentAal2 ? <p className={styles.reauth}>簽署、更正與作廢需同一工作階段最近 15 分鐘 AAL2。 <Link href="/mfa?audience=staff&purpose=sensitive-action">重新驗證</Link></p> : null}
    {state.kind !== "idle" ? <p className={state.kind === "error" ? styles.error : styles.message} role="status">{state.text}</p> : null}
  </form></details>;
}
