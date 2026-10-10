"use client";

import {
  createContext, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
  type FormEvent, type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import { useCoreDraftGuard } from "@/components/app/core-draft-guard";
import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { hasPendingOperations, tryAcquirePendingOperation, usePendingOperations } from "@/lib/navigation/pending-operation-lock";
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
  scope: string;
  slot: string;
  scheduledFor: string;
  attempt: Attempt | null;
  release: (() => void) | null;
  inFlight: boolean;
  confirmed: boolean;
  view: MutationView;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => MutationView;
  update: (changes: Partial<MutationView>) => void;
};

type MutationContext = {
  stores: Map<string, MutationStore>;
  scope: string;
  syncGuard: () => void;
};

// Only unresolved attempts retain their frozen request in tab memory. A Next
// route or GET filter may unmount the page; neither can create a new key for
// that slot when it returns. No clinical request is stored on disk.
const mutationStores = new Map<string, MutationStore>();
const pendingRefreshScopes = new Set<string>();
const registryListeners = new Set<() => void>();
// A boolean only: no client, medication, request body, idempotency key or actor
// is written to browser storage. It deliberately survives a hard reload so a
// lost in-memory request cannot silently become a new clinical operation.
const unresolvedMarker = "insulin-administration-unresolved-v1";
let registryRevision = 0;
function publishRegistry() {
  registryRevision += 1;
  for (const listener of registryListeners) listener();
}
function subscribeRegistry(listener: () => void) {
  registryListeners.add(listener);
  return () => { registryListeners.delete(listener); };
}
const registrySnapshot = () => registryRevision;
const registryServerSnapshot = () => 0;
const MutationStoresContext = createContext<MutationContext | null>(null);

function hasActiveInsulinAttempt() {
  return [...mutationStores.values()].some((store) => store.attempt !== null);
}

function hasLostInsulinAttempt() {
  if (typeof window === "undefined") return false;
  try { return window.sessionStorage.getItem(unresolvedMarker) === "1" && !hasActiveInsulinAttempt(); }
  catch { return true; }
}

function hasOtherScopeAttempt(scope: string, stores = mutationStores) {
  return [...stores.values()].some((store) => store.attempt !== null && store.scope !== scope);
}

function markInsulinAttemptUnresolved() {
  try { window.sessionStorage.setItem(unresolvedMarker, "1"); return true; }
  catch { return false; }
}

function clearInsulinMarkerIfSettled() {
  if (hasActiveInsulinAttempt()) return;
  try { window.sessionStorage.removeItem(unresolvedMarker); }
  catch { /* Keep the fail-closed warning if storage cannot be updated. */ }
  publishRegistry();
}

export function resetInsulinMutationStateForTests(preserveMarker = false) {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY");
  for (const store of mutationStores.values()) store.release?.();
  mutationStores.clear();
  pendingRefreshScopes.clear();
  if (!preserveMarker) {
    try { window.sessionStorage.removeItem(unresolvedMarker); } catch { /* Test may stub storage. */ }
  }
  publishRegistry();
}

export function insulinMutationStoreCountForTests() {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY");
  return mutationStores.size;
}

export function InsulinMutationProvider({ actorId, snapshot, children }: {
  actorId: string;
  snapshot: InsulinAdministrationSnapshot;
  children: ReactNode;
}) {
  const guard = useCoreDraftGuard();
  const scope = `${actorId}:${snapshot.organizationId}:${snapshot.branchId}`;
  // Initial SSR also renders Client Components. Server renders must never
  // retain actor/medication slot metadata in process-global memory.
  const stores = useMemo(() => typeof window === "undefined"
    ? new Map<string, MutationStore>() : mutationStores, []);
  const context: MutationContext = useMemo(() => ({
    stores,
    scope,
    syncGuard: () => {
      const active = [...stores.values()].filter((store) =>
        store.scope === scope && store.attempt !== null);
      if (active.length === 0) { guard.saved(); return; }
      if (active.some((store) => store.inFlight)) guard.begin();
      if (active.some((store) => store.view.uncertain)) guard.hold();
      if (!active.some((store) => store.inFlight)) guard.finish();
    },
  }), [guard, scope, stores]);
  useEffect(() => {
    context.syncGuard();
    return () => {
      // Keep unresolved attempts for SPA re-entry. Resolved keys and their
      // clinical slot identifiers need no tab-lifetime cache.
      for (const [key, store] of stores) {
        if (store.scope === scope && store.attempt === null) stores.delete(key);
      }
    };
  }, [context, scope, stores]);
  return <MutationStoresContext.Provider value={context}>{children}</MutationStoresContext.Provider>;
}

function mutationStore(context: MutationContext, item: InsulinAdministrationItem) {
  const slot = `${context.scope}:${item.medicationPlanId}:${item.scheduledFor}`;
  const key = `${slot}:${item.state}`;
  let store = [...context.stores.values()].find((candidate) =>
    candidate.slot === slot && candidate.attempt !== null) ?? context.stores.get(key);
  if (!store) {
    const listeners = new Set<() => void>();
    store = {
      scope: context.scope,
      slot,
      scheduledFor: item.scheduledFor,
      attempt: null,
      release: null,
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
        publishRegistry();
      },
    };
    context.stores.set(key, store);
  }
  return store;
}

