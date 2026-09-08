"use client";

import { FormEvent, MouseEvent, useRef, useState } from "react";
import { Droplets, ShieldCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { parseBloodGlucoseSuccess } from "@/lib/blood-glucose/client-contract";
import type {
  BloodGlucoseMealContext,
  BloodGlucoseUnit,
} from "@/lib/blood-glucose/constants";

type ClientOption = { id: string; name: string; code: string };

const mealContextLabels: Record<BloodGlucoseMealContext, string> = {
  fasting: "空腹",
  pre_meal: "餐前",
  post_meal: "餐後",
  random: "隨機",
};

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

async function responseError(response: Response) {
  try {
    const body = (await response.json()) as {
      errors?: Array<{ message?: unknown }>;
    };
    const message = body.errors?.[0]?.message;
    if (typeof message === "string" && message.trim()) return message;
  } catch {
    // Keep a safe fallback for non-JSON intermediary responses.
  }
  return "血糖量測未確認儲存。畫面內容仍保留，請以相同冪等鍵直接重試。";
}

export function BloodGlucoseComposer({
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
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [measuredAt, setMeasuredAt] = useState("");
  const [mealContext, setMealContext] =
    useState<BloodGlucoseMealContext>("pre_meal");
  const [unit, setUnit] = useState<BloodGlucoseUnit>("mg/dL");
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function resetForOpen() {
    setClientId(clients[0]?.id ?? "");
    setMeasuredAt(defaultTaipeiLocal(serviceDate));
    setMealContext("pre_meal");
    setUnit("mg/dL");
    setValue("");
    idempotencyKey.current = crypto.randomUUID();
    setError(null);
    setNotice(null);
  }

  function open(event: MouseEvent<HTMLButtonElement>) {
    trigger.current = event.currentTarget;
    resetForOpen();
    dialog.current?.showModal();
  }

  function close() {
    dialog.current?.close();
  }

  function changed() {
    if (error) {
      idempotencyKey.current = crypto.randomUUID();
      setError(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const numericValue = Number(value);
      if (!value.trim() || !Number.isFinite(numericValue)) {
        throw new Error("請輸入有效的血糖數值。");
      }
      const normalizedMeasuredAt = taipeiLocalToIso(measuredAt);
      const response = await fetchWithTimeout("/api/blood-glucose", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify({
          client_id: clientId,
          measured_at: normalizedMeasuredAt,
          meal_context: mealContext,
          value: numericValue,
          unit,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const raw: unknown = await response.json().catch(() => null);
      parseBloodGlucoseSuccess(raw, response.status, {
        clientId,
        measuredAt: normalizedMeasuredAt,
        mealContext,
        value: numericValue,
        unit,
      });

      close();
      setNotice(
        demo
          ? "展示血糖已通過相同欄位與冪等驗證；展示資料不會永久保存。"
          : "血糖量測已儲存。數值只作紀錄，不代表系統診斷。",
      );
      idempotencyKey.current = crypto.randomUUID();
      if (!demo) router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error && submitError.message
          ? submitError.message
          : "血糖量測未確認儲存。畫面內容仍保留，請以相同冪等鍵直接重試。",
      );
    } finally {
      setPending(false);
    }
  }

  const rangeHint =
    unit === "mg/dL"
      ? "技術輸入範圍 20–600，僅接受整數。"
      : "技術輸入範圍 1.1–33.3，最多一位小數。";

  return (
    <div className="core-composer">
      <button
        className="button button--primary"
        disabled={!enabled || clients.length === 0}
        onClick={open}
        title={
          !enabled
            ? "目前角色沒有新增血糖量測的權限"
            : clients.length === 0
              ? "沒有可量測的個案"
              : undefined
        }
        type="button"
      >
        <Droplets aria-hidden="true" />新增血糖
      </button>
      {notice ? (
        <p className="core-composer__notice" role="status">
          {notice}
        </p>
      ) : null}
      <dialog
        aria-labelledby="blood-glucose-dialog-title"
        className="core-dialog"
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        onClose={() => trigger.current?.focus()}
        ref={dialog}
      >
        <form className="core-dialog__surface" onSubmit={submit}>
          <header className="drawer__header">
            <div>
              <p className="eyebrow">專用血糖交易</p>
              <h2 id="blood-glucose-dialog-title">新增血糖量測</h2>
              <p>量測時間以 Asia/Taipei 解讀；只能新增最近 24 小時內的資料。</p>
            </div>
            <button
              aria-label="關閉"
              className="icon-button"
              onClick={close}
              type="button"
            >
              <X aria-hidden="true" />
            </button>
          </header>
          <div className="drawer__body core-dialog__body">
            <div className="callout core-care-callout">
              <ShieldCheck aria-hidden="true" />
              <span>
                系統保存量測值、情境、單位、時間與來源。技術範圍只防止明顯輸入錯誤，不會自動診斷或改變照顧決策。
              </span>
            </div>
            <label className="field">
              <span>個案 *</span>
              <select
                autoFocus
                onChange={(event) => {
                  changed();
                  setClientId(event.target.value);
                }}
                required
                value={clientId}
              >
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
                onChange={(event) => {
                  changed();
                  setMeasuredAt(event.target.value);
                }}
                required
                type="datetime-local"
                value={measuredAt}
              />
            </label>
            <label className="field">
              <span>量測情境 *</span>
              <select
                onChange={(event) => {
                  changed();
                  setMealContext(event.target.value as BloodGlucoseMealContext);
                }}
                required
                value={mealContext}
              >
                {Object.entries(mealContextLabels).map(([context, label]) => (
                  <option key={context} value={context}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>單位 *</span>
              <select
                onChange={(event) => {
                  changed();
                  setUnit(event.target.value as BloodGlucoseUnit);
                  setValue("");
                }}
                required
                value={unit}
              >
                <option value="mg/dL">mg/dL</option>
                <option value="mmol/L">mmol/L</option>
              </select>
            </label>
            <label className="field">
              <span>血糖數值 *</span>
              <input
                aria-describedby="blood-glucose-range-hint"
                inputMode="decimal"
                max={unit === "mg/dL" ? 600 : 33.3}
                min={unit === "mg/dL" ? 20 : 1.1}
                onChange={(event) => {
                  changed();
                  setValue(event.target.value);
                }}
                required
                step={unit === "mg/dL" ? 1 : 0.1}
                type="number"
                value={value}
              />
              <small id="blood-glucose-range-hint">{rangeHint}</small>
            </label>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <footer className="drawer__footer">
            <button
              className="button button--secondary"
              onClick={close}
              type="button"
            >
              取消
            </button>
            <button
              className="button button--primary"
              disabled={pending || !clientId}
              type="submit"
            >
              {pending ? "儲存中…" : "儲存血糖"}
            </button>
          </footer>
        </form>
      </dialog>
    </div>
  );
}
