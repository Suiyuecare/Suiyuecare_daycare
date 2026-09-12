"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { TenantContext } from "@/lib/domain/types";
import { getOfflineStorageGeneration, loadOfflineDrafts, removeOfflineDraft, saveOfflineDraft, type OfflineDraftNamespace } from "@/lib/offline/draft-store";
import { isCareLocalDraft, OFFLINE_CARE_LABELS, synchronizeCareDraft, type CareLocalDraft } from "@/lib/offline/care-outbox";

type NewDraft = Omit<CareLocalDraft, "createdAt" | "expiresAt"> & Partial<Pick<CareLocalDraft, "createdAt" | "expiresAt">>;
type OfflineCareContext = {
  enabled: boolean; drafts: readonly CareLocalDraft[]; message: string;
  save: (draft: NewDraft) => Promise<void>; remove: (id: string, expectedToken?: string) => Promise<void>;
  sync: () => Promise<void>;
};
const OfflineContext = createContext<OfflineCareContext | null>(null);
export function useOfflineCare() { return useContext(OfflineContext); }

export function OfflineCareProvider({ context, children }: { context: TenantContext; children: ReactNode }) {
  const key = `${context.organizationId}:${context.branchId}:${context.userId}`;
  return <ScopedOfflineCare key={key} context={context}>{children}</ScopedOfflineCare>;
}

