"use client";

import { useEffect, useState } from "react";
import { CreateClientServicePlan } from "@/components/client-service-plan-workflow/client-service-plan-actions";
import { buildDemoClientServicePlanSnapshot } from "@/lib/client-service-plan-workflow/demo";

const snapshot = { ...buildDemoClientServicePlanSnapshot({ clientId: null, status: "all",
  asOf: "2026-09-08", query: null }), demo: false };
type HarnessWindow = Window & { planHarnessRequests?: RequestInit[] };

// Component-only synthetic layout/retry harness. ALL Page52 writes are captured
// and rejected locally; no HTTP handler, authentication or database is exercised.
// No retained app route imports this fixture.
export default function ClientServicePlanHarness() {
  const [ready, setReady] = useState(false);
  const [canManage, setCanManage] = useState(true);
  useEffect(() => {
    const original = window.fetch;
    (window as HarnessWindow).planHarnessRequests = [];
    window.fetch = async (input, init = {}) => {
      if (!String(input).startsWith("/api/client-service-plans")) return original(input, init);
      (window as HarnessWindow).planHarnessRequests!.push(init);
      throw new TypeError("Synthetic unknown outcome; no request was sent");
    };
    const timer = setTimeout(() => setReady(true), 0);
    return () => { clearTimeout(timer); window.fetch = original; };
  }, []);
  return <main id="main-content" style={{ maxWidth: 1200, margin: "0 auto", padding: 16 }}>
    <h1>服務計畫操作元件測試</h1>
    <p>合成表單與模擬斷線；不連正式 API、不存檔，不是正式登入端到端驗收。</p>
    <button className="button button--secondary" onClick={() => setCanManage((value) => !value)} type="button">
      {canManage ? "模擬撤銷權限" : "恢復模擬權限"}</button>
    {ready ? <CreateClientServicePlan snapshot={snapshot} canManage={canManage} /> : <p role="status">測試載入中</p>}
  </main>;
}
