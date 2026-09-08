"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseInterprofessionalConsultationApiError,
  parseInterprofessionalConsultationApiSuccess,
} from "@/lib/interprofessional-consultations/parser";
import type {
  ConsultationClientOption,
  ConsultationPersonOption,
  InterprofessionalConsultationItem,
  InterprofessionalConsultationMutationInput,
} from "@/lib/interprofessional-consultations/types";

import styles from "./interprofessional-consultations.module.css";

function toIso(value: FormDataEntryValue | null) {
  return new Date(`${String(value)}:00+08:00`).toISOString();
}

function useMutation(organizationId: string, branchId: string) {
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
  const submit = async (input: Omit<InterprofessionalConsultationMutationInput, "idempotencyKey">) => {
    const canonical = JSON.stringify(input);
    if (attemptedRef.current !== null && attemptedRef.current !== canonical) {
      keyRef.current = crypto.randomUUID();
    }
    attemptedRef.current = canonical;
    const full = { ...input, idempotencyKey: keyRef.current } satisfies InterprofessionalConsultationMutationInput;
    setPending(true); setMessage(null);
    try {
      const response = await fetchWithTimeout("/api/interprofessional-consultations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": keyRef.current,
          "x-interprofessional-consultation-action": input.action,
        },
        body: JSON.stringify(Object.fromEntries(
          Object.entries(input).filter(([, value]) => value !== null),
        )),
      });
      const raw: unknown = await response.json();
      if (!response.ok) {
        setMessage(parseInterprofessionalConsultationApiError(raw)?.errors[0]?.message ??
          "儲存未完成；請保留內容並用相同操作鍵重試。");
        return;
      }
      parseInterprofessionalConsultationApiSuccess(
        raw, full, organizationId, branchId, response.status,
      );
      setCompleted(true);
      setMessage("已新增不可變事件與站內通知佇列證據，正在重新取得快照。");
      router.refresh();
    } catch (error) {
      setMessage(isClientFetchTimeoutError(error)
        ? "連線逾時，完成狀態未知；請保留內容並直接重試，相同內容會沿用原操作鍵。"
        : "網路中斷，完成狀態未知；請保留內容並直接重試，相同內容會沿用原操作鍵。");
    } finally {
      setPending(false);
    }
  };
  return { online, pending, completed, message, dirty, submit };
}

function StatusMessage({ state }: { state: ReturnType<typeof useMutation> }) {
  return <>
    {!state.online ? <p className={styles.warning} role="status">目前離線；正式照會不保存在裝置，請重新連線後送出。</p> : null}
    {state.message ? <p className={state.completed ? styles.success : styles.warning} role="status">{state.message}</p> : null}
  </>;
}

