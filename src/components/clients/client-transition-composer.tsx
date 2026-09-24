"use client";

import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { History, Plus, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";
import {
  allowedClientTransitionKinds,
  isTerminalClientTransition,
  taipeiDate,
} from "@/lib/clients/lifecycle-rules";
import {
  parseClientTransitionError,
  parseClientTransitionSuccess,
  type ClientTransitionExpected,
} from "@/lib/clients/transition-client";
import type {
  ClientLifecycleClient,
  ClientTransitionKind,
} from "@/lib/clients/types";

const eventLabels: Record<ClientTransitionKind, string> = {
  admit: "收案",
  suspend: "暫停服務",
  resume: "恢復服務",
  transfer: "轉出",
  close: "結案",
  death: "死亡結案",
};

export function ClientTransitionComposer({
  clients,
  canManage,
  hasRecentAal2,
  canRoutineAdmit = false,
  demo,
  lockedClientId = null,
}: {
  clients: readonly ClientLifecycleClient[];
  canManage: boolean;
  hasRecentAal2: boolean;
  canRoutineAdmit?: boolean;
  demo: boolean;
  lockedClientId?: string | null;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const operation = useRef<{ key: string; body: string; expected: ClientTransitionExpected } | null>(null);
  const inFlight = useRef(false);
  const uncertain = useRef(false);
  const operationLease = useRef<(() => void) | null>(null);
  const viewLease = useRef<(() => void) | null>(null);
  const alive = useRef(true);
  const [refreshPending, startRefresh] = useTransition();
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const eligibleClients = useMemo(
    () => clients.filter((client) => (!lockedClientId || client.id === lockedClientId) && allowedClientTransitionKinds(client).some((kind) => hasRecentAal2 || (canRoutineAdmit && kind === "admit"))),
    [clients, lockedClientId, hasRecentAal2, canRoutineAdmit],
  );
  const initialClient = eligibleClients[0] ?? null;
  const [clientId, setClientId] = useState(initialClient?.id ?? "");
  const selectedClient =
    eligibleClients.find((client) => client.id === clientId) ?? null;
  const allowedKinds = selectedClient
    ? allowedClientTransitionKinds(selectedClient).filter((kind) => hasRecentAal2 || (canRoutineAdmit && kind === "admit"))
    : [];
  const [eventKind, setEventKind] = useState<ClientTransitionKind>(
    allowedKinds[0] ?? "admit",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [retryRequired, setRetryRequired] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [completed, setCompleted] = useState(false);
  const locked = pending || retryRequired;

  useEffect(() => {
    if (!refreshPending && viewLease.current) { viewLease.current(); viewLease.current = null; }
  }, [refreshPending, refreshEpoch]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; viewLease.current?.(); viewLease.current = null; };
  }, []);

  function releaseOperation() {
    operationLease.current?.();
    operationLease.current = null;
  }

  function reloadLatest() {
    const release = tryAcquireViewTransition();
    if (!release) { setError("另有儲存或畫面更新尚未確認，請先完成後再讀取最新狀態。"); setNotice("另有作業待確認，請先完成後再讀取最新狀態。"); return; }
    viewLease.current = release;
    try { window.location.reload(); } catch { release(); viewLease.current = null; }
  }

  useEffect(() => {
    if (!locked) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [locked]);

  const enabled =
    !demo && canManage && (hasRecentAal2 || canRoutineAdmit) && eligibleClients.length > 0 && !completed;

  function open(event: MouseEvent<HTMLButtonElement>) {
    if (!enabled || inFlight.current || uncertain.current) return;
    trigger.current = event.currentTarget;
    const client = eligibleClients[0] ?? null;
    setClientId(client?.id ?? "");
    setEventKind(client ? allowedClientTransitionKinds(client)[0] ?? "admit" : "admit");
    operation.current = null;
    setConflict(false);
    setError(null);
    setNotice(null);
    setNeedsReauth(false);
    dialog.current?.showModal();
  }

  function close() {
    if (inFlight.current || uncertain.current) return;
    dialog.current?.close();
  }

  function changed() {
    if (error && !uncertain.current && !inFlight.current && !conflict) {
      operation.current = null;
      setError(null);
      setNeedsReauth(false);
    }
  }

  function keepDialogFocus(event: ReactKeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      "button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])",
    )).filter((element) =>
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true" &&
      !element.closest("[hidden]"),
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || demo || !canManage || (!enabled && !uncertain.current) || conflict || (!selectedClient && !operation.current)) return;
    if (!operationLease.current) {
      const release = tryAcquirePendingOperation();
      if (!release) { setError("畫面正在更新或切換分支，請稍候再送出；尚未建立異動。"); return; }
      operationLease.current = release;
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    setNeedsReauth(false);
    const form = event.currentTarget;
    try {
      if (!operation.current && selectedClient) {
        const data = new FormData(form);
        const effectiveOn = String(data.get("effective_on") ?? "");
        operation.current = {
        key: crypto.randomUUID(),
        body: JSON.stringify({
          client_id: selectedClient.id, event_kind: eventKind, effective_on: effectiveOn,
          reason: String(data.get("reason") ?? ""),
          handoff_note: isTerminalClientTransition(eventKind) ? String(data.get("handoff_note") ?? "") : null,
          expected_row_version: selectedClient.rowVersion,
        }),
        expected: { clientId: selectedClient.id, eventKind, effectiveOn, fromStatus: selectedClient.status, baseRowVersion: selectedClient.rowVersion },
        };
      }
    } catch {
      releaseOperation(); inFlight.current = false; setPending(false);
      setError("無法建立本次異動，尚未送出。請核對輸入後再試。"); return;
    }
    const submitted = operation.current!;
    try {
      const response = await fetchWithTimeout("/api/clients/transitions", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": submitted.key,
        },
        body: submitted.body,
      });
      const raw = await response.json().catch(() => null);
      if (!response.ok) {
        const firstError = parseClientTransitionError(raw);
        if (alive.current && firstError?.code === "AAL2_REQUIRED") setNeedsReauth(true);
        // A rejection after a lost reply cannot prove the original did not commit.
        if (response.status >= 400 && response.status < 500 && firstError && !uncertain.current) {
          operation.current = null;
          releaseOperation();
          if (alive.current) { setConflict(response.status === 409); setError(firstError.message); }
          return;
        }
        throw new Error(firstError?.message || "SAVE_FAILED");
      }
      const envelope = parseClientTransitionSuccess(raw, response.status, submitted.expected);

      uncertain.current = false;
      operation.current = null;
      releaseOperation();
      // A late receipt may confirm a detached form. Release its write lease,
      // but never acquire a view lease or refresh a different current page.
      if (!alive.current) return;
      setRetryRequired(false);
      setCompleted(true);
      form.reset();
      dialog.current?.close();
      setNotice(
        envelope.data.replayed
          ? "已確認先前相同異動，不會建立重複歷程。"
          : `${eventLabels[submitted.expected.eventKind]}已寫入歷程；請核對重新載入的服務狀態再接續操作。`,
      );
      const releaseView = tryAcquireViewTransition();
      if (releaseView) {
        viewLease.current = releaseView;
        setRefreshEpoch((value) => value + 1);
        startRefresh(() => {
          try { router.refresh(); } catch {
            releaseView(); viewLease.current = null;
            setNotice("異動已確認完成，但最新畫面尚未讀回；請讀取最新服務狀態，不要再次建立異動。");
          }
        });
      } else {
        setNotice("異動已確認完成；另有作業待確認，請完成後讀取最新服務狀態，不要再次建立異動。");
      }
    } catch (caught) {
      uncertain.current = true;
      if (!alive.current) return;
      setRetryRequired(true);
      setError(
        caught instanceof Error && caught.message !== "SAVE_FAILED"
          ? caught.message
          : "異動未確認完成。畫面內容仍保留，請直接重試；系統會沿用同一冪等鍵避免重複。",
      );
    } finally {
      inFlight.current = false;
      if (alive.current) setPending(false);
    }
  }

  const disabledReason = demo
    ? "展示模式只提供合成唯讀歷程"
    : !canManage
      ? "目前角色只有 clients.read，沒有 clients.manage"
      : !hasRecentAal2 && !canRoutineAdmit
        ? "請先完成最近 15 分鐘內的雙因素重新驗證"
        : eligibleClients.length === 0
          ? "目前沒有可執行合法異動的個案"
          : completed ? "本次異動已確認，請先核對更新後的服務狀態" : undefined;

  return (
    <div className="core-composer">
      <button
        className="button button--primary"
        disabled={!enabled}
        onClick={open}
        ref={trigger}
        title={disabledReason}
        type="button"
      >
        <Plus aria-hidden="true" />建立個案異動
      </button>
      {!demo && canManage && !hasRecentAal2 && (!canRoutineAdmit || clients.some((client) =>
        (!lockedClientId || client.id === lockedClientId) && allowedClientTransitionKinds(client).some((kind) => kind !== "admit"))) ? (
        <Link className="reauth-link" href="/mfa?audience=staff&purpose=sensitive-action">
          <ShieldCheck aria-hidden="true" />{canRoutineAdmit ? "其他異動：完成近期雙因素驗證" : "完成近期雙因素驗證"}
        </Link>
      ) : null}
      {notice ? <p className="core-composer__notice" role="status">{notice}</p> : null}
      {completed ? <button type="button" className="button button--secondary" onClick={reloadLatest}>讀取最新服務狀態</button> : null}
      <dialog
        aria-labelledby="client-transition-dialog-title"
        className="core-dialog"
        onCancel={(event) => {
          if (inFlight.current || uncertain.current) event.preventDefault();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        onClose={() => trigger.current?.focus()}
        onKeyDown={keepDialogFocus}
        ref={dialog}
      >
        <form className="core-dialog__surface" onChange={changed} onSubmit={submit}>
          <header className="drawer__header">
            <div>
              <p className="eyebrow">不可變生命週期</p>
              <h2 id="client-transition-dialog-title">建立個案異動</h2>
              <p>送出後不可修改或刪除；錯誤需以後續更正事件處理。</p>
            </div>
            <button aria-label="關閉" className="icon-button" disabled={locked} onClick={close} type="button"><X aria-hidden="true" /></button>
          </header>
          <div className="drawer__body core-dialog__body">
            <fieldset className="core-dialog__fieldset" disabled={locked || conflict}>
            <div className="callout core-care-callout"><History aria-hidden="true" /><span>正式收案會核對已核准 Google 帳號與個案管理權限；其他異動另需近期雙因素驗證。伺服器鎖定個案後再次核對目前狀態與資料版本。</span></div>
            <label className="field">
              <span>個案 *</span>
              <select
                name="client_id"
                disabled={Boolean(lockedClientId)}
                onChange={(event) => {
                  const nextClient = eligibleClients.find((client) => client.id === event.target.value);
                  setClientId(event.target.value);
                  setEventKind(nextClient ? allowedClientTransitionKinds(nextClient)[0] ?? "admit" : "admit");
                }}
                required
                value={selectedClient?.id ?? ""}
              >
                {eligibleClients.map((client) => <option key={client.id} value={client.id}>{client.displayName}（{client.clientCode}・v{client.rowVersion}）</option>)}
              </select>
            </label>
            <label className="field">
              <span>異動類型 *</span>
              <select
                name="event_kind"
                onChange={(event) => setEventKind(event.target.value as ClientTransitionKind)}
                required
                value={eventKind}
              >
                {allowedKinds.map((kind) => <option key={kind} value={kind}>{eventLabels[kind]}</option>)}
              </select>
              <small className="field-hint">只列出目前狀態可進行的異動；資料庫仍會在交易時重新驗證。</small>
            </label>
            <label className="field"><span>生效日期 *</span><input defaultValue={taipeiDate()} max={taipeiDate()} name="effective_on" required type="date" /></label>
            <label className="field"><span>異動理由 *</span><textarea maxLength={1000} name="reason" placeholder="填寫可供後續稽核理解的具體原因。" required /></label>
            {isTerminalClientTransition(eventKind) ? (
              <label className="field"><span>交接內容 *</span><textarea maxLength={2000} name="handoff_note" placeholder="記錄文件、承接單位、聯絡窗口與後續安排。" required /></label>
            ) : null}
            </fieldset>
            {error ? (
              <div>
                <p className="form-error" role="alert">{error}</p>
                {retryRequired ? <p role="status">結果尚未確認。個案、內容及版本已鎖定；請使用「重試確認原異動」，不要另建一筆。若仍失敗，請聯絡主管協助核對。</p> : null}
                {conflict ? <button type="button" className="button button--secondary" onClick={reloadLatest}>重新讀取狀態（清除未送出的輸入）</button> : null}
                {needsReauth ? <Link className="reauth-link reauth-link--inline" href="/mfa?audience=staff&purpose=sensitive-action" target="_blank" rel="noopener noreferrer"><ShieldCheck aria-hidden="true" />在新分頁重新驗證後回來重試</Link> : null}
              </div>
            ) : null}
          </div>
          <footer className="drawer__footer"><button className="button button--secondary" disabled={locked} onClick={close} type="button">取消</button><button className="button button--primary" disabled={pending || conflict || completed} type="submit">{pending ? "建立中…" : retryRequired ? "重試確認原異動" : `確認${eventLabels[eventKind]}`}</button></footer>
        </form>
      </dialog>
    </div>
  );
}
