"use client";

import { FormEvent, MouseEvent, useRef, useState } from "react";
import { FilePlus2, ShieldCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { useCoreDraftGuard } from "./client-continuation";
import { CoreCareReceiptError, parseDiaryWriteReceipt } from "@/lib/core-care/write-receipts";
import { observationsFromForm } from "@/lib/care-diary/schema";
import { DiaryObservationsFields } from "./diary-observations";
import { OfflineCareFormNotice, useOfflineCareForm } from "./offline-care-form";
import { useCareWriteAttempt } from "./use-care-write-attempt";
import { isDefiniteCareRejection } from "@/lib/core-care/write-attempt";
import { notifyConfirmedDiaryDraft } from "@/lib/core-care/diary-draft-event";
import type { CareDiaryFields } from "@/lib/care-diary/schema";
import { isDailyWorkflowShift, type DailyWorkflowShift } from "@/lib/core-care/workflow-links";

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
  caregiverMode = false,
}: {
  clients: readonly ClientOption[];
  serviceDate: string;
  enabled: boolean;
  demo: boolean;
  selectedClientId?: string;
  selectedShift?: DailyWorkflowShift;
  caregiverMode?: boolean;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const formRef = useRef<HTMLFormElement>(null);
  const draft = useCoreDraftGuard();
  const attempt = useCareWriteAttempt<DiaryRequest>();
  const unavailableSelection = selectedClientId !== undefined && !clients.some((client) => client.id === selectedClientId);
  const selectedClient = caregiverMode && selectedClientId ? clients.find((client) => client.id === selectedClientId) : undefined;
  const invalidShift = selectedShift !== undefined && !isDailyWorkflowShift(selectedShift);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticePending, setNoticePending] = useState(false);
  const [draftSession, setDraftSession] = useState(0);
  const [restoredObservations, setRestoredObservations] = useState<Record<string, string>>();
  const offline = useOfflineCareForm({ kind: "care-note", serviceDate, enabled, demo, allowedClientIds: clients.map((client) => client.id), formRef, idempotencyKey, onRestoreId: (id) => { if (!attempt.current()) idempotencyKey.current = id; } });

  function open(event: MouseEvent<HTMLButtonElement>) {
    if (!enabled || unavailableSelection || invalidShift) return;
    trigger.current = event.currentTarget;
    if (attempt.current()) { dialog.current?.showModal(); return; }
    formRef.current?.reset();
    setDraftSession((value) => value + 1);
    setRestoredObservations(undefined);
    idempotencyKey.current = crypto.randomUUID();
    setError(null);
    setShiftError(null);
    setNotice(null);
    setNoticePending(false);
    dialog.current?.showModal();
  }

  function close() {
    if (pending) return;
    if (attempt.current()) { dialog.current?.close(); setNoticePending(true); setNotice("上一筆日誌結果尚未確認；重新開啟後只能重試原內容，不會建立新的一筆。"); return; }
    draft.discard(() => dialog.current?.close());
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const prior = attempt.current();
    const data = new FormData(form);
    const clientId = prior?.body.client_id ?? String(data.get("client_id") ?? "");
    if (!enabled || unavailableSelection || invalidShift || !clients.some((client) => client.id === clientId) || (selectedClient && clientId !== selectedClient.id)) {
      setError("請重新選擇目前授權的個案；尚未送出日誌草稿。");
      return;
    }
    if (!isDailyWorkflowShift(prior?.body.data.shift ?? String(data.get("shift") ?? ""))) {
      setShiftError("請先選擇上午、下午或全日；尚未送出日誌草稿。");
      form.querySelector<HTMLSelectElement>('select[name="shift"]')?.focus();
      return;
    }
    const observations = prior?.body.data.observations ?? observationsFromForm(data);
    if (!prior && caregiverMode
      && Object.values(observations).every((entry) => entry.state === "unknown")
      && !String(data.get("note") ?? "").trim()
      && !String(data.get("follow_up") ?? "").trim()
      && data.get("abnormal") !== "on") {
      setError("請選一項觀察，或填寫紀錄摘要。");
      return;
    }
    if (!draft.begin()) return;
    setPending(true);
    setError(null);
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
            observations,
            ...(String(data.get("follow_up") ?? "").trim()
              ? { follow_up: String(data.get("follow_up")) }
              : {}),
          },
        };
      if (!prior && !demo && !navigator.onLine && await offline.queueIfOffline(body)) {
        draft.saved(); dialog.current?.close();
        setNoticePending(true);
        setNotice("已保存在裝置等待送出；尚未確認儲存到系統。");
        return;
      }
      const frozen = attempt.prepare(body, idempotencyKey.current);
      const response = await fetchWithTimeout("/api/records", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "Idempotency-Key": frozen.key },
        body: frozen.serialized,
      });
      if (!response.ok) { if (await isDefiniteCareRejection(response)) attempt.failed(response.status); throw new Error("SAVE_FAILED"); }
      const raw: unknown = await response.json().catch(() => null);
      const receipt = parseDiaryWriteReceipt(raw, response.status, demo);
      await offline.saved();
      attempt.confirmed();
      form.reset();
      draft.saved();
      dialog.current?.close();
      setNotice(
        demo
          ? "展示草稿已通過欄位與重送檢查；展示資料不會永久保存。"
          : "系統已回覆草稿儲存；請查看下方讀回結果，尚未簽署。",
      );
      setNoticePending(!demo);
      idempotencyKey.current = crypto.randomUUID();
      if (!demo) {
        notifyConfirmedDiaryDraft({ clientId: frozen.body.client_id, recordId: receipt.record.id, version: receipt.record.version });
        router.refresh();
      }
    } catch (caught) {
      const uncertain = attempt.failed();
      if (uncertain) draft.hold(); else draft.unhold();
      if (uncertain) await offline.retainUnconfirmed(uncertain.body);
      setError(isClientFetchTimeoutError(caught) || caught instanceof CoreCareReceiptError
        ? caught.message
        : "草稿尚未確認儲存。請保留內容直接重試，系統會辨識同一次送出。");
    } finally {
      draft.finish();
      setPending(false);
    }
  }

  function handleEdit() {
    if (attempt.current()) return;
    draft.changed();
    if (error) { idempotencyKey.current = crypto.randomUUID(); setError(null); }
    void offline.capture();
  }

  return (
    <div className="core-composer">
      <button
        className="button button--primary"
        disabled={!enabled || clients.length === 0 || unavailableSelection || invalidShift}
        onClick={open}
        title={!enabled ? "目前角色沒有建立照顧草稿的權限" : unavailableSelection ? "指定個案不在目前授權名單，請重新選擇" : clients.length === 0 ? "沒有可建立紀錄的個案" : undefined}
        type="button"
      >
        <FilePlus2 aria-hidden="true" />{caregiverMode ? "新增照顧紀錄" : "新增日誌草稿"}
      </button>
      {unavailableSelection ? <p role="alert">指定個案不在目前授權名單；不會自動改為其他個案。</p> : null}
      {invalidShift ? <p role="alert">指定班別無效，請返回今日工作重新選擇；不會自動改成全日。</p> : null}
      {notice ? <p className={`core-composer__notice${noticePending ? " core-composer__notice--pending" : ""}`} role="status">{notice}</p> : null}
      <dialog
        aria-labelledby="care-diary-dialog-title"
        className="core-dialog"
        onCancel={(event) => { event.preventDefault(); close(); }}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        onClose={() => trigger.current?.focus()}
        ref={dialog}
      >
        <form className="core-dialog__surface" data-core-care-draft ref={formRef} key={`${serviceDate}:${selectedClientId ?? "none"}:${selectedShift ?? "unselected"}`} onChange={(event) => { if (caregiverMode && event.target instanceof HTMLInputElement && event.target.name === "water") return; handleEdit(); }} onSubmit={submit}>
          <header className="drawer__header"><div><p className="eyebrow">{caregiverMode ? "本次照顧" : "第 3 步・日誌草稿"}</p><h2 id="care-diary-dialog-title">{caregiverMode ? "記錄照顧" : "新增照顧日誌"}</h2><p>{caregiverMode ? "確認個案與時間，記下這次的觀察。" : "記下本次觀察與下一步處置；時間以臺北時間顯示。草稿需確認與簽署後才算正式完成。"}</p></div><button aria-label="關閉" className="icon-button" disabled={pending} onClick={close} type="button"><X aria-hidden="true" /></button></header>
          {attempt.locked && !pending ? <p role="status">結果尚未確認，內容已鎖定。請重試原操作；不要另建一筆相同紀錄。</p> : null}
          <div className="drawer__body core-dialog__body">
          <fieldset className="core-dialog__fieldset" disabled={pending || attempt.locked}>
            <OfflineCareFormNotice offline={offline} onRestore={(values) => { draft.changed(); setRestoredObservations(values); setDraftSession((value) => value + 1); }} />
            <div className="callout core-care-callout"><ShieldCheck aria-hidden="true" /><span>{caregiverMode ? "先存草稿，確認並簽署後才完成；異常標記僅供人工確認。" : "此操作只建立草稿。異常旗標只是提醒工作人員確認，不會產生診斷或自動改變照顧決策。"}</span></div>
            {selectedClient ? <div className="field"><span>本次照顧個案</span><strong className="core-selected-client">{selectedClient.name}（{selectedClient.code}）</strong><select aria-hidden="true" defaultValue={selectedClient.id} hidden name="client_id" tabIndex={-1}><option value={selectedClient.id}>{selectedClient.name}</option></select></div> : <label className="field"><span>個案 *</span><select defaultValue={unavailableSelection ? "" : selectedClientId ?? ""} name="client_id" required><option value="">請選擇個案</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}（{client.code}）</option>)}</select></label>}
            <label className="field"><span>班別 *</span><select aria-describedby={shiftError ? "care-diary-shift-error" : undefined} aria-invalid={shiftError ? true : undefined}
              defaultValue={selectedShift ?? ""} name="shift" onChange={() => setShiftError(null)}
              onInvalid={(event) => { event.preventDefault(); const control = event.currentTarget;
                setShiftError("請先選擇上午、下午或全日；尚未送出日誌草稿。"); window.requestAnimationFrame(() => control.focus()); }} required>
              <option value="">請選擇班別</option><option value="morning">上午</option><option value="afternoon">下午</option><option value="full_day">全日</option>
            </select>{shiftError ? <small className="form-error" id="care-diary-shift-error" role="alert">{shiftError}</small> : null}</label>
            <label className="field"><span>發生日期與時間 *</span><input defaultValue={defaultTaipeiLocal(serviceDate)} name="occurred_at" required type="datetime-local" /></label>
            {caregiverMode ? <DiaryObservationsFields key={draftSession} restored={restoredObservations} caregiverMode onUserChange={handleEdit} /> : null}
            {caregiverMode ? <input name="care_item" type="hidden" value="日常照顧觀察" /> : <label className="field"><span>照顧項目 *</span><input maxLength={120} name="care_item" placeholder="例如：團體活動參與觀察" required /></label>}
            {!caregiverMode ? <DiaryObservationsFields key={draftSession} restored={restoredObservations} /> : null}
            <label className="field"><span>紀錄摘要</span><textarea maxLength={2000} name="note" placeholder="只記錄必要觀察與處置，不輸入無關個資。" /></label>
            <label className="field"><span>後續行動</span><textarea maxLength={1000} name="follow_up" placeholder="如需交班或追蹤，填寫具體行動。" /></label>
            <label className="check-field"><input name="abnormal" type="checkbox" /><span>標記為需留意，送入後續人工確認</span></label>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
          </fieldset>
          </div>
          <footer className="drawer__footer"><button className="button button--secondary" disabled={pending} onClick={close} type="button">{attempt.locked && !pending ? "稍後處理" : "取消"}</button><button className="button button--primary" disabled={pending} type="submit">{pending ? "儲存中…" : attempt.locked ? "重試原草稿" : "儲存草稿"}</button></footer>
        </form>
      </dialog>
    </div>
  );
}
