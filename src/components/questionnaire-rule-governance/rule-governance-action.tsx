"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { GovernanceDialog } from "@/components/ui/governance-dialog";
import { tryAcquirePendingOperation } from "@/lib/navigation/pending-operation-lock";
import { RuleGovernanceClientError, writeRuleGovernance, type RuleGovernanceScope } from "@/lib/questionnaire-assessments/rule-governance-client";
import { parseRuleReviewReceipt, ruleReviewInputSchema, type RuleReviewInput } from "@/lib/questionnaire-assessments/rule-review-contract";
import { parseRuleRetirementReceipt, ruleRetirementInputSchema, type RuleRetirementInput } from "@/lib/questionnaire-assessments/rule-retirement-shared";

export interface RuleGovernanceActionProps {
  scope: RuleGovernanceScope;
  kind: "review" | "retirement";
  input: RuleReviewInput | RuleRetirementInput;
  label: string;
  summary: string;
  enabled: boolean;
  disabledReason?: string;
  onCompleted: () => Promise<void>;
  onLockChange?: (locked: boolean) => void;
}

type Confirmation = Pick<RuleGovernanceActionProps, "scope" | "kind" | "input" | "label" | "summary">;
type Attempt = { confirmation: Confirmation; operationId: string; uncertain: boolean; saved: boolean };
type Phase = "confirm" | "sending" | "uncertain" | "stop-confirm" | "reading" | "saved-stale";
type NavigationEntry = { index: number; key: string };
type BrowserNavigation = EventTarget & { currentEntry?: NavigationEntry | null };
type TraversalEvent = Event & { navigationType?: string; destination?: { key?: string } };

const UNKNOWN = "尚未確認是否已保存。請以原操作重試，勿另建相同申請。";
const SAVED_STALE = "已保存，但清單尚未更新。請重新載入清單，不要再次送出。";
const SCOPE_CHANGED = "帳號或分支已變更；請保留本頁，由原帳號與分支回查操作結果。";
const NAVIGATION_WARNING = "仍有未確認或尚未完成回查的操作。請留在本視窗，以原操作重試或完成回查後再離開。";
const DENIALS: Record<Exclude<RuleGovernanceClientError["kind"], "unconfirmed">, string> = {
  auth: "請先登入後再操作。",
  forbidden: "目前帳號無法處理此分支的規則審核。",
  reauth: "請完成身分驗證後，再確認送出。",
  conflict: "待審內容已變更，請回查清單後重新確認。",
  invalid: "請檢查日期、理由與待審內容，再確認送出。",
};

function scopeIdentity(scope: RuleGovernanceScope): string {
  return [scope.organizationId, scope.branchId, scope.userId].map((value) => value.toLowerCase()).join(":");
}

function browserNavigation(): BrowserNavigation | undefined {
  return (window as unknown as { navigation?: BrowserNavigation }).navigation;
}

function usableEntry(entry: NavigationEntry | null | undefined): entry is NavigationEntry {
  return !!entry && Number.isSafeInteger(entry.index) && entry.index >= 0 && typeof entry.key === "string" && entry.key.length > 0;
}

