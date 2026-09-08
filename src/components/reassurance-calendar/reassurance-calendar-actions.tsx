"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseReassuranceCalendarApiError,
  parseReassuranceCalendarApiSuccess,
} from "@/lib/reassurance-calendar/parser";
import type {
  ReassuranceCalendarClientOption,
  ReassuranceCalendarItem,
  ReassuranceCalendarMutationInput,
  ReassuranceCalendarStaffOption,
} from "@/lib/reassurance-calendar/types";

import styles from "./reassurance-calendar.module.css";

function localDateTime(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function toIso(value: FormDataEntryValue | null) {
  return new Date(`${String(value)}:00+08:00`).toISOString();
}

function useMutationState() {
  const router = useRouter();
  const keyRef = useRef(crypto.randomUUID());
  const attemptedRef = useRef<string | null>(null);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update(); window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  const dirty = () => {
    if (attemptedRef.current !== null) {
      keyRef.current = crypto.randomUUID(); attemptedRef.current = null; setMessage(null);
    }
  };
  const submit = async (input: Omit<ReassuranceCalendarMutationInput, "idempotencyKey">) => {
    const canonical = JSON.stringify(input);
    if (attemptedRef.current !== null && attemptedRef.current !== canonical) {
      keyRef.current = crypto.randomUUID();
    }
    attemptedRef.current = canonical;
    const full = { ...input, idempotencyKey: keyRef.current } satisfies ReassuranceCalendarMutationInput;
    setPending(true); setMessage(null);
    try {
      const response = await fetchWithTimeout("/api/reassurance-calendar", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": keyRef.current },
        body: JSON.stringify(Object.fromEntries(
          Object.entries(input).filter(([field, value]) =>
            value !== null && !(input.action === "cancel" && field === "targetClientIds")),
        )),
      });
      const raw: unknown = await response.json();
      if (!response.ok) {
        setMessage(parseReassuranceCalendarApiError(raw)?.errors[0]?.message ??
          "儲存未完成；請保留內容並用相同操作鍵重試。");
        return;
      }
      parseReassuranceCalendarApiSuccess(raw, full);
      setCompleted(true); setMessage("已保存不可變版本，正在重新取得單一快照。");
      router.refresh();
    } catch (error) {
      setMessage(isClientFetchTimeoutError(error)
        ? "連線逾時，完成狀態未知；請保留內容並直接重試，相同內容會沿用原操作鍵。"
        : "網路中斷，完成狀態未知；請保留內容並直接重試，相同內容會沿用原操作鍵。");
    } finally { setPending(false); }
  };
  return { online, pending, completed, message, dirty, submit };
}

