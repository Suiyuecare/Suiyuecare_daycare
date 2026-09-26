// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { hasPendingOperations, hasViewTransition, tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";
import { buildDemoNursingAssessmentSnapshot } from "./demo";
import { beginNursingAssessment, clearNursingAssessmentPendingOnLogout, getNursingAssessmentPending,
  getNursingAssessmentSnapshotAdmission, nursingAssessmentAuthoritySignature, observeNursingAssessmentAuthority,
  observeNursingAssessmentSnapshot, quarantineNursingAssessmentSnapshot, reconcileNursingAssessmentConfirmed,
  retryNursingAssessment, settleNursingAssessment, tryAcquireNursingAssessmentRecoveryRead,
  type NursingAssessmentOperation } from "./pending";
import type { NursingAssessmentSnapshot, NursingReceipt } from "./types";

const uuid = (n: number) => `51920000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { organizationId: uuid(1), branchId: uuid(2), userId: uuid(3) };
let serial = 0;
let now = Date.parse("2026-09-27T05:00:00.000Z");
const capabilities = { canManage: true, canSign: true, hasRecentAal2: true };
const context: TenantContext = { ...scope, organizationName: "獨立合成機構", branchName: "獨立合成分支", displayName: "独立合成護理",
  roles: ["nurse"], scopes: ["clients.read", "nursing_assessments.read", "nursing_assessments.manage", "nursing_assessments.sign"],
  assuranceLevel: "aal2", recentAal2At: new Date(now).toISOString(), demo: false };
function fresh(offset = 0): NursingAssessmentSnapshot {
  const result = { ...buildDemoNursingAssessmentSnapshot(scope.organizationId, scope.branchId), demo: false };
  result.generatedAt = new Date(now + offset).toISOString(); result.staleAfter = new Date(now + offset + 300000).toISOString();
  result.clients = result.clients.map(client => ({ ...client, versions: client.versions.map(version => ({ ...version, createdAt: new Date(now - 1000).toISOString() })) }));
  return result;
}
function observe(overrides: Partial<TenantContext> = {}) {
  return observeNursingAssessmentAuthority(nursingAssessmentAuthoritySignature({ ...context, ...overrides }));
}
function admit(value = fresh()) {
  return observeNursingAssessmentSnapshot(scope, false, value, capabilities);
}
function begin(): NursingAssessmentOperation {
  const snapshot = fresh();
  return beginNursingAssessment(scope, false, { idempotencyKey: uuid(10), request: { action: "create_draft",
    clientId: snapshot.clients[0]!.clientId, content: snapshot.clients[0]!.versions[0]!.content } }, snapshot.generatedAt)!;
}
function saved(operation: NursingAssessmentOperation): NursingReceipt {
  const source = fresh().clients[0]!.versions[0]!;
  const request = operation.input.request;
  if (request.action !== "create_draft") throw new Error("INDEPENDENT_FIXTURE_REQUIRES_CREATE");
  return { operationId: uuid(20), organizationId: scope.organizationId, branchId: scope.branchId,
    actorUserId: scope.userId, idempotencyKey: operation.input.idempotencyKey,
    request, replayed: false, persisted: true, demo: false, result: { ...source, assessmentKey: uuid(21), versionId: uuid(22),
      content: structuredClone(request.content), contentHash: "b".repeat(64), recordedBy: scope.userId, createdAt: new Date(now).toISOString() } };
}
beforeEach(() => { now = Date.parse("2026-09-27T05:00:00.000Z") + ++serial * 86400000; context.recentAal2At = new Date(now).toISOString();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); clearNursingAssessmentPendingOnLogout(); observe(); admit(); });
afterEach(() => { clearNursingAssessmentPendingOnLogout(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("independent nursing recovery read ownership and source floors", () => {
  it("does not start a read beside an actively sending write", () => {
    const operation = begin(); expect(operation).not.toBeNull();
    expect(tryAcquireNursingAssessmentRecoveryRead(scope, false)).toBeNull();
    expect(getNursingAssessmentPending().operation).toBe(operation); expect(hasPendingOperations()).toBe(true); expect(hasViewTransition()).toBe(false);
  });
  it("holds its exact unknown write while manual read excludes writes, retries and navigation", () => {
    const operation = begin(); settleNursingAssessment(operation, "unknown"); const unknown = getNursingAssessmentPending().operation!;
    const read = tryAcquireNursingAssessmentRecoveryRead(scope, false);
    expect(read).not.toBeNull();
    try {
      expect(hasPendingOperations()).toBe(true); expect(hasViewTransition()).toBe(true);
      expect(tryAcquirePendingOperation()).toBeNull(); expect(tryAcquireViewTransition()).toBeNull();
      expect(tryAcquireNursingAssessmentRecoveryRead(scope, false)).toBeNull();
      expect(retryNursingAssessment(operation.token, scope, false)).toBeNull();
      expect(getNursingAssessmentPending().operation).toBe(unknown);
    } finally { read!(); }
    expect(hasViewTransition()).toBe(false); expect(hasPendingOperations()).toBe(true);
    const retry = retryNursingAssessment(operation.token, scope, false)!;
    expect(retry.body).toBe(operation.body); expect(retry.input.idempotencyKey).toBe(operation.input.idempotencyKey);
    expect(retry.target).toBe(operation.target); expect(retry.token).toBe(operation.token);
  });
  it("cannot borrow a foreign lease or clear either owner while own write is unknown", () => {
    const operation = begin(); settleNursingAssessment(operation, "unknown"); const foreign = tryAcquirePendingOperation()!;
    try { expect(tryAcquireNursingAssessmentRecoveryRead(scope, false)).toBeNull(); expect(hasPendingOperations()).toBe(true); }
    finally { foreign(); }
    const read = tryAcquireNursingAssessmentRecoveryRead(scope, false)!;
    expect(read).not.toBeNull(); read(); expect(hasPendingOperations()).toBe(true);
    expect(getNursingAssessmentPending().operation?.token).toBe(operation.token);
  });
  it("without own write does not adopt another module's opaque lease", () => {
    const foreign = tryAcquirePendingOperation()!;
    try { expect(tryAcquireNursingAssessmentRecoveryRead(scope, false)).toBeNull(); expect(hasPendingOperations()).toBe(true); }
    finally { foreign(); }
  });
  it.each(["organizationId", "branchId", "userId"] as const)("cannot recover a foreign %s or demo identity", field => {
    const operation = begin(); settleNursingAssessment(operation, "unknown");
    expect(tryAcquireNursingAssessmentRecoveryRead({ ...scope, [field]: uuid(90) }, false)).toBeNull();
    expect(tryAcquireNursingAssessmentRecoveryRead(scope, true)).toBeNull();
    expect(getNursingAssessmentPending().operation?.body).toBe(operation.body); expect(hasPendingOperations()).toBe(true);
  });
  it("never performs a transport request or replays an unknown intent merely by acquiring and releasing a read", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); const operation = begin(); settleNursingAssessment(operation, "unknown");
    const read = tryAcquireNursingAssessmentRecoveryRead(scope, false)!; read();
    vi.setSystemTime(now + 60000); expect(fetch).not.toHaveBeenCalled();
    expect(getNursingAssessmentPending().operation?.phase).toBe("unknown"); expect(getNursingAssessmentPending().confirmed).toHaveLength(0);
  });
  it("fresh GET admission is not proof that an unknown write succeeded or failed", () => {
    const operation = begin(); settleNursingAssessment(operation, "unknown");
    vi.setSystemTime(now + 1000); expect(admit(fresh(1000))).toBe(true);
    expect(getNursingAssessmentPending().operation?.phase).toBe("unknown");
    expect(getNursingAssessmentPending().operation?.body).toBe(operation.body);
    expect(getNursingAssessmentPending().operation?.input.idempotencyKey).toBe(operation.input.idempotencyKey);
    expect(getNursingAssessmentPending().confirmed).toHaveLength(0); expect(hasPendingOperations()).toBe(true);
  });
  it("quarantine preserves the original operation but old source/absence/remount cannot restore disclosure", () => {
    const operation = begin(); settleNursingAssessment(operation, "unknown");
    expect(quarantineNursingAssessmentSnapshot(scope, false)).toBe(true);
    expect(admit(fresh())).toBe(false); expect(observeNursingAssessmentSnapshot(scope, false, null, capabilities)).toBe(false);
    expect(getNursingAssessmentSnapshotAdmission(scope, false)).toBeNull();
    expect(getNursingAssessmentPending().operation?.token).toBe(operation.token);
    expect(getNursingAssessmentPending().operation?.input.idempotencyKey).toBe(operation.input.idempotencyKey);
    expect(getNursingAssessmentPending().operation?.body).toBe(operation.body); expect(hasPendingOperations()).toBe(true);
    vi.setSystemTime(now + 1); expect(admit(fresh(1))).toBe(true);
    expect(getNursingAssessmentSnapshotAdmission(scope, false)).toBe(fresh(1).generatedAt);
  });
  it.each(["scope", "read permission", "AAL"])("authority %s ABA rejects retained old snapshot without erasing unknown intent", kind => {
    const operation = begin(); settleNursingAssessment(operation, "unknown");
    observe(kind === "scope" ? { branchId: uuid(99) } : kind === "AAL" ? { assuranceLevel: "aal1" } : { scopes: context.scopes.filter(item => item !== "nursing_assessments.read") });
    observe(); expect(admit(fresh())).toBe(false); expect(getNursingAssessmentSnapshotAdmission(scope, false)).toBeNull();
    expect(settleNursingAssessment(operation, saved(operation))).toBe(false); expect(getNursingAssessmentPending().confirmed).toHaveLength(0);
    expect(getNursingAssessmentPending().operation?.phase).toBe("unknown"); expect(hasPendingOperations()).toBe(true);
    vi.setSystemTime(now + 1); expect(admit(fresh(1))).toBe(true);
    const retry = retryNursingAssessment(operation.token, scope, false)!; expect(retry.body).toBe(operation.body);
  });
  it("rejects accepted-source regression even without a permission change", () => {
    vi.setSystemTime(now + 1000); expect(admit(fresh(1000))).toBe(true);
    expect(admit(fresh())).toBe(false); expect(getNursingAssessmentSnapshotAdmission(scope, false)).toBe(fresh(1000).generatedAt);
  });
  it("loss of assignment at the same generation prevents old client list resurrection", () => {
    const original = fresh(); const empty = { ...original, clients: [], clientTotal: 0, clientsTruncated: false };
    observeNursingAssessmentSnapshot(scope, false, empty, capabilities);
    expect(admit(original)).toBe(false);
    vi.setSystemTime(now + 1); expect(admit(fresh(1))).toBe(true);
  });
  it("a foreign quarantine cannot invalidate current admitted source or release an unknown lease", () => {
    const operation = begin(); settleNursingAssessment(operation, "unknown");
    expect(quarantineNursingAssessmentSnapshot({ ...scope, userId: uuid(99) }, false)).toBe(false);
    expect(getNursingAssessmentSnapshotAdmission(scope, false)).toBe(fresh().generatedAt);
    expect(getNursingAssessmentPending().operation?.token).toBe(operation.token); expect(hasPendingOperations()).toBe(true);
  });
  it("a successful read cannot clear positive saved marker using absent or truncated source", () => {
    const operation = begin(); const receipt = saved(operation); settleNursingAssessment(operation, receipt);
    vi.setSystemTime(now + 1000); const visible = fresh(1000);
    visible.clients = visible.clients.map(client => client.clientId === receipt.request.clientId ? { ...client, versions: [receipt.result, ...client.versions], versionsTotal: client.versionsTotal + 1 } : client);
    for (const snapshot of [ { ...visible, clients: [], clientTotal: 0 }, { ...visible, clientTotal: 3, clientsTruncated: true },
      { ...visible, clients: visible.clients.map(client => ({ ...client, versionsTotal: client.versionsTotal + 1, versionsTruncated: true })) } ]) {
      reconcileNursingAssessmentConfirmed(scope, snapshot, Date.now()); expect(getNursingAssessmentPending().confirmed).toHaveLength(1);
    }
    reconcileNursingAssessmentConfirmed(scope, visible, Date.now()); expect(getNursingAssessmentPending().confirmed).toHaveLength(0);
  });
  it("logout cannot let an old read-release closure release a newer actor's write", () => {
    const operation = begin(); settleNursingAssessment(operation, "unknown"); const oldRead = tryAcquireNursingAssessmentRecoveryRead(scope, false)!;
    clearNursingAssessmentPendingOnLogout(); oldRead(); vi.setSystemTime(now + 1); observe(); admit(fresh(1));
    const newer = beginNursingAssessment(scope, false, { idempotencyKey: uuid(11), request: { action: "create_draft",
      clientId: fresh().clients[0]!.clientId, content: fresh().clients[0]!.versions[0]!.content } }, fresh(1).generatedAt)!;
    expect(newer).not.toBeNull();
    oldRead(); expect(getNursingAssessmentPending().operation).toBe(newer); expect(hasPendingOperations()).toBe(true);
    expect(settleNursingAssessment(operation, saved(operation))).toBe(false);
  });
});
