"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { formatCareTaipeiTime } from "@/lib/core-care/date";
import { reminderReceiptSchema, reminderSnapshotSchema, type ReminderMutation, type ReminderSnapshot } from "@/lib/care-reminders/contracts";
import styles from "./care-reminders.module.css";

export function RefreshCareReminders() {
  const router = useRouter();
  return <button className="button button--secondary" type="button" onClick={() => router.refresh()}>重新載入提醒</button>;
}

export function CareReminderPanel({ initial, demo = false }: { initial: ReminderSnapshot; demo?: boolean }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [sourceId, setSourceId] = useState("");
  const [identity, setIdentity] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  // Keep exact input and key after uncertain response. No altered retry payload.
  const retry = useRef<ReminderMutation | null>(null);
  const [hasRetry, setHasRetry] = useState(false);
  const source = snapshot.sources.find((item) => item.id === sourceId);
  async function reload() {
    const response = await fetchWithTimeout(`/api/care-reminders?client_id=${encodeURIComponent(snapshot.client_id)}`, { cache: "no-store" });
    const raw = await response.json();
    const checked = reminderSnapshotSchema.safeParse(raw?.data);
    if (!response.ok || raw?.status !== "ok" || !checked.success || checked.data.client_id !== snapshot.client_id) throw new Error("無法更新提醒，請重新載入頁面核對；不代表沒有注意事項。");
    setSnapshot(checked.data);
  }
  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true);
    try { await reload(); setError(null); }
    catch { setError("暫時無法更新，請保留原資料並稍後重試。"); }
    finally { inFlight.current = false; setPending(false); }
  }
  async function mutate(input: ReminderMutation) {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true); setError(null); setMessage(null);
    retry.current = input; setHasRetry(true);
    try {
      const response = await fetchWithTimeout("/api/care-reminders", { method: "POST", headers: {
        "Content-Type": "application/json", "Idempotency-Key": input.idempotency_key,
      }, body: JSON.stringify(input) });
      const raw = await response.json();
      if (!response.ok) {
        if ([400, 403, 409].includes(response.status)) { retry.current = null; setHasRetry(false); }
        throw new Error(response.status === 409 ? "來源或狀態已變更，請更新提醒後再核對。" : "尚未確認完成，請保留資料；無法重試時請聯絡管理員。");
      }
      const checked = reminderReceiptSchema.safeParse(raw?.data);
      if (raw?.status !== "ok" || !checked.success || checked.data.client_id !== input.client_id || checked.data.action !== input.action || checked.data.idempotency_key !== input.idempotency_key) throw new Error("儲存回執無法確認，請使用相同操作重試。");
      retry.current = null; setHasRetry(false); setReason(""); setIdentity(false);
      setMessage(input.action === "generate" ? `已建立 ${checked.data.affected} 筆待核對提醒。沒有候選不代表個案沒有注意事項；中央資料仍未正式入檔。`
        : input.action === "confirm" ? "提醒已由您核對發布；不會更動原照顧計畫。" : "已保存不採用／撤回理由，不會刪除原始紀錄。");
      await reload();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "操作結果無法確認，請稍後重試。"); }
    finally { inFlight.current = false; setPending(false); }
  }
  return <section className="panel" aria-labelledby="care-reminder-heading">
    <div className="panel__header"><div className="panel__title"><h2 id="care-reminder-heading">個案照顧提醒</h2><p>只使用人工核對後的提醒；仍以現行核准照顧計畫為準。</p></div></div>
    <div className={`panel__body ${styles.body}`}>
      <p>更新時間：{formatCareTaipeiTime(snapshot.generated_at)}。{error ? "目前顯示上次取得的資料，請先核對是否仍適用。" : "照顧前仍須確認資料是否適用於今天。"}</p>
      {demo ? <p className="callout">展示資料，尚未載入真實個案提醒。</p> : null}
      {!snapshot.reminders.length ? <p>目前尚無已核對提醒，不代表沒有照顧風險。請先確認個案現行照顧計畫。</p> : null}
      {snapshot.reviewer ? <label className={styles.field}>核對理由（發布、撤回或來源關聯時必填，至少 5 字）<textarea value={reason} onChange={(event) => setReason(event.target.value)} disabled={pending || hasRetry} maxLength={1000} /></label> : null}
      <ul className={styles.list}>{snapshot.reminders.map((item) => <li key={item.id} className={styles.card}>
        <div><strong>{item.title}</strong><span className="status-pill">{item.status === "confirmed" ? "已人工核對" : item.status === "dismissed" ? "不採用／已撤回" : "待人工核對，尚非照顧指示"}</span></div>
        <p>{item.text}</p>
        {item.source_changed ? <p className="callout">已有新版中央來源，這筆已核對提醒保留但需要重新確認；不會自動覆寫既有照顧計畫。</p> : null}
        <p>來源為中央 HTML 暫存資料，並非正式入檔。{item.reviewed_at ? `核對時間：${formatCareTaipeiTime(item.reviewed_at)}` : "尚未核對"}</p>
        {snapshot.reviewer ? <details><summary>來源與版本核對</summary><dl>
          <dt>批次</dt><dd>{item.batch_id}</dd><dt>欄位／原選項</dt><dd>{item.source.label}：{item.source.sourceValue}</dd>
          <dt>來源位置</dt><dd>{item.source.parentPath}</dd><dt>映射目標</dt><dd>{item.source.targetPath}</dd>
          <dt>規則版本</dt><dd>{item.rule_version}／{item.rule_id}</dd><dt>封存時間（不是評估日期）</dt><dd>{formatCareTaipeiTime(item.imported_at)}</dd>
        </dl></details> : null}
        {snapshot.reviewer && item.status !== "dismissed" ? <div className={styles.actions}>
          {item.status === "pending_review" ? <button className="button button--primary" type="button" disabled={pending || hasRetry || reason.trim().length < 5}
            onClick={() => mutate({ action: "confirm", client_id: snapshot.client_id, reminder_id: item.id, expected_status: "pending_review", reason, idempotency_key: crypto.randomUUID() })}>核對並發布這筆提醒</button> : null}
          <button className="button button--secondary" type="button" disabled={pending || hasRetry || reason.trim().length < 5}
            onClick={() => mutate({ action: "dismiss", client_id: snapshot.client_id, reminder_id: item.id, expected_status: item.status as "pending_review" | "confirmed", reason, idempotency_key: crypto.randomUUID() })}>{item.status === "confirmed" ? "撤回這筆提醒" : "不採用這筆提醒"}</button>
        </div> : null}
      </li>)}</ul>
      {snapshot.reviewer ? <details className={styles.review}><summary>管理核對：從中央暫存來源建立提醒</summary>
        <p>先比對原始來源與本頁個案的穩定識別資料，不以姓名相似自動配對。自動候選只是提醒您核對現行計畫，不會推斷診斷、藥量或飲食變更。</p>
        <p>來源關聯後不得直接改成另一位個案；若選錯，請停止發布並交由資料負責人核對，保留原始稽核。</p>
        <label className={styles.field}>已完成可信封存的中央來源<select value={sourceId} onChange={(event) => { setSourceId(event.target.value); setIdentity(false); }} disabled={pending || hasRetry}>
          <option value="">請選擇來源批次</option>{snapshot.sources.map((item) => <option key={item.id} value={item.id}>{item.file_name} · {item.id.slice(0, 8)}{item.associated_client_id ? " · 已關聯本個案" : " · 尚未關聯"}</option>)}
        </select></label>
        {!snapshot.sources.length ? <p>尚無可用的可信封存批次。一般解析預覽不會繞過七年封存與匯入授權；請先由管理員完成可信上傳。</p> : null}
        <label className={styles.check}><input type="checkbox" checked={identity} disabled={pending || hasRetry} onChange={(event) => setIdentity(event.target.checked)} />我已核對來源與目前個案的穩定識別資料，確認是同一人。</label>
        <button className="button button--primary" type="button" disabled={!source || !identity || reason.trim().length < 5 || pending || hasRetry} onClick={() => source && mutate({ action: "generate", client_id: snapshot.client_id,
          client_version: snapshot.client_version, batch_id: source.id, payload_sha256: source.payload_sha256, identity_confirmed: true, reason, idempotency_key: crypto.randomUUID() })}>產生待核對提醒</button>
      </details> : null}
      {error ? <p role="alert" className="form-error">{error}</p> : null}{message ? <p role="status" className="callout">{message}</p> : null}
      <div className={styles.actions}>{hasRetry ? <button className="button button--secondary" type="button" disabled={pending} onClick={() => retry.current && mutate(retry.current)}>以相同操作重試</button> : null}
        {!demo ? <button className="button button--secondary" type="button" disabled={pending} onClick={refresh}>更新提醒</button> : null}</div>
    </div>
  </section>;
}
