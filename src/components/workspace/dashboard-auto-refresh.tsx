"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";

export const DASHBOARD_REFRESH_INTERVAL_MS = 55_000;

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => { window.removeEventListener("online", onChange); window.removeEventListener("offline", onChange); };
}
const onlineSnapshot = () => navigator.onLine;
const serverOnlineSnapshot = () => true;

export function DashboardAutoRefresh({
  generatedAt,
}: {
  generatedAt: string;
}) {
  const router = useRouter();
  const online = useSyncExternalStore(subscribeOnline, onlineSnapshot, serverOnlineSnapshot);
  const [pending, startTransition] = useTransition();
  const [requestedFrom, setRequestedFrom] = useState<string | null>(null);
  const status = pending ? "正在更新工作清單。" : requestedFrom !== null && requestedFrom !== generatedAt
    ? "工作清單已更新。" : "每 55 秒自動更新；離線或切到背景時暫停。";
  const lastAttempt = useRef<number | null>(null);

  const refresh = useCallback(() => {
    if (document.visibilityState !== "visible" || !navigator.onLine) return;
    lastAttempt.current = Date.now();
    setRequestedFrom(generatedAt);
    startTransition(() => router.refresh());
  }, [router, generatedAt]);

  useEffect(() => {
    lastAttempt.current = Date.now();

    const timer = window.setInterval(refresh,
      DASHBOARD_REFRESH_INTERVAL_MS);
    const refreshIfOverdue = () => {
      if (lastAttempt.current === null ||
        Date.now() - lastAttempt.current >= DASHBOARD_REFRESH_INTERVAL_MS) {
        refresh();
      }
    };
    const onOnline = () => refreshIfOverdue();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshIfOverdue();
    };

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [generatedAt, refresh]);

  return (
    <div>
      <button
        className="button button--secondary"
        disabled={pending || !online}
        onClick={refresh}
        type="button"
      >
        <RefreshCw aria-hidden="true" />
        {pending ? "更新中…" : "立即更新"}
      </button>
      {!online && <p className="form-error" role="status">目前離線，清單可能不是最新。請恢復連線後更新。</p>}
      <span className="sr-only" role="status">{status}</span>
    </div>
  );
}
