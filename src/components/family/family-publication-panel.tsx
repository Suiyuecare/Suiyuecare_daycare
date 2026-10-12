"use client";
import { useId, useRef, useState } from "react";
import { Share2 } from "lucide-react";
import { z } from "zod";
import { familyPublishSchema } from "@/lib/family/workspace-schema";
import { useProtectedCompletionDraft } from "@/lib/navigation/use-protected-completion-draft";
import styles from "@/components/clinical-attachments/clinical-attachments.module.css";
type Props = { clientId: string; sourceId: string; category: z.infer<typeof familyPublishSchema>["category"]; occurredAt: string; enabled: boolean };
export function FamilyPublicationPanel(props: Props) { return <FamilyPublicationClient key={`${props.clientId}:${props.sourceId}:${props.category}`} {...props} />; }
function FamilyPublicationClient({ clientId, sourceId, category, occurredAt, enabled }: Props) {
  const id = useId(); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(""); const attempt = useRef<z.infer<typeof familyPublishSchema> | null>(null);
  const [held, setHeld] = useState(false);
  const [dirty, setDirty] = useState(false); const submitted = useRef<HTMLFormElement | null>(null);
  useProtectedCompletionDraft(dirty, busy, held);
  async function send(payload?: z.infer<typeof familyPublishSchema>) { const next = attempt.current ?? payload; if (!next || busy) return; attempt.current = next; setHeld(true); setBusy(true); const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15_000);
    try { const response = await fetch("/api/family-publications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(next), cache: "no-store", signal: controller.signal }); const data = z.object({ data: z.object({ receipt: z.object({ id: z.uuid(), replayed: z.boolean() }) }) }).parse(await response.json()); if (!response.ok || !data.data.receipt.id) throw new Error(); attempt.current = null; setHeld(false); setDirty(false); submitted.current?.reset(); setNotice("已發布給有此資料類別授權的家屬"); }
    catch { setNotice("發布尚未確認；請核對權限／最近驗證，或重試原操作。"); } finally { clearTimeout(timeout); setBusy(false); }
  }
  if (!enabled) return null;
  return <details className={styles.root}><summary><Share2 aria-hidden="true" />發布家屬摘要</summary><form noValidate onChange={() => setDirty(true)} className={`${styles.body} ${styles.form}`} onSubmit={event => { event.preventDefault(); submitted.current = event.currentTarget; const form = new FormData(event.currentTarget); const input = familyPublishSchema.safeParse({ clientId, sourceId, category, occurredAt, title: form.get("title"), summary: form.get("summary"), idempotency_key: crypto.randomUUID() }); if (!input.success) { setNotice("請填寫標題與家屬摘要。"); return; } void send(input.data); }}><label htmlFor={`${id}-title`}>標題<input id={`${id}-title`} name="title" maxLength={120} disabled={busy || held} /></label><label htmlFor={`${id}-summary`}>給家屬的摘要<textarea id={`${id}-summary`} name="summary" maxLength={1000} disabled={busy || held} /></label><button className="button button--primary" type="submit" disabled={busy || held}>{busy ? "發布中…" : "核對並發布"}</button>{held ? <button type="button" className="button button--secondary" disabled={busy} onClick={() => void send()}>重試原操作</button> : null}{dirty && !busy && !held ? <button type="button" className="button button--secondary" onClick={event => { event.currentTarget.form?.reset(); setDirty(false); }}>清除未送出內容</button> : null}{notice ? <p role="status">{notice}</p> : null}</form></details>;
}
