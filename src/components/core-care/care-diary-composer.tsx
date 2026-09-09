"use client";

import { FormEvent, MouseEvent, useRef, useState } from "react";
import { FilePlus2, ShieldCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { useCoreDraftGuard } from "./client-continuation";
import { CoreCareReceiptError, parseDiaryWriteReceipt } from "@/lib/core-care/write-receipts";

type ClientOption = { id: string; name: string; code: string };

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
  const formRef = useRef<HTMLFormElement>(null);
  const draft = useCoreDraftGuard();
  const unavailableSelection = selectedClientId !== undefined && !clients.some((client) => client.id === selectedClientId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function open(event: MouseEvent<HTMLButtonElement>) {
    if (!enabled || unavailableSelection) return;
    trigger.current = event.currentTarget;
    formRef.current?.reset();
    idempotencyKey.current = crypto.randomUUID();
    setError(null);
    setNotice(null);
    dialog.current?.showModal();
  }

  function close() {
    if (!draft.discard()) return;
    dialog.current?.close();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const clientId = String(data.get("client_id") ?? "");
    if (!enabled || unavailableSelection || !clients.some((client) => client.id === clientId)) {
      setError("請重新選擇目前授權的個案；尚未送出日誌草稿。");
      return;
    }
    if (!draft.begin()) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetchWithTimeout("/api/records", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify({
          client_id: clientId,
          page_slug: "staff/daily-care/care-diary",
          occurred_at: taipeiLocalToIso(String(data.get("occurred_at") ?? "")),
          data: {
            shift: String(data.get("shift") ?? ""),
            care_item: String(data.get("care_item") ?? ""),
            note: String(data.get("note") ?? ""),
            abnormal: data.get("abnormal") === "on",
            ...(String(data.get("follow_up") ?? "").trim()
              ? { follow_up: String(data.get("follow_up")) }
              : {}),
          },
        }),
      });
      if (!response.ok) throw new Error("SAVE_FAILED");
      const raw: unknown = await response.json().catch(() => null);
      parseDiaryWriteReceipt(raw, response.status, demo);
      form.reset();
      draft.saved();
      dialog.current?.close();
      setNotice(
        demo
          ? "展示草稿已通過欄位與重送檢查；展示資料不會永久保存。"
          : "照顧日誌草稿已儲存；尚未簽署，不會計為正式完成。",
      );
      idempotencyKey.current = crypto.randomUUID();
      if (!demo) router.refresh();
    } catch (caught) {
      setError(isClientFetchTimeoutError(caught) || caught instanceof CoreCareReceiptError
        ? caught.message
        : "草稿尚未確認儲存。請保留內容直接重試，系統會辨識同一次送出。");
    } finally {
      draft.finish();
      setPending(false);
    }
  }

  return (
    <div className="core-composer">
      <button
        className="button button--primary"
        disabled={!enabled || clients.length === 0 || unavailableSelection}
        onClick={open}
        title={!enabled ? "目前角色沒有建立照顧草稿的權限" : unavailableSelection ? "指定個案不在目前授權名單，請重新選擇" : clients.length === 0 ? "沒有可建立紀錄的個案" : undefined}
        type="button"
      >
        <FilePlus2 aria-hidden="true" />新增日誌草稿
      </button>
      {unavailableSelection ? <p role="alert">指定個案不在目前授權名單；不會自動改為其他個案。</p> : null}
      {notice ? <p className="core-composer__notice" role="status">{notice}</p> : null}
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
        <form className="core-dialog__surface" data-core-care-draft ref={formRef} key={`${serviceDate}:${selectedClientId ?? "none"}`} onChange={() => { draft.changed(); if (error) { idempotencyKey.current = crypto.randomUUID(); setError(null); } }} onSubmit={submit}>
          <header className="drawer__header"><div><p className="eyebrow">第 3 步・日誌草稿</p><h2 id="care-diary-dialog-title">新增照顧日誌</h2><p>記下觀察與下一步處置；時間以臺北時間解讀，簽署仍須近期 AAL2 驗證。</p></div><button aria-label="關閉" className="icon-button" disabled={pending} onClick={close} type="button"><X aria-hidden="true" /></button></header>
          <fieldset className="drawer__body core-dialog__body core-dialog__fields" disabled={pending}>
            <div className="callout core-care-callout"><ShieldCheck aria-hidden="true" /><span>此操作只建立草稿。異常旗標只是提醒工作人員確認，不會產生診斷或自動改變照顧決策。</span></div>
            <label className="field"><span>個案 *</span><select defaultValue={unavailableSelection ? "" : selectedClientId ?? ""} name="client_id" required><option value="">請選擇個案</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}（{client.code}）</option>)}</select></label>
            <label className="field"><span>班別 *</span><select defaultValue="full_day" name="shift" required><option value="morning">上午</option><option value="afternoon">下午</option><option value="full_day">全日</option></select></label>
            <label className="field"><span>發生日期與時間 *</span><input defaultValue={defaultTaipeiLocal(serviceDate)} name="occurred_at" required type="datetime-local" /></label>
            <label className="field"><span>照顧項目 *</span><input maxLength={120} name="care_item" placeholder="例如：團體活動參與觀察" required /></label>
            <label className="field"><span>紀錄摘要</span><textarea maxLength={2000} name="note" placeholder="只記錄必要觀察與處置，不輸入無關個資。" /></label>
            <label className="field"><span>後續行動</span><textarea maxLength={1000} name="follow_up" placeholder="如需交班或追蹤，填寫具體行動。" /></label>
            <label className="check-field"><input name="abnormal" type="checkbox" /><span>標記為需留意，送入後續人工確認</span></label>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
          </fieldset>
          <footer className="drawer__footer"><button className="button button--secondary" disabled={pending} onClick={close} type="button">取消</button><button className="button button--primary" disabled={pending} type="submit">{pending ? "儲存中…" : "儲存草稿"}</button></footer>
        </form>
      </dialog>
    </div>
  );
}
