"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_SYNTHETIC_PREVIEW === "true") return;
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // The application remains usable online if registration is blocked.
      });
    }
  }, []);

  return null;
}
