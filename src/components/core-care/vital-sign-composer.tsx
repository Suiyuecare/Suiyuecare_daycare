"use client";

import { FormEvent, MouseEvent, useRef, useState } from "react";
import { HeartPulse, ShieldCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import { useCoreDraftGuard } from "./client-continuation";
import { CoreCareReceiptError, parseVitalWriteReceipt } from "@/lib/core-care/write-receipts";
import { OfflineCareFormNotice, useOfflineCareForm } from "./offline-care-form";
import { useCareWriteAttempt } from "./use-care-write-attempt";
import { isDefiniteCareRejection } from "@/lib/core-care/write-attempt";
import { DailyFieldError, DailyValidationSummary, useDailyFormValidation } from "./daily-form-validation";
import styles from "./daily-composer.module.css";

type ClientOption = { id: string; name: string; code: string };
type VitalRequest = { client_id: string; measured_at: string; values: Record<string, number> };

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
  const validation = useDailyFormValidation();
  const draft = useCoreDraftGuard();
  const attempt = useCareWriteAttempt<VitalRequest>();
  const offline = useOfflineCareForm({ kind: "vital-sign", serviceDate, enabled, demo,
    allowedClientIds: clients.map((client) => client.id), formRef, idempotencyKey, onRestoreId: (id) => { if (!attempt.current()) idempotencyKey.current = id; } });
  const unavailableSelection = selectedClientId !== undefined && !clients.some((client) => client.id === selectedClientId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function open(event: MouseEvent<HTMLButtonElement>) {
    if (!enabled || unavailableSelection) return;
    trigger.current = event.currentTarget;
    if (attempt.current()) { dialog.current?.showModal(); return; }
    formRef.current?.reset();
    idempotencyKey.current = crypto.randomUUID();
    setError(null);
    setNotice(null);
    validation.reset();
    dialog.current?.showModal();
  }

  function close() {
    if (pending) return;
    if (attempt.current()) { dialog.current?.close(); setNotice("上一筆量測結果尚未確認；重新開啟後只能重試原內容，不會建立新的一筆。"); return; }
    if (!draft.discard()) return;
    dialog.current?.close();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (validation.composing.current || pending) return;
    const form = event.currentTarget;
    const prior = attempt.current();
    const data = new FormData(form);
    const clientId = prior?.body.client_id ?? String(data.get("client_id") ?? "");
    if (!enabled || unavailableSelection || !clients.some((client) => client.id === clientId)) {
      if (!prior) { setError(null); validation.validate(form, { client_id: "請重新選擇目前授權的個案；尚未送出量測。" }); }
      else setError("請重新選擇目前授權的個案；尚未送出量測。");
      return;
    }
    if (!prior) {
      const extra: Record<string, string> = {};
      const filled = (name: string) => String(data.get(name) ?? "").trim() !== "";
      if (!["systolic", "diastolic", "pulse", "temperature", "oxygen_saturation"].some(filled)) extra.systolic = "請至少填寫一項量測值；血壓須成對填寫。";
      else if (filled("systolic") !== filled("diastolic")) extra[filled("systolic") ? "diastolic" : "systolic"] = "請一起填寫收縮壓與舒張壓。";
      if (!validation.validate(form, extra)) { setError(null); return; }
    }
    if (!draft.begin()) return;
    setPending(true);
    setError(null);
    try {
      const values = prior?.body.values ?? {
        systolic: optionalNumber(data, "systolic"),
        diastolic: optionalNumber(data, "diastolic"),
        pulse: optionalNumber(data, "pulse"),
        temperature: optionalNumber(data, "temperature"),
        oxygen_saturation: optionalNumber(data, "oxygen_saturation"),
      };
      const body = prior?.body ?? {
        client_id: clientId,
        measured_at: taipeiLocalToIso(String(data.get("measured_at") ?? "")),
        values: Object.fromEntries(Object.entries(values).filter((entry): entry is [string, number] => typeof entry[1] === "number")),
      };
      if (!prior && !demo && !navigator.onLine && await offline.queueIfOffline(body)) {
        draft.saved(); dialog.current?.close();
        setNotice("量測已保存在裝置等待送出；尚未確認儲存到系統。重新連線後會自動重試。");
        return;
      }
      const frozen = attempt.prepare(body, idempotencyKey.current);
      const response = await fetchWithTimeout("/api/measurements", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": frozen.key,
        },
        body: frozen.serialized,
      });
      if (!response.ok) { if (await isDefiniteCareRejection(response)) attempt.failed(response.status); throw new Error("SAVE_FAILED"); }
      const raw: unknown = await response.json().catch(() => null);
      parseVitalWriteReceipt(raw, response.status, demo, values);
      await offline.saved();
      attempt.confirmed();
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
      const uncertain = attempt.failed();
      if (uncertain) await offline.retainUnconfirmed(uncertain.body);
      setError(isClientFetchTimeoutError(caught) || caught instanceof CoreCareReceiptError
        ? caught.message
        : "量測尚未確認儲存。請檢查至少一項數值、成對血壓與最近 24 小時內的時間。保留內容直接重試，系統會辨識同一次送出。");
    } finally {
      draft.finish();
      setPending(false);
    }
  }

  return (
    <div className={`core-composer ${styles.composer}`}>
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
          noValidate
          aria-busy={pending}
          onCompositionStart={validation.onCompositionStart}
          onCompositionEnd={validation.onCompositionEnd}
          onKeyDown={validation.onKeyDown}
          ref={formRef}
          key={`${serviceDate}:${selectedClientId ?? "none"}`}
          onChange={(event) => {
            if (attempt.current()) return;
            validation.clearChanged(event.target);
            draft.changed();
            if (error) {
              idempotencyKey.current = crypto.randomUUID();
              setError(null);
            }
            void offline.capture();
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
          {attempt.locked && !pending ? <p role="status">結果尚未確認，內容已鎖定。請重試原操作；不要另建一筆相同紀錄。</p> : null}
          <div className="drawer__body core-dialog__body">
          <DailyValidationSummary validation={validation} />
          <fieldset className="core-dialog__fieldset" disabled={pending || attempt.locked}>
            <OfflineCareFormNotice offline={offline} onRestore={() => draft.changed()} />
            <div className="callout core-care-callout">
              <ShieldCheck aria-hidden="true" />
              <span>
                至少填一項；血壓須成對填寫。技術範圍只防止明顯輸入錯誤，不代表醫療判讀或診斷。
              </span>
            </div>
            <label className="field">
              <span id={validation.labelId("client_id")}>個案 *</span>
              <select defaultValue={unavailableSelection ? "" : selectedClientId ?? ""} name="client_id" required {...validation.field("client_id")}>
                <option value="">請選擇個案</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}（{client.code}）
                  </option>
                ))}
              </select>
              <DailyFieldError validation={validation} name="client_id" />
            </label>
            <label className="field">
              <span id={validation.labelId("measured_at")}>量測日期與時間 *</span>
              <input
                defaultValue={defaultTaipeiLocal(serviceDate)}
                name="measured_at"
                {...validation.field("measured_at")}
                required
                type="datetime-local"
              />
              <DailyFieldError validation={validation} name="measured_at" />
            </label>
            <fieldset className="vital-inputs">
              <legend>量測值（至少一項）</legend>
              <label className="field">
                <span id={validation.labelId("systolic")}>收縮壓 mmHg</span>
                <input inputMode="decimal" max="350" min="20" name="systolic" step="1" type="number" {...validation.field("systolic")} />
                <DailyFieldError validation={validation} name="systolic" />
              </label>
              <label className="field">
                <span id={validation.labelId("diastolic")}>舒張壓 mmHg</span>
                <input inputMode="decimal" max="250" min="10" name="diastolic" step="1" type="number" {...validation.field("diastolic")} />
                <DailyFieldError validation={validation} name="diastolic" />
              </label>
              <label className="field">
                <span id={validation.labelId("pulse")}>脈搏 bpm</span>
                <input inputMode="decimal" max="350" min="10" name="pulse" step="1" type="number" {...validation.field("pulse")} />
                <DailyFieldError validation={validation} name="pulse" />
              </label>
              <label className="field">
                <span id={validation.labelId("temperature")}>體溫 °C</span>
                <input inputMode="decimal" max="50" min="20" name="temperature" step="0.1" type="number" {...validation.field("temperature")} />
                <DailyFieldError validation={validation} name="temperature" />
              </label>
              <label className="field">
                <span id={validation.labelId("oxygen_saturation")}>血氧 %</span>
                <input inputMode="decimal" max="100" min="1" name="oxygen_saturation" step="1" type="number" {...validation.field("oxygen_saturation")} />
                <DailyFieldError validation={validation} name="oxygen_saturation" />
              </label>
            </fieldset>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
          </fieldset>
          </div>
          <footer className="drawer__footer">
            <button className="button button--secondary" disabled={pending} onClick={close} type="button">
              {attempt.locked && !pending ? "稍後處理" : "取消"}
            </button>
            <button className="button button--primary" disabled={pending} type="submit">
              {pending ? "儲存中…" : attempt.locked ? "重試原量測" : "儲存量測"}
            </button>
          </footer>
        </form>
      </dialog>
    </div>
  );
}
