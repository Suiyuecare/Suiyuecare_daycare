"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parseReferralManagementApiError,
  parseReferralManagementApiSuccess,
} from "@/lib/referral-management/parser";
import type {
  ReferralClientOption,
  ReferralManagementItem,
  ReferralManagementMutationInput,
  ReferralManagementSnapshot,
  ReferralReceivingUnitState,
} from "@/lib/referral-management/types";

import styles from "./referral-management.module.css";

type MutationDraft = Omit<ReferralManagementMutationInput, "idempotencyKey">;

function toIso(value: FormDataEntryValue | null) {
  return new Date(`${String(value)}:00+08:00`).toISOString();
}

function requestBody(input: MutationDraft) {
  if (input.action === "create") return {
    action: input.action,
    clientId: input.clientId,
    receivingUnitState: input.receivingUnitState,
    receivingUnitCode: input.receivingUnitCode,
    receivingUnitName: input.receivingUnitName,
    referralDate: input.referralDate,
    referralReason: input.referralReason,
  };
  const chain = {
    action: input.action,
    referralKey: input.referralKey,
    previousEventId: input.previousEventId,
    expectedSequence: input.expectedSequence,
  };
  if (input.action === "correct") return {
    ...chain,
    correctsEventId: input.correctsEventId,
    entryContent: input.entryContent,
    correctionReason: input.correctionReason,
  };
  return input.entryContent === null ? chain : { ...chain, entryContent: input.entryContent };
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
  const submit = async (input: MutationDraft) => {
    const canonical = JSON.stringify(input);
    if (attemptedRef.current !== null && attemptedRef.current !== canonical) {
      keyRef.current = crypto.randomUUID();
    }
    attemptedRef.current = canonical;
    const full = { ...input, idempotencyKey: keyRef.current } satisfies ReferralManagementMutationInput;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetchWithTimeout("/api/referrals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": keyRef.current,
        },
        body: JSON.stringify(requestBody(input)),
      });
      const raw: unknown = await response.json();
      if (!response.ok) {
        setMessage(parseReferralManagementApiError(raw)?.errors[0]?.message ??
          "儲存未完成；請保留內容並用相同操作鍵重試。");
        return;
      }
      parseReferralManagementApiSuccess(
        raw, full, organizationId, branchId, response.status,
      );
      setCompleted(true);
      setMessage("已新增不可變轉介事件與站內 queued 證據，正在重新取得快照。");
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
    {!state.online ? <p className={styles.warning} role="status">目前離線；正式轉介不保存在裝置，請重新連線後送出。</p> : null}
    {state.message ? <p className={state.completed ? styles.success : styles.warning}
      role="status">{state.message}</p> : null}
  </>;
}

export function ReferralCreateForm({
  branchId, canCreate, clients, organizationId, referenceTime,
}: {
  branchId: string;
  canCreate: boolean;
  clients: readonly ReferralClientOption[];
  organizationId: string;
  referenceTime: string;
}) {
  const state = useMutation(organizationId, branchId);
  const [unitState, setUnitState] = useState<ReferralReceivingUnitState>("manual_unstandardized");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const manual = unitState === "manual_unstandardized";
    void state.submit({
      action: "create",
      referralKey: null,
      previousEventId: null,
      expectedSequence: null,
      clientId: String(data.get("clientId")),
      receivingUnitState: unitState,
      receivingUnitCode: manual ? String(data.get("receivingUnitCode")) : null,
      receivingUnitName: manual ? String(data.get("receivingUnitName")) : null,
      referralDate: toIso(data.get("referralDate")),
      referralReason: String(data.get("referralReason")),
      entryContent: null,
      correctionReason: null,
      correctsEventId: null,
    });
  };
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(referenceTime)).replace(", ", "T");
  return <details className={styles.editor}>
    <summary>建立轉介草稿</summary>
    <form onSubmit={submit} onInput={state.dirty}>
      <fieldset disabled={!canCreate || state.pending || state.completed || !state.online}>
        <div className={styles.formGrid}>
          <label><span>個案</span><select required name="clientId"><option value="">請選擇</option>
            {clients.map((option) => <option key={option.clientId}
              value={option.clientId}>{option.displayName} · {option.clientCode}</option>)}</select></label>
          <label><span>接收單位狀態</span><select required name="receivingUnitState"
            value={unitState} onChange={(event) => setUnitState(event.target.value as ReferralReceivingUnitState)}>
            <option value="manual_unstandardized">人工輸入（未標準化）</option>
            <option value="missing">缺值（待補）</option>
            <option value="not_applicable">不適用</option>
          </select></label>
          {unitState === "manual_unstandardized" ? <>
            <label><span>人工接收單位代碼</span><input required name="receivingUnitCode"
              maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,39}"
              placeholder="例如 DEMO-CLINIC" /></label>
            <label><span>人工接收單位名稱</span><input required name="receivingUnitName"
              maxLength={160} placeholder="例如 復健診所" /></label>
          </> : null}
          <label><span>轉介日期（台北）</span><input required type="datetime-local"
            name="referralDate" defaultValue={local} /></label>
          <label className={styles.wide}><span>轉介原因</span><textarea required
            minLength={2} maxLength={2000} name="referralReason" /></label>
        </div>
        <button className="button" type="submit">{state.pending ? "送出中…" : "建立不可變草稿"}</button>
      </fieldset>
      {!canCreate ? <p className={styles.muted}>目前唯讀；建立需要指定個案權限及最近 15 分鐘 AAL2。</p> : null}
      <StatusMessage state={state} />
    </form>
  </details>;
}

