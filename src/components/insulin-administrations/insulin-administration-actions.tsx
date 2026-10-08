"use client";

import {
  createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore,
  type FormEvent, type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { INSULIN_INJECTION_SITES } from "@/lib/insulin-administrations/site-catalog";
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

type Attempt = {
  key: string;
  body: string;
  input: InsulinMutationInput;
};

type MutationView = {
  pending: boolean;
  uncertain: boolean;
  stale: boolean;
  message: string | null;
  success: boolean;
};

type MutationStore = {
  attempt: Attempt | null;
  inFlight: boolean;
  confirmed: boolean;
  view: MutationView;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => MutationView;
  update: (changes: Partial<MutationView>) => void;
};

// The desktop row and mobile card are both mounted for one slot. A page-scoped
// provider shares their attempt without retaining clinical data after unmount.
const MutationStoresContext = createContext<Map<string, MutationStore> | null>(null);

export function InsulinMutationProvider({ children }: { children: ReactNode }) {
  const [stores] = useState(() => new Map<string, MutationStore>());
  return <MutationStoresContext.Provider value={stores}>{children}</MutationStoresContext.Provider>;
}

function mutationStore(stores: Map<string, MutationStore>, snapshot: InsulinAdministrationSnapshot,
  item: InsulinAdministrationItem) {
  const slot = `${snapshot.organizationId}:${snapshot.branchId}:${item.medicationPlanId}` +
    `:${item.scheduledFor}:${item.state}`;
  let store = stores.get(slot);
  if (!store) {
    const listeners = new Set<() => void>();
    store = {
      attempt: null,
      inFlight: false,
      confirmed: false,
      view: { pending: false, uncertain: false, stale: false, message: null, success: false },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
      getSnapshot: () => store!.view,
      update: (changes) => {
        store!.view = { ...store!.view, ...changes };
        listeners.forEach((listener) => listener());
      },
    };
    stores.set(slot, store);
  }
  return store;
}

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

function useInsulinMutation(snapshot: InsulinAdministrationSnapshot, item: InsulinAdministrationItem) {
  const router = useRouter();
  const stores = useContext(MutationStoresContext);
  if (!stores) throw new Error("Insulin actions require a shared mutation provider");
  const store = mutationStore(stores, snapshot, item);
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [online, setOnline] = useState(true);
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
  useEffect(() => {
    if (!view.pending && !view.uncertain) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [view.pending, view.uncertain]);

  const sendAttempt = async (attempt: Attempt) => {
    if (store.inFlight || store.confirmed) return;
    store.inFlight = true;
    store.update({ pending: true, success: false, message: null });
    let successfulResponse = false;
    try {
      const response = await fetchWithTimeout("/api/insulin-administrations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": attempt.key,
          "x-insulin-operation": attempt.input.action,
        },
        body: attempt.body,
      });
      successfulResponse = response.ok;
      const raw: unknown = await response.json();
      if (!response.ok) {
        const error = parseInsulinApiError(raw)?.errors[0];
        // The operation lookup precedes the version and slot checks in the
        // database transaction. A correlated replay would have returned a
        // success receipt; these conflicts mean this attempt did not write.
        if (response.status === 409 && [
          "INSULIN_VERSION_CONFLICT", "INSULIN_IDEMPOTENCY_OR_SLOT_CONFLICT",
          "INSULIN_PLAN_OR_RULE_CONFLICT",
        ].includes(error?.code ?? "")) {
          store.attempt = null;
          store.update({ uncertain: false, stale: true,
            message: "正式紀錄或用藥計畫已變更，本次未寫入。請重新載入並核對後再操作。" });
          return;
        }
        // A strict 400 validation error is known to precede the database mutation.
        // Other errors can be returned after an unknown write result, so keep the exact attempt.
        if (!store.view.uncertain && response.status === 400 &&
            ["INVALID_INSULIN_ADMINISTRATION", "INVALID_INSULIN_OPERATION"]
              .includes(error?.code ?? "")) {
          store.attempt = null;
          store.update({ message: error?.message ?? "內容未通過驗證，請修正後再送出。" });
          return;
        }
        store.update({ uncertain: true,
          message: `${error?.message ?? "操作結果尚未確認。"}請以同一操作重試，勿另建紀錄。` });
        return;
      }
      parseInsulinApiSuccess(
        raw, attempt.input, snapshot.organizationId, snapshot.branchId, response.status,
      );
      store.attempt = null;
      store.confirmed = true;
      store.update({ uncertain: false, success: true,
        message: "已新增不可變事件，正在重新取得伺服器快照。" });
      try {
        router.refresh();
      } catch {
        // A display refresh failure cannot revoke an already verified receipt.
        store.update({ message: "已取得正式紀錄，但畫面更新失敗；請稍後重新載入。" });
      }
    } catch (error) {
      store.update({ uncertain: true, message: successfulResponse
        ? "伺服器回覆未通過核對，結果未知；請以同一操作重試，勿改動內容。"
        : isClientFetchTimeoutError(error)
          ? "連線逾時，結果未知；請以同一操作重試，勿改動內容。"
          : "連線或回覆中斷，結果未知；請以同一操作重試，勿改動內容。" });
    } finally {
      store.inFlight = false;
      store.update({ pending: false });
    }
  };
  const submit = (draft: Draft) => {
    if (store.inFlight || store.view.uncertain || store.view.stale || store.confirmed ||
        !navigator.onLine) return;
    const key = crypto.randomUUID();
    const attempt = {
      key,
      body: JSON.stringify(draft),
      input: attachIdempotencyKey(draft, key),
    };
    store.attempt = attempt;
    void sendAttempt(attempt);
  };
  const retry = () => {
    if (!store.view.uncertain || !store.attempt || !navigator.onLine) return;
    void sendAttempt(store.attempt);
  };
  return { online, ...view, submit, retry };
}

