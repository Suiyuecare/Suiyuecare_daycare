"use client";

import { useEffect } from "react";

/** Focus the freshly authorized GET result when a filter arrives with the result fragment. */
export function DailySummaryResultFocus({ readyKey }: { readyKey: string }) {
  useEffect(() => {
    if (window.location.hash !== "#daily-summary-results") return;
    const frame = window.requestAnimationFrame(() => {
      const heading = document.getElementById("daily-summary-results");
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView?.({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [readyKey]);
  return null;
}
