"use client";
// Synthetic browser fixture, not imported by any permanent application route.
import { useEffect, useState } from "react";
import { OfflineCareProvider } from "@/components/core-care/offline-care-provider";
import { CareDiaryComposer } from "@/components/core-care/care-diary-composer";
import { clearOfflineDrafts, loadOfflineDrafts, saveOfflineDraft } from "@/lib/offline/draft-store";
import type { TenantContext } from "@/lib/domain/types";

const context: TenantContext = { organizationId: "33333333-3333-4333-8333-333333333333", branchId: "44444444-4444-4444-8444-444444444444",
  userId: "55555555-5555-4555-8555-555555555555", organizationName: "合成驗收", branchName: "合成驗收", displayName: "合成人員",
  roles: ["care_worker"], scopes: ["care_records.write"], assuranceLevel: "aal2", recentAal2At: null, demo: false };
const clientId = "11111111-1111-4111-8111-111111111111";
export function OfflineCareHarness() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const originalFetch = window.fetch;
    let sends = 0;
    const seen = new Set<string>();
    window.fetch = async (input, init) => {
      if (String(input) !== "/api/records" || init?.method !== "POST") return originalFetch(input, init);
      sends += 1;
      const key = new Headers(init.headers).get("Idempotency-Key") ?? "";
      const replayed = seen.has(key); seen.add(key);
      return Response.json({ requestId: crypto.randomUUID(), status: "ok", errors: [], data: {
        demo: false, persisted: true, replayed,
        record: { id: crypto.randomUUID(), version: 1, status: "draft" }, page: { slug: "staff/daily-care/care-diary" },
      } }, { status: replayed ? 200 : 201 });
    };
    Object.assign(window, { __careOfflineTest: {
      countSends: () => sends,
      own: () => loadOfflineDrafts(context),
      other: () => loadOfflineDrafts({ ...context, userId: "66666666-6666-4666-8666-666666666666" }),
      clear: () => clearOfflineDrafts(),
      expired: () => saveOfflineDraft(context, { id: crypto.randomUUID(), kind: "care-note", clientRef: clientId, baseVersion: 0,
        createdAt: new Date(Date.now() - 25 * 3600000).toISOString(), expiresAt: new Date(Date.now() - 3600000).toISOString(), payload: {} }),
    } });
    let active = true;
    queueMicrotask(() => { if (active) setReady(true); });
    return () => { active = false; window.fetch = originalFetch; };
  }, []);
  return <main style={{ padding: 24 }}><h1>合成離線驗收</h1><p>僅測試瀏覽器草稿；伺服器回覆為測試替身，不代表正式儲存。</p>
    {ready ? <OfflineCareProvider context={context}><CareDiaryComposer clients={[{ id: clientId, name: "合成個案", code: "TEST-001" }]}
      serviceDate="2026-09-12" selectedClientId={clientId} enabled demo={false} /></OfflineCareProvider> : <p>初始化測試環境…</p>}
  </main>;
}
