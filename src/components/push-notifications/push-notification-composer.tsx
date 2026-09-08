"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, Eye, LockKeyhole, Send, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";

import { fetchWithTimeout, isClientFetchTimeoutError } from "@/lib/api/client-fetch";
import {
  parsePushNotificationActionError,
  parsePushNotificationActionSuccess,
} from "@/lib/push-notifications/parser";
import type {
  PushNotificationQueueReceipt,
  PushNotificationRecipient,
  PushNotificationRecipientPreview,
} from "@/lib/push-notifications/types";

import styles from "./push-notifications.module.css";

function taipeiIso(localValue: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(localValue)) return null;
  const parsed = new Date(`${localValue}:00+08:00`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export function PushNotificationComposer({
  recipients,
  previewEnabled,
  queueEnabled,
  disabledReason,
  demo,
}: {
  recipients: readonly PushNotificationRecipient[];
  previewEnabled: boolean;
  queueEnabled: boolean;
  disabledReason?: string;
  demo: boolean;
}) {
  const router = useRouter();
  const [category, setCategory] = useState("工作提醒");
  const [priority, setPriority] = useState<0 | 1 | 2 | 3>(1);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [scheduledLocal, setScheduledLocal] = useState("");
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [preview, setPreview] = useState<PushNotificationRecipientPreview | null>(null);
  const [receipt, setReceipt] = useState<PushNotificationQueueReceipt | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState<"preview" | "queue" | null>(null);
  const [uncertainQueue, setUncertainQueue] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(crypto.randomUUID());

  const selectedSorted = useMemo(() => [...selected].sort(), [selected]);
  const fieldsLocked = pending !== null || receipt !== null || uncertainQueue;
  const scheduleIso = scheduleMode === "later" ? taipeiIso(scheduledLocal) : null;

  function changed(action: () => void) {
    if (fieldsLocked) return;
    action();
    setPreview(null);
    setConfirmed(false);
    setError(null);
    key.current = crypto.randomUUID();
  }

  function payload(mode: "preview" | "queue") {
    return {
      mode,
      category: category.trim(),
      priority,
      title: title.trim(),
      body: body.trim(),
      recipient_user_ids: selectedSorted,
      channels: ["in_app"],
      scheduled_for: scheduleIso,
    };
  }

  function validate() {
    if (!selectedSorted.length) return "請至少選擇一位目前分支的有效員工。";
    if (!category.trim() || !title.trim() || !body.trim()) {
      return "請完成分類、主旨與通知內容。";
    }
    if (scheduleMode === "later" && !scheduleIso) {
      return "請提供有效的台北時間排程日期與時間。";
    }
    return null;
  }

  async function submit(mode: "preview" | "queue") {
    if (pending || receipt) return;
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }
    if (mode === "queue" && (!preview || !confirmed || !queueEnabled)) return;
    if (mode === "preview" && !previewEnabled) return;
    setPending(mode);
    setError(null);
    try {
      const response = await fetchWithTimeout("/api/notifications/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key.current,
        },
        body: JSON.stringify(payload(mode)),
      });
      const raw: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const envelope = parsePushNotificationActionError(raw);
        const errorCode = envelope?.errors[0]?.code;
        setError(
          envelope?.errors[0]?.message ??
            (mode === "queue"
              ? "通知結果不明；請勿變更內容，直接使用相同操作重試。"
              : "收件者預覽失敗，系統未建立通知。"),
        );
        if (
          mode === "queue" &&
          (response.status >= 500 ||
            errorCode === "PUSH_NOTIFICATION_QUEUE_FAILED" ||
            errorCode === "PUSH_NOTIFICATION_RESULT_INVALID")
        ) {
          setUncertainQueue(true);
        }
        return;
      }
      const result = parsePushNotificationActionSuccess(raw, {
        mode,
        recipientUserIds: selectedSorted,
        httpStatus: response.status,
      });
      if (result.data.mode === "preview") {
        setPreview(result.data.preview);
      } else {
        setReceipt(result.data.receipt);
        router.refresh();
      }
    } catch (caught) {
      setError(isClientFetchTimeoutError(caught)
        ? caught.message
        : mode === "queue"
          ? "網路狀態不明；請勿變更內容，按下方按鈕以相同冪等鍵重試。"
          : "無法完成預覽；系統未建立通知。");
      if (mode === "queue") setUncertainQueue(true);
    } finally {
      setPending(null);
    }
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submit(preview ? "queue" : "preview");
  }

  return (
    <section aria-labelledby="push-composer-title" className={`panel ${styles.composer}`}>
      <div className="panel__header">
        <div className="panel__title">
          <h2 id="push-composer-title">建立站內員工通知</h2>
          <p>先由伺服器核對實際收件者，再以同一內容排入站內佇列。</p>
        </div>
        <span className="status-pill status-pill--success">in_app 唯一開放</span>
      </div>
      <form className={styles.composerForm} onSubmit={submitForm}>
        <fieldset className={styles.channelFieldset} disabled={fieldsLocked}>
          <legend>通知管道</legend>
          <div className={styles.channelGrid}>
            <label className={`${styles.channelCard} ${styles.channelActive}`}>
              <input checked readOnly type="checkbox" />
              <span><strong>站內通知</strong><small>目前唯一可建立的正式管道</small></span>
            </label>
            {[
              { id: "pwa", label: "PWA 推播", reason: "尚未接妥推播供應與裝置權杖" },
              { id: "line", label: "LINE", reason: "OA 綁定、同意與 webhook 尚未完成" },
              { id: "sms", label: "簡訊", reason: "正式供應商與回執尚未驗收" },
              { id: "family", label: "家屬收件", reason: "關係、個案與同意版本模型尚未完成" },
            ].map(({ id, label, reason }) => (
              <label className={styles.channelCard} key={label} title={reason}>
                <input aria-describedby={`disabled-${id}`} disabled type="checkbox" />
                <span><strong>{label}</strong><small id={`disabled-${id}`}>{reason}</small></span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className={styles.fieldsGrid}>
          <label className="field"><span>分類</span><input disabled={fieldsLocked} maxLength={80} onChange={(event) => changed(() => setCategory(event.target.value))} required value={category} /></label>
          <label className="field"><span>優先度</span><select disabled={fieldsLocked} onChange={(event) => changed(() => setPriority(Number(event.target.value) as 0 | 1 | 2 | 3))} value={priority}><option value={0}>0・低</option><option value={1}>1・一般</option><option value={2}>2・高</option><option value={3}>3・最高（技術暫行需確認）</option></select></label>
          <label className={`field ${styles.wideField}`}><span>主旨</span><input disabled={fieldsLocked} maxLength={80} onChange={(event) => changed(() => setTitle(event.target.value))} placeholder="例如：明日工作安排已更新" required value={title} /></label>
          <label className={`field ${styles.wideField}`}><span>內容</span><textarea disabled={fieldsLocked} maxLength={240} onChange={(event) => changed(() => setBody(event.target.value))} placeholder="僅放一般提醒；個資與健康資訊請改為登入系統查看。" required rows={3} value={body} /><small className={styles.counter}>{body.length}/240</small></label>
        </div>

        <fieldset className={styles.scheduleFieldset} disabled={fieldsLocked}>
          <legend>建立時間</legend>
          <label className="check-field"><input checked={scheduleMode === "now"} name="schedule" onChange={() => changed(() => setScheduleMode("now"))} type="radio" /><span>現在建立，立即出現在站內收件佇列</span></label>
          <label className="check-field"><input checked={scheduleMode === "later"} name="schedule" onChange={() => changed(() => setScheduleMode("later"))} type="radio" /><span>指定台北時間排程</span></label>
          {scheduleMode === "later" ? <label className="field"><span>排程時間（Asia/Taipei）</span><input disabled={fieldsLocked} onChange={(event) => changed(() => setScheduledLocal(event.target.value))} required type="datetime-local" value={scheduledLocal} /></label> : null}
        </fieldset>

        <fieldset className={styles.recipientFieldset} disabled={fieldsLocked || !previewEnabled}>
          <legend>目前有效員工收件者</legend>
          <div className={styles.recipientTools}>
            <span>已選 {selectedSorted.length}／{recipients.length} 人</span>
            <button className="button button--secondary" onClick={() => changed(() => setSelected(selected.length === recipients.length ? [] : recipients.map((recipient) => recipient.userId)))} type="button">{selected.length === recipients.length ? "清除全部" : "選取全部"}</button>
          </div>
          <div className={styles.recipientGrid}>
            {recipients.map((recipient) => (
              <label className={styles.recipientCard} key={recipient.userId}>
                <input checked={selected.includes(recipient.userId)} onChange={(event) => changed(() => setSelected(event.target.checked ? [...selected, recipient.userId] : selected.filter((id) => id !== recipient.userId)))} type="checkbox" />
                <span><strong>{recipient.displayName}</strong><small>{recipient.employeeCode ?? "無員工編號"}・{recipient.roleNames.join("、") || "尚無角色名稱"}・{recipient.membershipScope === "branch" ? "本分支" : "機構層級"}</small></span>
              </label>
            ))}
          </div>
        </fieldset>

        {preview ? (
          <section aria-live="polite" className={styles.previewBox}>
            <div className={styles.previewHeading}><div><p className="eyebrow">伺服器核對結果</p><h3>實際收件者 {preview.recipientCount} 人・站內佇列 {preview.deliveryCount} 筆</h3></div><span className="status-pill status-pill--success">未持久化預覽</span></div>
            <ul>{preview.recipients.map((recipient) => <li key={recipient.userId}>{recipient.displayName}</li>)}</ul>
            <label className="check-field"><input checked={confirmed} disabled={demo || fieldsLocked} onChange={(event) => setConfirmed(event.target.checked)} required={!demo} type="checkbox" /><span>我確認收件者、主旨與一般提醒內容正確，且未放入個資或健康資訊。</span></label>
          </section>
        ) : null}

        {receipt ? <div className={`callout ${styles.successCallout}`} role="status"><CheckCircle2 aria-hidden="true" /><span><strong>已持久化建立：</strong>{receipt.deliveryCount} 筆站內 delivery 狀態均為 queued；這不代表已送達或已讀。通知識別碼 {receipt.notificationId}</span></div> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {uncertainQueue && !receipt ? <button className="button button--primary" disabled={pending !== null} onClick={() => { setUncertainQueue(false); void submit("queue"); }} type="button">以相同內容與冪等鍵重試</button> : null}
        {!uncertainQueue ? (
          <div className={styles.actions}>
            <button className="button button--secondary" disabled={!previewEnabled || pending !== null || receipt !== null} onClick={() => void submit("preview")} type="button"><Eye aria-hidden="true" />{pending === "preview" ? "核對中…" : preview ? "重新核對收件者" : "預覽實際收件者"}</button>
            <button aria-describedby={demo ? "demo-queue-boundary" : undefined} className="button button--primary" disabled={!preview || !confirmed || !queueEnabled || pending !== null || receipt !== null} type="submit"><Send aria-hidden="true" />{pending === "queue" ? "建立中…" : scheduleMode === "later" ? "確認排程並建立" : "確認建立站內通知"}</button>
          </div>
        ) : null}
        {!previewEnabled && disabledReason ? <div className={`callout ${styles.lockedCallout}`} role="status"><LockKeyhole aria-hidden="true" /><span>{disabledReason}</span></div> : null}
        {demo ? <p className={styles.demoBoundary} id="demo-queue-boundary"><ShieldCheck aria-hidden="true" />展示模式可呼叫合成收件者預覽，但建立按鈕固定停用且 API 會拒絕 queue。</p> : null}
      </form>
    </section>
  );
}