export function RuleGovernanceAction(props: RuleGovernanceActionProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const confirmationSurface = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const busy = useRef(false);
  const attempt = useRef<Attempt | null>(null);
  const lease = useRef<(() => void) | null>(null);
  const currentScope = useRef(scopeIdentity(props.scope));
  const completed = useRef(props.onCompleted);
  const lockChanged = useRef(props.onLockChange);
  const identity = scopeIdentity(props.scope);

  useLayoutEffect(() => {
    currentScope.current = identity;
    completed.current = props.onCompleted;
    lockChanged.current = props.onLockChange;
  }, [identity, props.onCompleted, props.onLockChange]);

  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [phase, setPhase] = useState<Phase>("confirm");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [lastEnabled, setLastEnabled] = useState(props.enabled);
  const [traversalAvailable, setTraversalAvailable] = useState(false);
  const [navigationNotice, setNavigationNotice] = useState("");
  const disabledDescription = useId();

  // A fresh authorization check is also a fresh acknowledgement boundary.
  // Conditional prop-derived state avoids an effect showing an outdated check.
  if (lastEnabled !== props.enabled) {
    setLastEnabled(props.enabled);
    setAcknowledged(false);
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // A lost response must retain the tab-local lease, even if this view is
      // unmounted. No request bodies or keys are persisted across page unload.
      if (!attempt.current) lease.current?.();
    };
  }, []);

  useEffect(() => {
    if (!confirmation) return;
    const navigation = browserNavigation();
    const original = navigation?.currentEntry;
    const originalScope = scopeIdentity(confirmation.scope);
    let restoring = false;
    let focusFrame: number | null = null;
    function restoreDialogFocus() {
      if (focusFrame !== null) window.cancelAnimationFrame(focusFrame);
      focusFrame = window.requestAnimationFrame(() => {
        focusFrame = null;
        if (!mounted.current || !attempt.current || currentScope.current !== originalScope) return;
        const dialog = confirmationSurface.current?.closest<HTMLDialogElement>("dialog");
        if (!dialog?.open || !dialog.isConnected) return;
        const active = document.activeElement;
        // Preserve ordinary input/button focus. A cancelled native traversal
        // may leave BODY focused while the modal is still in the top layer.
        if (active instanceof HTMLElement && dialog.contains(active) && !active.matches(":disabled")) return;
        const titleId = dialog.getAttribute("aria-labelledby")?.split(/\s+/u)[0];
        const title = titleId ? document.getElementById(titleId) : null;
        if (title instanceof HTMLElement && dialog.contains(title)) title.focus();
      });
    }
    function warn() { if (mounted.current) setNavigationNotice(NAVIGATION_WARNING); }
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!attempt.current) return;
      // This is the narrow browser-owned hard-unload warning exception, not a
      // product confirm(). Browsers show their own generic warning text.
      event.preventDefault();
      event.returnValue = " ";
    }
    function navigate(event: Event) {
      const traversal = event as TraversalEvent;
      if (!attempt.current || traversal.navigationType !== "traverse") return;
      if (restoring && usableEntry(original) && traversal.destination?.key === original.key) return;
      if (event.cancelable) {
        // Current browsers decide when a traversal is cancellable. Never
        // assume repeated browser Back presses can always be prevented.
        event.preventDefault();
        event.stopImmediatePropagation();
        warn();
        restoreDialogFocus();
      }
    }
    function popState(event: PopStateEvent) {
      if (!attempt.current) return;
      const destination = navigation?.currentEntry;
      // History API alone supplies no reliable traversal direction. Without
      // native entry indices, retain beforeunload only; never guess Back,
      // overwrite an entry or truncate the user's Forward history.
      if (!usableEntry(original) || !usableEntry(destination)) { warn(); return; }
      event.stopImmediatePropagation();
      warn();
      if (destination.key === original.key) { restoring = false; restoreDialogFocus(); return; }
      if (restoring) return;
      const delta = original.index - destination.index;
      if (delta === 0) return;
      restoring = true;
      try { window.history.go(delta); }
      catch { restoring = false; }
    }
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("popstate", popState, true);
    navigation?.addEventListener("navigate", navigate);
    return () => {
      if (focusFrame !== null) window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("popstate", popState, true);
      navigation?.removeEventListener("navigate", navigate);
    };
  }, [confirmation]);

  function current(value: Confirmation): boolean {
    return mounted.current && currentScope.current === scopeIdentity(value.scope);
  }

  function release(value: Confirmation) {
    lease.current?.();
    lease.current = null;
    // The parent can remain mounted when its refreshed list removes this
    // action. Clear that same-scope UI lock without updating this child's UI.
    if (currentScope.current === scopeIdentity(value.scope)) lockChanged.current?.(false);
  }

  function open() {
    if (!props.enabled || busy.current || attempt.current) return;
    try {
      // Parse into a detached, strict object before confirmation. Prop edits
      // cannot change what the user confirmed or any subsequent exact retry.
      const input = props.kind === "review" ? ruleReviewInputSchema.parse(props.input)
        : ruleRetirementInputSchema.parse(props.input);
      setConfirmation({ scope: { ...props.scope }, kind: props.kind, input, label: props.label, summary: props.summary });
      setPhase("confirm");
      setMessage("");
      setNotice("");
      setAcknowledged(false);
      setTraversalAvailable(usableEntry(browserNavigation()?.currentEntry));
      setNavigationNotice("");
    } catch { setNotice("待審內容無效，請重新載入清單後再操作。"); }
  }

  function close() {
    if (busy.current || attempt.current) return;
    setConfirmation(null);
    setMessage("");
  }

  async function refresh(value: Confirmation, stopping: boolean) {
    if (busy.current || !current(value)) return;
    busy.current = true;
    setPhase("reading");
    setMessage(stopping ? "正在回查清單；原操作可能已保存。" : "已保存，正在更新清單…");
    try {
      // The parent must resolve only after a validated authoritative read, not
      // after merely scheduling a router refresh or swallowing a read failure.
      await completed.current();
      // A successful read may legitimately remove this action from the list.
      // Release its lease without announcing success on an unmounted view.
      if (currentScope.current !== scopeIdentity(value.scope)) return;
      attempt.current = null;
      release(value);
      if (!current(value)) return;
      setConfirmation(null);
      setNotice(stopping ? "已回查清單。原操作可能已保存；請核對歷程後再決定下一步。" : "已保存，清單已更新。");
      setMessage("");
    } catch {
      if (!current(value)) return;
      setPhase(stopping ? "uncertain" : "saved-stale");
      setMessage(stopping ? "回查未完成，原操作結果仍未確認。請保留原操作再試。" : SAVED_STALE);
    } finally { busy.current = false; }
  }

  async function send() {
    if (!confirmation || busy.current || !current(confirmation) || attempt.current?.saved || (!attempt.current && !acknowledged)) return;
    if (!attempt.current && !props.enabled) {
      setAcknowledged(false);
      setMessage("目前無法送出，請重新確認權限與身分驗證。");
      return;
    }
    busy.current = true;
    let pending = attempt.current;
    if (!pending) {
      const acquired = tryAcquirePendingOperation();
      if (!acquired) {
        busy.current = false;
        setMessage("畫面正在更新或切換分支，請稍候再操作。");
        return;
      }
      lease.current = acquired;
      try {
        pending = { confirmation, operationId: crypto.randomUUID(), uncertain: false, saved: false };
        attempt.current = pending;
      } catch {
        release(confirmation);
        busy.current = false;
        setMessage("無法建立安全操作識別，請重新載入後再試。");
        return;
      }
      lockChanged.current?.(true);
    }
    setPhase("sending");
    setMessage("正在送出，請稍候…");
    try {
      const value = pending.confirmation;
      const receipt = await writeRuleGovernance(value.scope, value.kind, value.input, pending.operationId);
      // Validate here as well so no false receipt can be treated as success,
      // even if an adapter is replaced or mocked incorrectly in the future.
      if (value.kind === "review") parseRuleReviewReceipt(receipt, value.scope, value.input as RuleReviewInput, pending.operationId);
      else parseRuleRetirementReceipt(receipt, value.scope, value.input as RuleRetirementInput, pending.operationId);
      attempt.current = { ...pending, saved: true };
      if (!current(value)) return;
      busy.current = false;
      await refresh(value, false);
    } catch (error) {
      const knownDenial = error instanceof RuleGovernanceClientError && error.kind !== "unconfirmed";
      if (!pending.uncertain && knownDenial) {
        attempt.current = null;
        release(pending.confirmation);
        if (current(pending.confirmation)) {
          setPhase("confirm");
          setMessage(DENIALS[error.kind as keyof typeof DENIALS]);
          setAcknowledged(false);
        }
      } else {
        attempt.current = { ...pending, uncertain: true };
        if (current(pending.confirmation)) {
          setPhase("uncertain");
          setMessage(UNKNOWN);
        }
      }
    } finally { busy.current = false; }
  }

  const scopeChanged = confirmation !== null && identity !== scopeIdentity(confirmation.scope);
  const protectedDialog = phase !== "confirm";
  const doingWork = phase === "sending" || phase === "reading";

  return (
    <>
      <button ref={trigger} type="button" className="button button--secondary" disabled={!props.enabled || confirmation !== null}
        aria-describedby={!props.enabled && props.disabledReason ? disabledDescription : undefined} onClick={open}>
        {props.label}
      </button>
      {!props.enabled && props.disabledReason ? <p id={disabledDescription}>{props.disabledReason}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <GovernanceDialog open={confirmation !== null} title={confirmation?.label ?? props.label}
        busy={protectedDialog || doingWork} onRequestClose={close} returnFocusRef={trigger}>
        {confirmation ? <div ref={confirmationSurface} className="core-dialog__body" aria-busy={doingWork}>
          <p>{confirmation.summary}</p>
          {scopeChanged ? <p className="form-error" role="alert">{SCOPE_CHANGED}</p> : null}
          {!props.enabled && phase === "confirm" ? <p className="form-error" role="alert">目前無法送出，請重新確認權限與身分驗證。</p> : null}
          {message ? <p className="form-error" role={doingWork ? "status" : "alert"}>{message}</p> : null}
          {navigationNotice ? <p role="status">{navigationNotice}</p> : null}
          {!traversalAvailable && protectedDialog ? <p>此瀏覽器無法完整保護返回／前進歷程。請勿返回、關閉或重新整理；先完成原操作重試或回查。</p> : null}
          {phase === "confirm" ? <label className="qrg-acknowledgement"><input type="checkbox" checked={acknowledged} disabled={scopeChanged || !props.enabled}
            onChange={(event) => setAcknowledged(event.target.checked)} />我已核對此分支、版本與申請內容</label> : null}
          {phase === "stop-confirm" ? <>
            <p>停止重試不表示操作失敗。原操作可能已保存；必須先成功回查清單，才能解除操作鎖定。</p>
            <button type="button" className="button button--secondary" disabled={scopeChanged}
              onClick={() => { setPhase("uncertain"); setMessage(UNKNOWN); }}>返回原操作重試</button>
            <button type="button" className="button button--primary" disabled={scopeChanged} onClick={() => void refresh(confirmation, true)}>確認停止重試並回查</button>
          </> : phase === "uncertain" ? <>
            <button type="button" className="button button--primary" disabled={scopeChanged} onClick={() => void send()}>以原操作重試</button>
            <button type="button" className="button button--secondary" disabled={scopeChanged}
              onClick={() => { if (!busy.current) { setPhase("stop-confirm"); setMessage(""); } }}>停止重試並回查</button>
          </> : phase === "saved-stale" ? <button type="button" className="button button--primary" disabled={scopeChanged}
            onClick={() => void refresh(confirmation, false)}>重新載入清單</button>
            : <button type="button" className="button button--primary" disabled={doingWork || scopeChanged || !acknowledged || (phase === "confirm" && !props.enabled)} onClick={() => void send()}>
              {doingWork ? "處理中…" : "確認送出"}
            </button>}
        </div> : null}
      </GovernanceDialog>
    </>
  );
}
