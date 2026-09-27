"use client";

import { useEffect, type RefObject } from "react";

const discardMessage = "還有尚未確認儲存的內容。確定要離開並放棄這次填寫嗎？";

/** Compatibility only for existing no-options callers outside the daily-form
 * migration. Their native modal owners have not adopted GovernanceDialog yet. */
export function useLegacyCoreDraftGuard(enabled: boolean, dirtyRef: RefObject<boolean>, busyRef: RefObject<boolean>) {
  function discard() {
    if (!enabled || busyRef.current || (dirtyRef.current && !window.confirm(discardMessage))) return false;
    dirtyRef.current = false;
    return true;
  }
  useEffect(() => {
    if (!enabled) return;
    function mayLeave() {
      if (busyRef.current || (dirtyRef.current && !window.confirm(discardMessage))) return false;
      dirtyRef.current = false;
      return true;
    }
    function unload(event: BeforeUnloadEvent) {
      if (!dirtyRef.current && !busyRef.current) return;
      event.preventDefault(); event.returnValue = "";
    }
    function click(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      if (new URL(link.href, window.location.href).href === window.location.href) return;
      if (!mayLeave()) { event.preventDefault(); event.stopPropagation(); }
    }
    function submit(event: SubmitEvent) {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || form.hasAttribute("data-core-care-draft") || form.method.toLowerCase() !== "get") return;
      if (!mayLeave()) { event.preventDefault(); event.stopPropagation(); }
    }
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true); document.addEventListener("submit", submit, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true); document.removeEventListener("submit", submit, true);
    };
  }, [enabled, dirtyRef, busyRef]);
  return discard;
}
