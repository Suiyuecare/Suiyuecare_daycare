"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseMeetingActionApiEnvelope,
  parseMeetingActionUpdateInput,
  parseMeetingMinuteApiEnvelope,
  parseMeetingMinuteInput,
} from "@/lib/meetings/parser";
import type {
  MeetingActionItem,
  MeetingManagementSnapshot,
  MeetingMinute,
} from "@/lib/meetings/types";

import styles from "./meetings.module.css";

function localDateTime(iso: string) {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function taipeiLocalToIso(value: string) {
  return new Date(`${value}:00+08:00`).toISOString();
}

function errorMessage(error: unknown) {
  if (isClientFetchTimeoutError(error)) return error.message;
  if (error instanceof Error && error.message.includes("fetch")) {
    return "網路中斷，尚未確認寫入；請保留畫面後重試。";
  }
  return "操作未確認完成；請重新載入資料，並使用原操作鍵重試。";
}

export function MeetingActionUpdateForm({
  action,
  canManage,
  meeting,
}: {
  action: MeetingActionItem;
  canManage: boolean;
  meeting: MeetingMinute;
}) {
  const router = useRouter();
  const operationKey = useRef<string | null>(null);
  const failedAttempt = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!canManage) return null;
  return (
    <form className={styles.actionForm} onChange={() => {
      if (failedAttempt.current) {
        failedAttempt.current = false;
        operationKey.current = null;
        setMessage(null);
      }
    }} onSubmit={async (event) => {
      event.preventDefault();
      setPending(true); setMessage(null);
      const data = new FormData(event.currentTarget);
      operationKey.current ??= crypto.randomUUID();
      try {
        const input = parseMeetingActionUpdateInput({
          meeting_key: meeting.meetingKey,
          minute_version_id: meeting.minuteVersionId,
          action_id: action.actionId,
          expected_previous_update_id: action.latestUpdateId,
          progress_status: data.get("status"),
          progress_note: String(data.get("note") ?? "").trim() || null,
        }, operationKey.current);
        const response = await fetchWithTimeout("/api/meetings/actions", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": input.idempotencyKey },
          body: JSON.stringify({
            meeting_key: input.meetingKey, minute_version_id: input.minuteVersionId,
            action_id: input.actionId,
            expected_previous_update_id: input.expectedPreviousUpdateId,
            progress_status: input.progressStatus, progress_note: input.progressNote,
          }),
        });
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error("save failed");
        parseMeetingActionApiEnvelope(payload, input, response.status);
        operationKey.current = null;
        failedAttempt.current = false;
        setMessage("進度已追加保存；原會議紀錄沒有被改寫。");
        router.refresh();
      } catch (error) {
        failedAttempt.current = true;
        setMessage(errorMessage(error));
      } finally { setPending(false); }
    }}>
      <fieldset className={styles.inlineFieldset} disabled={pending}>
      <label>
        <span>行動狀態</span>
        <select name="status" defaultValue={action.progressStatus}>
          <option value="not_started">尚未開始</option>
          <option value="in_progress">進行中</option>
          <option value="completed">已完成</option>
          <option value="cancelled">已取消</option>
        </select>
      </label>
      <label className={styles.grow}>
        <span>進度備註（選填）</span>
        <input name="note" maxLength={1000} defaultValue={action.progressNote ?? ""} />
      </label>
      <button className="button button--secondary" type="submit" disabled={pending}>
        {pending ? "保存中…" : "追加進度"}
      </button>
      </fieldset>
      {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
    </form>
  );
}

