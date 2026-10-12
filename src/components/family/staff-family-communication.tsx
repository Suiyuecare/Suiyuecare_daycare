"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { MessageCircleMore, RefreshCw, Send, Share2, Undo2 } from "lucide-react";
import { z } from "zod";
import { familyPublishSchema, familyStaffWorkspaceSchema, familyStaffWriteSchema, type FamilyStaffWorkspaceSnapshot } from "@/lib/family/workspace-schema";
import { formatCareTaipeiTime } from "@/lib/core-care/date";
import { useProtectedCompletionDraft } from "@/lib/navigation/use-protected-completion-draft";
import { ClinicalAttachments } from "@/components/clinical-attachments/clinical-attachments";
import { FamilySchedule } from "./family-schedule";
import styles from "./family-live-workspace.module.css";

type Attempt = { kind: "write"; input: z.infer<typeof familyStaffWriteSchema> } | { kind: "publish"; input: z.infer<typeof familyPublishSchema> };
type ClientOption = { id: string; name: string; code: string };
const labels = { care: "照顧", health: "健康", attendance: "出勤", schedule: "行程", billing: "帳單", document: "文件", notice: "通知" };
async function readStaffWorkspace(clientId: string, recipientId: string, signal: AbortSignal) {
  const query = new URLSearchParams({ client: clientId }); if (recipientId) query.set("recipient", recipientId);
  const response = await fetch(`/api/family-communication?${query}`, { cache: "no-store", signal });
  const data = z.object({ data: z.object({ snapshot: familyStaffWorkspaceSchema }) }).parse(await response.json());
  if (!response.ok || data.data.snapshot.clientId !== clientId || data.data.snapshot.recipientId !== (recipientId || null)) throw new Error();
  return data.data.snapshot;
}

