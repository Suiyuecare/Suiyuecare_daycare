// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPendingOperations, hasViewTransition, tryAcquirePendingOperation } from "@/lib/navigation/pending-operation-lock";
import { parsePsychosocialActionSuccess } from "./parser";
import { normalizePsychosocialSnapshot } from "./snapshot-contract";
import { capabilities, psychosocialCommittedSnapshot, psychosocialDenial, psychosocialFixture, psychosocialReceipt } from "./pending.test-fixtures";
import { beginPsychosocialAssessment, clearPsychosocialAssessmentPendingOnLogout, getPsychosocialAssessmentPending, getPsychosocialAssessmentSnapshotAdmission,
  isConfirmedPsychosocialAssessmentRejection, observePsychosocialAssessmentAuthority, observePsychosocialAssessmentSnapshot, psychosocialAssessmentAuthoritySignature,
  quarantinePsychosocialAssessmentSnapshot, reconcilePsychosocialAssessmentConfirmed, retryPsychosocialAssessment, settlePsychosocialAssessment, tryAcquirePsychosocialAssessmentRecoveryRead, type PsychosocialInput } from "./pending";
let fixture: ReturnType<typeof psychosocialFixture>; let iteration = 0;
beforeEach(() => { clearPsychosocialAssessmentPendingOnLogout(); vi.setSystemTime(new Date(1900000000000 + (++iteration * 10000))); fixture = psychosocialFixture();
  observePsychosocialAssessmentAuthority(psychosocialAssessmentAuthoritySignature(fixture.context)); observePsychosocialAssessmentSnapshot(fixture.scope, false, fixture.snapshot, capabilities); });
