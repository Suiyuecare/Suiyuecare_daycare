"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseCaseConferenceApiError,
  parseCaseConferenceApiSuccess,
} from "@/lib/case-conferences/parser";
import type {
  CaseConferenceActionItemInput,
  CaseConferenceAttendeeInput,
  CaseConferenceDeadlineState,
  CaseConferenceItem,
  CaseConferenceMutationInput,
  CaseConferenceSnapshot,
} from "@/lib/case-conferences/types";

import styles from "./case-conferences.module.css";

type MutationDraft = Omit<CaseConferenceMutationInput, "idempotencyKey">;
type ActionDraft = CaseConferenceActionItemInput;

function localDateTime(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
  return parts.replace(", ", "T");
}

function toIso(value: FormDataEntryValue | null) {
  const parsed = new Date(`${String(value)}:00+08:00`);
  return parsed.toISOString();
}

function body(input: MutationDraft) {
  if (input.action === "sign") return {
    action: input.action, meetingKey: input.meetingKey,
    previousVersionId: input.previousVersionId, expectedVersion: input.expectedVersion,
  };
  const content = {
    meetingStartsAt: input.meetingStartsAt, meetingEndsAt: input.meetingEndsAt,
    problemStatement: input.problemStatement, decisionSummary: input.decisionSummary,
    attendees: input.attendees, actionItems: input.actionItems,
  };
  if (input.action === "create") return { action: input.action, clientId: input.clientId, ...content };
  const chain = {
    action: input.action, meetingKey: input.meetingKey,
    previousVersionId: input.previousVersionId, expectedVersion: input.expectedVersion,
  };
  return input.action === "correct"
    ? { ...chain, ...content, correctsVersionId: input.correctsVersionId,
      correctionReason: input.correctionReason }
    : { ...chain, ...content };
}

function useMutation(snapshot: CaseConferenceSnapshot) {
  const router = useRouter();
  const keyRef = useRef(crypto.randomUUID());
  const attemptedRef = useRef<string | null>(null);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
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
  const dirty = () => {
    if (attemptedRef.current !== null) {
      keyRef.current = crypto.randomUUID();
      attemptedRef.current = null;
      setMessage(null);
    }
  };
  const submit = async (input: MutationDraft) => {
    const canonical = JSON.stringify(input);
    if (attemptedRef.current !== null && attemptedRef.current !== canonical) {
      keyRef.current = crypto.randomUUID();
    }
    attemptedRef.current = canonical;
    const full = { ...input, idempotencyKey: keyRef.current } satisfies CaseConferenceMutationInput;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetchWithTimeout("/api/case-conferences", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": keyRef.current,
          "x-case-conference-operation": input.action,
        },
        body: JSON.stringify(body(input)),
      });
      const raw: unknown = await response.json();
      if (!response.ok) {
        setMessage(parseCaseConferenceApiError(raw)?.errors[0]?.message ??
          "儲存未完成；請保留內容並用相同操作鍵重試。");
        return;
      }
      parseCaseConferenceApiSuccess(
        raw, full, snapshot.organizationId, snapshot.branchId, response.status,
      );
      setCompleted(true);
      setMessage("已新增不可變會議版本，正在重新取得快照。");
      router.refresh();
    } catch (error) {
      setMessage(isClientFetchTimeoutError(error)
        ? "連線逾時，完成狀態未知；請直接重試，相同內容會沿用原操作鍵。"
        : "網路中斷，完成狀態未知；請直接重試，相同內容會沿用原操作鍵。");
    } finally {
      setPending(false);
    }
  };
  return { online, pending, completed, message, dirty, submit };
}

function Message({ state }: { state: ReturnType<typeof useMutation> }) {
  return <>
    {!state.online ? <p className={styles.warning} role="status">
      目前離線；正式個案研討不保存在裝置，請重新連線後送出。
    </p> : null}
    {state.message ? <p className={state.completed ? styles.success : styles.warning}
      role="status">{state.message}</p> : null}
  </>;
}

function initialAttendees(item: CaseConferenceItem | null, snapshot: CaseConferenceSnapshot) {
  if (item) return item.attendees.map((entry) => ({
    userId: entry.userId, attendanceStatus: entry.attendanceStatus,
  } satisfies CaseConferenceAttendeeInput));
  const first = snapshot.staffOptions[0];
  return first ? [{ userId: first.userId, attendanceStatus: "attended" as const }] : [];
}

function initialActions(item: CaseConferenceItem | null, snapshot: CaseConferenceSnapshot) {
  if (item) return item.actionItems.map((entry) => ({
    actionId: entry.actionId, itemOrder: entry.itemOrder, actionText: entry.actionText,
    responsibleUserId: entry.responsibleUserId, deadlineState: entry.deadlineState,
    dueDate: entry.dueDate, actionStatus: entry.actionStatus,
  } satisfies ActionDraft));
  const first = snapshot.staffOptions[0];
  return first ? [{
    actionId: crypto.randomUUID(), itemOrder: 1, actionText: "",
    responsibleUserId: first.userId, deadlineState: "missing" as const,
    dueDate: null, actionStatus: "open" as const,
  }] : [];
}