export function MeetingCorrectionForm({
  canSign,
  hasRecentAal2,
  meeting,
}: {
  canSign: boolean;
  hasRecentAal2: boolean;
  meeting: MeetingMinute;
}) {
  const router = useRouter();
  const operationKey = useRef<string | null>(null);
  const failedAttempt = useRef(false);
  const supplementalDecisionId = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!canSign) return null;
  return (
    <details className={styles.correction}>
      <summary>建立更正版</summary>
      <form onChange={() => {
        if (failedAttempt.current) {
          failedAttempt.current = false;
          operationKey.current = null;
          supplementalDecisionId.current = null;
          setMessage(null);
        }
      }} onSubmit={async (event) => {
        event.preventDefault();
        setPending(true); setMessage(null);
        const data = new FormData(event.currentTarget);
        operationKey.current ??= crypto.randomUUID();
        const extraDecision = String(data.get("decision") ?? "").trim();
        if (extraDecision) supplementalDecisionId.current ??= crypto.randomUUID();
        try {
          const input = parseMeetingMinuteInput({
            meeting_key: meeting.meetingKey,
            previous_version_id: meeting.minuteVersionId,
            correction_reason: data.get("reason"),
            meeting_type: meeting.meetingType,
            title: data.get("title"),
            starts_at: meeting.startsAt,
            ends_at: meeting.endsAt,
            staff_attendee_user_ids: meeting.staffAttendees.map((item) => item.userId),
            external_attendee_names: meeting.externalAttendees.map((item) => item.name),
            agenda_items: meeting.agendaItems.map((item) => ({
              item_id: item.itemId, item_order: item.itemOrder, topic: item.topic,
            })),
            decisions: [
              ...meeting.decisions.map((item) => ({
                decision_id: item.decisionId, item_order: item.itemOrder,
                decision: item.decision,
              })),
              ...(extraDecision ? [{
                decision_id: supplementalDecisionId.current,
                item_order: meeting.decisions.length + 1,
                decision: extraDecision,
              }] : []),
            ],
            action_items: meeting.actionItems.map((item) => ({
              action_id: item.actionId, item_order: item.itemOrder, action: item.action,
              responsible_user_id: item.responsibleUserId, due_date: item.dueDate,
            })),
          }, operationKey.current);
          const response = await fetchWithTimeout("/api/meetings/minutes", {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": input.idempotencyKey },
            body: JSON.stringify({
              meeting_key: input.meetingKey, previous_version_id: input.previousVersionId,
              correction_reason: input.correctionReason, meeting_type: input.meetingType,
              title: input.title, starts_at: input.startsAt, ends_at: input.endsAt,
              staff_attendee_user_ids: input.staffAttendeeUserIds,
              external_attendee_names: input.externalAttendeeNames,
              agenda_items: input.agendaItems.map((item) => ({ item_id: item.itemId, item_order: item.itemOrder, topic: item.topic })),
              decisions: input.decisions.map((item) => ({ decision_id: item.decisionId, item_order: item.itemOrder, decision: item.decision })),
              action_items: input.actionItems.map((item) => ({ action_id: item.actionId, item_order: item.itemOrder, action: item.action, responsible_user_id: item.responsibleUserId, due_date: item.dueDate })),
            }),
          });
          const payload: unknown = await response.json();
          if (!response.ok) throw new Error("save failed");
          parseMeetingMinuteApiEnvelope(payload, input, response.status);
          operationKey.current = null;
          supplementalDecisionId.current = null;
          failedAttempt.current = false;
          setMessage("更正版已簽署；原版本完整保留。");
          router.refresh();
        } catch (error) { failedAttempt.current = true; setMessage(errorMessage(error)); }
        finally { setPending(false); }
      }}>
        <fieldset className={styles.formFieldset} disabled={pending}>
        {!hasRecentAal2 ? <p className={styles.warning} role="alert">簽署前請先在 15 分鐘內重新完成雙因素驗證。</p> : null}
        <label><span>更正版標題</span><input name="title" defaultValue={meeting.title} maxLength={200} required /></label>
        <label><span>更正理由</span><textarea name="reason" maxLength={1000} required /></label>
        <label><span>補充決議（選填）</span><textarea name="decision" maxLength={2000} /></label>
        <button className="button button--primary" type="submit" disabled={pending || !hasRecentAal2}>
          {pending ? "簽署中…" : "簽署更正版"}
        </button>
        </fieldset>
        {message ? <p className={styles.formMessage} role="status">{message}</p> : null}
      </form>
    </details>
  );
}

