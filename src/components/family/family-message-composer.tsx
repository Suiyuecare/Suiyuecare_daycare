"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Save, Send } from "lucide-react";
import { familyMessageReceiptSchema, familyMutationSchema } from "@/lib/family/workspace-schema";
import { getOfflineStorageGeneration, loadOfflineDrafts, removeOfflineDraft, saveOfflineDraft, type OfflineDraftNamespace } from "@/lib/offline/draft-store";
import { isFamilyMessageDraft, queueFamilyMessage, synchronizeFamilyMessage, type FamilyMessageDraft } from "@/lib/offline/family-outbox";
import { withOfflineOutboxLock } from "@/lib/offline/outbox-lock";
import { fetchWithTimeout } from "@/lib/api/client-fetch";
import { useProtectedCompletionDraft } from "@/lib/navigation/use-protected-completion-draft";
import styles from "./family-live-workspace.module.css";

type Props = { clientId: string; version: number; namespace?: OfflineDraftNamespace; onSaved: () => void; onRevoked: () => void };
export function FamilyMessageComposer(props: Props) { return <Composer key={`${props.clientId}:${props.namespace?.userId}:${props.namespace?.branchId}`} {...props} />; }
function Composer({ clientId, version, namespace, onSaved, onRevoked }: Props) {
  const id = useId(); const [body, setBody] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false); const [drafts, setDrafts] = useState<FamilyMessageDraft[]>([]); const [editing, setEditing] = useState<FamilyMessageDraft | null>(null); const [held, setHeld] = useState(false);
  const lock = useRef(false); const active = useRef(false); const frozen = useRef<ReturnType<(typeof familyMutationSchema.options)[0]["parse"]> | null>(null);
  useProtectedCompletionDraft(Boolean(body.trim()), busy, held);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const organizationId = namespace?.organizationId; const branchId = namespace?.branchId; const userId = namespace?.userId;
  const reload = useCallback(async () => {
    if (!organizationId || !branchId || !userId) return [];
    const rows = (await loadOfflineDrafts({ organizationId, branchId, userId })).filter(isFamilyMessageDraft).filter(row => row.clientRef === clientId);
    if (active.current) setDrafts(rows); return rows;
  }, [organizationId, branchId, userId, clientId]);
  const sync = useCallback(async () => {
    if (!organizationId || !branchId || !userId || !navigator.onLine || lock.current) return;
    lock.current = true; setBusy(true);
    const scope = { organizationId, branchId, userId };
    try { await withOfflineOutboxLock(async () => {
      const generation = getOfflineStorageGeneration();
      for (const draft of await reload()) {
        if (!active.current || draft.payload.state !== "queued") continue;
        const result = await synchronizeFamilyMessage(draft, scope);
        if (getOfflineStorageGeneration() !== generation || !active.current) return;
        if (result.status === "saved") { await removeOfflineDraft(scope, draft.id, draft.storageToken, generation); onSaved(); }
        else if (result.status === "revoked") { for (const row of await reload()) await removeOfflineDraft(scope, row.id, row.storageToken, generation); setBody(""); setEditing(null); onRevoked(); return; }
        else if (result.status === "review") await saveOfflineDraft(scope, { ...draft, payload: { ...draft.payload, state: "review", message: result.message } }, generation);
        if (active.current) setNotice(result.message);
        if (result.status === "retry") break;
      }
      await reload();
    }); } catch { if (active.current) setNotice("裝置草稿無法讀寫，請保持此頁並重試。"); }
    finally { lock.current = false; if (active.current) setBusy(false); }
  }, [organizationId, branchId, userId, reload, onSaved, onRevoked]);
  useEffect(() => {
    void reload().catch(() => { if (active.current) setNotice("此裝置無法保存離線草稿；仍可連線送出。"); });
    const reconnect = () => { void sync(); }; const clear = () => { setBody(""); setDrafts([]); setEditing(null); frozen.current = null; setHeld(false); };
    window.addEventListener("online", reconnect); window.addEventListener("daycare-offline-cleared", clear);
    const timer = setInterval(reconnect, 30_000); reconnect();
    return () => { clearInterval(timer); window.removeEventListener("online", reconnect); window.removeEventListener("daycare-offline-cleared", clear); };
  }, [reload, sync]);
  async function persist(queued: boolean) {
    if (!namespace || !body.trim() || lock.current) return; lock.current = true; setBusy(true);
    try {
      const generation = getOfflineStorageGeneration(); const createdAt = editing?.createdAt ?? new Date().toISOString();
      const value: FamilyMessageDraft = { id: editing?.id ?? crypto.randomUUID(), kind: "family-message", clientRef: clientId, createdAt, expiresAt: editing?.expiresAt ?? new Date(Date.parse(createdAt) + 86_400_000).toISOString(), baseVersion: editing?.baseVersion ?? version, storageToken: editing?.storageToken, payload: { schema: 1, body: body.trim(), state: "local" } };
      await saveOfflineDraft(namespace, queued ? await queueFamilyMessage(value) : value, generation);
      if (active.current && getOfflineStorageGeneration() === generation) { setBody(""); setEditing(null); await reload(); setNotice(queued ? "已排入待傳送；恢復連線後自動同步。" : "草稿已保存，24 小時後清除。" ); }
    } catch { if (active.current) setNotice("草稿未保存；請保留內容，重新核對裝置儲存空間。"); }
    finally { lock.current = false; if (active.current) setBusy(false); }
    if (queued) void sync();
  }
  async function sendOnline() {
    if (lock.current) return;
    const parsed = familyMutationSchema.options[0].safeParse(frozen.current ?? { action: "message", clientId, body, expectedVersion: version, idempotency_key: crypto.randomUUID() });
    if (!parsed.success) { setNotice("請填寫訊息內容。"); return; }
    if (namespace && !frozen.current) { await persist(true); return; }
    frozen.current = parsed.data; lock.current = true; setHeld(true); setBusy(true);
    try {
      const response = await fetchWithTimeout("/api/family-portal", { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data) }, 15_000);
      if (response.status === 401 || response.status === 403) { onRevoked(); return; }
      const data = await response.json(); const receipt = familyMessageReceiptSchema.safeParse(data?.data?.receipt);
      if ((!response.ok && response.status !== 409) || !receipt.success || (response.status === 409 && receipt.data.status !== "conflict")) throw new Error();
      frozen.current = null; setHeld(false); setBody(""); setNotice(receipt.data.status === "conflict" ? "訊息有新版本，已交由機構人工核對。" : "訊息已送出"); onSaved();
    } catch { if (active.current) setNotice("結果尚未確認；請重試原操作，內容仍保留。"); }
    finally { lock.current = false; if (active.current) setBusy(false); }
  }
  return <div><form noValidate className={styles.form} onSubmit={event => { event.preventDefault(); void sendOnline(); }}><label htmlFor={`${id}-message`}>給機構的訊息<textarea id={`${id}-message`} value={body} maxLength={2000} disabled={busy || held} onChange={event => setBody(event.target.value)} /></label><div className={styles.actions}><button className="button button--primary" type="submit" disabled={busy}><Send aria-hidden="true" />{held ? "重試原操作" : "送出"}</button>{namespace ? <button className="button button--secondary" type="button" disabled={busy || held || !body.trim()} onClick={() => void persist(false)}><Save aria-hidden="true" />保存草稿</button> : null}</div></form>{notice ? <p role="status">{notice}</p> : null}
    {drafts.length ? <details open><summary>裝置草稿 · {drafts.length}</summary><ul>{drafts.map(draft => <li key={draft.id}><p>{draft.payload.body}</p><small>{draft.payload.state === "queued" ? "待傳送" : draft.payload.state === "review" ? "待人工核對" : "尚未送出"} · 保存至 {new Date(draft.expiresAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Taipei" })}</small>{draft.payload.message ? <p>{draft.payload.message}</p> : null}{draft.payload.state === "local" ? <button className="button button--secondary" type="button" disabled={busy || held || Boolean(body.trim())} onClick={() => { setEditing(draft); setBody(draft.payload.body); }}>接續填寫</button> : null}{draft.payload.state === "queued" ? <button className="button button--secondary" type="button" disabled={busy} onClick={() => void sync()}>重試傳送</button> : null}<button className="button button--secondary" type="button" disabled={busy || held || editing?.id === draft.id} onClick={() => { if (namespace) void removeOfflineDraft(namespace, draft.id, draft.storageToken).then(reload).catch(() => setNotice("草稿未清除，請重試。")); }}>清除草稿</button></li>)}</ul></details> : null}
  </div>;
}
