"use client";

import { FormEvent, MouseEvent, useMemo, useRef, useState } from "react";
import { ClipboardCheck, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { withCareRequestDeadline } from "@/lib/core-care/request-deadline";
import { parseAttendanceSuccess } from "@/lib/core-care/attendance-client";
import type { AttendanceEventKind } from "@/lib/core-care/attendance-constants";
import { CoreDraftConfirmation, useCoreDraftGuard } from "./client-continuation";
import { GovernanceDialog } from "@/components/ui/governance-dialog";
import { OfflineCareFormNotice, useOfflineCareForm } from "./offline-care-form";
import { useCareWriteAttempt } from "./use-care-write-attempt";
import { useCareRequestOwner } from "./use-care-request-owner";
import { isDefiniteCareRejection } from "@/lib/core-care/write-attempt";
import { DailyFieldError, DailyValidationSummary, useDailyFormValidation } from "./daily-form-validation";
import styles from "./daily-composer.module.css";

type AttendanceRequest = { client_id: string; event_kind: AttendanceEventKind; occurred_at: string; reason?: string };

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
  const trigger = useRef<HTMLButtonElement>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const formRef = useRef<HTMLFormElement>(null);
  const validation = useDailyFormValidation();
  const [editorOpen, setEditorOpen] = useState(false);
  const attempt = useCareWriteAttempt<AttendanceRequest>();
  const attemptScope = useRef<string | null>(null);
  const privacyScope = JSON.stringify(["attendance", demo, serviceDate, selectedClientId ?? null]);
  const capabilities = JSON.stringify([enabled, clients.map((client) => [client.id, allowedEvents(client)]).sort()]);
  const draft = useCoreDraftGuard({
    scopeKey: privacyScope,
    revisionKey: capabilities,
    canPrompt: enabled,
    isBlocked: () => !!attempt.current(),
    onDiscard() { setEditorOpen(false); if (!attempt.current()) resetForOpen(); },
  });
  const offline = useOfflineCareForm({ kind: "attendance", serviceDate, enabled, demo,
    allowedClientIds: clients.map((client) => client.id), formRef, idempotencyKey, onRestoreId: (id) => { if (!attempt.current()) idempotencyKey.current = id; } });
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
  const requestOwner = useCareRequestOwner(JSON.stringify([privacyScope, capabilities]), () => {
    if (attempt.current()) attempt.failed();
    setPending(false); setEditorOpen(false); setError(null); setNotice(null); draft.finish();
  });
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
    validation.reset();
  }

  function open(event: MouseEvent<HTMLButtonElement>) {
    if (!enabled || unavailableSelection) return;
    trigger.current = event.currentTarget;
    if (attempt.current()) { setEditorOpen(true); return; }
    resetForOpen();
    setEditorOpen(true);
  }

  function close() {
    if (pending) return;
    if (attempt.current()) { setEditorOpen(false); setNotice("上一筆出勤結果尚未確認；重新開啟後只能重試原內容，不會建立新的一筆。"); return; }
    draft.requestExit(() => setEditorOpen(false));
  }

  function changed() {
    if (attempt.current()) return;
    draft.changed();
    if (error) {
      idempotencyKey.current = crypto.randomUUID();
      setError(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (validation.composing.current || pending) return;
    const prior = attempt.current();
    if (prior && attemptScope.current !== privacyScope) {
      setError("上一筆出勤尚未確認，請回到原個案與日期處理；未建立新的一筆。");
      return;
    }
    if (prior && !clients.some((client) => client.id === prior.body.client_id)) {
      setError("原出勤個案不在目前名單；請回到原個案確認上一筆結果，未改用其他個案。");
      return;
    }
    if (!prior && !validation.validate(event.currentTarget)) return;
    if (!enabled || (!prior && (unavailableSelection || !selectedClient || !availableEvents.length)) || !draft.begin()) return;
    setPending(true);
    setError(null);
    const request = requestOwner.begin();
    try {
      const normalizedOccurredAt = prior?.body.occurred_at ?? taipeiLocalToIso(occurredAt);
      const body = prior?.body ?? {
        client_id: effectiveClientId, event_kind: effectiveEventKind,
        occurred_at: normalizedOccurredAt, ...(reason.trim() ? { reason: reason.trim() } : {}),
      };
      if (!prior && !demo && !navigator.onLine && await offline.queueIfOffline(body)) {
        request.throwIfStale();
        draft.saved(); setEditorOpen(false);
        setNotice("出勤已保存在裝置等待送出；尚未確認儲存到系統。若已超過補登期限，會保留給您確認。");
        return;
      }
      request.throwIfStale();
      if (!prior) attemptScope.current = privacyScope;
      const frozen = attempt.prepare(body, idempotencyKey.current);
      const result = await withCareRequestDeadline(async (signal) => {
        const response = await fetchWithTimeout("/api/attendance", {
          method: "POST", cache: "no-store", signal,
          headers: { "Content-Type": "application/json", "Idempotency-Key": frozen.key },
          body: frozen.serialized,
        });
        signal.throwIfAborted();
        if (!response.ok) {
          const definite = await isDefiniteCareRejection(response);
          signal.throwIfAborted();
          const message = await responseError(response);
          signal.throwIfAborted();
          return { response, raw: null, definite, message };
        }
        const raw: unknown = await response.json().catch(() => null);
        signal.throwIfAborted();
        return { response, raw, definite: false, message: null };
      }, { signal: request.signal });
      request.throwIfStale();
      const { response, raw } = result;
      if (!response.ok) {
        if (result.definite) attempt.failed(response.status);
        throw new Error(result.message ?? "出勤尚未確認儲存，請重試原操作。");
      }
      parseAttendanceSuccess(raw, response.status, {
        clientId: frozen.body.client_id,
        eventKind: frozen.body.event_kind,
        occurredAt: frozen.body.occurred_at,
      });
      await offline.saved();
      request.throwIfStale();
      attempt.confirmed();
      attemptScope.current = null;

      draft.saved();
      setEditorOpen(false);
      setNotice(
        demo
          ? `展示${eventLabels[effectiveEventKind]}已通過相同驗證；展示資料不會永久保存。`
          : `${selectedClient?.name ?? "此個案"}${eventLabels[frozen.body.event_kind]}已儲存${isBackfill ? "並標記為補登" : ""}。可接續上方量測步驟。`,
      );
      idempotencyKey.current = crypto.randomUUID();
      if (!demo) router.refresh();
    } catch (submitError) {
      if (!request.isCurrent()) return;
      const uncertain = attempt.failed();
      if (uncertain) await offline.retainUnconfirmed(uncertain.body);
      if (!request.isCurrent()) return;
      setError(
        submitError instanceof Error && submitError.message
          ? submitError.message
          : "出勤尚未確認儲存。請保留內容直接重試，系統會辨識同一次送出。",
      );
    } finally {
      request.finish();
      if (request.isCurrent()) { draft.finish(); setPending(false); }
    }
  }

  return (
    <div className={`core-composer ${styles.composer}`}>
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
      <GovernanceDialog open={editorOpen && !draft.open} title="簽到、簽退或登記未到" busy={pending}
        cancelLabel={attempt.locked && !pending ? "稍後處理" : "取消"} onRequestClose={close} returnFocusRef={trigger}>
        <form data-core-care-draft noValidate aria-busy={pending} ref={formRef}
          onCompositionStart={validation.onCompositionStart} onCompositionEnd={validation.onCompositionEnd} onKeyDown={validation.onKeyDown}
          onChange={(event) => { if (!attempt.current()) { validation.clearChanged(event.target); void offline.capture(); } }} onSubmit={submit}>
          <p className="eyebrow">第 1 步・出勤</p>
          <p>確認個案、簽到退動作與時間；服務日依臺北時間判定。</p>
          {attempt.locked && !pending ? <p role="status">結果尚未確認，內容已鎖定。請重試原操作；不要另建一筆相同紀錄。</p> : null}
          <DailyValidationSummary validation={validation} />
          <fieldset className="core-dialog__fieldset" disabled={pending || attempt.locked}>
            <OfflineCareFormNotice offline={offline} onRestore={(values) => {
              setClientId(values.client_id ?? "");
              setEventKind((values.event_kind ?? "check_in") as AttendanceEventKind);
              setOccurredAt(values.occurred_at ?? ""); setReason(values.reason ?? ""); draft.changed();
            }} />
            <div className="callout core-care-callout">
              <ShieldCheck aria-hidden="true" />
              <span>
                超過伺服器時間 15 分鐘會自動視為補登，須具補登權限、最近 15 分鐘重新驗證並填寫理由。
              </span>
            </div>
            <label className="field">
              <span id={validation.labelId("client_id")}>個案 *</span>
              <select
                name="client_id"
                {...validation.field("client_id")}
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
              <DailyFieldError validation={validation} name="client_id" />
            </label>
            <label className="field">
              <span id={validation.labelId("event_kind")}>出勤動作 *</span>
              <select
                name="event_kind"
                {...validation.field("event_kind")}
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
              <DailyFieldError validation={validation} name="event_kind" />
            </label>
            <label className="field">
              <span id={validation.labelId("occurred_at")}>事件日期與時間 *</span>
              <input
                name="occurred_at"
                {...validation.field("occurred_at")}
                onChange={(event) => {
                  changed();
                  setOccurredAt(event.target.value);
                }}
                required
                type="datetime-local"
                value={occurredAt}
              />
              <DailyFieldError validation={validation} name="occurred_at" />
            </label>
            <label className="field">
              <span id={validation.labelId("reason")}>補登理由{isBackfill ? " *" : "（超過 15 分鐘時必填）"}</span>
              <textarea
                className="resize-none"
                name="reason"
                {...validation.field("reason", "attendance-reason-hint")}
                maxLength={1000}
                onChange={(event) => {
                  changed();
                  setReason(event.target.value);
                }}
                placeholder="例如：接送延遲，返回機構後依紙本時間補登。"
                required={isBackfill}
                value={reason}
              />
              <DailyFieldError validation={validation} name="reason" />
              <small id="attendance-reason-hint">
                {isBackfill
                  ? "目前時間已超過 15 分鐘；需確認補登授權與理由。"
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
              className="button button--primary"
              disabled={pending || (!attempt.locked && (!effectiveClientId || availableEvents.length === 0))}
              type="submit"
            >
              {pending ? "儲存中…" : attempt.locked ? "重試原出勤" : `確認${eventLabels[effectiveEventKind]}`}
            </button>
          </footer>
        </form>
      </GovernanceDialog>
      <CoreDraftConfirmation draft={draft} />
    </div>
  );
}