function ConferenceEditor({ action, item, snapshot }: {
  action: "create" | "revise" | "correct";
  item: CaseConferenceItem | null;
  snapshot: CaseConferenceSnapshot;
}) {
  const state = useMutation(snapshot);
  const [attendees, setAttendees] = useState(() => initialAttendees(item, snapshot));
  const [actions, setActions] = useState(() => initialActions(item, snapshot));
  const canAct = action === "correct" ? snapshot.canCorrect : snapshot.canManage;
  const label = action === "create" ? "建立會議草稿"
    : action === "revise" ? "修訂草稿" : "有理由更正簽署版";
  const submitLabel = action === "create" ? "建立不可變草稿"
    : action === "revise" ? "建立修訂版本" : "建立更正版本";
  const setAttendee = (userId: string, checked: boolean) => {
    state.dirty();
    setAttendees((current) => checked
      ? [...current, { userId, attendanceStatus: "attended" }]
      : current.filter((entry) => entry.userId !== userId));
  };
  const updateAttendance = (userId: string, attendanceStatus: CaseConferenceAttendeeInput["attendanceStatus"]) => {
    state.dirty();
    setAttendees((current) => current.map((entry) => entry.userId === userId
      ? { ...entry, attendanceStatus } : entry));
  };
  const updateAction = (index: number, patch: Partial<ActionDraft>) => {
    state.dirty();
    setActions((current) => current.map((entry, position) => position === index
      ? { ...entry, ...patch } : entry));
  };
  const addAction = () => {
    const staff = snapshot.staffOptions[0];
    if (!staff || actions.length >= 50) return;
    state.dirty();
    setActions((current) => [...current, {
      actionId: crypto.randomUUID(), itemOrder: current.length + 1, actionText: "",
      responsibleUserId: staff.userId, deadlineState: "missing", dueDate: null,
      actionStatus: "open",
    }]);
  };
  const removeAction = (index: number) => {
    if (actions.length <= 1) return;
    state.dirty();
    setActions((current) => current.filter((_, position) => position !== index)
      .map((entry, position) => ({ ...entry, itemOrder: position + 1 })));
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const startsAt = toIso(data.get("meetingStartsAt"));
    const endsAt = toIso(data.get("meetingEndsAt"));
    const normalizedActions = actions.map((entry, index) => ({
      ...entry, itemOrder: index + 1,
      dueDate: entry.deadlineState === "dated" ? entry.dueDate : null,
    }));
    void state.submit({
      action,
      meetingKey: item?.meetingKey ?? null,
      previousVersionId: item?.versionId ?? null,
      expectedVersion: item?.version ?? null,
      correctsVersionId: action === "correct" ? item?.versionId ?? null : null,
      clientId: action === "create" ? String(data.get("clientId")) : null,
      meetingStartsAt: startsAt, meetingEndsAt: endsAt,
      problemStatement: String(data.get("problemStatement")),
      decisionSummary: String(data.get("decisionSummary")),
      attendees, actionItems: normalizedActions,
      correctionReason: action === "correct" ? String(data.get("correctionReason")) : null,
    });
  };
  const start = localDateTime(item?.meetingStartsAt ?? snapshot.generatedAt);
  const end = localDateTime(item?.meetingEndsAt ??
    new Date(Date.parse(snapshot.generatedAt) + 3_600_000).toISOString());
  return <details className={styles.editor}>
    <summary>{label}</summary>
    <form onSubmit={submit} onInput={state.dirty}>
      <fieldset disabled={!canAct || state.pending || state.completed || !state.online}>
        <div className={styles.formGrid}>
          {action === "create" ? <label><span>個案</span><select required name="clientId"
            defaultValue=""><option value="">請選擇</option>{snapshot.clientOptions.map((option) =>
              <option key={option.clientId} value={option.clientId}>
                {option.displayName} · {option.clientCode}
              </option>)}</select></label> : null}
          <label><span>會議開始（台北）</span><input required type="datetime-local"
            name="meetingStartsAt" defaultValue={start} /></label>
          <label><span>會議結束（台北）</span><input required type="datetime-local"
            name="meetingEndsAt" defaultValue={end} /></label>
          <label className={styles.wide}><span>問題</span><textarea required minLength={2}
            maxLength={4000} name="problemStatement" defaultValue={item?.problemStatement} /></label>
          <label className={styles.wide}><span>決議</span><textarea required minLength={2}
            maxLength={4000} name="decisionSummary" defaultValue={item?.decisionSummary} /></label>
          {action === "correct" ? <label className={styles.wide}><span>更正理由</span>
            <textarea required minLength={2} maxLength={1000} name="correctionReason" /></label> : null}
        </div>

        <section className={styles.formSection} aria-labelledby={`${action}-attendees`}>
          <h3 id={`${action}-attendees`}>出席者快照</h3>
          <div className={styles.optionGrid}>{snapshot.staffOptions.map((staff) => {
            const selected = attendees.find((entry) => entry.userId === staff.userId);
            return <div className={styles.staffOption} key={staff.userId}>
              <label><input type="checkbox" checked={Boolean(selected)}
                onChange={(event) => setAttendee(staff.userId, event.target.checked)} />
                <span>{staff.displayName}</span></label>
              <select aria-label={`${staff.displayName}出席狀態`} disabled={!selected}
                value={selected?.attendanceStatus ?? "attended"}
                onChange={(event) => updateAttendance(staff.userId,
                  event.target.value as CaseConferenceAttendeeInput["attendanceStatus"])}>
                <option value="attended">出席</option><option value="remote">遠距</option>
                <option value="absent">缺席</option><option value="excused">請假</option>
              </select>
            </div>;
          })}</div>
        </section>

        <section className={styles.formSection} aria-labelledby={`${action}-items`}>
          <div className={styles.sectionHeading}><h3 id={`${action}-items`}>逐項行動</h3>
            <button className="button button--ghost" type="button" onClick={addAction}>新增行動</button></div>
          {actions.map((entry, index) => <fieldset className={styles.actionDraft}
            key={entry.actionId}>
            <legend>行動 {index + 1}</legend>
            <label className={styles.wide}><span>內容</span><textarea required minLength={2}
              maxLength={2000} value={entry.actionText}
              onChange={(event) => updateAction(index, { actionText: event.target.value })} /></label>
            <label><span>負責人</span><select required value={entry.responsibleUserId}
              onChange={(event) => updateAction(index, { responsibleUserId: event.target.value })}>
              {snapshot.staffOptions.map((staff) => <option key={staff.userId}
                value={staff.userId}>{staff.displayName}</option>)}</select></label>
            <label><span>期限狀態</span><select value={entry.deadlineState}
              onChange={(event) => updateAction(index, {
                deadlineState: event.target.value as CaseConferenceDeadlineState,
                dueDate: event.target.value === "dated" ? entry.dueDate : null,
              })}><option value="dated">指定日期</option><option value="missing">缺值</option>
                <option value="not_applicable">不適用</option></select></label>
            {entry.deadlineState === "dated" ? <label><span>人工期限</span><input required
              type="date" value={entry.dueDate ?? ""}
              onChange={(event) => updateAction(index, { dueDate: event.target.value })} /></label> : null}
            <label><span>行動狀態</span><select value={entry.actionStatus}
              onChange={(event) => updateAction(index, {
                actionStatus: event.target.value as ActionDraft["actionStatus"],
              })}><option value="open">待辦</option><option value="completed">完成</option>
                <option value="cancelled">取消</option></select></label>
            <button className="button button--ghost" type="button" disabled={actions.length <= 1}
              onClick={() => removeAction(index)}>移除此行動</button>
          </fieldset>)}
        </section>
        <button className="button" type="submit" disabled={attendees.length === 0 || actions.length === 0}>
          {state.pending ? "送出中…" : submitLabel}
        </button>
      </fieldset>
      {!canAct ? <p className={styles.muted}>目前唯讀或尚未完成此操作所需的近期 AAL2。</p> : null}
      <Message state={state} />
    </form>
  </details>;
}