function base(item: ReferralManagementItem) {
  return {
    referralKey: item.referralKey,
    previousEventId: item.eventId,
    expectedSequence: item.sequence,
    clientId: null,
    receivingUnitState: null,
    receivingUnitCode: null,
    receivingUnitName: null,
    referralDate: null,
    referralReason: null,
    correctionReason: null,
    correctsEventId: null,
  } as const;
}

const nextAction = {
  draft: "submit",
  submitted: "register_received",
  received: "respond",
  responded: "close",
  closed: null,
} as const;
const actionLabel = {
  submit: "送出院內版本",
  register_received: "人工登記收件",
  respond: "登記回覆",
  close: "結案",
} as const;

export function ReferralTransitionForm({ item, snapshot }: {
  item: ReferralManagementItem;
  snapshot: ReferralManagementSnapshot;
}) {
  const state = useMutation(snapshot.organizationId, snapshot.branchId);
  const action = nextAction[item.status];
  if (action === null) return null;
  const canAct = action === "submit" ? snapshot.canSubmit
    : action === "register_received" ? snapshot.canRegisterReceipt
      : action === "respond" ? snapshot.canRespond : snapshot.canClose;
  const unitReady = action !== "submit" || item.receivingUnitState === "manual_unstandardized";
  const contentRequired = action !== "submit";
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const content = String(data.get("entryContent") ?? "").trim();
    void state.submit({
      ...base(item),
      action,
      entryContent: content || null,
    });
  };
  return <details className={styles.actionEditor}>
    <summary>{actionLabel[action]}</summary>
    <form onSubmit={submit} onInput={state.dirty}>
      <fieldset disabled={!canAct || !unitReady || state.pending || state.completed || !state.online}>
        <label><span>{action === "submit" ? "送出備註（選填）" : `${actionLabel[action]}內容`}</span>
          <textarea required={contentRequired} minLength={contentRequired ? 2 : undefined}
            maxLength={4000} name="entryContent" /></label>
        <button className="button button--secondary" type="submit">
          {state.pending ? "送出中…" : `建立${actionLabel[action]}事件`}
        </button>
      </fieldset>
      {action === "submit" ? <p className={styles.muted}>送出只凍結院內版本，不代表外部送達；接收單位缺值或不適用時不能送出。</p> : null}
      <StatusMessage state={state} />
    </form>
  </details>;
}

export function ReferralCorrectionForm({ item, snapshot }: {
  item: ReferralManagementItem;
  snapshot: ReferralManagementSnapshot;
}) {
  const state = useMutation(snapshot.organizationId, snapshot.branchId);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void state.submit({
      ...base(item),
      action: "correct",
      correctsEventId: String(data.get("correctsEventId")),
      entryContent: String(data.get("entryContent")),
      correctionReason: String(data.get("correctionReason")),
    });
  };
  return <details className={styles.actionEditor}>
    <summary>狹義更正</summary>
    <form onSubmit={submit} onInput={state.dirty}>
      <fieldset disabled={!snapshot.canCorrect || state.pending || state.completed || !state.online}>
        <label><span>更正哪一事件</span><select required name="correctsEventId" defaultValue="">
          <option value="">請選擇</option>
          {item.history.filter((entry) => entry.eventKind !== "corrected").map((entry) =>
            <option key={entry.eventId} value={entry.eventId}>#{entry.sequence} · {entry.eventKind}</option>)}
        </select></label>
        <label><span>更正後內容</span><textarea required minLength={2}
          maxLength={4000} name="entryContent" /></label>
        <label><span>更正理由</span><textarea required minLength={2}
          maxLength={500} name="correctionReason" /></label>
        <button className="button button--secondary" type="submit">
          {state.pending ? "送出中…" : "建立更正事件"}
        </button>
      </fieldset>
      <p className={styles.muted}>原事件與目前狀態不會被修改；更正需要近期 AAL2。</p>
      <StatusMessage state={state} />
    </form>
  </details>;
}
