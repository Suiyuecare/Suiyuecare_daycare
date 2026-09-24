"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { hasPendingOperations, tryAcquireViewTransition, usePendingOperations, useViewTransitionPending } from "@/lib/navigation/pending-operation-lock";

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
  const operationPending = usePendingOperations();
  const viewPending = useViewTransitionPending();
  const [requestedFrom, setRequestedFrom] = useState<string | null>(null);
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const [refreshError, setRefreshError] = useState(false);
  const paused = operationPending ? "有儲存結果尚待確認，自動與手動更新已暫停；請先回原表單確認結果。"
    : viewPending && !pending ? "系統正在更新或切換分支，暫停重複更新。" : null;
  const status = paused ?? (pending ? "正在更新工作清單。" : refreshError ? "工作清單更新未完成，請稍後重試。" : requestedFrom !== null && requestedFrom !== generatedAt
    ? "工作清單已更新。" : "每 55 秒自動更新；離線或切到背景時暫停。");
  const lastAttempt = useRef<number | null>(null);
  const viewLease = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!pending && viewLease.current) { viewLease.current(); viewLease.current = null; }
  }, [pending, generatedAt, requestedFrom, refreshEpoch]);
  useEffect(() => () => { viewLease.current?.(); viewLease.current = null; }, []);

  const refresh = useCallback(() => {
    if (document.visibilityState !== "visible" || !navigator.onLine || hasPendingOperations()) return;
    const release = tryAcquireViewTransition();
    if (!release) return;
    viewLease.current = release;
    lastAttempt.current = Date.now();
    // Even a synchronous/no-change refresh needs a committed effect boundary
    // to release its lease; generatedAt/requestedFrom may both be unchanged.
    setRefreshEpoch((epoch) => epoch + 1);
    setRequestedFrom(generatedAt);
    setRefreshError(false);
    try { startTransition(() => router.refresh()); } catch {
      release(); viewLease.current = null; setRefreshError(true);
    }
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
        disabled={pending || !online || operationPending || viewPending}
        onClick={refresh}
        type="button"
      >
        <RefreshCw aria-hidden="true" />
        {pending ? "更新中…" : "立即更新"}
      </button>
      {!online && <p className="form-error" role="status">目前離線，清單可能不是最新。請恢復連線後更新。</p>}
      {paused ? <p role="status">{paused}</p> : <span className="sr-only" role="status">{status}</span>}
    </div>
  );
}
