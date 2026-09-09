"use client";

import { FormEvent, MouseEvent, useRef, useState } from "react";
import { HeartPulse, ShieldCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { useCoreDraftGuard } from "./client-continuation";
import { CoreCareReceiptError, parseVitalWriteReceipt } from "@/lib/core-care/write-receipts";

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
  const parsed = new Date(`${value}:00+08:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error("INVALID_DATE_TIME");
  return parsed.toISOString();
}

function optionalNumber(data: FormData, name: string) {
  const raw = String(data.get(name) ?? "").trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error("INVALID_NUMBER");
  return value;
}

export function VitalSignComposer({
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
      setError("請重新選擇目前授權的個案；尚未送出量測。");
      return;
    }
    if (!draft.begin()) return;
    setPending(true);
    setError(null);
    try {
      const values = {
        systolic: optionalNumber(data, "systolic"),
        diastolic: optionalNumber(data, "diastolic"),
        pulse: optionalNumber(data, "pulse"),
        temperature: optionalNumber(data, "temperature"),
        oxygen_saturation: optionalNumber(data, "oxygen_saturation"),
      };
      const response = await fetchWithTimeout("/api/measurements", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify({
          client_id: clientId,
          measured_at: taipeiLocalToIso(
            String(data.get("measured_at") ?? ""),
          ),
          values: Object.fromEntries(
            Object.entries(values).filter(([, value]) => value != null),
          ),
        }),
      });
      if (!response.ok) throw new Error("SAVE_FAILED");
      const raw: unknown = await response.json().catch(() => null);
      parseVitalWriteReceipt(raw, response.status, demo, values);
      form.reset();
      draft.saved();
      dialog.current?.close();
      setNotice(
        demo
          ? "展示量測已通過欄位與重送檢查；展示資料不會永久保存。"
          : "生命徵象已儲存；可接續上方日誌步驟。量測資料不代表自動診斷。",
      );
      idempotencyKey.current = crypto.randomUUID();
      if (!demo) router.refresh();
    } catch (caught) {
      setError(isClientFetchTimeoutError(caught) || caught instanceof CoreCareReceiptError
        ? caught.message
        : "量測尚未確認儲存。請檢查至少一項數值、成對血壓與最近 24 小時內的時間。保留內容直接重試，系統會辨識同一次送出。");
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
        title={
          !enabled
            ? "目前角色沒有新增生命徵象的權限"
            : unavailableSelection ? "指定個案不在目前授權名單，請重新選擇"
            : clients.length === 0
              ? "沒有可量測的個案"
              : undefined
        }
        type="button"
      >
        <HeartPulse aria-hidden="true" />新增量測
      </button>
      {unavailableSelection ? <p role="alert">指定個案不在目前授權名單；不會自動改為其他個案。</p> : null}
      {notice ? (
        <p className="core-composer__notice" role="status">
          {notice}
        </p>
      ) : null}
      <dialog
        aria-labelledby="vital-sign-dialog-title"
        className="core-dialog"
        onCancel={(event) => { event.preventDefault(); close(); }}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        onClose={() => trigger.current?.focus()}
        ref={dialog}
      >
        <form
          className="core-dialog__surface"
          data-core-care-draft
          ref={formRef}
          key={`${serviceDate}:${selectedClientId ?? "none"}`}
          onChange={() => {
            draft.changed();
            if (error) {
              idempotencyKey.current = crypto.randomUUID();
              setError(null);
            }
          }}
          onSubmit={submit}
        >
          <header className="drawer__header">
            <div>
              <p className="eyebrow">第 2 步・量測</p>
              <h2 id="vital-sign-dialog-title">新增生命徵象</h2>
              <p>沿用選定個案，確認實際量測時間與數值；時間以臺北時間解讀。</p>
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
                至少填一項；血壓須成對填寫。技術範圍只防止明顯輸入錯誤，不代表醫療判讀或診斷。
              </span>
            </div>
            <label className="field">
              <span>個案 *</span>
              <select defaultValue={unavailableSelection ? "" : selectedClientId ?? ""} name="client_id" required>
                <option value="">請選擇個案</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}（{client.code}）
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>量測日期與時間 *</span>
              <input
                defaultValue={defaultTaipeiLocal(serviceDate)}
                name="measured_at"
                required
                type="datetime-local"
              />
            </label>
            <fieldset className="vital-inputs">
              <legend>量測值（至少一項）</legend>
              <label className="field">
                <span>收縮壓 mmHg</span>
                <input inputMode="decimal" max="350" min="20" name="systolic" step="1" type="number" />
              </label>
              <label className="field">
                <span>舒張壓 mmHg</span>
                <input inputMode="decimal" max="250" min="10" name="diastolic" step="1" type="number" />
              </label>
              <label className="field">
                <span>脈搏 bpm</span>
                <input inputMode="decimal" max="350" min="10" name="pulse" step="1" type="number" />
              </label>
              <label className="field">
                <span>體溫 °C</span>
                <input inputMode="decimal" max="50" min="20" name="temperature" step="0.1" type="number" />
              </label>
              <label className="field">
                <span>血氧 %</span>
                <input inputMode="decimal" max="100" min="1" name="oxygen_saturation" step="1" type="number" />
              </label>
            </fieldset>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
          </fieldset>
          <footer className="drawer__footer">
            <button className="button button--secondary" disabled={pending} onClick={close} type="button">
              取消
            </button>
            <button className="button button--primary" disabled={pending} type="submit">
              {pending ? "儲存中…" : "儲存量測"}
            </button>
          </footer>
        </form>
      </dialog>
    </div>
  );
}
