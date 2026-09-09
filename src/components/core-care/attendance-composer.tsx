"use client";

import { FormEvent, MouseEvent, useMemo, useRef, useState } from "react";
import { ClipboardCheck, ShieldCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { parseAttendanceSuccess } from "@/lib/core-care/attendance-client";
import type { AttendanceEventKind } from "@/lib/core-care/attendance-constants";
import { useCoreDraftGuard } from "./client-continuation";

type ClientOption = {
  id: string;
  name: string;
  code: string;
  attendance: {
    status: "present" | "absent" | "leave" | "cancelled";
    checkedOutAt: string | null;
  } | null;
};

const eventLabels: Record<AttendanceEventKind, string> = {
  check_in: "簽到",
  check_out: "簽退",
  absent: "未到",
  leave: "請假",
};

function allowedEvents(client: ClientOption): readonly AttendanceEventKind[] {
  if (!client.attendance || client.attendance.status === "cancelled") {
    return ["check_in", "absent", "leave"];
  }
  if (
    client.attendance.status === "present" &&
    !client.attendance.checkedOutAt
  ) {
    return ["check_out"];
  }
  return [];
}

function defaultTaipeiLocal(serviceDate: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
  return `${serviceDate}T${parts.hour}:${parts.minute}`;
}

function taipeiLocalToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) {
    throw new Error("日期時間格式錯誤。");
  }
  const parsed = new Date(`${value}:00+08:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error("日期時間格式錯誤。");
  return parsed.toISOString();
}

function isBackfillCandidate(value: string) {
  try {
    return Date.now() - new Date(taipeiLocalToIso(value)).getTime() > 15 * 60 * 1_000;
  } catch {
    return false;
  }
}

async function responseError(response: Response) {
  try {
    const body = (await response.json()) as {
      errors?: Array<{ message?: unknown }>;
    };
    const message = body.errors?.[0]?.message;
    if (typeof message === "string" && message.trim()) return message;
  } catch {
    // A network intermediary may return a non-JSON response. Keep the safe
    // fallback below and never expose raw response content.
  }
  return "出勤尚未確認儲存。請保留內容直接重試，系統會辨識同一次送出。";
}

export function AttendanceComposer({
  clients,
  serviceDate,
  enabled,
  demo,
  selectedClientId,
}: {
  clients: readonly ClientOption[];
  serviceDate: string;
  enabled: boolean;
  demo: boolean;
  selectedClientId?: string;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const draft = useCoreDraftGuard();
  const eligibleClients = useMemo(
    () => clients.filter((client) => allowedEvents(client).length > 0),
    [clients],
  );
  const [clientId, setClientId] = useState(selectedClientId ?? "");
  const selectedClient =
    eligibleClients.find((client) => client.id === clientId);
  const unavailableSelection = selectedClientId !== undefined && !eligibleClients.some((client) => client.id === selectedClientId);
  const effectiveClientId = selectedClient?.id ?? "";
  const availableEvents = selectedClient ? allowedEvents(selectedClient) : [];
  const [eventKind, setEventKind] = useState<AttendanceEventKind>(
    availableEvents[0] ?? "check_in",
  );
  const effectiveEventKind = availableEvents.includes(eventKind)
    ? eventKind
    : availableEvents[0] ?? "check_in";
  const [occurredAt, setOccurredAt] = useState(
    defaultTaipeiLocal(serviceDate),
  );
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isBackfill = isBackfillCandidate(occurredAt);

  function resetForOpen() {
    const firstClient = eligibleClients.find((client) => client.id === selectedClientId);
    const firstEvent = firstClient ? allowedEvents(firstClient)[0] : undefined;
    setClientId(firstClient?.id ?? "");
    setEventKind(firstEvent ?? "check_in");
    setOccurredAt(defaultTaipeiLocal(serviceDate));
    setReason("");
    idempotencyKey.current = crypto.randomUUID();
    setError(null);
    setNotice(null);
  }

  function open(event: MouseEvent<HTMLButtonElement>) {
    if (!enabled || unavailableSelection) return;
    trigger.current = event.currentTarget;
    resetForOpen();
    dialog.current?.showModal();
  }

  function close() {
    if (!draft.discard()) return;
    dialog.current?.close();
  }

  function changed() {
    draft.changed();
    if (error) {
      idempotencyKey.current = crypto.randomUUID();
      setError(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || unavailableSelection || !selectedClient || !availableEvents.length || !draft.begin()) return;
    setPending(true);
    setError(null);
    try {
      const normalizedOccurredAt = taipeiLocalToIso(occurredAt);
      const response = await fetchWithTimeout("/api/attendance", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify({
          client_id: effectiveClientId,
          event_kind: effectiveEventKind,
          occurred_at: normalizedOccurredAt,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const raw: unknown = await response.json().catch(() => null);
      parseAttendanceSuccess(raw, response.status, {
        clientId: effectiveClientId,
        eventKind: effectiveEventKind,
        occurredAt: normalizedOccurredAt,
      });

      draft.saved();
      dialog.current?.close();
      setNotice(
        demo
          ? `展示${eventLabels[effectiveEventKind]}已通過相同驗證；展示資料不會永久保存。`
          : `${selectedClient.name}${eventLabels[effectiveEventKind]}已儲存${isBackfill ? "並標記為補登" : ""}。可接續上方量測步驟。`,
      );
      idempotencyKey.current = crypto.randomUUID();
      if (!demo) router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error && submitError.message
          ? submitError.message
          : "出勤尚未確認儲存。請保留內容直接重試，系統會辨識同一次送出。",
      );
    } finally {
      draft.finish();
      setPending(false);
    }
  }

  return (
    <div className="core-composer">
      <button
        className="button button--primary"
        disabled={!enabled || eligibleClients.length === 0 || unavailableSelection}
        onClick={open}
        title={
          !enabled
            ? "目前角色沒有登錄出勤的權限"
            : unavailableSelection
              ? "指定個案目前沒有可執行的出勤動作，請確認紀錄或重新選擇個案"
            : eligibleClients.length === 0
              ? "本服務日沒有可執行的出勤動作"
              : undefined
        }
        type="button"
      >
        <ClipboardCheck aria-hidden="true" />登錄出勤
      </button>
      {unavailableSelection ? <p role="status">指定個案目前無可用出勤動作；不會自動改為其他個案。</p> : null}
      {notice ? (
        <p className="core-composer__notice" role="status">
          {notice}
        </p>
      ) : null}
      <dialog
        aria-labelledby="attendance-dialog-title"
        className="core-dialog"
        onCancel={(event) => { event.preventDefault(); close(); }}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        onClose={() => trigger.current?.focus()}
        ref={dialog}
      >
        <form className="core-dialog__surface" data-core-care-draft onSubmit={submit}>
          <header className="drawer__header">
            <div>
              <p className="eyebrow">第 1 步・出勤</p>
              <h2 id="attendance-dialog-title">簽到、簽退或登記未到</h2>
              <p>確認個案、簽到退動作與時間；服務日依臺北時間判定。</p>
            </div>
            <button
              aria-label="關閉"
              className="icon-button"
              onClick={close}
              disabled={pending}
              type="button"
            >
              <X aria-hidden="true" />
            </button>
          </header>
          <fieldset className="drawer__body core-dialog__body core-dialog__fields" disabled={pending}>
            <div className="callout core-care-callout">
              <ShieldCheck aria-hidden="true" />
              <span>
                超過伺服器時間 15 分鐘會自動視為補登，須具補登權限、最近 15 分鐘重新驗證並填寫理由。
              </span>
            </div>
            <label className="field">
              <span>個案 *</span>
              <select
                autoFocus
                onChange={(event) => {
                  changed();
                  const nextClient = eligibleClients.find(
                    (client) => client.id === event.target.value,
                  );
                  setClientId(event.target.value);
                  setEventKind(
                    nextClient ? allowedEvents(nextClient)[0] ?? "check_in" : "check_in",
                  );
                }}
                required
                value={effectiveClientId}
              >
                <option value="">請選擇個案</option>
                {eligibleClients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}（{client.code}）
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>出勤動作 *</span>
              <select
                onChange={(event) => {
                  changed();
                  setEventKind(event.target.value as AttendanceEventKind);
                }}
                required
                value={effectiveEventKind}
              >
                {availableEvents.map((kind) => (
                  <option key={kind} value={kind}>
                    {eventLabels[kind]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>事件日期與時間 *</span>
              <input
                onChange={(event) => {
                  changed();
                  setOccurredAt(event.target.value);
                }}
                required
                type="datetime-local"
                value={occurredAt}
              />
            </label>
            <label className="field">
              <span>補登理由{isBackfill ? " *" : "（超過 15 分鐘時必填）"}</span>
              <textarea
                aria-describedby="attendance-reason-hint"
                maxLength={1000}
                onChange={(event) => {
                  changed();
                  setReason(event.target.value);
                }}
                placeholder="例如：接送延遲，返回機構後依紙本時間補登。"
                required={isBackfill}
                value={reason}
              />
              <small id="attendance-reason-hint">
                {isBackfill
                  ? "目前時間已超過 15 分鐘；系統會以 staff_backfill 保存。"
                  : "一般即時登錄可留白；伺服器仍會重新判定。"}
              </small>
            </label>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
          </fieldset>
          <footer className="drawer__footer">
            <button
              className="button button--secondary"
              onClick={close}
              disabled={pending}
              type="button"
            >
              取消
            </button>
            <button
              className="button button--primary"
              disabled={pending || !effectiveClientId || availableEvents.length === 0}
              type="submit"
            >
              {pending ? "儲存中…" : `確認${eventLabels[effectiveEventKind]}`}
            </button>
          </footer>
        </form>
      </dialog>
    </div>
  );
}
