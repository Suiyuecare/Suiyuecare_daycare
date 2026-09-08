"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  fetchWithTimeout,
  isClientFetchTimeoutError,
} from "@/lib/api/client-fetch";
import { parseActivityActionError, parseActivityActionSuccess } from "@/lib/activities/parser";
import type {
  ActivityClientOption, ActivityItem, ActivityMutationInput, ActivityStaffOption,
} from "@/lib/activities/types";

import styles from "./activities.module.css";

function localDateTime(value: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function toIso(local: FormDataEntryValue | null) {
  return new Date(`${String(local)}:00+08:00`).toISOString();
}

function useConnectivity() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  return online;
}

function useMutationState() {
  const router = useRouter();
  const online = useConnectivity();
  const keyRef = useRef(crypto.randomUUID());
  const attemptedRef = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dirty = () => {
    if (attemptedRef.current !== null) {
      keyRef.current = crypto.randomUUID(); attemptedRef.current = null; setMessage(null);
    }
  };
  const submit = async (input: Omit<ActivityMutationInput, "idempotencyKey">) => {
    const canonical = JSON.stringify(input);
    if (attemptedRef.current !== null && attemptedRef.current !== canonical) keyRef.current = crypto.randomUUID();
    attemptedRef.current = canonical;
    const full = { ...input, idempotencyKey: keyRef.current } satisfies ActivityMutationInput;
    setPending(true); setMessage(null);
    try {
      const response = await fetchWithTimeout("/api/activities", {
        method: input.action === "create" ? "POST" : "PATCH",
        headers: { "content-type": "application/json", "idempotency-key": keyRef.current },
        body: JSON.stringify(Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null))),
      });
      const value: unknown = await response.json();
      if (!response.ok) {
        const error = parseActivityActionError(value);
        setMessage(error?.errors[0]?.message ?? "儲存未完成；內容已保留，可用相同冪等鍵重試。");
        return;
      }
      parseActivityActionSuccess(value, full);
      setCompleted(true); setMessage("活動操作已保存，正在重新載入同一資料快照。");
      router.refresh();
    } catch (error) {
      setMessage(isClientFetchTimeoutError(error)
        ? "連線逾時，完成狀態未知；請保留內容並直接重試，相同內容會沿用原冪等鍵。"
        : "網路中斷，完成狀態未知；請保留內容並直接重試，相同內容會沿用原冪等鍵。");
    } finally { setPending(false); }
  };
  return { online, pending, completed, message, dirty, submit };
}