export function ReassuranceCalendarEventForm({
  canManage, clients, event, referenceTime, staff,
}: {
  canManage: boolean;
  clients: readonly ReassuranceCalendarClientOption[];
  event?: ReassuranceCalendarItem;
  referenceTime: string;
  staff: readonly ReassuranceCalendarStaffOption[];
}) {
  const state = useMutationState();
  const [audienceKind, setAudienceKind] = useState<
    "all_branch_clients" | "selected_clients"
  >(event?.audienceKind ?? "all_branch_clients");
  const selected = new Set(event?.audience
    .filter((value) => value.targetKind === "client").map((value) => value.targetId) ?? []);
  const start = event?.startsAt ?? new Date(Date.parse(referenceTime) + 86_400_000).toISOString();
  const end = event?.endsAt ?? new Date(Date.parse(start) + 3_600_000).toISOString();
  const submit = (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault(); const data = new FormData(formEvent.currentTarget);
    const input = {
      action: event ? "revise" as const : "create" as const,
      eventKey: event?.eventKey ?? null,
      previousVersionId: event?.versionId ?? null,
      expectedVersion: event?.version ?? null,
      category: String(data.get("category")) as ReassuranceCalendarMutationInput["category"],
      title: String(data.get("title")), summary: String(data.get("summary")),
      startsAt: toIso(data.get("startsAt")), endsAt: toIso(data.get("endsAt")),
      location: String(data.get("location")),
      audienceKind: String(data.get("audienceKind")) as ReassuranceCalendarMutationInput["audienceKind"],
      targetClientIds: data.getAll("targetClientIds").map(String).sort(),
      responsibleUserId: String(data.get("responsibleUserId")),
      reason: event ? String(data.get("reason")) : null,
    };
    void state.submit(input);
  };
  return <details className={styles.editor}>
    <summary>{event ? "建立行程更正版" : "新增行程"}</summary>
    <form onSubmit={submit} onInput={state.dirty}>
      {!state.online ? <p className={styles.warning} role="status">目前離線；正式行程不會保存在裝置，請重新連線後送出。</p> : null}
      <fieldset disabled={!canManage || state.pending || state.completed || !state.online}>
        <div className={styles.formGrid}>
          <label><span>分類</span><select name="category" required defaultValue={event?.category ?? "care"}>
            <option value="care">照顧</option><option value="activity">活動</option>
            <option value="transport">交通</option><option value="appointment">約定</option>
            <option value="reminder">提醒</option></select></label>
          <label><span>標題</span><input name="title" required maxLength={200} defaultValue={event?.title ?? ""} /></label>
          <label className={styles.wide}><span>內容摘要</span><textarea name="summary" required maxLength={2000} defaultValue={event?.summary ?? ""} /></label>
          <label><span>開始（台北時間）</span><input type="datetime-local" name="startsAt" required defaultValue={localDateTime(start)} /></label>
          <label><span>結束（台北時間）</span><input type="datetime-local" name="endsAt" required defaultValue={localDateTime(end)} /></label>
          <label><span>地點</span><input name="location" required maxLength={200} defaultValue={event?.location ?? ""} /></label>
          <label><span>負責人</span><select name="responsibleUserId" required defaultValue={event?.responsibleUserId ?? ""}>
            <option value="">請選擇</option>{staff.map((option) => <option key={option.userId} value={option.userId}>{option.displayName}</option>)}</select></label>
          <label><span>對象範圍</span><select name="audienceKind" required value={audienceKind}
            onChange={(changeEvent) => setAudienceKind(changeEvent.target.value as typeof audienceKind)}>
            <option value="all_branch_clients">目前分支全部服務對象</option>
            <option value="selected_clients">指定個案</option></select></label>
          {event ? <label className={styles.wide}><span>更正理由</span><textarea name="reason" required minLength={2} maxLength={500} /></label> : null}
        </div>
        <fieldset className={styles.targets}><legend>指定個案（選擇「指定個案」時至少勾選一位）</legend>
          {clients.map((client) => <label key={client.clientId}>
            <input type="checkbox" name="targetClientIds" value={client.clientId}
              defaultChecked={selected.has(client.clientId)} disabled={audienceKind === "all_branch_clients"} />
            <span>{client.displayName} · {client.clientCode}</span>
          </label>)}
        </fieldset>
        <button className="button" type="submit">{state.pending ? "送出中…" : event ? "發布更正版" : "發布行程"}</button>
      </fieldset>
      {!canManage ? <p className={styles.muted}>目前為唯讀；所有正式發布都需要近期 AAL2 與管理權限。</p> : null}
      {state.message ? <p role="status" className={state.completed ? styles.success : styles.warning}>{state.message}</p> : null}
    </form>
  </details>;
}

export function ReassuranceCalendarCancelForm({
  canCancel, event, hasRecentAal2,
}: {
  canCancel: boolean; event: ReassuranceCalendarItem; hasRecentAal2: boolean;
}) {
  const state = useMutationState();
  const submit = (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault(); const data = new FormData(formEvent.currentTarget);
    void state.submit({
      action: "cancel", eventKey: event.eventKey,
      previousVersionId: event.versionId, expectedVersion: event.version,
      category: null, title: null, summary: null, startsAt: null, endsAt: null,
      location: null, audienceKind: null, targetClientIds: [],
      responsibleUserId: null, reason: String(data.get("reason")),
    });
  };
  const disabled = !canCancel || !hasRecentAal2;
  return <details className={styles.cancelEditor}>
    <summary>取消行程</summary><form onSubmit={submit} onInput={state.dirty}>
      <fieldset disabled={disabled || state.pending || state.completed || !state.online}>
        <label><span>取消原因（必填）</span><textarea name="reason" required minLength={2} maxLength={500} /></label>
        <button className="button button--secondary" type="submit">{state.pending ? "送出中…" : "確認建立取消版本"}</button>
      </fieldset>
      {canCancel && !hasRecentAal2 ? <p className={styles.warning}>請先完成最近 15 分鐘內的 AAL2 驗證。</p> : null}
      {!state.online ? <p className={styles.warning} role="status">目前離線，取消不會送出。</p> : null}
      {state.message ? <p role="status" className={state.completed ? styles.success : styles.warning}>{state.message}</p> : null}
    </form>
  </details>;
}