export function NewMeetingForm({
  canSign,
  hasRecentAal2,
  snapshot,
}: {
  canSign: boolean;
  hasRecentAal2: boolean;
  snapshot: MeetingManagementSnapshot;
}) {
  const router = useRouter();
  const operationKey = useRef<string | null>(null);
  const failedAttempt = useRef(false);
  const draftIds = useRef<{ agenda: string; decision: string; action: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!canSign) return null;
  const exampleEnd = localDateTime(snapshot.generatedAt);
  const exampleStart = localDateTime(new Date(Date.parse(snapshot.generatedAt) - 60 * 60_000).toISOString());
  return (
    <details className={styles.composer}>
      <summary>建立並簽署會議紀錄</summary>
      <form className={styles.composerGrid} onChange={() => {
        if (failedAttempt.current) {
          failedAttempt.current = false;
          operationKey.current = null;
          draftIds.current = null;
          setMessage(null);
        }
      }} onSubmit={async (event) => {
        event.preventDefault(); setPending(true); setMessage(null);
        const form = event.currentTarget;
        const data = new FormData(form);
        operationKey.current ??= crypto.randomUUID();
        draftIds.current ??= {
          agenda: crypto.randomUUID(), decision: crypto.randomUUID(), action: crypto.randomUUID(),
        };
        const actionText = String(data.get("action") ?? "").trim();
        const responsible = String(data.get("responsible") ?? "");
        const dueDate = String(data.get("dueDate") ?? "");
        try {
          const input = parseMeetingMinuteInput({
            meeting_key: null, previous_version_id: null, correction_reason: null,
            meeting_type: data.get("meetingType"), title: data.get("title"),
            starts_at: taipeiLocalToIso(String(data.get("startsAt"))),
            ends_at: taipeiLocalToIso(String(data.get("endsAt"))),
            staff_attendee_user_ids: data.getAll("staff"),
            external_attendee_names: String(data.get("external") ?? "").split("\n").map((item) => item.trim()).filter(Boolean),
            agenda_items: [{ item_id: draftIds.current.agenda, item_order: 1, topic: data.get("agenda") }],
            decisions: String(data.get("decision") ?? "").trim() ? [{ decision_id: draftIds.current.decision, item_order: 1, decision: data.get("decision") }] : [],
            action_items: actionText ? [{ action_id: draftIds.current.action, item_order: 1, action: actionText, responsible_user_id: responsible, due_date: dueDate }] : [],
          }, operationKey.current);
          const response = await fetchWithTimeout("/api/meetings/minutes", {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": input.idempotencyKey },
            body: JSON.stringify({
              meeting_key: null, previous_version_id: null, correction_reason: null,
              meeting_type: input.meetingType, title: input.title,
              starts_at: input.startsAt, ends_at: input.endsAt,
              staff_attendee_user_ids: input.staffAttendeeUserIds,
              external_attendee_names: input.externalAttendeeNames,
              agenda_items: input.agendaItems.map((item) => ({ item_id: item.itemId, item_order: item.itemOrder, topic: item.topic })),
              decisions: input.decisions.map((item) => ({ decision_id: item.decisionId, item_order: item.itemOrder, decision: item.decision })),
              action_items: input.actionItems.map((item) => ({ action_id: item.actionId, item_order: item.itemOrder, action: item.action, responsible_user_id: item.responsibleUserId, due_date: item.dueDate })),
            }),
          });
          const payload: unknown = await response.json();
          if (!response.ok) throw new Error("save failed");
          parseMeetingMinuteApiEnvelope(payload, input, response.status);
          operationKey.current = null;
          draftIds.current = null;
          failedAttempt.current = false;
          setMessage("會議紀錄已簽署保存。");
          form.reset(); router.refresh();
        } catch (error) { failedAttempt.current = true; setMessage(errorMessage(error)); }
        finally { setPending(false); }
      }}>
        <fieldset className={`${styles.formFieldset} ${styles.composerFieldset}`} disabled={pending}>
        {!hasRecentAal2 ? <p className={styles.warning} role="alert">簽署前請先在 15 分鐘內重新完成雙因素驗證。</p> : null}
        <label><span>機構自訂會議類型</span><input name="meetingType" maxLength={120} required /></label>
        <label><span>會議標題</span><input name="title" maxLength={200} required /></label>
        <label><span>開始時間（台北）</span><input name="startsAt" type="datetime-local" defaultValue={exampleStart} required /></label>
        <label><span>結束時間（台北）</span><input name="endsAt" type="datetime-local" defaultValue={exampleEnd} required /></label>
        <fieldset className={styles.full}><legend>員工出席者（至少一人）</legend>
          <div className={styles.staffChoices}>{snapshot.staffOptions.map((staff, index) => <label key={staff.userId}>
            <input type="checkbox" name="staff" value={staff.userId} defaultChecked={index === 0} />
            <span>{staff.displayName}{staff.employeeCode ? `（${staff.employeeCode}）` : ""}</span>
          </label>)}</div>
        </fieldset>
        <label className={styles.full}><span>外部出席者（每行一位，會明確標示外部）</span><textarea name="external" maxLength={6000} /></label>
        <label className={styles.full}><span>議程</span><textarea name="agenda" maxLength={1000} required /></label>
        <label className={styles.full}><span>決議（選填）</span><textarea name="decision" maxLength={2000} /></label>
        <label><span>行動項目（選填）</span><input name="action" maxLength={2000} /></label>
        <label><span>行動負責人</span><select name="responsible" defaultValue=""><option value="">請選擇</option>{snapshot.staffOptions.map((staff) => <option key={staff.userId} value={staff.userId}>{staff.displayName}</option>)}</select></label>
        <label><span>行動期限</span><input name="dueDate" type="date" /></label>
        <div className={styles.full}><button className="button button--primary" type="submit" disabled={pending || !hasRecentAal2}>{pending ? "簽署中…" : "簽署會議紀錄"}</button></div>
        </fieldset>
        {message ? <p className={`${styles.formMessage} ${styles.full}`} role="status">{message}</p> : null}
      </form>
    </details>
  );
}
