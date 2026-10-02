// Local synthetic UI. It is not an app route, Auth, clinical or SQL evidence.
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app/app-shell";
import { BodyAssessmentsWorkspace } from "@/components/body-assessments/body-assessments-workspace";
import { buildDemoBodyAssessmentSnapshot } from "@/lib/body-assessments/demo";
import type { BodyAssessmentRecord, BodyAssessmentSnapshot } from "@/lib/body-assessments/types";
import type { BodyAssessmentReceipt, BodyAssessmentMutation } from "@/lib/body-assessments/parser";
import type { TenantContext } from "@/lib/domain/types";
import { staffPages } from "@/lib/catalog";

const seed = buildDemoBodyAssessmentSnapshot({ clientId: null, state: "all" });
const actor = seed.records[0].actor_user_id;
const original = seed.records[0].history[0];
const initial: BodyAssessmentSnapshot = { ...seed, demo: false,
  records: [{ ...original, history: [], historyTotal: 0, historyTruncated: false }] };
const context: TenantContext = { organizationId: initial.organizationId, branchId: initial.branchId, userId: actor,
  organizationName: "合成測試機構（非正式）", branchName: "合成測試分支", displayName: "合成測試人員",
  roles: ["nurse"], scopes: [], assuranceLevel: "aal2", recentAal2At: null, demo: false };
const uuid = (number: number) => `19000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
type FixtureState = { mode: "success" | "unknown" | "invalid" | "denied" | "deferred";
  writes: { key: string; body: string }[]; refreshes: number; resolve: (() => void) | null;
  remount: () => void; foreign: (value: boolean) => void; allowed: (value: boolean) => void;
  fresh: () => void; last: BodyAssessmentReceipt | null };
type BranchFixtureState = { branchRequests: { method: string; body: string }[] };
const state: FixtureState & BranchFixtureState = { mode: "success", writes: [], refreshes: 0, resolve: null, branchRequests: [],
  remount: () => {}, foreign: () => {}, allowed: () => {}, fresh: () => {}, last: null };
(window as unknown as Window & { fixture: FixtureState }).fixture = state;
const receipts = new Map<string, BodyAssessmentReceipt>();
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href);
  if (url.origin !== location.origin) throw new Error("External fixture requests are blocked");
  if (url.pathname === "/api/context/branch") {
    const method = init?.method ?? "GET";
    state.branchRequests.push({ method, body: String(init?.body ?? "") });
    if (method === "DELETE") return Response.json({ status: "ok", data: { cleared: true } });
    if (method === "GET") return Response.json({ requestId: uuid(91), status: "ok", errors: [], data: {
      currentBranchId: initial.branchId,
      branches: [{ id: initial.branchId, name: context.branchName }, { id: uuid(999), name: "合成另一分支" }],
    } });
    // Deliberately unknown: never navigate a browser to a real staff route or
    // claim a cookie/permission change from this synthetic UI harness.
    return Response.json({ status: "error", errors: [] }, { status: 503 });
  }
  if (url.pathname !== "/api/body-assessments" || init?.method !== "POST") throw new Error("Only the synthetic body API is available");
  const key = new Headers(init.headers).get("idempotency-key") ?? "";
  const body = String(init.body); state.writes.push({ key, body });
  const mode = state.mode;
  if (mode === "deferred") await new Promise<void>((resolve) => { state.resolve = resolve; });
  if (mode === "denied") return Response.json({ requestId: uuid(90), status: "error", data: null,
    errors: [{ code: "INVALID_BODY_ASSESSMENT_OPERATION", message: "Synthetic rejection" }] }, { status: 400 });
  const request = JSON.parse(body) as BodyAssessmentMutation;
  const replayed = receipts.has(key);
  const receipt: BodyAssessmentReceipt = { ...(receipts.get(key) ?? {
    operation_id: uuid(100 + receipts.size), organization_id: initial.organizationId, branch_id: initial.branchId,
    actor_user_id: actor, client_id: request.client_id, idempotency_key: key, request_payload: request,
    assessment_key: request.assessment_key ?? uuid(200 + receipts.size), version_id: uuid(300 + receipts.size),
    version: request.expected_version + 1, record_state: request.action === "sign" ? "signed" : request.action === "correct" ? "corrected" : "draft",
    content_hash: "c".repeat(64), committed_at: new Date().toISOString(), replayed: false,
  }), replayed };
  receipts.set(key, receipt); state.last = receipt;
  if (mode === "unknown") throw new Error("Synthetic lost acknowledgement");
  if (mode === "invalid") return Response.json({});
  return Response.json({ requestId: uuid(90), status: "ok", data: receipt, errors: [] }, { status: replayed ? 200 : 201 });
};
function updatedRecord(receipt: BodyAssessmentReceipt): BodyAssessmentRecord {
  const request = receipt.request_payload;
  return { ...original, assessment_key: receipt.assessment_key, version_id: receipt.version_id,
    previous_version_id: request.previous_version_id, version: receipt.version, content_hash: receipt.content_hash,
    record_state: receipt.record_state, client_id: request.client_id, reason: request.reason,
    observed_at: "observed_at" in request ? request.observed_at : original.observed_at,
    observations: "observations" in request ? request.observations : original.observations,
    created_at: receipt.committed_at, signed_at: receipt.record_state === "draft" ? null : receipt.committed_at,
    signed_by: receipt.record_state === "draft" ? null : actor,
    signer_role_keys: receipt.record_state === "draft" ? null : ["nurse"],
    signature_purpose: receipt.record_state === "draft" ? null : "合成瀏覽器假回執（不是臨床證據）",
    signature_reauth_challenge_id: receipt.record_state === "draft" ? null : uuid(400),
    history: [], historyTotal: 0, historyTruncated: false };
}
function Fixture() {
  const [epoch, setEpoch] = useState(0); const [foreign, setForeign] = useState(false);
  const [allowed, setAllowed] = useState(true); const [snapshot, setSnapshot] = useState(initial);
  useEffect(() => {
    state.remount = () => setEpoch((value) => value + 1); state.foreign = setForeign; state.allowed = setAllowed;
    state.fresh = () => {
      if (!state.last) return;
      const now = new Date(); const record = updatedRecord(state.last);
      setSnapshot({ ...initial, generatedAt: now.toISOString(), staleAfter: new Date(now.getTime() + 300_000).toISOString(),
        records: [record], matchingTotal: 1 });
    };
  }, []);
  const visible = foreign ? { ...snapshot, branchId: uuid(999), records: [], clients: [], matchingTotal: 0, clientTotal: 0 } : snapshot;
  return <AppShell context={context} navigation={[]}>
    <aside className="callout" style={{ marginBottom: 20 }}>本機合成瀏覽器測試；假的回執不證明登入、臨床簽署或正式保存，完全不連線雲端。</aside>
    <BodyAssessmentsWorkspace key={epoch} page={staffPages.find((page) => page.number === 19)!}
      snapshot={visible} canManage={allowed} canSign={allowed} actorUserId={actor} />
  </AppShell>;
}
createRoot(document.getElementById("fixture-root")!).render(<Fixture />);
