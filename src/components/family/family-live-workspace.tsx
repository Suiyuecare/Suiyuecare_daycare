"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CalendarDays, FileText, HeartPulse, MessageCircleMore, RefreshCw, Settings } from "lucide-react";
import { z } from "zod";
import { familyMutationSchema, familyWorkspaceSchema, type FamilyWorkspaceSnapshot } from "@/lib/family/workspace-schema";
import { formatCareTaipeiTime } from "@/lib/core-care/date";
import { useProtectedCompletionDraft } from "@/lib/navigation/use-protected-completion-draft";
import { ClinicalAttachments } from "@/components/clinical-attachments/clinical-attachments";
import { FamilyMessageComposer } from "./family-message-composer";
import { FamilySchedule } from "./family-schedule";
import styles from "./family-live-workspace.module.css";
type Mutation = z.infer<typeof familyMutationSchema>;
type Props = { initial: FamilyWorkspaceSnapshot; pageNumber: number; title: string };
export function FamilyLiveWorkspace(props: Props) { return <FamilyLiveWorkspaceClient key={`${props.initial.clientId}:${props.pageNumber}`} {...props} />; }
function FamilyLiveWorkspaceClient({ initial, pageNumber, title }: Props) {
  const id = useId(); const [snapshot, setSnapshot] = useState<FamilyWorkspaceSnapshot | null>(initial); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(""); const [, setBody] = useState(""); const [link, setLink] = useState<{ url: string; title: string } | null>(null);
  const frozen = useRef<Mutation | null>(null); const loading = useRef<AbortController | null>(null); const active = useRef(true);
  const [held, setHeld] = useState(false); const [dirty, setDirty] = useState(false);
  useProtectedCompletionDraft(dirty, busy, held);
  useEffect(() => { active.current = true; return () => { active.current = false; loading.current?.abort(); }; }, []);
  useEffect(() => { if (!link) return; const timer = setTimeout(() => setLink(null), 55_000); return () => clearTimeout(timer); }, [link]);
  const refresh = useCallback(async () => {
    loading.current?.abort(); const controller = new AbortController(); loading.current = controller; const timeout = setTimeout(() => controller.abort(), 15_000); setBusy(true);
    try { const response = await fetch(`/api/family-portal?client=${encodeURIComponent(initial.clientId)}`, { cache: "no-store", signal: controller.signal }); if (response.status === 401 || response.status === 403) { setSnapshot(null); throw new Error("授權已失效，請聯絡機構。"); }
      const payload = z.object({ data: z.object({ snapshot: familyWorkspaceSchema }) }).parse(await response.json()); if (!response.ok || payload.data.snapshot.clientId !== initial.clientId) throw new Error("資料暫時無法讀取，請重試。");
      if (initial.actorScope && (!payload.data.snapshot.actorScope || Object.keys(initial.actorScope).some(key => initial.actorScope![key as keyof typeof initial.actorScope] !== payload.data.snapshot.actorScope![key as keyof typeof initial.actorScope]))) { setSnapshot(null); throw new Error("登入身分或分支已變更，請重新進入家屬頁面。"); }
      if (active.current && !controller.signal.aborted) setSnapshot(payload.data.snapshot);
    } catch (failure) { if (active.current && loading.current === controller) setNotice(failure instanceof Error && failure.name !== "AbortError" ? failure.message : "讀取逾時，請重試。"); }
    finally { clearTimeout(timeout); if (active.current && loading.current === controller) setBusy(false); }
  }, [initial]);
  const onMessageSaved = useCallback(() => { void refresh(); }, [refresh]);
  const onMessageRevoked = useCallback(() => { setSnapshot(null); }, []);
  useEffect(() => { const timer = setInterval(() => { if (!held && !dirty) void refresh(); }, 60_000); return () => clearInterval(timer); }, [held, dirty, refresh]);
  async function send(input?: Mutation) {
    const attempt = frozen.current ?? input; if (!attempt || busy) return; frozen.current = attempt; setHeld(true); setBusy(true); setNotice(""); setLink(null);
    const controller = new AbortController(); loading.current = controller; const timeout = setTimeout(() => controller.abort(), 15_000);
    try { const response = await fetch("/api/family-portal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(attempt), cache: "no-store", signal: controller.signal });
      if (response.status === 401 || response.status === 403) { setSnapshot(null); throw new Error("授權已失效；內容尚未確認送出，請聯絡機構。"); }
      const data = z.object({ data: z.record(z.string(), z.unknown()) }).parse(await response.json()); if (!response.ok) throw new Error();
      if (attempt.action === "download") {
        const receipt = z.object({ url: z.url(), publicationId: z.uuid(), expiresSeconds: z.literal(60) }).parse(data.data); const url = new URL(receipt.url);
        if (receipt.publicationId !== attempt.publicationId || url.protocol !== "https:" || url.host !== new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://invalid.invalid").host || !url.pathname.includes("/storage/v1/object/sign/clinical-attachments/")) throw new Error();
        setLink({ url: receipt.url, title: snapshot?.publications.find(row => row.id === attempt.publicationId)?.title ?? "核准文件" });
      } else if (attempt.action === "read") { if (data.data.confirmed !== true) throw new Error(); }
      else { z.object({ id: z.uuid(), replayed: z.boolean(), version: z.number().int().positive().optional() }).strict().parse(data.data.receipt); }
      frozen.current = null; setHeld(false); setDirty(false); if (attempt.action === "message") setBody(""); setNotice(attempt.action === "message" ? "訊息已送出" : attempt.action === "preferences" ? "設定已保存" : attempt.action === "read" ? "已標記已讀" : "連結有效 60 秒");
      setBusy(false); await refresh();
    } catch (failure) { if (active.current) setNotice(failure instanceof Error && failure.message.includes("授權") ? failure.message : "結果尚未確認；請按重試，內容仍保留。"); }
    finally { clearTimeout(timeout); if (active.current) setBusy(false); }
  }
  const Icon = pageNumber === 85 ? MessageCircleMore : pageNumber === 87 ? CalendarDays : pageNumber === 89 ? Settings : pageNumber === 88 ? FileText : HeartPulse;
  const categories = pageNumber === 86 ? ["care", "health", "attendance"] : pageNumber === 87 ? ["schedule"] : pageNumber === 88 ? ["billing", "document"] : ["notice"];
  const rows = snapshot?.publications.filter(row => categories.includes(row.category)) ?? [];
  return <section className={styles.root}><header className="page-heading"><h1><Icon aria-hidden="true" />{title}</h1><button className="button button--secondary" type="button" disabled={busy || held || dirty} onClick={() => void refresh()}><RefreshCw aria-hidden="true" />更新</button></header>
    {notice ? <p role="status" className="callout">{notice}</p> : null}{busy ? <p role="status">處理中…</p> : null}{held ? <button className="button button--secondary" type="button" disabled={busy} onClick={() => void send()}>重試原操作</button> : null}{dirty && !busy && !held ? <button className="button button--secondary" type="button" onClick={event => { event.currentTarget.closest("section")?.querySelectorAll("form").forEach(form => form.reset()); setBody(""); setDirty(false); }}>清除未送出內容</button> : null}
    {!snapshot ? <p role="alert">此個案目前沒有有效授權，已隱藏資料。</p> : <>
      <p className={styles.updated}>更新 {formatCareTaipeiTime(snapshot.updatedAt)}</p>
      {pageNumber === 85 ? !snapshot.scopes.includes("messages.read") ? <p>尚未授權訊息服務，請聯絡機構。</p> : <>
        <ol className={styles.messages}>{snapshot.messages.map(row => <li key={row.id} className={row.direction === "family_to_institution" ? styles.mine : styles.theirs}><strong>{row.direction === "family_to_institution" ? "我" : "機構"}</strong><p>{row.body}</p><small>{formatCareTaipeiTime(row.at)} · {row.direction === "family_to_institution" ? "已送出" : row.read ? "已讀" : "未讀"}</small>{row.direction === "institution_to_family" && !row.read ? <button className="button button--secondary" type="button" disabled={busy || held || dirty} onClick={() => void send({ action: "read", clientId: snapshot.clientId, messageId: row.id, idempotency_key: crypto.randomUUID() })}>標記已讀</button> : null}<ClinicalAttachments audience="family" source={{ clientId: snapshot.clientId, sourceKind: "family_message", sourceId: row.id, sourceVersion: 1 }} canManage={row.direction === "family_to_institution"} /></li>)}</ol>
        {!snapshot.messages.length ? <p>尚無訊息</p> : null}<FamilyMessageComposer clientId={snapshot.clientId} version={snapshot.messageVersion} namespace={snapshot.actorScope} onSaved={onMessageSaved} onRevoked={onMessageRevoked} />
      </> : null}
      {pageNumber !== 85 && pageNumber !== 89 ? <div className={styles.cards}>{rows.map(row => <article className="panel" key={row.id}><div className="panel__body"><h2>{row.title}</h2><p>{row.summary}</p><small>{formatCareTaipeiTime(row.occurredAt)}</small>{row.bill ? <><p><strong>{new Intl.NumberFormat("zh-TW", { style: "currency", currency: row.bill.currency }).format(row.bill.total)}</strong> · {row.bill.balance === 0 ? "已付清" : `未付 ${row.bill.balance.toLocaleString("zh-TW")}`}</p><p>{row.bill.periodFrom} — {row.bill.periodTo}</p><ul>{row.bill.lines.map((line, index) => <li key={index}>{line.name} × {line.quantity} · {line.amount.toLocaleString("zh-TW")}</li>)}</ul>{row.bill.receipts.map(receipt => <p key={receipt.number}>收據 {receipt.number} · {receipt.amount.toLocaleString("zh-TW")} · {formatCareTaipeiTime(receipt.at)}</p>)}</> : null}{row.category === "document" ? <button className="button button--secondary" type="button" disabled={busy || held} onClick={() => void send({ action: "download", clientId: snapshot.clientId, publicationId: row.id, idempotency_key: crypto.randomUUID() })}>開啟文件</button> : null}</div></article>)}</div> : null}
      {pageNumber === 87 ? snapshot.scopes.includes("schedule.read") ? <FamilySchedule clientId={snapshot.clientId} /> : <p>尚未授權行程，請聯絡機構。</p> : null}
      {pageNumber !== 85 && pageNumber !== 87 && pageNumber !== 89 && rows.length === 0 ? <p>尚無已核准公開的資料</p> : null}
      {link ? <a className="button button--secondary" href={link.url} target="_blank" rel="noopener noreferrer">下載 {link.title}</a> : null}
      {pageNumber === 89 ? <><p>未讀訊息 {snapshot.unreadCount} 則</p><form key={snapshot.preferences.version} noValidate onChange={() => setDirty(true)} className={styles.form} onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); const input = familyMutationSchema.safeParse({ action: "preferences", clientId: snapshot.clientId, expectedVersion: snapshot.preferences.version, pushEnabled: form.get("push") === "on", categories: form.getAll("categories"), quietStart: form.get("quietStart"), quietEnd: form.get("quietEnd"), contactPhone: String(form.get("phone") ?? "").trim() || null, idempotency_key: crypto.randomUUID() }); if (!input.success) { setNotice("請確認手機號碼與安靜時段。"); return; } void send(input.data); }}><fieldset disabled={busy || held}><legend>通知偏好</legend><label className="check-field"><input name="push" type="checkbox" defaultChecked={snapshot.preferences.pushEnabled} />接收提醒</label>{(["messages", "care", "schedule", "billing"] as const).map(category => <label className="check-field" key={category}><input name="categories" value={category} type="checkbox" defaultChecked={snapshot.preferences.categories.includes(category)} />{{ messages: "訊息", care: "照顧", schedule: "行程", billing: "帳單" }[category]}</label>)}<label htmlFor={`${id}-start`}>安靜時段開始<input id={`${id}-start`} type="time" name="quietStart" defaultValue={snapshot.preferences.quietStart} /></label><label htmlFor={`${id}-end`}>安靜時段結束<input id={`${id}-end`} type="time" name="quietEnd" defaultValue={snapshot.preferences.quietEnd} /></label><label htmlFor={`${id}-phone`}>聯絡手機<input id={`${id}-phone`} type="tel" autoComplete="tel" name="phone" defaultValue={snapshot.preferences.contactPhone ?? ""} maxLength={10} /></label><button className="button button--primary" type="submit">保存設定</button></fieldset></form><p>LINE／裝置推播尚未啟用；目前使用站內訊息。</p></> : null}
    </>}
  </section>;
}
