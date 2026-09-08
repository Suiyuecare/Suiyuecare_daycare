"use client";

import { useEffect, useState } from "react";

import { ClientVaccinationBatchForm, ClientVaccinationCreateForm,
  ClientVaccinationRevisionForm } from "@/components/client-vaccinations/client-vaccination-actions";
import { buildDemoClientVaccinationSnapshot } from "@/lib/client-vaccinations/demo";

const snapshot = { ...buildDemoClientVaccinationSnapshot({
  organizationId: "23900000-0000-4000-8000-000000000001",
  branchId: "23900000-0000-4000-8000-000000000002",
  filters: { clientId: null, vaccineName: null, doseNumber: null,
    dateFrom: null, dateTo: null, status: "all", query: "" },
  now: new Date("2026-09-08T00:00:00Z"),
}), demo: false };

type HarnessWindow = Window & { vaccineHarnessRequests?: RequestInit[] };

// Local component/layout harness only. It intercepts ALL vaccination writes;
// it does not exercise authentication, HTTP handlers or persistence. No app route
// imports this fixture in the checked-in application.
export default function ClientVaccinationHarness() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const original = window.fetch;
    (window as HarnessWindow).vaccineHarnessRequests = [];
    window.fetch = async (input, init = {}) => {
      if (!String(input).startsWith("/api/client-vaccinations")) return original(input, init);
      (window as HarnessWindow).vaccineHarnessRequests!.push(init);
      const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      const receipt = (body: Record<string, unknown>) => ({
        recordPayload: Object.fromEntries(Object.entries(body).filter(([key]) =>
          !["action", "vaccination_key", "previous_version_id", "expected_base_version", "correction_reason"].includes(key))),
        organizationId: snapshot.organizationId, branchId: snapshot.branchId,
        vaccinationKey: body.vaccination_key, recordVersionId: crypto.randomUUID(),
        version: Number(body.expected_base_version) + 1, previousVersionId: body.previous_version_id,
        recordStatus: "active", clientId: body.client_id, contentHash: "a".repeat(64),
        duplicateWarning: false, duplicateCount: 0, duplicateBasis: "same_client_normalized_vaccine_and_dose",
        recordedAt: "2026-09-08T00:00:00.000Z", replayed: false, persisted: true, demo: false,
      });
      if (String(input).endsWith("/batch")) {
        const items = sent.items as { idempotency_key: string; record: Record<string, unknown> }[];
        return Response.json({ requestId: crypto.randomUUID(), status: "ok", errors: [], data: {
          batchId: crypto.randomUUID(), batchIdempotencyKey: new Headers(init.headers).get("idempotency-key"),
          requestHash: "b".repeat(64), replayed: false, itemTotal: items.length,
          succeededTotal: 1, rejectedTotal: items.length - 1, persisted: true, demo: false,
          results: items.map((item, index) => ({ index, idempotencyKey: item.idempotency_key,
            status: index === 0 ? "created" : "rejected", receipt: index === 0 ? receipt(item.record) : null,
            error: index === 0 ? null : { code: "INVALID_CLIENT_VACCINATION_RECORD", message: "合成測試：請核對劑次。" } })),
        } });
      }
      return Response.json({ requestId: crypto.randomUUID(), status: "ok", errors: [],
        data: { receipt: receipt(sent), persisted: true, demo: false } }, { status: 201 });
    };
    const timer = setTimeout(() => setReady(true), 0);
    return () => { clearTimeout(timer); window.fetch = original; };
  }, []);
  return <main id="main-content" style={{ maxWidth: 1200, margin: "0 auto", padding: 16 }}>
    <h1>疫苗操作元件測試</h1>
    <p role="note">全為合成資料及模擬回應；不存檔、不連正式 API，不是正式登入端到端驗收。</p>
    {ready ? <>
      <ClientVaccinationCreateForm canManage snapshot={snapshot} />
      <ClientVaccinationBatchForm canManage hasRecentAal2 snapshot={snapshot} />
      <ClientVaccinationRevisionForm canManage hasRecentAal2 snapshot={snapshot} />
    </> : <p role="status">測試元件載入中</p>}
  </main>;
}