function SignForm({ item, snapshot }: { item: CaseConferenceItem; snapshot: CaseConferenceSnapshot }) {
  const state = useMutation(snapshot);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void state.submit({
      action: "sign", meetingKey: item.meetingKey, previousVersionId: item.versionId,
      expectedVersion: item.version, correctsVersionId: null, clientId: null,
      meetingStartsAt: null, meetingEndsAt: null, problemStatement: null,
      decisionSummary: null, attendees: null, actionItems: null, correctionReason: null,
    });
  };
  return <form className={styles.signForm} onSubmit={submit}>
    <button className="button button--secondary" type="submit"
      disabled={!snapshot.canSign || state.pending || state.completed || !state.online}>
      {state.pending ? "簽署中…" : "簽署目前草稿"}
    </button>
    {!snapshot.canSign ? <p className={styles.muted}>簽署需權限及同一工作階段最近 15 分鐘 AAL2。</p> : null}
    <Message state={state} />
  </form>;
}

export function CaseConferenceCreateForm({ snapshot }: { snapshot: CaseConferenceSnapshot }) {
  return <ConferenceEditor action="create" item={null} snapshot={snapshot} />;
}

export function CaseConferenceActions({ item, snapshot }: {
  item: CaseConferenceItem;
  snapshot: CaseConferenceSnapshot;
}) {
  if (snapshot.demo) return null;
  return <div className={styles.actions}>
    {item.status === "draft" ? <>
      <ConferenceEditor action="revise" item={item} snapshot={snapshot} />
      <SignForm item={item} snapshot={snapshot} />
    </> : <ConferenceEditor action="correct" item={item} snapshot={snapshot} />}
  </div>;
}