function Result({ state }: { state: ReturnType<typeof useInsulinMutation> }) {
  return <>
    {!state.online ? <p className={styles.warning} role="status">
      目前離線；本頁不保存草稿，重新連線前不會送出。
    </p> : null}
    {state.message ? <p className={state.success ? styles.success : styles.warning}
      role="status">{state.message}</p> : null}
    {state.uncertain ? <button className="button button--secondary" type="button"
      disabled={!state.online || state.pending} onClick={state.retry}>
      {state.pending ? "核對中…" : "同一操作重試"}
    </button> : null}
    {state.stale ? <button className="button button--secondary" type="button"
      onClick={() => window.location.reload()}>重新載入正式紀錄</button> : null}
  </>;
}

export function InsulinAdministrationActions({ item, snapshot }: {
  item: InsulinAdministrationItem;
  snapshot: InsulinAdministrationSnapshot;
}) {
  const state = useInsulinMutation(snapshot, item);
  const [lateReasonError, setLateReasonError] = useState("");
  const lateReasonErrorId = useId();
  const lateReasonRef = useRef<HTMLTextAreaElement>(null);
  if (snapshot.demo) return <span className={styles.readOnly}>合成唯讀，不送出</span>;
  if (item.state === "completed") return <span className={styles.readOnly}>雙人覆核完成</span>;

  if (item.state === "pending_review") {
    if (!snapshot.canReview || !item.administrationKey || !item.eventId) {
      return <span className={styles.readOnly}>需另一位具有效資格的人員覆核</span>;
    }
    return <div className={styles.actionBox}>
      <button className="button button--secondary" disabled={!state.online || state.pending ||
        state.uncertain || state.stale || state.success}
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
      const lateReason = String(data.get("lateReason") ?? "").trim();
      if (lateReason.length < 2 || lateReason.length > 1000) {
        setLateReasonError("請填寫 2 至 1000 字的補登授權理由。");
        lateReasonRef.current?.focus();
        return;
      }
      setLateReasonError("");
      void state.submit({
        action: "authorize_late", medicationPlanId: item.medicationPlanId,
        scheduledFor: item.scheduledFor, lateReason,
      });
    };
    return <form className={styles.actionBox} noValidate onSubmit={authorize}>
      <label><span>補登授權理由</span><textarea name="lateReason" minLength={2}
        maxLength={1000} required disabled={state.uncertain || state.stale || state.success || state.pending}
        aria-describedby={lateReasonError ? lateReasonErrorId : undefined}
        aria-invalid={lateReasonError ? true : undefined}
        onChange={() => setLateReasonError("")} ref={lateReasonRef} /></label>
      {lateReasonError ? <p className={styles.warning} id={lateReasonErrorId}
        role="alert">{lateReasonError}</p> : null}
      <button className="button button--secondary" disabled={!state.online || state.pending ||
        state.uncertain || state.stale || state.success}
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
    const site = INSULIN_INJECTION_SITES.find((option) => option.code === data.get("siteCode"));
    if (!site) return;
    void state.submit({
      action: "execute",
      administrationKey: lateChain ? item.administrationKey : null,
      previousEventId: lateChain ? item.eventId : null,
      expectedSequence: lateChain ? 1 : 0,
      medicationPlanId: item.medicationPlanId,
      scheduledFor: item.scheduledFor,
      doseText: item.orderedDoseText,
      doseUnit: item.doseUnit,
      siteCode: site.code,
      siteText: site.label,
    });
  };
  return <details className={styles.actionBox}>
    <summary>{item.state === "late_authorized" ? "依授權補登施打" : "記錄施打"}</summary>
    <form onSubmit={execute}>
      <p>計畫劑量：<strong>{item.orderedDoseText} {item.doseUnit}</strong>（不可由本頁改寫）</p>
      <label><span>施打部位</span><select name="siteCode" defaultValue="ABDOMEN_LEFT"
        disabled={state.uncertain || state.stale || state.success || state.pending}>
        {INSULIN_INJECTION_SITES.map((site) => <option key={site.code} value={site.code}>
          {site.label}
        </option>)}
      </select></label>
      <button className="button button--secondary" disabled={!state.online || state.pending ||
        state.uncertain || state.stale || state.success}
        type="submit">{state.pending ? "送出中…" : "簽署施打並送覆核"}</button>
      <Result state={state} />
    </form>
  </details>;
}