export function ActivityScheduleForm({
  activity, canManage, clients, quickClientId, referenceTime, staff,
}: {
  activity?: ActivityItem; canManage: boolean; clients: readonly ActivityClientOption[];
  quickClientId: string | null; referenceTime: string; staff: readonly ActivityStaffOption[];
}) {
  const state = useMutationState();
  const mode = activity ? "revise" : "create";
  const selected = new Set(activity?.participants.map((value) => value.clientId) ?? (quickClientId ? [quickClientId] : []));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const participants = data.getAll("participantClientIds").map(String).sort();
    void state.submit({
      action: mode, activityId: activity?.activityId ?? null,
      expectedScheduleVersionId: activity?.scheduleVersionId ?? null,
      expectedScheduleVersion: activity?.scheduleVersion ?? null,
      expectedStatusEventId: activity?.statusEventId ?? null,
      expectedStatusSequence: activity?.statusSequence ?? null,
      activityType: String(data.get("activityType")), title: String(data.get("title")),
      searchSummary: String(data.get("searchSummary")), location: String(data.get("location")),
      startsAt: toIso(data.get("startsAt")), endsAt: toIso(data.get("endsAt")),
      responsibleUserId: String(data.get("responsibleUserId")),
      participantClientIds: participants, capacity: Number(data.get("capacity")),
      reason: activity ? String(data.get("reason")) : null,
    });
  };
  const startDefault = activity?.startsAt ?? new Date(Date.parse(referenceTime) + 60 * 60 * 1000).toISOString();
  const endDefault = activity?.endsAt ?? new Date(Date.parse(referenceTime) + 2 * 60 * 60 * 1000).toISOString();
  return <details className={styles.editor} open={!activity && quickClientId !== null}>
    <summary>{activity ? "建立排程更正版／管理參與者" : "建立活動"}</summary>
    <form onSubmit={submit} onInput={state.dirty}>
      {!state.online ? <p className={styles.warning} role="status">目前離線；活動頁不會把正式操作存到裝置，重新連線後再送出。</p> : null}
      <fieldset disabled={!canManage || state.pending || state.completed || !state.online}>
        <div className={styles.formGrid}>
          <label><span>活動類型</span><input name="activityType" required maxLength={120} defaultValue={activity?.activityType ?? ""} /></label>
          <label><span>活動標題</span><input name="title" required maxLength={200} defaultValue={activity?.title ?? ""} /></label>
          <label className={styles.wide}><span>活動內容摘要（可搜尋）</span><textarea name="searchSummary" required maxLength={1000} defaultValue={activity?.searchSummary ?? ""} /></label>
          <label><span>地點</span><input name="location" required maxLength={200} defaultValue={activity?.location ?? ""} /></label>
          <label><span>負責人</span><select name="responsibleUserId" required defaultValue={activity?.responsibleUserId ?? ""}><option value="">請選擇</option>{staff.map((value) => <option key={value.userId} value={value.userId}>{value.displayName}</option>)}</select></label>
          <label><span>開始（台北時間）</span><input name="startsAt" type="datetime-local" required defaultValue={localDateTime(startDefault)} /></label>
          <label><span>結束（台北時間）</span><input name="endsAt" type="datetime-local" required defaultValue={localDateTime(endDefault)} /></label>
          <label><span>容量</span><input name="capacity" type="number" min={1} max={500} required defaultValue={activity?.capacity ?? 12} /></label>
          {activity ? <label className={styles.wide}><span>排程更正理由</span><textarea name="reason" required maxLength={1000} /></label> : null}
        </div>
        <fieldset className={styles.participants}>
          <legend>參與個案（{clients.length} 個目前可查看選項）</legend>
          {clients.map((client) => <label key={client.clientId}>
            <input type="checkbox" name="participantClientIds" value={client.clientId} defaultChecked={selected.has(client.clientId)} />
            <span>{client.displayName} · {client.clientCode}</span>
          </label>)}
        </fieldset>
        <button className="button" type="submit">{state.pending ? "送出中…" : activity ? "保存更正版" : "建立活動"}</button>
      </fieldset>
      {!canManage ? <p className={styles.muted}>目前為唯讀；需要活動管理權限才能操作。</p> : null}
      {state.message ? <p role="status" className={state.completed ? styles.success : styles.warning}>{state.message}</p> : null}
    </form>
  </details>;
}

export function ActivityTransitionForm({
  action, activity, canAct, hasRecentAal2,
}: {
  action: "start" | "complete" | "cancel"; activity: ActivityItem;
  canAct: boolean; hasRecentAal2: boolean;
}) {
  const state = useMutationState();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void state.submit({
      action, activityId: activity.activityId,
      expectedScheduleVersionId: activity.scheduleVersionId,
      expectedScheduleVersion: activity.scheduleVersion,
      expectedStatusEventId: activity.statusEventId,
      expectedStatusSequence: activity.statusSequence,
      activityType: null, title: null, searchSummary: null, location: null,
      startsAt: null, endsAt: null, responsibleUserId: null,
      participantClientIds: [], capacity: null,
      reason: action === "cancel" ? String(data.get("reason")) : null,
    });
  };
  const label = action === "start" ? "開始活動" : action === "complete" ? "標記完成" : "取消活動";
  const disabled = !canAct || (action === "cancel" && !hasRecentAal2);
  return <form className={styles.transition} onSubmit={submit} onInput={state.dirty}>
    <fieldset disabled={disabled || state.pending || state.completed || !state.online}>
      {action === "cancel" ? <label><span>取消原因</span><textarea name="reason" required maxLength={1000} /></label> : null}
      <button disabled={disabled || state.pending || state.completed || !state.online} className={action === "cancel" ? "button button--secondary" : "button"} type="submit">{state.pending ? "送出中…" : label}</button>
    </fieldset>
    {action === "cancel" && canAct && !hasRecentAal2 ? <p className={styles.warning}>取消需在最近 15 分鐘內完成同一工作階段 AAL2 驗證。</p> : null}
    {!state.online ? <p className={styles.warning} role="status">目前離線，正式狀態不會送出。</p> : null}
    {state.message ? <p role="status" className={state.completed ? styles.success : styles.warning}>{state.message}</p> : null}
  </form>;
}
