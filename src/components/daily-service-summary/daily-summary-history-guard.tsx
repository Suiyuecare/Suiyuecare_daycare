"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { DAILY_SERVICE_SUMMARY_PATH } from "@/lib/daily-service-summary/query";
import styles from "./daily-summary-history-guard.module.css";

function isPage54Path(pathname: string) {
  return pathname === DAILY_SERVICE_SUMMARY_PATH || pathname === `${DAILY_SERVICE_SUMMARY_PATH}/`;
}

/**
 * Hide the server-rendered snapshot synchronously during pagehide so a bfcache
 * entry contains a neutral cover, including before pageshow can run on return.
 */
export function installDailySummaryHistoryGuard(
  content: HTMLElement,
  cover: HTMLElement,
  reload: () => void = () => window.location.reload(),
  browser: Window = window,
) {
  let reloadRequested = false;

  const conceal = () => {
    content.setAttribute("inert", "");
    content.setAttribute("aria-hidden", "true");
    content.style.setProperty("display", "none", "important");
    cover.hidden = false;
    cover.style.setProperty("display", "grid", "important");
  };

  const reloadCoveredPage = () => {
    conceal();
    if (reloadRequested) return;
    reloadRequested = true;
    reload();
  };

  const onPageHide = () => conceal();
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted || !cover.hidden) reloadCoveredPage();
  };
  const onPopState = () => {
    // Next can retain the Page 54 subtree during a client-side history move.
    if (isPage54Path(browser.location.pathname)) reloadCoveredPage();
  };

  browser.addEventListener("pagehide", onPageHide);
  browser.addEventListener("pageshow", onPageShow);
  browser.addEventListener("popstate", onPopState);

  return () => {
    browser.removeEventListener("pagehide", onPageHide);
    browser.removeEventListener("pageshow", onPageShow);
    browser.removeEventListener("popstate", onPopState);
  };
}

export function DailySummaryHistoryGuard({ children }: { children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contentRef.current || !coverRef.current) return;
    return installDailySummaryHistoryGuard(contentRef.current, coverRef.current);
  }, []);

  return <>
    <div className={styles.content} ref={contentRef}>{children}</div>
    <div className={styles.cover} hidden ref={coverRef} role="status" aria-live="polite">
      <div className={styles.message}>
        <strong>正在重新驗證頁面</strong>
        <p>請稍候，資料即將重新載入。</p>
      </div>
    </div>
  </>;
}