export function StaffFamilyCommunication({ clients, initialClientId = "" }: { clients: ClientOption[]; initialClientId?: string }) {
  const id = useId(); const [clientId, setClientId] = useState(clients.some(client => client.id === initialClientId) ? initialClientId : "");
  const [recipientId, setRecipientId] = useState(""); const [snapshot, setSnapshot] = useState<FamilyStaffWorkspaceSnapshot | null>(null);
  const [busy, setBusy] = useState(Boolean(initialClientId)); const [notice, setNotice] = useState(""); const [body, setBody] = useState(""); const [dirty, setDirty] = useState(false); const [held, setHeld] = useState(false);
  const [editing, setEditing] = useState(""); const [scheduleOpened, setScheduleOpened] = useState(false); const submitted = useRef<HTMLFormElement | null>(null);
  const frozen = useRef<Attempt | null>(null); const active = useRef(false); const loading = useRef<AbortController | null>(null);
  useProtectedCompletionDraft(dirty, busy, held);
  useEffect(() => { active.current = true; return () => { active.current = false; loading.current?.abort(); }; }, []);

  const load = useCallback(async (selected: string, recipient: string) => {
    loading.current?.abort(); if (!selected) return;
    const controller = new AbortController(); loading.current = controller; const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const data = await readStaffWorkspace(selected, recipient, controller.signal);
      if (active.current && loading.current === controller && !controller.signal.aborted) setSnapshot(data);
    } catch { if (active.current && loading.current === controller) { setSnapshot(null); setNotice("資料暫時無法讀取，請核對權限後重試。"); } }
    finally { clearTimeout(timer); if (active.current && loading.current === controller) setBusy(false); }
  }, []);
  useEffect(() => {
    if (!clientId) return;
    const controller = new AbortController(); loading.current = controller; const timer = setTimeout(() => controller.abort(), 15_000);
    void readStaffWorkspace(clientId, recipientId, controller.signal).then(value => { if (active.current && !controller.signal.aborted) setSnapshot(value); }).catch(() => { if (active.current && loading.current === controller) { setSnapshot(null); setNotice("資料暫時無法讀取，請核對權限後重試。"); } }).finally(() => { clearTimeout(timer); if (active.current && loading.current === controller) setBusy(false); });
    return () => { clearTimeout(timer); controller.abort(); };
  }, [clientId, recipientId]);

  async function send(attempt?: Attempt) {
    const operation = frozen.current ?? attempt; if (!operation || busy) return;
    frozen.current = operation; setHeld(true); setBusy(true); setNotice(""); const controller = new AbortController(); loading.current = controller; const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(operation.kind === "publish" ? "/api/family-publications" : "/api/family-communication", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(operation.input), cache: "no-store", signal: controller.signal });
      if (response.status === 401 || response.status === 403) setSnapshot(null);
      const data = z.object({ data: z.object({ receipt: z.object({ id: z.uuid(), replayed: z.boolean(), status: z.enum(["saved", "conflict"]).optional() }).strict() }) }).parse(await response.json());
      if ((!response.ok && !(response.status === 409 && data.data.receipt.status === "conflict")) || (operation.kind === "write" && operation.input.action === "withdraw" && data.data.receipt.id !== operation.input.publicationId) || (operation.kind === "write" && operation.input.action === "reviewConflict" && data.data.receipt.id !== operation.input.conflictId)) throw new Error();
      frozen.current = null; setHeld(false); setDirty(false); setEditing(""); submitted.current?.reset(); setBody(""); setNotice(data.data.receipt.status === "conflict" ? "訊息有新版本，已進入人工核對佇列。" : operation.kind === "publish" ? "摘要已發布" : operation.input.action === "message" ? "訊息已送出" : operation.input.action === "reviewConflict" ? "已人工核對；未自動傳送訊息。" : "已撤回，原發布紀錄保留"); await load(clientId, recipientId);
    } catch { if (active.current) setNotice("結果尚未確認；請重試原操作，內容仍保留。"); }
    finally { clearTimeout(timer); if (active.current) setBusy(false); }
  }

  const blocked = busy || held;
  return <section className={styles.root}><header className="page-heading"><h2><MessageCircleMore aria-hidden="true" />家屬溝通</h2><button className="button button--secondary" type="button" disabled={blocked || dirty || !clientId} onClick={() => { setBusy(true); void load(clientId, recipientId); }}><RefreshCw aria-hidden="true" />更新</button></header>
    <div className={styles.form}><label htmlFor={`${id}-client`}>個案<select id={`${id}-client`} value={clientId} disabled={blocked || dirty} onChange={event => { setSnapshot(null); setBusy(Boolean(event.target.value)); setRecipientId(""); setClientId(event.target.value); setNotice(""); }}><option value="">請選擇個案</option>{clients.map(client => <option key={client.id} value={client.id}>{client.name} · {client.code}</option>)}</select></label>
      {snapshot ? <label htmlFor={`${id}-recipient`}>家屬<select id={`${id}-recipient`} value={recipientId} disabled={blocked || dirty} onChange={event => { setSnapshot(null); setBusy(true); setRecipientId(event.target.value); setNotice(""); }}><option value="">請選擇已授權家屬</option>{snapshot.recipients.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label> : null}</div>
    {busy ? <p role="status">處理中…</p> : null}{notice ? <p role="status">{notice}</p> : null}{held ? <button className="button button--secondary" type="button" disabled={busy} onClick={() => void send()}>重試原操作</button> : null}{dirty && !blocked ? <button className="button button--secondary" type="button" onClick={event => { event.currentTarget.closest("section")?.querySelectorAll("form").forEach(form => form.reset()); setBody(""); setDirty(false); setEditing(""); }}>清除未送出內容</button> : null}
    {snapshot ? <><small>更新 {formatCareTaipeiTime(snapshot.updatedAt)}</small>{!snapshot.recipients.length ? <p>尚無完成訊息授權的家屬</p> : null}
      {recipientId ? <><ol className={styles.messages}>{snapshot.messages.map(message => <li key={message.id} className={message.direction === "institution_to_family" ? styles.mine : styles.theirs}><strong>{message.direction === "institution_to_family" ? "機構" : "家屬"}</strong><p>{message.body}</p><small>{formatCareTaipeiTime(message.at)} · {message.direction === "institution_to_family" ? message.read ? "家屬已讀" : "已送出" : "家屬傳入"}</small><ClinicalAttachments source={{ clientId, sourceKind: "family_message", sourceId: message.id, sourceVersion: 1 }} canManage={message.direction === "institution_to_family"} /></li>)}</ol>
        {!snapshot.messages.length ? <p>尚無訊息</p> : null}<form noValidate className={styles.form} onChange={() => { setDirty(true); setEditing("message"); }} onSubmit={event => { event.preventDefault(); submitted.current = event.currentTarget; const input = familyStaffWriteSchema.safeParse({ action: "message", clientId, recipientUserId: recipientId, body, expectedVersion: snapshot.messageVersion, idempotency_key: crypto.randomUUID() }); if (!input.success) { setNotice("請填寫要給這位家屬的訊息。"); return; } void send({ kind: "write", input: input.data }); }}><label htmlFor={`${id}-body`}>給家屬的訊息<textarea id={`${id}-body`} value={body} disabled={blocked || Boolean(editing && editing !== "message")} maxLength={2000} onChange={event => { setBody(event.target.value); setDirty(true); setEditing("message"); }} /></label><div><button className="button button--primary" type="submit" disabled={blocked || Boolean(editing && editing !== "message")}><Send aria-hidden="true" />送出</button></div></form></> : null}
      {snapshot.conflicts.length ? <details open><summary>待人工核對 · {snapshot.conflicts.length}</summary><ul>{snapshot.conflicts.map(conflict => <li key={conflict.id}><p>{conflict.body}</p><small>基準 {conflict.expectedVersion} · 現況 {conflict.observedVersion} · {formatCareTaipeiTime(conflict.at)}</small><form noValidate className={styles.form} onChange={() => { setDirty(true); setEditing(conflict.id); }} onSubmit={event => { event.preventDefault(); submitted.current = event.currentTarget; const input = familyStaffWriteSchema.safeParse({ action: "reviewConflict", clientId, conflictId: conflict.id, note: new FormData(event.currentTarget).get("note"), idempotency_key: crypto.randomUUID() }); if (!input.success) { setNotice("請填寫核對結果。"); return; } void send({ kind: "write", input: input.data }); }}><label htmlFor={`${id}-conflict-${conflict.id}`}>核對结果<input id={`${id}-conflict-${conflict.id}`} name="note" maxLength={1000} disabled={blocked || Boolean(editing && editing !== conflict.id)} /></label><button className="button button--secondary" type="submit" disabled={blocked || Boolean(editing && editing !== conflict.id)}>完成核對</button></form></li>)}</ul></details> : null}
      <details onToggle={event => setScheduleOpened(event.currentTarget.open)}><summary>活動與接送行程</summary>{scheduleOpened ? <FamilySchedule clientId={clientId} audience="staff" /> : null}</details>
      <details><summary><Share2 aria-hidden="true" />家屬可見摘要</summary>
        {snapshot.canPublish ? <form noValidate className={styles.form} key={`${clientId}-${snapshot.updatedAt}`} onChange={() => { setDirty(true); setEditing("publish"); }} onSubmit={event => { event.preventDefault(); submitted.current = event.currentTarget; const form = new FormData(event.currentTarget); const selected = String(form.get("source")); const source = snapshot.sources.find(row => `${row.category}:${row.id}` === selected); const input = familyPublishSchema.safeParse({ clientId, sourceId: source?.id, category: source?.category, occurredAt: source?.at, title: form.get("title"), summary: form.get("summary"), idempotency_key: crypto.randomUUID() }); if (!input.success) { setNotice("請選擇來源並填寫標題與摘要。"); return; } void send({ kind: "publish", input: input.data }); }}><label htmlFor={`${id}-source`}>來源紀錄<select id={`${id}-source`} name="source" disabled={blocked || Boolean(editing && editing !== "publish")}><option value="">請選擇</option>{snapshot.sources.map(source => <option key={`${source.category}:${source.id}`} value={`${source.category}:${source.id}`}>{labels[source.category]} · {source.label} · {formatCareTaipeiTime(source.at)}</option>)}</select></label><label htmlFor={`${id}-title`}>標題<input id={`${id}-title`} name="title" disabled={blocked || Boolean(editing && editing !== "publish")} maxLength={120} /></label><label htmlFor={`${id}-summary`}>家屬摘要<textarea id={`${id}-summary`} name="summary" disabled={blocked || Boolean(editing && editing !== "publish")} maxLength={1000} /></label><button className="button button--primary" disabled={blocked || Boolean(editing && editing !== "publish")} type="submit">核對並發布</button></form> : <p>發布／撤回需要發布權限與最近驗證。</p>}
        <ul className={styles.messages}>{snapshot.publications.map(publication => <li key={publication.id}><strong>{publication.title}</strong><p>{publication.summary}</p><small>{formatCareTaipeiTime(publication.publishedAt)} · {publication.withdrawn ? "已撤回" : !publication.sourceCurrent ? "來源已更新，家屬不再顯示" : "已發布"}</small>{snapshot.canPublish && !publication.withdrawn ? <form noValidate className={styles.form} onChange={() => { setDirty(true); setEditing(publication.id); }} onSubmit={event => { event.preventDefault(); submitted.current = event.currentTarget; const input = familyStaffWriteSchema.safeParse({ action: "withdraw", clientId, publicationId: publication.id, reason: new FormData(event.currentTarget).get("reason"), idempotency_key: crypto.randomUUID() }); if (!input.success) { setNotice("請填寫撤回原因。"); return; } void send({ kind: "write", input: input.data }); }}><label htmlFor={`${id}-${publication.id}`}>撤回原因<input id={`${id}-${publication.id}`} name="reason" maxLength={1000} disabled={blocked || Boolean(editing && editing !== publication.id)} /></label><button className="button button--secondary" type="submit" disabled={blocked || Boolean(editing && editing !== publication.id)}><Undo2 aria-hidden="true" />撤回發布</button></form> : null}</li>)}</ul>
      </details></> : !busy && clientId ? <button className="button button--secondary" type="button" disabled={blocked} onClick={() => { setBusy(true); void load(clientId, recipientId); }}>重新載入</button> : null}
  </section>;
}