afterEach(() => { clearPsychosocialAssessmentPendingOnLogout(); vi.useRealTimers(); });
function begin() { return beginPsychosocialAssessment(fixture.scope, false, fixture.input, fixture.snapshot.generatedAt)!; }
function signInput(): PsychosocialInput { const item = fixture.draft; return { action: "sign", clientId: item.clientId, assessmentKey: item.assessmentKey!, previousVersionId: item.versionId!, expectedVersion: item.assessmentVersion!, idempotencyKey: fixture.input.idempotencyKey }; }
describe("psychosocial same-operation journal", () => {
  it("read rejection quarantines old generation across remount without discarding or rekeying unknown writes", () => {
    const operation = begin(); settlePsychosocialAssessment(operation, "unknown");
    expect(quarantinePsychosocialAssessmentSnapshot({ ...fixture.scope, userId: "28280000-0000-4000-8000-000000000002" }, false)).toBe(false);
    expect(quarantinePsychosocialAssessmentSnapshot(fixture.scope, true)).toBe(false);
    expect(quarantinePsychosocialAssessmentSnapshot(fixture.scope, false)).toBe(true);
    expect(getPsychosocialAssessmentPending().snapshotFloor).toBe(fixture.snapshot.generatedAt);
    expect(getPsychosocialAssessmentPending().operation?.body).toBe(operation.body); expect(hasPendingOperations()).toBe(true);
    expect(observePsychosocialAssessmentSnapshot(fixture.scope, false, fixture.snapshot, capabilities)).toBe(false);
    expect(retryPsychosocialAssessment(operation.token, fixture.scope, false)).toBeNull();
    vi.setSystemTime(Date.now() + 1000); const fresh = { ...fixture.snapshot, generatedAt: new Date().toISOString(), staleAfter: new Date(Date.now() + 60000).toISOString() };
    expect(observePsychosocialAssessmentSnapshot(fixture.scope, false, fresh, capabilities)).toBe(true);
    const retry = retryPsychosocialAssessment(operation.token, fixture.scope, false)!;
    expect(retry.body).toBe(operation.body); expect(retry.input.idempotencyKey).toBe(operation.input.idempotencyKey);
  });
  it("explicit recovery read preserves the unknown original and excludes foreign leases/retry", () => {
    const operation = begin(); expect(tryAcquirePsychosocialAssessmentRecoveryRead(fixture.scope, false)).toBeNull();
    settlePsychosocialAssessment(operation, "unknown"); const original = getPsychosocialAssessmentPending().operation;
    const foreign = tryAcquirePendingOperation()!;
    try { expect(tryAcquirePsychosocialAssessmentRecoveryRead(fixture.scope, false)).toBeNull(); } finally { foreign(); }
    expect(tryAcquirePsychosocialAssessmentRecoveryRead({ ...fixture.scope, userId: "28280000-0000-4000-8000-000000000002" }, false)).toBeNull();
    expect(tryAcquirePsychosocialAssessmentRecoveryRead(fixture.scope, true)).toBeNull();
    const read = tryAcquirePsychosocialAssessmentRecoveryRead(fixture.scope, false)!;
    try { expect(read).not.toBeNull(); expect(hasPendingOperations()).toBe(true); expect(hasViewTransition()).toBe(true);
      expect(getPsychosocialAssessmentPending().operation).toBe(original); expect(retryPsychosocialAssessment(operation.token, fixture.scope, false)).toBeNull(); }
    finally { read?.(); }
    expect(hasPendingOperations()).toBe(true); const retry = retryPsychosocialAssessment(operation.token, fixture.scope, false)!;
    expect(retry.body).toBe(operation.body); expect(retry.input.idempotencyKey).toBe(operation.input.idempotencyKey);
  });
  it("freezes normalized full content, source, key and own shared lease", () => { const operation = begin(); expect(operation).not.toBeNull(); expect(hasPendingOperations()).toBe(true);
    expect(operation.input.action !== "sign" && Object.isFrozen(operation.input.dimensions)).toBe(true); if (fixture.input.action === "create_draft") fixture.input.assessmentSummary = "later edit"; expect(operation.body).not.toContain("later edit");
    expect(beginPsychosocialAssessment(fixture.scope, false, operation.input, operation.snapshotAt)).toBeNull(); });
  it.each([403, 409])("unknown→%i preserves body/key/token and remains manually retryable", (status) => { const original = begin(); settlePsychosocialAssessment(original, "unknown");
    const retry = retryPsychosocialAssessment(original.token, fixture.scope, false)!; expect(retry.body).toBe(original.body); expect(retry.input.idempotencyKey).toBe(original.input.idempotencyKey);
    expect(isConfirmedPsychosocialAssessmentRejection(psychosocialDenial(status), status)).toBe(true); settlePsychosocialAssessment(retry, "denied");
    expect(getPsychosocialAssessmentPending().operation?.phase).toBe("unknown"); expect(hasPendingOperations()).toBe(true); });
  it("first strict rejection releases only this owner", () => { const operation = begin(); settlePsychosocialAssessment(operation, "denied"); expect(hasPendingOperations()).toBe(false); expect(getPsychosocialAssessmentPending().operation).toBeNull(); });
  it("clearing this journal cannot release another module lease", () => { const foreign = tryAcquirePendingOperation()!; clearPsychosocialAssessmentPendingOnLogout(); expect(hasPendingOperations()).toBe(true); foreign(); });
  it("retains recovery after source expiry but forbids new writes", () => { const operation = begin(); settlePsychosocialAssessment(operation, "unknown"); vi.setSystemTime(new Date(Date.parse(fixture.snapshot.staleAfter) + 1));
    expect(retryPsychosocialAssessment(operation.token, fixture.scope, false)?.body).toBe(operation.body); });
  it("actor ABA rejects old attempt and requires a new snapshot generation", () => { const operation = begin(); const other = { ...fixture.context, userId: "28280000-0000-4000-8000-000000000002" };
    observePsychosocialAssessmentAuthority(psychosocialAssessmentAuthoritySignature(other)); observePsychosocialAssessmentAuthority(psychosocialAssessmentAuthoritySignature(fixture.context));
    expect(settlePsychosocialAssessment(operation, "denied")).toBe(false); expect(observePsychosocialAssessmentSnapshot(fixture.scope, false, fixture.snapshot, capabilities)).toBe(false);
    expect(getPsychosocialAssessmentPending().snapshotFloor).toBe(fixture.snapshot.generatedAt); expect(retryPsychosocialAssessment(operation.token, fixture.scope, false)).toBeNull(); });
  it.each(["clients.read", "social_work_records.read"])("%s revoke/restore retains global floor across owner remount", (permission) => {
    observePsychosocialAssessmentAuthority(psychosocialAssessmentAuthoritySignature({ ...fixture.context, scopes: fixture.context.scopes.filter((scope) => scope !== permission) }));
    observePsychosocialAssessmentAuthority(psychosocialAssessmentAuthoritySignature(fixture.context));
    expect(observePsychosocialAssessmentSnapshot(fixture.scope, false, fixture.snapshot, capabilities)).toBe(false); });
  it("manage-only loss preserves readable source but invalidates old write attempt", () => { const operation = begin(); observePsychosocialAssessmentSnapshot(fixture.scope, false, fixture.snapshot, { ...capabilities, canManage: false });
    expect(getPsychosocialAssessmentPending().snapshotFloor).toBeNull(); expect(settlePsychosocialAssessment(operation, "denied")).toBe(false); expect(retryPsychosocialAssessment(operation.token, fixture.scope, false)).toBeNull(); });
  it("removing assigned client at the same generation establishes a global privacy floor", () => {
    const operation = begin(); const removed = { ...fixture.snapshot, items: fixture.snapshot.items.filter((item) => item.clientId !== fixture.client.clientId),
      itemTotal: fixture.snapshot.itemTotal - 1, matchingTotal: fixture.snapshot.matchingTotal - 1, clientOptions: fixture.snapshot.clientOptions.filter((item) => item.clientId !== fixture.client.clientId),
      metrics: { ...fixture.snapshot.metrics, notAssessed: fixture.snapshot.metrics.notAssessed - 1 } };
    expect(observePsychosocialAssessmentSnapshot(fixture.scope, false, removed, capabilities)).toBe(false);
    expect(getPsychosocialAssessmentPending().snapshotFloor).toBe(fixture.snapshot.generatedAt); expect(settlePsychosocialAssessment(operation, "denied")).toBe(false);
    expect(observePsychosocialAssessmentSnapshot(fixture.scope, false, fixture.snapshot, capabilities)).toBe(false);
  });
  it("invalid server capability flags do not create admission", () => expect(() => observePsychosocialAssessmentSnapshot(fixture.scope, false, fixture.snapshot,
    { ...capabilities, hasRecentAal2: "true" } as unknown as typeof capabilities)).toThrow());
  it("AAL downgrade/redemption cannot resurrect the old source", () => { observePsychosocialAssessmentAuthority(psychosocialAssessmentAuthoritySignature({ ...fixture.context, assuranceLevel: "aal1" }));
    observePsychosocialAssessmentAuthority(psychosocialAssessmentAuthoritySignature(fixture.context)); expect(observePsychosocialAssessmentSnapshot(fixture.scope, false, fixture.snapshot, capabilities)).toBe(false); });
  it("accepted generation watermark rejects stale remount after a privacy floor clears", () => {
    const newer = { ...fixture.snapshot, generatedAt: new Date(Date.now() + 1).toISOString(), staleAfter: new Date(Date.now() + 60001).toISOString() };
    observePsychosocialAssessmentSnapshot(fixture.scope, false, newer, capabilities);
    expect(getPsychosocialAssessmentSnapshotAdmission(fixture.scope, false)).toBe(newer.generatedAt); expect(observePsychosocialAssessmentSnapshot(fixture.scope, false, fixture.snapshot, capabilities)).toBe(false); });
  it("logout clears clinical body and retains only generation metadata", () => { const operation = begin(); clearPsychosocialAssessmentPendingOnLogout();
    expect(getPsychosocialAssessmentPending().operation).toBeNull(); expect(settlePsychosocialAssessment(operation, "unknown")).toBe(false); expect(hasPendingOperations()).toBe(false);
    expect(getPsychosocialAssessmentPending().snapshotFloor).toBe(fixture.snapshot.generatedAt); });
  it("successful receipt guards same client, not just the original chain", () => { const operation = begin(); const receipt = parsePsychosocialActionSuccess(psychosocialReceipt(operation.input, fixture.context), operation.input, 201);
    settlePsychosocialAssessment(operation, receipt); expect(hasPendingOperations()).toBe(false); expect(getPsychosocialAssessmentPending().confirmed).toHaveLength(1);
    expect(beginPsychosocialAssessment(fixture.scope, false, fixture.input, fixture.snapshot.generatedAt)).toBeNull();
    reconcilePsychosocialAssessmentConfirmed(fixture.scope, fixture.snapshot, Date.now()); expect(getPsychosocialAssessmentPending().confirmed).toHaveLength(1); });
  it("fresh exact original version in same-client same-chain history clears the guard", () => {
    const operation = begin(); const receipt = parsePsychosocialActionSuccess(psychosocialReceipt(operation.input, fixture.context), operation.input, 201); settlePsychosocialAssessment(operation, receipt);
    const snapshot = psychosocialCommittedSnapshot(fixture.snapshot, operation.input, receipt.data); const now = Date.parse(snapshot.generatedAt);
    reconcilePsychosocialAssessmentConfirmed(fixture.scope, snapshot, now); expect(getPsychosocialAssessmentPending().confirmed).toHaveLength(0);
  });
  it("positive matching history can prove success in a partial list; absence never proves it", () => {
    const operation = begin(); const receipt = parsePsychosocialActionSuccess(psychosocialReceipt(operation.input, fixture.context), operation.input, 201); settlePsychosocialAssessment(operation, receipt);
    const snapshot = psychosocialCommittedSnapshot(fixture.snapshot, operation.input, receipt.data);
    const partial = { ...snapshot, matchingTotal: snapshot.matchingTotal + 1, itemsTruncated: true, metrics: { ...snapshot.metrics, notAssessed: snapshot.metrics.notAssessed + 1 } };
    reconcilePsychosocialAssessmentConfirmed(fixture.scope, partial, Date.parse(partial.generatedAt)); expect(getPsychosocialAssessmentPending().confirmed).toHaveLength(0);
  });
  it.each(["wrong-version", "wrong-time", "future", "expired", "foreign"])("%s projection cannot clear saved marker", (kind) => {
    const operation = begin(); const receipt = parsePsychosocialActionSuccess(psychosocialReceipt(operation.input, fixture.context), operation.input, 201); settlePsychosocialAssessment(operation, receipt);
    const snapshot = psychosocialCommittedSnapshot(fixture.snapshot, operation.input, receipt.data); const item = snapshot.items.find((entry) => entry.clientId === operation.input.clientId)!;
    if (kind === "wrong-version") { item.versionId = "28600000-0000-4000-8000-000000000099"; item.versionHistory[0]!.versionId = item.versionId; }
    if (kind === "wrong-time") item.versionHistory[0]!.createdAt = new Date(Date.parse(receipt.data.committedAt) - 1).toISOString();
    if (kind === "foreign") snapshot.branchId = "22222222-2222-4222-8222-222222222299";
    const now = kind === "future" ? Date.parse(snapshot.generatedAt) - 1 : kind === "expired" ? Date.parse(snapshot.staleAfter) : Date.parse(snapshot.generatedAt);
    reconcilePsychosocialAssessmentConfirmed(fixture.scope, snapshot, now); expect(getPsychosocialAssessmentPending().confirmed).toHaveLength(1);
  });
  it.each(["versionId", "assessmentKey", "assessedOn", "reassessmentDueOn", "responsibleUserId"])("forged %s receipt cannot release original operation", (field) => {
    observePsychosocialAssessmentSnapshot(fixture.scope, false, fixture.draftSnapshot, capabilities); const input = signInput(); const op = beginPsychosocialAssessment(fixture.scope, false, input, fixture.snapshot.generatedAt, fixture.draft)!;
    const bad = { versionId: fixture.draft.versionId, assessmentKey: "28500000-0000-4000-8000-000000000088", assessedOn: "2200-01-01", reassessmentDueOn: "2200-01-01", responsibleUserId: "28280000-0000-4000-8000-000000000088" };
    expect(() => settlePsychosocialAssessment(op, psychosocialReceipt(input, fixture.context, fixture.draft, { [field]: bad[field as keyof typeof bad] }) as ReturnType<typeof parsePsychosocialActionSuccess>)).toThrow();
    expect(getPsychosocialAssessmentPending().operation).toBe(op); });
  it("signing requires real loader recency flags rather than nursing-only context timestamp", () => { observePsychosocialAssessmentSnapshot(fixture.scope, false, fixture.draftSnapshot, { ...capabilities, hasRecentAal2: false });
    expect(beginPsychosocialAssessment(fixture.scope, false, signInput(), fixture.snapshot.generatedAt, fixture.draft)).toBeNull(); });
  it("target must bind exact original immutable source id/version/content", () => { observePsychosocialAssessmentSnapshot(fixture.scope, false, fixture.draftSnapshot, capabilities);
    expect(() => beginPsychosocialAssessment(fixture.scope, false, signInput(), fixture.snapshot.generatedAt, { ...fixture.draft, assessmentSummary: "different source" })).toThrow(); });
  it.each([null, {}, { requestId: "bad", status: "error", data: null, errors: [] }])("malformed error is not known denial", (raw) => expect(isConfirmedPsychosocialAssessmentRejection(raw, 403)).toBe(false));
  it("generic failed-save 409 is not a known rejection", () => expect(isConfirmedPsychosocialAssessmentRejection({ ...psychosocialDenial(), errors: [{ code: "PSYCHOSOCIAL_SAVE_FAILED", message: "unknown" }] }, 409)).toBe(false));
  it("synthetic mode never acquires a write lease", () => expect(beginPsychosocialAssessment(fixture.scope, true, fixture.input, fixture.snapshot.generatedAt)).toBeNull());
});
describe("psychosocial projection admission", () => {
  it("accepts the exact production projection", () => expect(normalizePsychosocialSnapshot(fixture.snapshot, fixture.context)).toEqual(fixture.snapshot));
  it.each(["top", "metrics", "dimension", "history", "boolean", "truncation"])("rejects unknown or forged %s data, not silently discard", (kind) => {
    const value = structuredClone(fixture.snapshot) as unknown as Record<string, unknown>;
    if (kind === "top") value.extra = "hidden";
    if (kind === "metrics") (value.metrics as Record<string, unknown>).extra = true;
    const items = value.items as Record<string, unknown>[];
    if (kind === "dimension") ((items[0]!.dimensions as Record<string, Record<string, unknown>>).resource_access!).versionHistoryTruncated = true;
    if (kind === "history") ((items[0]!.versionHistory as Record<string, unknown>[])[0]!).extra = true;
    if (kind === "boolean") items[0]!.versionHistoryTruncated = "false";
    if (kind === "truncation") items[0]!.versionHistoryTruncated = true;
    expect(() => normalizePsychosocialSnapshot(value as unknown as typeof fixture.snapshot, fixture.context)).toThrow();
  });
});