export function ConsultationCreateForm({
  branchId, canCreate, clients, organizationId, referenceTime, staff,
}: {
  branchId: string;
  canCreate: boolean;
  clients: readonly ConsultationClientOption[];
  organizationId: string;
  referenceTime: string;
  staff: readonly ConsultationPersonOption[];
}) {
  const state = useMutation(organizationId, branchId);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const deadlineState = String(data.get("deadlineState")) as "dated" | "missing" | "not_applicable";
    const assignee = String(data.get("assigneeUserId"));
    void state.submit({
      action: "create", consultationKey: null, previousEventId: null,
      expectedSequence: null, clientId: String(data.get("clientId")),
      assigneeUserId: assignee || null,
      disciplineCode: String(data.get("disciplineCode")),
      disciplineLabel: String(data.get("disciplineLabel")),
      urgency: String(data.get("urgency")) as "routine" | "soon" | "urgent",
      requestedAt: toIso(data.get("requestedAt")), deadlineState,
      dueAt: deadlineState === "dated" ? toIso(data.get("dueAt")) : null,
      problemSummary: String(data.get("problemSummary")), entryContent: null,
      correctsEventId: null,
    });
  };
  const requested = new Date(referenceTime);
  const due = new Date(requested.getTime() + 2 * 86_400_000);
  const local = (value: Date) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(value).replace(", ", "T");
  return <details className={styles.editor}>
    <summary>提出跨專業照會</summary>
    <form onSubmit={submit} onInput={state.dirty}>
      <fieldset disabled={!canCreate || state.pending || state.completed || !state.online}>
        <div className={styles.formGrid}>
          <label><span>個案</span><select required name="clientId"><option value="">請選擇</option>
            {clients.map((option) => <option key={option.clientId} value={option.clientId}>{option.displayName} · {option.clientCode}</option>)}</select></label>
          <label><span>精確承辦人</span><select name="assigneeUserId"><option value="">待指派</option>
            {staff.map((option) => <option key={option.userId} value={option.userId}>{option.displayName}</option>)}</select></label>
          <label><span>人工專業代碼</span><input required name="disciplineCode" maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,39}" placeholder="例如 PT-MANUAL" /></label>
          <label><span>人工專業名稱</span><input required name="disciplineLabel" maxLength={100} placeholder="例如 物理治療" /></label>
          <label><span>人工急迫性</span><select required name="urgency" defaultValue="routine">
            <option value="routine">一般</option><option value="soon">儘速</option><option value="urgent">緊急</option></select></label>
          <label><span>提出時間（台北）</span><input required type="datetime-local" name="requestedAt" defaultValue={local(requested)} /></label>
          <label><span>期限狀態</span><select required name="deadlineState" defaultValue="dated">
            <option value="dated">有人工期限</option><option value="missing">缺值（待補）</option>
            <option value="not_applicable">不適用</option></select></label>
          <label><span>人工期限（台北）</span><input type="datetime-local" name="dueAt" defaultValue={local(due)} /></label>
          <label className={styles.wide}><span>問題摘要</span><textarea required minLength={2} maxLength={2000} name="problemSummary" /></label>
        </div>
        <button className="button" type="submit">{state.pending ? "送出中…" : "建立照會事件"}</button>
      </fieldset>
      {!canCreate ? <p className={styles.muted}>目前唯讀；建立照會需要目前分支權限、個案指派與最近 15 分鐘 AAL2。</p> : null}
      <StatusMessage state={state} />
    </form>
  </details>;
}

function base(item: InterprofessionalConsultationItem) {
  return {
    consultationKey: item.consultationKey, previousEventId: item.eventId,
    expectedSequence: item.sequence, clientId: null, disciplineCode: null,
    disciplineLabel: null, urgency: null, requestedAt: null,
    deadlineState: null, dueAt: null, problemSummary: null,
  } as const;
}

export function ConsultationAssignmentForm({
  branchId, canAssign, item, organizationId, staff,
}: {
  branchId: string;
  canAssign: boolean;
  item: InterprofessionalConsultationItem;
  organizationId: string;
  staff: readonly ConsultationPersonOption[];
}) {
  const state = useMutation(organizationId, branchId);
  const action = item.assignmentState === "unassigned" ? "assign" as const : "reassign" as const;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void state.submit({ ...base(item), action,
      assigneeUserId: String(data.get("assigneeUserId")),
      entryContent: action === "reassign" ? String(data.get("entryContent")) : null,
      correctsEventId: null,
    });
  };
  return <details className={styles.actionEditor}><summary>{action === "assign" ? "指派承辦" : "改派承辦"}</summary>
    <form onSubmit={submit} onInput={state.dirty}><fieldset disabled={!canAssign || state.pending || state.completed || !state.online}>
      <label><span>精確承辦人</span><select required name="assigneeUserId" defaultValue=""><option value="">請選擇</option>
        {staff.filter((option) => option.userId !== item.assigneeUserId).map((option) => <option key={option.userId} value={option.userId}>{option.displayName}</option>)}</select></label>
      {action === "reassign" ? <label><span>改派理由</span><textarea required minLength={2} maxLength={4000} name="entryContent" /></label> : null}
      <button className="button button--secondary" type="submit">{state.pending ? "送出中…" : action === "assign" ? "建立指派事件" : "建立改派事件"}</button>
    </fieldset><StatusMessage state={state} /></form>
  </details>;
}

