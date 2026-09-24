"use client";

import { FormEvent, MouseEvent, useMemo, useRef, useState } from "react";
import { FileSignature, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { fetchWithTimeout } from "@/lib/api/client-fetch";
import {
  parseServiceCompletionEnvelope,
  parseServiceCompletionError,
} from "@/lib/service-management/completion-client";
import type { ServiceUsageClientOption } from "@/lib/service-management/types";

function taipeiClock(serviceDate: string, offsetMinutes: number) {
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
  const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  const adjusted = Math.max(0, Math.min(23 * 60 + 59, currentMinutes + offsetMinutes));
  const hour = String(Math.floor(adjusted / 60)).padStart(2, "0");
  const minute = String(adjusted % 60).padStart(2, "0");
  return `${serviceDate}T${hour}:${minute}`;
}

function taipeiLocalToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) {
    throw new Error("日期時間格式錯誤。");
  }
  const parsed = new Date(`${value}:00+08:00`);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("日期時間格式錯誤。");
  }
  return parsed.toISOString();
}

export function ServiceUsageComposer({
  clients,
  serviceDate,
  canComplete,
  hasRecentAal2,
  demo,
}: {
  clients: readonly ServiceUsageClientOption[];
  serviceDate: string;
  canComplete: boolean;
  hasRecentAal2: boolean;
  demo: boolean;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const eligibleClients = useMemo(
    () => clients.filter(
      (client) =>
        client.status === "active" &&
        client.admittedOn !== null &&
        client.admittedOn <= serviceDate &&
        client.endedOn === null,
    ),
    [clients, serviceDate],
  );
  const [clientId, setClientId] = useState(eligibleClients[0]?.id ?? "");
  const [serviceCode, setServiceCode] = useState("");
  const [startedAt, setStartedAt] = useState(taipeiClock(serviceDate, -60));
  const [endedAt, setEndedAt] = useState(taipeiClock(serviceDate, 0));
  const [result, setResult] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const enabled =
    (demo || (canComplete && hasRecentAal2)) && eligibleClients.length > 0;

  function resetForOpen() {
    setClientId(eligibleClients[0]?.id ?? "");
    setServiceCode("");
    setStartedAt(taipeiClock(serviceDate, -60));
    setEndedAt(taipeiClock(serviceDate, 0));
    setResult("");
    setNotes("");
    setError(null);
    setNotice(null);
    setNeedsReauth(false);
    idempotencyKey.current = crypto.randomUUID();
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
      setNeedsReauth(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNeedsReauth(false);
    try {
      const normalizedServiceCode = serviceCode.trim().toUpperCase();
      const normalizedStartedAt = taipeiLocalToIso(startedAt);
      const normalizedEndedAt = taipeiLocalToIso(endedAt);
      const response = await fetchWithTimeout("/api/service-events/complete", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify({
          client_id: clientId,
          service_code: normalizedServiceCode,
          started_at: normalizedStartedAt,
          ended_at: normalizedEndedAt,
          result,
          ...(notes.trim() ? { notes } : {}),
        }),
      });
      const rawEnvelope: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const firstError = parseServiceCompletionError(rawEnvelope);
        if (
          firstError?.code === "AAL2_REQUIRED" ||
          firstError?.code === "SERVICE_COMPLETION_NOT_AUTHORIZED"
        ) {
          setNeedsReauth(true);
        }
        throw new Error(firstError?.message || "SAVE_FAILED");
      }
      const envelope = parseServiceCompletionEnvelope(
        rawEnvelope,
        response.status,
        {
          clientId,
          serviceCode: normalizedServiceCode,
          startedAt: normalizedStartedAt,
          endedAt: normalizedEndedAt,
        },
      );

      close();
      setNotice(
        envelope.data.demo
          ? "展示服務已通過相同欄位驗證；不會保存個案、證據或簽署。"
          : envelope.data.replayed
            ? "已確認先前相同的完成簽署，不會建立重複服務。"
            : "服務已完成並簽署；計畫連結、簽署人與內容雜湊已由伺服器保存。",
      );
      idempotencyKey.current = crypto.randomUUID();
      if (!demo) router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message !== "SAVE_FAILED"
          ? caught.message
          : "服務尚未確認完成。畫面內容仍保留，請直接重試；系統會沿用同一冪等鍵。",
      );
    } finally {
      setPending(false);
    }
  }

  const disabledReason = !canComplete && !demo
    ? "目前角色必須同時具備 services.write 與 services.sign"
    : !hasRecentAal2 && !demo
      ? "請先完成最近 15 分鐘內的雙因素重新驗證"
      : eligibleClients.length === 0
        ? "目前沒有已收案、服務中且未結案的個案"
        : undefined;
  const dayStart = `${serviceDate}T00:00`;
  const dayEnd = `${serviceDate}T23:59`;

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
        <FileSignature aria-hidden="true" />完成並簽署服務
      </button>
      {!demo && canComplete && !hasRecentAal2 ? (
        <Link className="reauth-link" href="/mfa?audience=staff&purpose=sensitive-action">
          <ShieldCheck aria-hidden="true" />完成近期雙因素驗證
        </Link>
      ) : null}
      {notice ? (
        <p className="core-composer__notice" role="status">
          {notice}
        </p>
      ) : null}
      <dialog
        aria-labelledby="service-usage-dialog-title"
        className="core-dialog"
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        onClose={() => trigger.current?.focus()}
        ref={dialog}
      >
        <form className="core-dialog__surface" onChange={changed} onSubmit={submit}>
          <header className="drawer__header">
            <div>
              <p className="eyebrow">完成＋簽署單一交易</p>
              <h2 id="service-usage-dialog-title">完成並簽署服務</h2>
              <p>個案、服務事實與窄化證據送出後，由資料庫解析當日唯一有效計畫。</p>
            </div>
            <button aria-label="關閉" className="icon-button" onClick={close} type="button">
              <X aria-hidden="true" />
            </button>
          </header>
          <div className="drawer__body core-dialog__body">
            <div className="callout core-care-callout">
              <ShieldCheck aria-hidden="true" />
              <span>
                確認後會立即建立「已完成且已簽署」的不可直接修改紀錄；伺服器會寫入簽署人、時間、目的與內容雜湊。
              </span>
            </div>
            <label className="field">
              <span>個案 *</span>
              <select
                autoFocus
                onChange={(event) => setClientId(event.currentTarget.value)}
                required
                value={clientId}
              >
                {eligibleClients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}（{client.code}）
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>服務代碼 *</span>
              <input
                autoCapitalize="characters"
                maxLength={40}
                onChange={(event) => setServiceCode(event.currentTarget.value)}
                pattern="[A-Za-z0-9][A-Za-z0-9._/-]{0,39}"
                placeholder="例如：BA01"
                required
                value={serviceCode}
              />
              <small>此版只驗證代碼格式；版本化代碼、資格與費率規則仍待建置。</small>
            </label>
            <div className="vital-inputs">
              <label className="field">
                <span>開始時間 *</span>
                <input
                  max={dayEnd}
                  min={dayStart}
                  onChange={(event) => setStartedAt(event.currentTarget.value)}
                  required
                  type="datetime-local"
                  value={startedAt}
                />
              </label>
              <label className="field">
                <span>結束時間 *</span>
                <input
                  max={dayEnd}
                  min={dayStart}
                  onChange={(event) => setEndedAt(event.currentTarget.value)}
                  required
                  type="datetime-local"
                  value={endedAt}
                />
              </label>
            </div>
            <label className="field">
              <span>執行結果 *</span>
              <textarea
                maxLength={240}
                onChange={(event) => setResult(event.currentTarget.value)}
                placeholder="客觀記錄本次服務完成結果。"
                required
                value={result}
              />
            </label>
            <label className="field">
              <span>備註（選填）</span>
              <textarea
                aria-describedby="service-notes-hint"
                maxLength={2000}
                onChange={(event) => setNotes(event.currentTarget.value)}
                placeholder="補充反應或後續注意事項；請勿貼入非必要敏感資料。"
                value={notes}
              />
              <small id="service-notes-hint">結果與備註的 UTF-8 JSON 合計上限 4KB。</small>
            </label>
            <label className="check-field">
              <input name="confirmed" required type="checkbox" />
              <span>我確認上述內容正確，並同意以目前身分立即完成與簽署此服務紀錄。</span>
            </label>
            {error ? (
              <div>
                <p className="form-error" role="alert">{error}</p>
                {needsReauth ? (
                  <Link className="reauth-link reauth-link--inline" href="/mfa?audience=staff&purpose=sensitive-action">
                    <ShieldCheck aria-hidden="true" />重新完成雙因素驗證
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>
          <footer className="drawer__footer">
            <button className="button button--secondary" onClick={close} type="button">取消</button>
            <button
              className="button button--primary"
              disabled={pending || !clientId}
              type="submit"
            >
              {pending ? "簽署中…" : "確認完成並簽署"}
            </button>
          </footer>
        </form>
      </dialog>
    </div>
  );
}