function ScopedOfflineCare({ context, children }: { context: TenantContext; children: ReactNode }) {
  const router = useRouter();
  const enabled = !context.demo && process.env.NEXT_PUBLIC_SYNTHETIC_PREVIEW !== "true";
  const namespace: OfflineDraftNamespace = useMemo(() => ({ organizationId: context.organizationId,
    branchId: context.branchId, userId: context.userId }), [context.organizationId, context.branchId, context.userId]);
  const [drafts, setDrafts] = useState<CareLocalDraft[]>([]);
  const [message, setMessage] = useState("");
  const [ended, setEnded] = useState(false);
  const running = useRef(false);
  const stopped = useRef(false);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const generation = useRef<string | null>(null);
  // A refresh must not silently upgrade an actively edited draft's baseline.
  const knownTokens = useRef(new Map<string, string>());
  const storageGeneration = useCallback(() => {
    if (generation.current === null) generation.current = getOfflineStorageGeneration();
    return generation.current;
  }, []);
  const reload = useCallback(async () => {
    if (!enabled || stopped.current) return;
    const loaded = await loadOfflineDrafts(namespace, storageGeneration());
    if (!stopped.current) {
      for (const item of loaded) if (item.storageToken && !knownTokens.current.has(item.id)) knownTokens.current.set(item.id, item.storageToken);
      setDrafts(loaded.filter(isCareLocalDraft));
    }
  }, [enabled, namespace, storageGeneration]);
  const save = useCallback(async (draft: NewDraft) => {
    if (!enabled || stopped.current) throw new Error("OFFLINE_DISABLED");
    const job = chain.current.catch(() => undefined).then(async () => {
      if (stopped.current) throw new Error("OFFLINE_DISABLED");
      const storageToken = await saveOfflineDraft(namespace, { ...draft,
        storageToken: draft.storageToken ?? knownTokens.current.get(draft.id) }, storageGeneration());
      if (storageToken) knownTokens.current.set(draft.id, storageToken);
      await reload();
    });
    chain.current = job;
    return job;
  }, [enabled, namespace, reload, storageGeneration]);
  const remove = useCallback(async (id: string, expectedToken?: string) => {
    const job = chain.current.catch(() => undefined).then(async () => {
      if (stopped.current) throw new Error("OFFLINE_DISABLED");
      const removed = await removeOfflineDraft(namespace, id, expectedToken ?? knownTokens.current.get(id), storageGeneration());
      if (removed === false) throw new Error("OFFLINE_DRAFT_CONFLICT");
      knownTokens.current.delete(id);
      await reload();
    });
    chain.current = job;
    return job;
  }, [namespace, reload, storageGeneration]);
  const sync = useCallback(async () => {
    if (!enabled || stopped.current || running.current || !navigator.onLine) return;
    running.current = true;
    try {
      await chain.current.catch(() => undefined);
      const run = async () => {
        const pending = (await loadOfflineDrafts(namespace, storageGeneration())).filter(isCareLocalDraft).filter((item) => item.payload.state === "queued");
        let changed = false;
        for (const item of pending) {
          if (stopped.current || !navigator.onLine) break;
          const result = await synchronizeCareDraft(item, undefined, namespace);
          if (stopped.current) break;
          if (result.status === "saved") { await remove(item.id, item.storageToken); changed = true; }
          else if (result.status === "review") await save({ ...item, payload: { ...item.payload, state: "review", message: result.message } });
          setMessage(result.message);
        }
        if (changed && !stopped.current) router.refresh();
        await reload();
      };
      // Keep two tabs from sending the same outbox simultaneously. Database
      // idempotency remains the final boundary if Web Locks is unavailable.
      if (navigator.locks) await navigator.locks.request(`daycare-care-outbox:${namespace.organizationId}:${namespace.branchId}:${namespace.userId}`, { ifAvailable: true }, async (lock) => { if (lock) await run(); });
      else await run();
    } catch (error) { if (!stopped.current) {
      setMessage(error instanceof Error && error.message === "OFFLINE_DRAFT_CONFLICT"
        ? "另一個分頁已更新這筆草稿；新內容已保留，沒有覆寫或刪除。請重新載入並確認。"
        : "暫時無法讀取裝置草稿。請保留畫面內容，稍後重試。");
      await reload().catch(() => undefined);
    } }
    finally { running.current = false; }
  }, [enabled, namespace, reload, remove, router, save, storageGeneration]);

  useEffect(() => {
    stopped.current = false;
    if (!enabled) return;
    void reload().catch(() => { if (!stopped.current) setMessage("此瀏覽器無法保存裝置草稿；請勿關閉尚未儲存的表單。"); });
    const retry = () => { void sync(); };
    const cleared = (event: Event) => {
      const nextGeneration = (event as CustomEvent<{ generation?: string }>).detail?.generation;
      // A delayed broadcast from an earlier logout must not stop a new login.
      if (nextGeneration && generation.current === nextGeneration) return;
      stopped.current = true; knownTokens.current.clear(); setDrafts([]); setMessage(""); setEnded(true);
    };
    window.addEventListener("online", retry);
    window.addEventListener("daycare-offline-cleared", cleared);
    const timer = window.setInterval(() => {
      // Expiry is independent of connectivity: even an offline, open page
      // must stop displaying drafts after their 24-hour retention window.
      if (!stopped.current) {
        setDrafts((current) => current.filter((item) => Date.parse(item.expiresAt) > Date.now()));
        void reload().catch(() => undefined);
        retry();
      }
    }, 30_000);
    retry();
    return () => { stopped.current = true; window.clearInterval(timer); window.removeEventListener("online", retry); window.removeEventListener("daycare-offline-cleared", cleared); };
  }, [enabled, reload, sync]);
  const value = useMemo(() => ({ enabled, drafts, message, save, remove, sync }), [enabled, drafts, message, save, remove, sync]);

  if (ended) return <section className="empty-card" role="alert"><h1>此工作階段已結束</h1>
    <p>已停止顯示本分頁的個案與草稿。請重新登入後再繼續。</p><a className="button button--primary" href="/login">回到登入頁</a></section>;

  return <OfflineContext.Provider value={value}>
    {enabled && (drafts.length > 0 || message) ? <details className="panel offline-care-panel">
      <summary>裝置草稿：{drafts.filter((item) => item.payload.state === "local").length} 筆未送出 · {drafts.filter((item) => item.payload.state === "queued").length} 筆待送 · {drafts.filter((item) => item.payload.state === "review").length} 筆需確認</summary>
      <div className="panel__body">
        <p>最多保留 24 小時，登出即清除。只有您已按下儲存的待送內容，才會在重新連線後自動重試；不會離線簽署。</p>
        {message ? <p role="status">{message}</p> : null}
        {drafts.map((item) => <article key={item.id} className="offline-care-item">
          <p>{item.payload.serviceDate} · {OFFLINE_CARE_LABELS[item.kind]} · {item.payload.state === "local" ? "僅存本機，請回原個案表單恢復" : item.payload.state === "queued" ? "等待送出" : "需要人工確認"}</p>
          {item.payload.message ? <p>{item.payload.message}</p> : null}
          {item.payload.state === "review" ? <button className="button button--secondary" type="button" onClick={() => {
            void save({ ...item, payload: { ...item.payload, state: "queued", message: undefined } }).then(sync).catch(() => setMessage("草稿尚未排入重試，請稍後再試。"));
          }}>已確認授權與原紀錄，原筆重試</button> : null}
          <button className="button button--secondary" type="button" onClick={() => {
            if (window.confirm("只刪除此裝置的這筆草稿；不會撤回可能已儲存到伺服器的紀錄。確定刪除？")) void remove(item.id, item.storageToken).catch(() => setMessage("草稿未確認移除，可能已有較新內容；請重新載入確認。"));
          }}>刪除這筆裝置草稿</button>
        </article>)}
        <button className="button button--secondary" type="button" onClick={() => { void sync(); }}>檢查待送內容</button>
      </div>
    </details> : null}
    {children}
  </OfflineContext.Provider>;
}
