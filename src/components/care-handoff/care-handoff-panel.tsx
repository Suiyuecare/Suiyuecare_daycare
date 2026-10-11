"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowRightLeft, CheckCheck, RefreshCw } from "lucide-react";
import { z } from "zod";
import { handoffSnapshotSchema, handoffWriteSchema } from "@/lib/care-handoff/schema";
import { formatCareTaipeiTime } from "@/lib/core-care/date";
import { useProtectedCompletionDraft } from "@/lib/navigation/use-protected-completion-draft";
import styles from "@/components/clinical-attachments/clinical-attachments.module.css";
type Snapshot = z.infer<typeof handoffSnapshotSchema>;
type HandoffProps = { clientId: string; sourceRecordId: string; canWrite: boolean; demo?: boolean };
export function CareHandoffPanel(props: HandoffProps) { return <CareHandoffClient key={`${props.clientId}:${props.sourceRecordId}`} {...props} />; }
function CareHandoffClient({ clientId, sourceRecordId, canWrite, demo = false }: HandoffProps) {
  const inputId = useId(); const [opened, setOpened] = useState(false); const [snapshot, setSnapshot] = useState<Snapshot | null>(null); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const unresolved = useRef<z.infer<typeof handoffWriteSchema> | null>(null); const loading = useRef<AbortController | null>(null);
  const [held, setHeld] = useState(false);
  const [dirty, setDirty] = useState(false); const [editing, setEditing] = useState(""); const [readAt, setReadAt] = useState(0); const submitted = useRef<HTMLFormElement | null>(null);
  useProtectedCompletionDraft(dirty, busy, held);
  async function load() { loading.current?.abort(); const controller = new AbortController(); loading.current = controller; const timeout = setTimeout(() => controller.abort(), 15_000); setBusy(true);
    try { const response = await fetch(`/api/care-handoffs?client=${encodeURIComponent(clientId)}`, { cache: "no-store", signal: controller.signal }); const parsed = z.object({ data: z.object({ snapshot: handoffSnapshotSchema }) }).parse(await response.json()); if (!response.ok || parsed.data.snapshot.clientId !== clientId || controller.signal.aborted) throw new Error(); setSnapshot(parsed.data.snapshot); setReadAt(Date.now()); }
    catch { if (loading.current === controller) { setSnapshot(null); setMessage("交班暫時無法讀取，請重試。"); } } finally { clearTimeout(timeout); if (loading.current === controller) setBusy(false); }
  }
  useEffect(() => () => loading.current?.abort(), []);
  async function send(input?: z.infer<typeof handoffWriteSchema>) {
    const frozen = unresolved.current ?? input; if (!frozen || busy) return; unresolved.current = frozen; setHeld(true); setBusy(true); setMessage("");
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15_000);
    try { const response = await fetch("/api/care-handoffs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(frozen), cache: "no-store", signal: controller.signal }); if (response.status === 401 || response.status === 403) setSnapshot(null); const result = z.object({ data: z.object({ receipt: z.object({ id: z.uuid(), version: z.number().int().positive(), replayed: z.boolean() }) }) }).parse(await response.json()); if (!response.ok || (frozen.action !== "create" && result.data.receipt.id !== frozen.id)) throw new Error(); unresolved.current = null; setHeld(false); submitted.current?.reset(); setDirty(false); setEditing(""); setMessage("交班已保存"); setBusy(false); await load(); }
    catch { setMessage("結果尚未確認，請重試原操作；內容仍保留。"); } finally { clearTimeout(timeout); setBusy(false); }
  }
  return <details className={styles.root} onToggle={event => { const next = event.currentTarget.open; setOpened(next); if (next && !demo && !snapshot && !busy) void load(); }}><summary><ArrowRightLeft aria-hidden="true" />交班與追蹤</summary>{opened ? <div className={styles.body}>
    {demo ? <p>展示模式不保存交班。</p> : <>{message ? <p role="status">{message}</p> : null}{busy ? <p role="status">處理中…</p> : null}
      {held ? <button className="button button--secondary" disabled={busy} onClick={() => void send()} type="button">重試原操作</button> : null}
      {dirty && !busy && !held ? <button className="button button--secondary" type="button" onClick={event => { event.currentTarget.closest("details")?.querySelectorAll("form").forEach(form => form.reset()); setDirty(false); setEditing(""); }}>清除未送出內容</button> : null}
      {snapshot?.rows.filter(row => row.sourceRecordId === sourceRecordId).map(row => <article key={row.id}><h4>{row.ownerName} · {row.status === "created" ? "待接班" : row.status === "closed" ? "已完成" : "已接班"}</h4><p>{row.message}</p><small>交班：{row.senderName} · 期限 {formatCareTaipeiTime(row.dueAt)}{row.status !== "closed" && Date.parse(row.dueAt) < readAt ? " · 已逾期" : ""}</small>{row.acknowledgedAt ? <p>接班時間 {formatCareTaipeiTime(row.acknowledgedAt)}</p> : null}
        {row.ownerId === snapshot.actorId && row.status === "created" ? <button type="button" className="button button--primary" disabled={busy || held || dirty} onClick={() => void send({ action: "acknowledge", clientId, id: row.id, expectedVersion: row.version, note: "", idempotency_key: crypto.randomUUID() })}><CheckCheck aria-hidden="true" />確認接班</button> : null}
        {row.ownerId === snapshot.actorId && row.status === "acknowledged" ? <form noValidate className={styles.form} onChange={() => { setDirty(true); setEditing(row.id); }} onSubmit={event => { event.preventDefault(); submitted.current = event.currentTarget; const form = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter); const input = handoffWriteSchema.safeParse({ action: form.get("action"), clientId, id: row.id, expectedVersion: row.version, note: form.get("note"), idempotency_key: crypto.randomUUID() }); if (!input.success) { setMessage("請填寫追蹤結果。"); return; } void send(input.data); }}><label htmlFor={`${inputId}-${row.id}`}>追蹤結果<textarea id={`${inputId}-${row.id}`} name="note" maxLength={1000} disabled={busy || held || Boolean(editing && editing !== row.id)} /></label><div className={styles.actions}><button name="action" value="follow_up" type="submit" className="button button--secondary" disabled={busy || held || Boolean(editing && editing !== row.id)}>保存追蹤</button><button name="action" value="close" type="submit" className="button button--primary" disabled={busy || held || Boolean(editing && editing !== row.id)}>完成追蹤</button></div></form> : null}
        <details><summary>追蹤歷程</summary><ol>{row.events.map((event, index) => <li key={index}>{event.actorName} · {formatCareTaipeiTime(event.at)} · {event.note || (event.action === "created" ? "交班" : "接班確認")}</li>)}</ol></details>
      </article>)}
      {canWrite && snapshot ? <form noValidate className={styles.form} onChange={() => { setDirty(true); setEditing("create"); }} onSubmit={event => { event.preventDefault(); submitted.current = event.currentTarget; const form = new FormData(event.currentTarget); const local = String(form.get("dueAt") ?? ""); const date = new Date(`${local}:00+08:00`); const input = handoffWriteSchema.safeParse({ action: "create", clientId, sourceRecordId, ownerId: form.get("ownerId"), message: form.get("message"), dueAt: Number.isFinite(date.getTime()) ? date.toISOString() : "", idempotency_key: crypto.randomUUID() }); if (!input.success) { setMessage("請選接班人，並填寫交班內容與期限。"); return; } void send(input.data); }}><fieldset disabled={busy || held || Boolean(editing && editing !== "create")}><legend>新交班</legend><label htmlFor={`${inputId}-owner`}>接班人<select id={`${inputId}-owner`} name="ownerId"><option value="">請選擇</option>{snapshot.recipients.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label htmlFor={`${inputId}-due`}>追蹤期限（台北時間）<input id={`${inputId}-due`} type="datetime-local" name="dueAt" /></label><label htmlFor={`${inputId}-message`}>交班內容<textarea id={`${inputId}-message`} name="message" maxLength={1000} /></label><button type="submit" className="button button--primary" disabled={!snapshot.recipients.length}>送出交班</button></fieldset></form> : null}
      <button type="button" className="button button--secondary" disabled={busy || held || dirty} onClick={() => void load()}><RefreshCw aria-hidden="true" />更新交班</button>
    </>}
  </div> : null}</details>;
}
