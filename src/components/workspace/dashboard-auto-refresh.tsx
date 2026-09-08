"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

export const DASHBOARD_REFRESH_INTERVAL_MS = 55_000;

type RefreshReason = "automatic" | "manual" | "reconnected" | "visible";

export function DashboardAutoRefresh({
  generatedAt,
}: {
  generatedAt: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState("每 55 秒自動更新；離線或切到背景時暫停。");
  const lastAttempt = useRef<number | null>(null);

  const refresh = useCallback((reason: RefreshReason) => {
    if (document.visibilityState !== "visible" || !navigator.onLine) return;
    lastAttempt.current = Date.now();
    setStatus(reason === "manual" ? "正在取得最新快照。" : "正在自動取得最新快照。");
    startTransition(() => router.refresh());
  }, [router]);

  useEffect(() => {
    lastAttempt.current = Date.now();

    const timer = window.setInterval(() => refresh("automatic"),
      DASHBOARD_REFRESH_INTERVAL_MS);
    const refreshIfOverdue = (reason: "reconnected" | "visible") => {
      if (lastAttempt.current === null ||
        Date.now() - lastAttempt.current >= DASHBOARD_REFRESH_INTERVAL_MS) {
        refresh(reason);
      }
    };
    const onOnline = () => refreshIfOverdue("reconnected");
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshIfOverdue("visible");
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
        disabled={pending}
        onClick={() => refresh("manual")}
        type="button"
      >
        <RefreshCw aria-hidden="true" />
        {pending ? "更新中…" : "立即更新"}
      </button>
      <span className="sr-only" role="status">{status}</span>
    </div>
  );
}
