"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Read-only freshness indicator; never caches records or automatically submits drafts. */
export function SnapshotFreshness({ expiresAt, demo = false }: { expiresAt: string; demo?: boolean }) {
  const router = useRouter();
  const [observed, setObserved] = useState<{ at: number; online: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (demo) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      const now = Date.now(); const expires = Date.parse(expiresAt);
      setObserved({ at: now, online: navigator.onLine });
      if (Number.isFinite(expires) && expires > now) timer = setTimeout(update, Math.min(expires - now + 1, 2_147_483_647));
    };
    update();
    window.addEventListener("online", update); window.addEventListener("offline", update);
    document.addEventListener("visibilitychange", update);
    return () => { clearTimeout(timer); window.removeEventListener("online", update);
      window.removeEventListener("offline", update); document.removeEventListener("visibilitychange", update); };
  }, [demo, expiresAt]);

  if (demo) return <p role="status">目前為合成展示快照，不代表即時正式資料。</p>;
  const expired = !Number.isFinite(Date.parse(expiresAt)) || (observed !== null && observed.at >= Date.parse(expiresAt));
  const offline = observed !== null && !observed.online;
  return <section aria-label="快照更新狀態" className="callout">
    <p role="status">{offline ? "目前離線；這份已載入的快照不代表最新狀態，重新連線後請更新。"
      : expired ? "這份快照已過期，請更新後再核對有效版本與統計。"
        : observed === null ? "正在確認快照效期與連線狀態。" : "快照仍在效期內；需要最新資料時可立即更新。"}</p>
    <button className="button button--secondary" disabled={offline || pending} type="button"
      onClick={() => startTransition(() => router.refresh())}>{pending ? "更新中…" : "更新快照"}</button>
  </section>;
}