function releaseKnownAttempt(store: MutationStore) {
  store.attempt = null;
  store.release?.();
  store.release = null;
  clearInsulinMarkerIfSettled();
  publishRegistry();
}

function markInFlight(store: MutationStore, inFlight: boolean) {
  store.inFlight = inFlight;
}

function registerAttempt(store: MutationStore, attempt: Attempt, release: () => void) {
  store.release = release;
  store.attempt = attempt;
  publishRegistry();
}

function markConfirmed(store: MutationStore) {
  store.confirmed = true;
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

function useInsulinMutationForStore(snapshot: InsulinAdministrationSnapshot, store: MutationStore) {
  const router = useRouter();
  const context = useContext(MutationStoresContext);
  if (!context) throw new Error("Insulin actions require a shared mutation provider");
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const locked = useSyncExternalStore(subscribeRegistry,
    () => hasLostInsulinAttempt() || hasOtherScopeAttempt(context.scope, context.stores), () => false);
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
  const releaseKnown = () => {
    releaseKnownAttempt(store);
    context.syncGuard();
  };
  const refreshIfAllSettled = () => {
    if (hasPendingOperations() || !pendingRefreshScopes.delete(context.scope)) return;
    try { router.refresh(); }
    catch { store.update({ message: "已確認本次未寫入，但畫面更新失敗；請重新載入正式紀錄。" }); }
  };
  const sendAttempt = async (attempt: Attempt, recovery: boolean) => {
    if (store.inFlight || store.confirmed) return;
    markInFlight(store, true);
    store.update({ pending: true, success: false, message: null });
    context.syncGuard();
    let successfulResponse = false;
    try {
      const response = await fetchWithTimeout("/api/insulin-administrations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": attempt.key,
          "x-insulin-operation": attempt.input.action,
          ...(recovery ? { "x-insulin-recovery": "exact" } : {}),
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
        if (!recovery && response.status === 409 && [
          "INSULIN_VERSION_CONFLICT", "INSULIN_IDEMPOTENCY_OR_SLOT_CONFLICT",
          "INSULIN_PLAN_OR_RULE_CONFLICT",
        ].includes(error?.code ?? "")) {
          releaseKnown();
          store.update({ uncertain: false, stale: true,
            message: "正式紀錄或用藥計畫已變更，本次未寫入。請重新載入並核對後再操作。" });
          refreshIfAllSettled();
          return;
        }
        // A strict 400 validation error is known to precede the database mutation.
        // Other errors can be returned after an unknown write result, so keep the exact attempt.
        if (!recovery && !store.view.uncertain && response.status === 400 &&
            ["INVALID_INSULIN_ADMINISTRATION", "INVALID_INSULIN_OPERATION"]
              .includes(error?.code ?? "")) {
          releaseKnown();
          store.update({ message: error?.message ?? "內容未通過驗證，請修正後再送出。" });
          refreshIfAllSettled();
          return;
        }
        store.update({ uncertain: true,
          message: `${error?.message ?? "操作結果尚未確認。"}請以同一操作重試，勿另建紀錄。` });
        return;
      }
      parseInsulinApiSuccess(
        raw, attempt.input, snapshot.organizationId, snapshot.branchId, response.status,
      );
      releaseKnown();
      markConfirmed(store);
      store.update({ uncertain: false, success: true,
        message: "已新增不可變事件，正在重新取得伺服器快照。" });
      try {
        if (!hasPendingOperations()) {
          pendingRefreshScopes.delete(context.scope);
          router.refresh();
        } else {
          pendingRefreshScopes.add(context.scope);
          store.update({ message: "已取得正式紀錄；另有操作待核對，完成後再更新畫面。" });
        }
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
      markInFlight(store, false);
      store.update({ pending: false });
      context.syncGuard();
    }
  };
  const submit = (draft: Draft) => {
    if (store.inFlight || store.attempt || store.view.uncertain || store.view.stale || store.confirmed ||
        !navigator.onLine) return;
    if (hasLostInsulinAttempt() || hasOtherScopeAttempt(context.scope, context.stores)) {
      store.update({ message: "先前施打操作尚未核對，不能建立新操作；請聯絡主管依正式紀錄與稽核紀錄確認。" });
      return;
    }
    const release = tryAcquirePendingOperation();
    if (!release) {
      store.update({ message: "畫面正在切換或更新，尚未建立本次操作。請稍候再試。" });
      return;
    }
    if (!markInsulinAttemptUnresolved()) {
      release();
      store.update({ message: "無法保留待核對狀態，尚未送出；請確認瀏覽器儲存設定。" });
      return;
    }
    let attempt: Attempt;
    try {
      const key = crypto.randomUUID();
      attempt = { key, body: JSON.stringify(draft), input: attachIdempotencyKey(draft, key) };
    } catch {
      release();
      clearInsulinMarkerIfSettled();
      store.update({ message: "無法建立本次操作，尚未送出。請重新核對內容。" });
      return;
    }
    registerAttempt(store, attempt, release);
    context.syncGuard();
    void sendAttempt(attempt, false);
  };
  const retry = () => {
    if (!store.view.uncertain || !store.attempt || store.inFlight || !navigator.onLine) return;
    void sendAttempt(store.attempt, true);
  };
  return { online, locked, ...view, submit, retry };
}

function useInsulinMutation(snapshot: InsulinAdministrationSnapshot, item: InsulinAdministrationItem) {
  const context = useContext(MutationStoresContext);
  if (!context) throw new Error("Insulin actions require a shared mutation provider");
  const store = mutationStore(context, item);
  return useInsulinMutationForStore(snapshot, store);
}

function HiddenSlotRecovery({ snapshot, store }: {
  snapshot: InsulinAdministrationSnapshot;
  store: MutationStore;
}) {
  const state = useInsulinMutationForStore(snapshot, store);
  return <li><strong>{new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit",
    minute: "2-digit", hourCycle: "h23",
  }).format(new Date(store.scheduledFor))}</strong>
    <span> 此時點的原操作仍待核對；目前篩選未顯示該筆時點。</span>
    <Result state={state} />
  </li>;
}

