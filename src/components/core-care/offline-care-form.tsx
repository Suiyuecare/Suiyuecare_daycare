"use client";

import { useState, type RefObject } from "react";
import type { OfflineDraftKind } from "@/lib/offline/draft-store";
import { careRequestHash, type CareLocalDraft } from "@/lib/offline/care-outbox";
import { useOfflineCare } from "./offline-care-provider";

type Options = {
  kind: OfflineDraftKind; serviceDate: string; enabled: boolean; demo: boolean;
  allowedClientIds: readonly string[]; formRef: RefObject<HTMLFormElement | null>;
  idempotencyKey: RefObject<string>;
  onRestoreId: (id: string) => void;
};

function valuesOf(form: HTMLFormElement | null) {
  const values: Record<string, string> = {};
  if (!form) return values;
  for (const field of Array.from(form.elements)) {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) ||
      !field.name || ["password", "file", "hidden"].includes(field.type)) continue;
    values[field.name] = field instanceof HTMLInputElement && field.type === "checkbox" ? String(field.checked) : field.value;
  }
  return values;
}

export function useOfflineCareForm(options: Options) {
  const context = useOfflineCare();
  const [message, setMessage] = useState("");
  const enabled = Boolean(context?.enabled && options.enabled && !options.demo);
  const recoverable = enabled ? context!.drafts.filter((item) => item.kind === options.kind &&
    item.payload.serviceDate === options.serviceDate && options.allowedClientIds.includes(item.clientRef) && item.payload.state === "local") : [];

  async function capture() {
    if (!enabled) return;
    const formValues = valuesOf(options.formRef.current);
    const clientRef = formValues.client_id;
    if (!clientRef || !options.allowedClientIds.includes(clientRef)) return;
    try {
      await context!.save({ id: options.idempotencyKey.current, kind: options.kind, clientRef, baseVersion: 0,
        payload: { schema: 1, serviceDate: options.serviceDate, formValues, state: "local" } });
      setMessage("已暫存這台裝置，尚未送出。最多保留 24 小時。");
    } catch { setMessage("裝置草稿尚未確認保存，請保留畫面並勿關閉分頁。"); }
  }

  function restore(item: CareLocalDraft) {
    if (!enabled || !recoverable.some((candidate) => candidate.id === item.id) || Date.parse(item.expiresAt) <= Date.now()) return null;
    options.onRestoreId(item.id);
    const values = item.payload.formValues;
    const form = options.formRef.current;
    if (form) for (const field of Array.from(form.elements)) {
      if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) ||
        !Object.hasOwn(values, field.name) || ["password", "file", "hidden"].includes(field.type)) continue;
      if (field instanceof HTMLInputElement && field.type === "checkbox") field.checked = values[field.name] === "true";
      else field.value = values[field.name];
    }
    setMessage("已恢復原草稿，請確認實際時間與內容後儲存；尚未送出。");
    return values;
  }

  async function queueIfOffline(body: Record<string, unknown>) {
    if (typeof navigator === "undefined" || navigator.onLine || options.demo) return false;
    if (!enabled || !options.allowedClientIds.includes(String(body.client_id))) throw new Error("無法保存離線草稿，請保留畫面並待網路恢復。");
    await context!.save({ id: options.idempotencyKey.current, kind: options.kind,
      clientRef: String(body.client_id), baseVersion: 0, payload: { schema: 1,
        serviceDate: options.serviceDate, formValues: valuesOf(options.formRef.current), state: "queued",
        request: { body, hash: await careRequestHash(body) } } });
    setMessage("已保存在裝置等待送出；尚未確認儲存到系統。重新連線後會以原筆操作重試。");
    return true;
  }

  async function saved() {
    if (!enabled) return;
    try { await context!.remove(options.idempotencyKey.current); setMessage(""); }
    catch { setMessage("伺服器已儲存，但裝置草稿尚未移除；請勿重建同一筆紀錄。"); }
  }
  async function retainUnconfirmed(body: Record<string, unknown>) {
    if (!enabled || !options.allowedClientIds.includes(String(body.client_id))) return;
    try {
      await context!.save({ id: options.idempotencyKey.current, kind: options.kind,
        clientRef: String(body.client_id), baseVersion: 0, payload: { schema: 1,
          serviceDate: options.serviceDate, formValues: valuesOf(options.formRef.current), state: "review",
          message: "上一筆儲存結果尚未確認；只可用原內容重試，避免產生重複紀錄。",
          request: { body, hash: await careRequestHash(body) } } });
      setMessage("原送出內容已保留在裝置，請確認上一筆結果後重試；不會另建一筆。");
    } catch { setMessage("原送出內容尚未保存到裝置，請勿關閉此分頁，並使用原內容重試。"); }
  }
  return { enabled, message, recoverable, capture, restore, queueIfOffline, saved, retainUnconfirmed };
}

export function OfflineCareFormNotice({ offline, onRestore }: {
  offline: ReturnType<typeof useOfflineCareForm>;
  onRestore?: (values: Record<string, string>) => void;
}) {
  if (!offline.enabled) return null;
  return <section className="offline-care-form" aria-label="裝置草稿">
    <p role="status">{offline.message || "填寫中會暫存這台裝置；只有按下儲存才會送出。"}</p>
    {offline.recoverable.map((item) => <button className="button button--secondary" type="button" key={item.id} onClick={() => {
      const values = offline.restore(item);
      if (values) onRestore?.(values);
    }}>恢復 {new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(item.createdAt))} 的未送出草稿</button>)}
  </section>;
}
