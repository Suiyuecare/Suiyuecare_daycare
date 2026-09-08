"use client";

import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { History, Plus, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { fetchWithTimeout } from "@/lib/api/client-fetch";
import {
  allowedClientTransitionKinds,
  isTerminalClientTransition,
  taipeiDate,
} from "@/lib/clients/lifecycle-rules";
import {
  parseClientTransitionError,
  parseClientTransitionSuccess,
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
  demo,
}: {
  clients: readonly ClientLifecycleClient[];
  canManage: boolean;
  hasRecentAal2: boolean;
  demo: boolean;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const eligibleClients = useMemo(
    () => clients.filter((client) => allowedClientTransitionKinds(client).length > 0),
    [clients],
  );
  const initialClient = eligibleClients[0] ?? null;
  const [clientId, setClientId] = useState(initialClient?.id ?? "");
  const selectedClient =
    eligibleClients.find((client) => client.id === clientId) ?? initialClient;
  const allowedKinds = selectedClient
    ? allowedClientTransitionKinds(selectedClient)
    : [];
  const [eventKind, setEventKind] = useState<ClientTransitionKind>(
    allowedKinds[0] ?? "admit",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);

  const enabled =
    !demo && canManage && hasRecentAal2 && eligibleClients.length > 0;

  function open(event: MouseEvent<HTMLButtonElement>) {
    trigger.current = event.currentTarget;
    const client = eligibleClients[0] ?? null;
    setClientId(client?.id ?? "");
    setEventKind(client ? allowedClientTransitionKinds(client)[0] ?? "admit" : "admit");
    idempotencyKey.current = crypto.randomUUID();
    setError(null);
    setNotice(null);
    setNeedsReauth(false);
    dialog.current?.showModal();
  }

  function close() {
    if (pending) return;
    dialog.current?.close();
  }

  function changed() {
    if (error) {
      idempotencyKey.current = crypto.randomUUID();
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
    if (!selectedClient) return;
    setPending(true);
    setError(null);
    setNeedsReauth(false);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await fetchWithTimeout("/api/clients/transitions", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify({
          client_id: selectedClient.id,
          event_kind: eventKind,
          effective_on: String(data.get("effective_on") ?? ""),
          reason: String(data.get("reason") ?? ""),
          handoff_note: isTerminalClientTransition(eventKind)
            ? String(data.get("handoff_note") ?? "")
            : null,
          expected_row_version: selectedClient.rowVersion,
        }),
      });
      const raw = await response.json().catch(() => null);
      if (!response.ok) {
        const firstError = parseClientTransitionError(raw);
        if (firstError?.code === "AAL2_REQUIRED") setNeedsReauth(true);
        throw new Error(firstError?.message || "SAVE_FAILED");
      }
      const envelope = parseClientTransitionSuccess(raw, response.status, {
        clientId: selectedClient.id,
        eventKind,
        effectiveOn: String(data.get("effective_on") ?? ""),
        fromStatus: selectedClient.status,
        baseRowVersion: selectedClient.rowVersion,
      });

      form.reset();
      close();
      setNotice(
        envelope.data.replayed
          ? "已確認先前相同異動，不會建立重複歷程。"
          : `${eventLabels[eventKind]}已寫入不可變歷程，個案狀態與版本已同步更新。`,
      );
      idempotencyKey.current = crypto.randomUUID();
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message !== "SAVE_FAILED"
          ? caught.message
          : "異動未確認完成。畫面內容仍保留，請直接重試；系統會沿用同一冪等鍵避免重複。",
      );
    } finally {
      setPending(false);
    }
  }

  const disabledReason = demo
    ? "展示模式只提供合成唯讀歷程"
    : !canManage
      ? "目前角色只有 clients.read，沒有 clients.manage"
      : !hasRecentAal2
        ? "請先完成最近 15 分鐘內的雙因素重新驗證"
        : eligibleClients.length === 0
          ? "目前沒有可執行合法異動的個案"
          : undefined;

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
      {!demo && canManage && !hasRecentAal2 ? (
        <Link className="reauth-link" href="/mfa?audience=staff">
          <ShieldCheck aria-hidden="true" />完成近期雙因素驗證
        </Link>
      ) : null}
      {notice ? <p className="core-composer__notice" role="status">{notice}</p> : null}
      <dialog
        aria-labelledby="client-transition-dialog-title"
        className="core-dialog"
        onCancel={(event) => {
          if (pending) event.preventDefault();
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
            <button aria-label="關閉" className="icon-button" disabled={pending} onClick={close} type="button"><X aria-hidden="true" /></button>
          </header>
          <div className="drawer__body core-dialog__body">
            <fieldset className="core-dialog__fieldset" disabled={pending}>
            <div className="callout core-care-callout"><History aria-hidden="true" /><span>伺服器會再次鎖定個案，核對 clients.manage、近期 AAL2、目前狀態與資料版本；畫面選項不是授權依據。</span></div>
            <label className="field">
              <span>個案 *</span>
              <select
                name="client_id"
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
            {error ? (
              <div>
                <p className="form-error" role="alert">{error}</p>
                {needsReauth ? <Link className="reauth-link reauth-link--inline" href="/mfa?audience=staff"><ShieldCheck aria-hidden="true" />重新完成雙因素驗證</Link> : null}
              </div>
            ) : null}
            </fieldset>
          </div>
          <footer className="drawer__footer"><button className="button button--secondary" disabled={pending} onClick={close} type="button">取消</button><button className="button button--primary" disabled={pending} type="submit">{pending ? "建立中…" : `確認${eventLabels[eventKind]}`}</button></footer>
        </form>
      </dialog>
    </div>
  );
}