export function InsulinPendingRecovery({ snapshot }: { snapshot: InsulinAdministrationSnapshot }) {
  const context = useContext(MutationStoresContext);
  if (!context) throw new Error("Insulin recovery requires a shared mutation provider");
  useSyncExternalStore(subscribeRegistry, registrySnapshot, registryServerSnapshot);
  const lost = useSyncExternalStore(subscribeRegistry, hasLostInsulinAttempt, () => false);
  const otherScope = hasOtherScopeAttempt(context.scope, context.stores);
  const visible = new Set(snapshot.items.filter((item) => !snapshot.demo &&
    (item.state === "pending_review" ? Boolean(snapshot.canReview && item.administrationKey && item.eventId)
      : item.state === "completed" ? false
        : item.state === "scheduled" && item.isLate ? snapshot.canAuthorizeLate : snapshot.canExecute),
  ).map((item) => `${context.scope}:${item.medicationPlanId}:${item.scheduledFor}`));
  const hidden = [...context.stores.values()].filter((store) => store.scope === context.scope &&
    store.attempt !== null && !visible.has(store.slot));
  return <>
    {lost ? <section className={styles.warning} role="alert" aria-label="遺失原操作的待核對警示">
      <strong>先前施打結果仍待核對</strong>
      <p>重新載入後原操作無法安全重試。本頁暫停新增施打或覆核；請主管核對正式紀錄與稽核紀錄，勿依「查無回執」判定未寫入。</p>
    </section> : null}
    {otherScope ? <section className={styles.warning} role="alert">
      <strong>另一工作範圍有待核對操作</strong>
      <p>請回原使用者與分支完成核對；目前不能建立新施打操作。</p>
    </section> : null}
    {hidden.length ? <section className={styles.warning} aria-label="未顯示時點的待核對操作">
    <p>篩選或導頁後仍保留 {hidden.length} 筆原操作。請先核對回執；查無回執不代表未寫入。</p>
    <ol>{hidden.map((store) => <HiddenSlotRecovery key={store.slot} snapshot={snapshot}
      store={store} />)}</ol>
    </section> : null}
  </>;
}

function Result({ state }: { state: ReturnType<typeof useInsulinMutation> }) {
  const otherOperationPending = usePendingOperations();
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
      disabled={otherOperationPending}
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
      <button className="button button--secondary" disabled={!state.online || state.locked || state.pending ||
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
    return <form className={styles.actionBox} method="post" noValidate onSubmit={authorize}>
      <label><span>補登授權理由</span><textarea name="lateReason" minLength={2}
        maxLength={1000} required disabled={state.locked || state.uncertain || state.stale || state.success || state.pending}
        aria-describedby={lateReasonError ? lateReasonErrorId : undefined}
        aria-invalid={lateReasonError ? true : undefined}
        onChange={() => setLateReasonError("")} ref={lateReasonRef} /></label>
      {lateReasonError ? <p className={styles.warning} id={lateReasonErrorId}
        role="alert">{lateReasonError}</p> : null}
      <button className="button button--secondary" disabled={!state.online || state.locked || state.pending ||
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
    <form method="post" noValidate onSubmit={execute}>
      <p>計畫劑量：<strong>{item.orderedDoseText} {item.doseUnit}</strong>（不可由本頁改寫）</p>
      <label><span>施打部位</span><select name="siteCode" defaultValue="ABDOMEN_LEFT"
        disabled={state.locked || state.uncertain || state.stale || state.success || state.pending}>
        {INSULIN_INJECTION_SITES.map((site) => <option key={site.code} value={site.code}>
          {site.label}
        </option>)}
      </select></label>
      <button className="button button--secondary" disabled={!state.online || state.locked || state.pending ||
        state.uncertain || state.stale || state.success}
        type="submit">{state.pending ? "送出中…" : "簽署施打並送覆核"}</button>
      <Result state={state} />
    </form>
  </details>;
}
