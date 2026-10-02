// Synthetic browser fixture, not an application route or proof of real Auth.
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app/app-shell";
import { ClaimValidationComposer } from "@/components/service-management/claim-validation-composer";
import type { TenantContext } from "@/lib/domain/types";

const uuid = (number: number) => `a0000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const scope = { organizationId: uuid(1), branchId: uuid(2), userId: uuid(3) };
const batch = { id: uuid(4), periodLabel: "合成測試 2026/09", totalAmount: "1200.10", itemCount: 2 };
const context: TenantContext = { ...scope, organizationName: "合成測試機構（非正式）", branchName: "合成測試分支",
  displayName: "合成測試人員", roles: ["finance_claims"], scopes: [], assuranceLevel: "aal2", recentAal2At: null, demo: false };
type FixtureWindow = Window & { fixture: {
  mode: "success" | "unknown" | "invalid" | "denied" | "deferred";
  writes: { key: string; body: string }[]; refreshes: number;
  resolve: (() => void) | null; remount: () => void; mounted: (value: boolean) => void;
  allowed: (value: boolean) => void; foreign: (value: boolean) => void; fresh: () => void;
} };
const state: FixtureWindow["fixture"] = {
  mode: "success", writes: [], refreshes: 0,
  resolve: null, remount: () => {}, mounted: () => {},
  allowed: () => {}, foreign: () => {}, fresh: () => {},
};
(window as unknown as FixtureWindow).fixture = state;
window.fetch = async (input, init) => {
  const url = new URL(String(input), window.location.href);
  if (url.origin !== window.location.origin) throw new Error("External fixture requests are blocked");
  if (url.pathname === "/api/context/branch") return Response.json({ status: "ok", data: { branches: [], cleared: true } });
  if (url.pathname !== "/api/claims/validate" || init?.method !== "POST") throw new Error("Only synthetic fixture API is available");
  const key = new Headers(init.headers).get("Idempotency-Key") ?? "";
  const body = String(init.body); state.writes.push({ key, body });
  const mode = state.mode;
  if (mode === "deferred") await new Promise<void>((resolve) => { state.resolve = resolve; });
  if (mode === "unknown") throw new Error("Synthetic lost acknowledgement");
  if (mode === "invalid") return Response.json({});
  if (mode === "denied") return Response.json({ requestId: uuid(9), status: "error", data: null,
    errors: [{ code: "CLAIM_VALIDATION_REJECTED", message: "Synthetic rejection" }] }, { status: 422 });
  const request = JSON.parse(body);
  return Response.json({ requestId: uuid(9), status: "ok", errors: [], data: {
    claimBatchId: request.claim_batch_id, totalAmount: request.expected_total_amount,
    itemCount: request.expected_item_count, status: "validated", persisted: true, demo: false,
    replayed: state.writes.length > 1, idempotencyKey: key,
  } });
};
function Fixture() {
  const [mounted, setMounted] = useState(true); const [epoch, setEpoch] = useState(0);
  const [allowed, setAllowed] = useState(true); const [foreign, setForeign] = useState(false);
  const [batches, setBatches] = useState([batch]);
  useEffect(() => {
    state.remount = () => setEpoch((value) => value + 1); state.mounted = setMounted;
    state.allowed = setAllowed; state.foreign = setForeign; state.fresh = () => setBatches([]);
  }, []);
  return <AppShell context={context} navigation={[]}>
    <section className="panel" style={{ padding: 24 }}>
      <h1 data-governance-focus-anchor tabIndex={-1}>本機合成申報驗證</h1>
      <p className="callout">合成資料、假的 HTTP 回覆；不連線正式帳號或資料庫。</p>
      {mounted ? <ClaimValidationComposer key={epoch} scope={{ ...scope, branchId: foreign ? uuid(8) : scope.branchId }}
        batches={batches} enabled={allowed} hasRecentAal2={allowed} demo={false} /> : <p>元件已卸載；暫存操作不得遺失。</p>}
      <a href="https://login.suiyuecare.com/portal/" id="fixture-portal">合成離頁測試</a>
      <form method="get" action="/" aria-label="合成篩選"><button className="button button--secondary">合成 GET 篩選</button></form>
    </section>
  </AppShell>;
}
createRoot(document.getElementById("fixture-root")!).render(<Fixture />);
