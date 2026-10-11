"use client";

import { useEffect, useLayoutEffect } from "react";
import { useScopeChangeDraftRegistration } from "./scope-change-pending";

/** Keep only a boolean safety state. Draft content and client IDs never enter the registry. */
export function useProtectedCompletionDraft(dirty: boolean, busy: boolean, unknown: boolean) {
  const register = useScopeChangeDraftRegistration();
  useLayoutEffect(() => { register({ dirty, busy, unknown }); }, [dirty, busy, unknown, register]);
  useEffect(() => {
    if (!dirty && !busy && !unknown) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy, unknown]);
}
