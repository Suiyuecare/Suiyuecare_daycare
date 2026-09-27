"use client";

import { FormEvent, MouseEvent, useRef, useState } from "react";
import { FilePlus2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { withCareRequestDeadline } from "@/lib/core-care/request-deadline";
import { CoreDraftConfirmation, useCoreDraftGuard } from "./client-continuation";
import { GovernanceDialog } from "@/components/ui/governance-dialog";
import { CoreCareReceiptError, parseDiaryWriteReceipt } from "@/lib/core-care/write-receipts";
import { observationsFromForm } from "@/lib/care-diary/schema";
import { DiaryObservationsFields } from "./diary-observations";
import { OfflineCareFormNotice, useOfflineCareForm } from "./offline-care-form";
import { useCareWriteAttempt } from "./use-care-write-attempt";
import { useCareRequestOwner } from "./use-care-request-owner";
import { isDefiniteCareRejection } from "@/lib/core-care/write-attempt";
import type { CareDiaryFields } from "@/lib/care-diary/schema";
import { isDailyWorkflowShift, type DailyWorkflowShift } from "@/lib/core-care/workflow-links";
import { DailyFieldError, DailyValidationSummary, useDailyFormValidation } from "./daily-form-validation";
import styles from "./daily-composer.module.css";

type ClientOption = { id: string; name: string; code: string };
type DiaryRequest = { client_id: string; page_slug: string; occurred_at: string; data: CareDiaryFields };

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
    throw new Error("INVALID_DATE_TIME");
  }
  const date = new Date(`${value}:00+08:00`);
  if (Number.isNaN(date.getTime())) throw new Error("INVALID_DATE_TIME");
  return date.toISOString();
}

