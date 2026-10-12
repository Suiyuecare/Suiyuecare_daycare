"use client";

import { useEffect, useLayoutEffect } from "react";
import { useScopeChangeDraftRegistration, type ScopeChangePendingReason } from "./scope-change-pending";

/** Keep only a boolean safety state. Draft content and client IDs never enter the registry. */
export function useProtectedCompletionDraft(dirty: boolean, busy: boolean, unknown: boolean,
  onBlockedNavigation?: (reason: Exclude<ScopeChangePendingReason, null>) => void) {
  const register = useScopeChangeDraftRegistration();
  useLayoutEffect(() => { register({ dirty, busy, unknown }); }, [dirty, busy, unknown, register]);
  useEffect(() => {
    if (!dirty && !busy && !unknown) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy, unknown]);
  useEffect(() => {
    if (!onBlockedNavigation || (!dirty && !busy && !unknown)) return;
    const intercept = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self") ||
        !["http:", "https:"].includes(anchor.protocol) || anchor.getAttribute("href")?.startsWith("#") ||
        (anchor.origin === window.location.origin && anchor.pathname === window.location.pathname &&
          anchor.search === window.location.search)) return;
      event.preventDefault(); event.stopPropagation();
      onBlockedNavigation(unknown ? "unknown" : busy ? "busy" : "dirty");
    };
    document.addEventListener("click", intercept, true);
    return () => document.removeEventListener("click", intercept, true);
  }, [dirty, busy, unknown, onBlockedNavigation]);
}
