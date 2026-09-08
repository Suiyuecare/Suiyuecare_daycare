"use client";

import { FormEvent, MouseEvent, useRef, useState } from "react";
import { FilePlus2, ShieldCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";

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
}: {
  clients: readonly ClientOption[];
  serviceDate: string;
  enabled: boolean;
  demo: boolean;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function open(event: MouseEvent<HTMLButtonElement>) {
    trigger.current = event.currentTarget;
    idempotencyKey.current = crypto.randomUUID();
    setError(null);
    setNotice(null);
    dialog.current?.showModal();
  }

  function close() {
    dialog.current?.close();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await fetchWithTimeout("/api/records", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify({
          client_id: String(data.get("client_id") ?? ""),
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
      form.reset();
      close();
      setNotice(
        demo
          ? "展示草稿已通過同一套欄位與冪等驗證；展示資料不會永久保存。"
          : "照顧日誌草稿已儲存；尚未簽署，不會計為正式完成。",
      );
      idempotencyKey.current = crypto.randomUUID();
      if (!demo) router.refresh();
    } catch (caught) {
      setError(isClientFetchTimeoutError(caught)
        ? caught.message
        : "草稿未確認儲存。畫面內容仍保留，請直接重試；系統會沿用同一冪等鍵避免重複。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="core-composer">
      <button
        className="button button--primary"
        disabled={!enabled || clients.length === 0}
        onClick={open}
        title={!enabled ? "目前角色沒有建立照顧草稿的權限" : clients.length === 0 ? "沒有可建立紀錄的個案" : undefined}
        type="button"
      >
        <FilePlus2 aria-hidden="true" />新增日誌草稿
      </button>
      {notice ? <p className="core-composer__notice" role="status">{notice}</p> : null}
      <dialog
        aria-labelledby="care-diary-dialog-title"
        className="core-dialog"
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        onClose={() => trigger.current?.focus()}
        ref={dialog}
      >
        <form className="core-dialog__surface" onChange={() => { if (error) { idempotencyKey.current = crypto.randomUUID(); setError(null); } }} onSubmit={submit}>
          <header className="drawer__header"><div><p className="eyebrow">未簽署草稿</p><h2 id="care-diary-dialog-title">新增照顧日誌</h2><p>發生時間固定以 Asia/Taipei 解讀，簽署另走近期 AAL2 流程。</p></div><button aria-label="關閉" className="icon-button" onClick={close} type="button"><X aria-hidden="true" /></button></header>
          <div className="drawer__body core-dialog__body">
            <div className="callout core-care-callout"><ShieldCheck aria-hidden="true" /><span>此操作只建立草稿。異常旗標只是提醒工作人員確認，不會產生診斷或自動改變照顧決策。</span></div>
            <label className="field"><span>個案 *</span><select defaultValue={clients[0]?.id} name="client_id" required>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}（{client.code}）</option>)}</select></label>
            <label className="field"><span>班別 *</span><select defaultValue="full_day" name="shift" required><option value="morning">上午</option><option value="afternoon">下午</option><option value="full_day">全日</option></select></label>
            <label className="field"><span>發生日期與時間 *</span><input defaultValue={defaultTaipeiLocal(serviceDate)} name="occurred_at" required type="datetime-local" /></label>
            <label className="field"><span>照顧項目 *</span><input maxLength={120} name="care_item" placeholder="例如：團體活動參與觀察" required /></label>
            <label className="field"><span>紀錄摘要</span><textarea maxLength={2000} name="note" placeholder="只記錄必要觀察與處置，不輸入無關個資。" /></label>
            <label className="field"><span>後續行動</span><textarea maxLength={1000} name="follow_up" placeholder="如需交班或追蹤，填寫具體行動。" /></label>
            <label className="check-field"><input name="abnormal" type="checkbox" /><span>標記為需留意，送入後續人工確認</span></label>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
          </div>
          <footer className="drawer__footer"><button className="button button--secondary" onClick={close} type="button">取消</button><button className="button button--primary" disabled={pending} type="submit">{pending ? "儲存中…" : "儲存草稿"}</button></footer>
        </form>
      </dialog>
    </div>
  );
}