export function CareDiaryComposer({
  clients,
  serviceDate,
  enabled,
  demo,
  selectedClientId,
  selectedShift,
}: {
  clients: readonly ClientOption[];
  serviceDate: string;
  enabled: boolean;
  demo: boolean;
  selectedClientId?: string;
  selectedShift?: DailyWorkflowShift;
}) {
  const router = useRouter();
  const trigger = useRef<HTMLButtonElement>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const formRef = useRef<HTMLFormElement>(null);
  const validation = useDailyFormValidation();
  const [editorOpen, setEditorOpen] = useState(false);
  const attempt = useCareWriteAttempt<DiaryRequest>();
  const attemptScope = useRef<string | null>(null);
  const privacyScope = JSON.stringify(["care-note", demo, serviceDate, selectedClientId ?? null, selectedShift ?? "full_day"]);
  const capabilities = JSON.stringify([enabled, clients.map((client) => client.id).sort()]);
  const draft = useCoreDraftGuard({
    scopeKey: privacyScope,
    revisionKey: capabilities,
    canPrompt: enabled,
    isBlocked: () => !!attempt.current(),
    onDiscard() {
      setEditorOpen(false);
      if (!attempt.current()) {
        formRef.current?.reset(); validation.reset(); setError(null); setRestoredObservations(undefined);
        setDraftSession((value) => value + 1); idempotencyKey.current = crypto.randomUUID();
      }
    },
  });
  const unavailableSelection = selectedClientId !== undefined && !clients.some((client) => client.id === selectedClientId);
  const invalidShift = selectedShift !== undefined && !isDailyWorkflowShift(selectedShift);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestOwner = useCareRequestOwner(JSON.stringify([privacyScope, capabilities]), () => {
    if (attempt.current()) attempt.failed();
    setPending(false); setEditorOpen(false); setError(null); setNotice(null); draft.finish();
  });
  const [draftSession, setDraftSession] = useState(0);
  const [restoredObservations, setRestoredObservations] = useState<Record<string, string>>();
  const offline = useOfflineCareForm({ kind: "care-note", serviceDate, enabled, demo, allowedClientIds: clients.map((client) => client.id), formRef, idempotencyKey, onRestoreId: (id) => { if (!attempt.current()) idempotencyKey.current = id; } });

  function open(event: MouseEvent<HTMLButtonElement>) {
    if (!enabled || unavailableSelection || invalidShift) return;
    trigger.current = event.currentTarget;
    if (attempt.current()) { setEditorOpen(true); return; }
    formRef.current?.reset();
    setDraftSession((value) => value + 1);
    setRestoredObservations(undefined);
    idempotencyKey.current = crypto.randomUUID();
    setError(null);
    setNotice(null);
    validation.reset();
    setEditorOpen(true);
  }

  function close() {
    if (pending) return;
    if (attempt.current()) { setEditorOpen(false); setNotice("上一筆日誌結果尚未確認；重新開啟後只能重試原內容，不會建立新的一筆。"); return; }
    draft.requestExit(() => setEditorOpen(false));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (validation.composing.current || pending) return;
    const form = event.currentTarget;
    const prior = attempt.current();
    if (prior && attemptScope.current !== privacyScope) {
      setError("上一筆日誌尚未確認，請回到原個案、日期與班別處理；未建立新的一筆。");
      return;
    }
    const data = new FormData(form);
    const clientId = prior?.body.client_id ?? String(data.get("client_id") ?? "");
    if (!enabled || unavailableSelection || invalidShift || !clients.some((client) => client.id === clientId)) {
      if (!prior) { setError(null); validation.validate(form, { client_id: "請重新選擇目前授權的個案；尚未送出日誌草稿。" }); }
      else setError("請重新選擇目前授權的個案；尚未送出日誌草稿。");
      return;
    }
    if (!prior && !validation.validate(form)) { setError(null); return; }
    if (!draft.begin()) return;
    setPending(true);
    setError(null);
    const request = requestOwner.begin();
    try {
      const body = prior?.body ?? {
          client_id: clientId,
          page_slug: "staff/daily-care/care-diary",
          occurred_at: taipeiLocalToIso(String(data.get("occurred_at") ?? "")),
          data: {
            shift: String(data.get("shift") ?? "") as CareDiaryFields["shift"],
            care_item: String(data.get("care_item") ?? ""),
            note: String(data.get("note") ?? ""),
            abnormal: data.get("abnormal") === "on",
            observations: observationsFromForm(data),
            ...(String(data.get("follow_up") ?? "").trim()
              ? { follow_up: String(data.get("follow_up")) }
              : {}),
          },
        };
      if (!prior && !demo && !navigator.onLine && await offline.queueIfOffline(body)) {
        request.throwIfStale();
        draft.saved(); setEditorOpen(false);
        setNotice("已保存在裝置等待送出；尚未確認儲存到系統。");
        return;
      }
      request.throwIfStale();
      if (!prior) attemptScope.current = privacyScope;
      const frozen = attempt.prepare(body, idempotencyKey.current);
      const { response, raw, definite } = await withCareRequestDeadline(async (signal) => {
        const response = await fetchWithTimeout("/api/records", {
          method: "POST", cache: "no-store", signal,
          headers: { "Content-Type": "application/json", "Idempotency-Key": frozen.key },
          body: frozen.serialized,
        });
        signal.throwIfAborted();
        if (!response.ok) {
          const definite = await isDefiniteCareRejection(response);
          signal.throwIfAborted();
          return { response, raw: null, definite };
        }
        const raw: unknown = await response.json().catch(() => null);
        signal.throwIfAborted();
        return { response, raw, definite: false };
      }, { signal: request.signal });
      request.throwIfStale();
      if (!response.ok) { if (definite) attempt.failed(response.status); throw new Error("SAVE_FAILED"); }
      parseDiaryWriteReceipt(raw, response.status, demo);
      await offline.saved();
      request.throwIfStale();
      attempt.confirmed();
      attemptScope.current = null;
      form.reset();
      draft.saved();
      setEditorOpen(false);
      setNotice(
        demo
          ? "展示草稿已通過欄位與重送檢查；展示資料不會永久保存。"
          : "照顧日誌草稿已儲存；尚未簽署，不會計為正式完成。",
      );
      idempotencyKey.current = crypto.randomUUID();
      if (!demo) router.refresh();
    } catch (caught) {
      if (!request.isCurrent()) return;
      const uncertain = attempt.failed();
      if (uncertain) await offline.retainUnconfirmed(uncertain.body);
      if (!request.isCurrent()) return;
      setError(isClientFetchTimeoutError(caught) || caught instanceof CoreCareReceiptError
        ? caught.message
        : "草稿尚未確認儲存。請保留內容直接重試，系統會辨識同一次送出。");
    } finally {
      request.finish();
      if (request.isCurrent()) { draft.finish(); setPending(false); }
    }
  }

  return (
    <div className={`core-composer ${styles.composer}`}>
      <button
        className="button button--primary"
        disabled={!enabled || clients.length === 0 || unavailableSelection || invalidShift}
        onClick={open}
        title={!enabled ? "目前角色沒有建立照顧草稿的權限" : unavailableSelection ? "指定個案不在目前授權名單，請重新選擇" : clients.length === 0 ? "沒有可建立紀錄的個案" : undefined}
        type="button"
      >
        <FilePlus2 aria-hidden="true" />新增日誌草稿
      </button>
      {unavailableSelection ? <p role="alert">指定個案不在目前授權名單；不會自動改為其他個案。</p> : null}
      {invalidShift ? <p role="alert">指定班別無效，請返回今日工作重新選擇；不會自動改成全日。</p> : null}
      {notice ? <p className="core-composer__notice" role="status">{notice}</p> : null}
      <GovernanceDialog open={editorOpen && !draft.open} title="新增照顧日誌" busy={pending}
        cancelLabel={attempt.locked && !pending ? "稍後處理" : "取消"} onRequestClose={close} returnFocusRef={trigger}>
        <form data-core-care-draft noValidate aria-busy={pending} ref={formRef} key={`${serviceDate}:${selectedClientId ?? "none"}:${selectedShift ?? "full_day"}`}
          onCompositionStart={validation.onCompositionStart} onCompositionEnd={validation.onCompositionEnd} onKeyDown={validation.onKeyDown}
          onChange={(event) => { if (attempt.current()) return; validation.clearChanged(event.target); draft.changed(); if (error) { idempotencyKey.current = crypto.randomUUID(); setError(null); } void offline.capture(); }} onSubmit={submit}>
          <p className="eyebrow">第 3 步・日誌草稿</p><p>記下本次觀察與下一步處置；時間以臺北時間顯示。草稿需確認與簽署後才算正式完成。</p>
          {attempt.locked && !pending ? <p role="status">結果尚未確認，內容已鎖定。請重試原操作；不要另建一筆相同紀錄。</p> : null}
          <DailyValidationSummary validation={validation} />
          <fieldset className="core-dialog__fieldset" disabled={pending || attempt.locked}>
            <OfflineCareFormNotice offline={offline} onRestore={(values) => { draft.changed(); setRestoredObservations(values); setDraftSession((value) => value + 1); }} />
            <div className="callout core-care-callout"><ShieldCheck aria-hidden="true" /><span>此操作只建立草稿。異常旗標只是提醒工作人員確認，不會產生診斷或自動改變照顧決策。</span></div>
            <label className="field"><span id={validation.labelId("client_id")}>個案 *</span><select defaultValue={unavailableSelection ? "" : selectedClientId ?? ""} name="client_id" required {...validation.field("client_id")}><option value="">請選擇個案</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}（{client.code}）</option>)}</select><DailyFieldError validation={validation} name="client_id" /></label>
            <label className="field"><span id={validation.labelId("shift")}>班別 *</span><select defaultValue={selectedShift ?? "full_day"} name="shift" required {...validation.field("shift")}><option value="morning">上午</option><option value="afternoon">下午</option><option value="full_day">全日</option></select><DailyFieldError validation={validation} name="shift" /></label>
            <label className="field"><span id={validation.labelId("occurred_at")}>發生日期與時間 *</span><input defaultValue={defaultTaipeiLocal(serviceDate)} name="occurred_at" required type="datetime-local" {...validation.field("occurred_at")} /><DailyFieldError validation={validation} name="occurred_at" /></label>
            <label className="field"><span id={validation.labelId("care_item")}>照顧項目 *</span><input maxLength={120} name="care_item" placeholder="例如：團體活動參與觀察" required {...validation.field("care_item")} /><DailyFieldError validation={validation} name="care_item" /></label>
            <DiaryObservationsFields key={draftSession} restored={restoredObservations} validation={validation} />
            <label className="field"><span id={validation.labelId("note")}>紀錄摘要</span><textarea className="resize-none" maxLength={2000} name="note" placeholder="只記錄必要觀察與處置，不輸入無關個資。" {...validation.field("note")} /><DailyFieldError validation={validation} name="note" /></label>
            <label className="field"><span id={validation.labelId("follow_up")}>後續行動</span><textarea className="resize-none" maxLength={1000} name="follow_up" placeholder="如需交班或追蹤，填寫具體行動。" {...validation.field("follow_up")} /><DailyFieldError validation={validation} name="follow_up" /></label>
            <label className="check-field"><input name="abnormal" type="checkbox" /><span>標記為需留意，送入後續人工確認</span></label>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
          </fieldset>
          <footer className="drawer__footer"><button className="button button--primary" disabled={pending} type="submit">{pending ? "儲存中…" : attempt.locked ? "重試原草稿" : "儲存草稿"}</button></footer>
        </form>
      </GovernanceDialog>
      <CoreDraftConfirmation draft={draft} />
    </div>
  );
}