export function ConsultationResponseForm({ branchId, canRespond, item, organizationId }: {
  branchId: string; canRespond: boolean; item: InterprofessionalConsultationItem;
  organizationId: string;
}) {
  const state = useMutation(organizationId, branchId);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void state.submit({ ...base(item),
      action: String(data.get("action")) as "reply" | "supplement",
      assigneeUserId: null, entryContent: String(data.get("entryContent")),
      correctsEventId: null,
    });
  };
  return <details className={styles.actionEditor}><summary>回覆／補充</summary>
    <form onSubmit={submit} onInput={state.dirty}><fieldset disabled={!canRespond || item.assignmentState === "unassigned" || item.status === "closed" || state.pending || state.completed || !state.online}>
      <label><span>事件類型</span><select name="action" defaultValue={item.status === "answered" ? "supplement" : "reply"}>
        <option value="reply">正式回覆</option><option value="supplement">補充內容</option></select></label>
      <label><span>內容</span><textarea required minLength={2} maxLength={4000} name="entryContent" /></label>
      <button className="button button--secondary" type="submit">{state.pending ? "送出中…" : "新增不可變事件"}</button>
    </fieldset><p className={styles.muted}>資料庫只接受目前精確承辦人回覆；其他人會被拒絕。</p><StatusMessage state={state} /></form>
  </details>;
}

export function ConsultationCloseForm({ branchId, canClose, item, organizationId }: {
  branchId: string; canClose: boolean; item: InterprofessionalConsultationItem;
  organizationId: string;
}) {
  const state = useMutation(organizationId, branchId);
  const action = item.status === "closed" ? "reopen" as const : "close" as const;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void state.submit({ ...base(item), action, assigneeUserId: null,
      entryContent: String(data.get("entryContent")), correctsEventId: null,
    });
  };
  return <details className={styles.actionEditor}><summary>{action === "close" ? "結案" : "重開"}</summary>
    <form onSubmit={submit} onInput={state.dirty}><fieldset disabled={!canClose || state.pending || state.completed || !state.online}>
      <label><span>{action === "close" ? "結案說明" : "重開理由"}</span><textarea required minLength={2} maxLength={4000} name="entryContent" /></label>
      <button className="button button--secondary" type="submit">{state.pending ? "送出中…" : action === "close" ? "建立結案事件" : "建立重開事件"}</button>
    </fieldset><StatusMessage state={state} /></form>
  </details>;
}

export function ConsultationCorrectionForm({ branchId, canRespond, item, organizationId }: {
  branchId: string; canRespond: boolean; item: InterprofessionalConsultationItem;
  organizationId: string;
}) {
  const state = useMutation(organizationId, branchId);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void state.submit({ ...base(item), action: "correct", assigneeUserId: null,
      entryContent: String(data.get("entryContent")),
      correctsEventId: String(data.get("correctsEventId")),
    });
  };
  return <details className={styles.actionEditor}><summary>狹義更正</summary>
    <form onSubmit={submit} onInput={state.dirty}><fieldset disabled={!canRespond || state.pending || state.completed || !state.online}>
      <label><span>更正哪一事件</span><select required name="correctsEventId" defaultValue=""><option value="">請選擇</option>
        {item.history.map((entry) => <option key={entry.eventId} value={entry.eventId}>#{entry.sequence} · {entry.eventKind}</option>)}</select></label>
      <label><span>更正內容與理由</span><textarea required minLength={2} maxLength={4000} name="entryContent" /></label>
      <button className="button button--secondary" type="submit">{state.pending ? "送出中…" : "建立更正事件"}</button>
    </fieldset><p className={styles.muted}>原事件與已完成內容不會被修改；更正需要近期 AAL2。</p><StatusMessage state={state} /></form>
  </details>;
}
