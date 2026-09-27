"use client";

import { useLayoutEffect, useRef } from "react";

/** Request cancellation for only the scope/capabilities actually supplied by
 * this mounted form. This is not an auth context, write lease or durable journal. */
export function useCareRequestOwner(scopeKey: string, onScopeChange: () => void) {
  const owner = useRef({ mounted: false, scopeKey, epoch: 0, controllers: new Set<AbortController>() });
  const callback = useRef(onScopeChange);
  useLayoutEffect(() => { callback.current = onScopeChange; });
  useLayoutEffect(() => {
    const current = owner.current;
    const changed = current.scopeKey !== scopeKey;
    current.scopeKey = scopeKey;
    current.mounted = true;
    if (changed) callback.current();
    return () => {
      current.mounted = false;
      current.epoch += 1;
      for (const controller of current.controllers) controller.abort();
      current.controllers.clear();
    };
  }, [scopeKey]);

  return {
    begin() {
      const current = owner.current;
      const epoch = current.epoch;
      const controller = new AbortController();
      if (!current.mounted) controller.abort();
      else current.controllers.add(controller);
      const isCurrent = () => current.mounted && current.epoch === epoch && !controller.signal.aborted;
      return {
        signal: controller.signal,
        isCurrent,
        throwIfStale() { if (!isCurrent()) throw new DOMException("作業範圍已更新。", "AbortError"); },
        finish() { current.controllers.delete(controller); },
      };
    },
  };
}
