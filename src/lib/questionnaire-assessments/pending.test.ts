// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { hasPendingOperations, hasViewTransition, tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";
import { QUESTIONNAIRE_FORMS } from "./forms";
import { parseQuestionnaireMutation } from "./mutation-contract";
import { admitQuestionnaireViewSource, clearQuestionnaireViewOnLogout, getQuestionnaireViewState,
  observeQuestionnaireViewAuthority, quarantineQuestionnaireView, questionnaireReadPermission, questionnaireViewAuthority } from "./readiness-view";
import { beginQuestionnairePending, cancelQuestionnaireRecoveryRead, clearQuestionnairePendingOnLogout, getQuestionnairePending,
  getQuestionnaireRecoveryReadLease, isQuestionnairePendingOwnerAdmitted, isQuestionnairePendingSourceAdmitted, isQuestionnaireRecoveryReadCurrent, markQuestionnairePendingCommitted,
  markQuestionnairePendingDenied, markQuestionnairePendingUnknown, observeQuestionnairePendingAuthority, observeQuestionnairePendingSource,
  reconcileQuestionnairePendingExactHistory, retryQuestionnairePending, settleQuestionnaireRecoveryRead,
  type QuestionnairePendingOperation, type QuestionnairePendingScope, type QuestionnaireRecoveryRead } from "./pending";
import type { QuestionnaireFormKey } from "./types";

const interleave = vi.hoisted(() => ({ write: null as (() => void) | null, read: null as (() => void) | null }));
vi.mock("@/lib/navigation/pending-operation-lock", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/navigation/pending-operation-lock")>();
  return { ...actual, tryAcquirePendingOperation: () => {
    const held = actual.tryAcquirePendingOperation(); if (held && interleave.write) { const run = interleave.write; interleave.write = null; run(); } return held;
  }, tryAcquirePendingRecoveryRead: (owner?: () => void) => {
    const held = actual.tryAcquirePendingRecoveryRead(owner); if (held && interleave.read) { const run = interleave.read; interleave.read = null; run(); } return held;
  } };
});
const id = (n: number) => `9312000a-0000-4000-8000-${String(n).padStart(12, "0")}`;
const formKeys = Object.keys(QUESTIONNAIRE_FORMS) as QuestionnaireFormKey[];
let serial = 0, now = 0, actor: TenantContext, scope: QuestionnairePendingScope, sourceAt: string;
const stamp = (offset = 0) => new Date(Date.now() + offset).toISOString();
function observer(context = actor) {
  const authority = questionnaireViewAuthority(context); observeQuestionnaireViewAuthority(authority);
  observeQuestionnairePendingAuthority(authority, getQuestionnaireViewState().epoch);
}
function admit(formKey: QuestionnaireFormKey = "spmsq", clientId = id(4), context = actor, at = stamp()) {
  observer(context); sourceAt = at;
  scope = { authority: questionnaireViewAuthority(context), epoch: getQuestionnaireViewState().epoch,
    organizationId: context.organizationId, branchId: context.branchId, actorUserId: context.userId, clientId, formKey };
  expect(admitQuestionnaireViewSource(scope.authority, sourceAt)).toBe(true);
  expect(observeQuestionnairePendingSource(scope, sourceAt)).toBe(true); return scope;
}
function wire(formKey = scope.formKey, action: "create" | "revise" = "create") {
  const form = QUESTIONNAIRE_FORMS[formKey];
  return { action, clientId: scope.clientId.toUpperCase(), formKey, formVersion: form.version, assessedOn: "2026-09-25",
    answers: Object.fromEntries(form.questions.map(question => [question.id, { state: "missing" }])), context: { qualitative_note: "  原操作內容  " },
    ...(action === "revise" ? { assessmentKey: id(5).toUpperCase(), previousVersionId: id(6).toUpperCase(), expectedVersion: 2 } : {}) };
}
function begin(action: "create" | "revise" = "create", key = id(7)) { return beginQuestionnairePending(scope, { request: wire(scope.formKey, action), idempotencyKey: key }, sourceAt)!; }
function unknown(action: "create" | "revise" = "create") {
  const operation = begin(action); expect(operation).not.toBeNull(); expect(markQuestionnairePendingUnknown(operation)).toBe(true);
  return getQuestionnairePending(scope).operation!;
}
function receipt(operation: QuestionnairePendingOperation) {
  const input = parseQuestionnaireMutation(operation.input.request, operation.input.idempotencyKey)!;
  return { action: input.action, clientId: operation.scope.clientId, formKey: operation.scope.formKey,
    assessmentKey: input.assessment_key ?? id(5), versionId: id(8), version: (input.expected_version ?? 0) + 1,
    recordState: "draft", assessedOn: input.assessed_on, contentHash: "b".repeat(64), committedAt: stamp(), replayed: false };
}
function draft(operation: QuestionnairePendingOperation) {
  const input = parseQuestionnaireMutation(operation.input.request, operation.input.idempotencyKey)!, result = receipt(operation);
  return { assessmentKey: result.assessmentKey, versionId: result.versionId, version: result.version, formVersion: input.form_version,
    assessedOn: input.assessed_on, answers: input.answers, context: input.context, recordState: "draft",
    authorDisplayName: "合成人員", createdAt: result.committedAt, contentHash: result.contentHash };
}
function proof(check: QuestionnaireRecoveryRead, status: "committed" | "not_found" = "committed") {
  const operation = check.operation, input = parseQuestionnaireMutation(operation.input.request, operation.input.idempotencyKey)!;
  return { schemaVersion: 1, status, organizationId: operation.scope.organizationId, branchId: operation.scope.branchId,
    actorUserId: operation.scope.actorUserId, clientId: operation.scope.clientId, formKey: operation.scope.formKey, action: input.action,
    idempotencyKey: operation.input.idempotencyKey, nonce: check.nonce, verifiedAt: stamp(), persisted: status === "committed", demo: false,
    receipt: status === "committed" ? receipt(operation) : null,
    request: status === "committed" ? { action: input.action, client_id: input.client_id, form_key: input.form_key,
      form_version: input.form_version, assessed_on: input.assessed_on, answers: input.answers, context: input.context,
      assessment_key: input.assessment_key ?? null, previous_version_id: input.previous_version_id ?? null, expected_version: input.expected_version ?? 0 } : null,
    draft: status === "committed" ? draft(operation) : null };
}
function retained(operation: QuestionnairePendingOperation) {
  const current = getQuestionnairePending(scope).operation!;
  expect(current?.token).toBe(operation.token); expect(current?.input).toBe(operation.input);
  expect(current?.body).toBe(operation.body); expect(current?.phase).toBe("unknown");
  expect(hasPendingOperations()).toBe(true); expect(getQuestionnairePending(scope).confirmed).toHaveLength(0);
}
beforeEach(() => {
  clearQuestionnairePendingOnLogout(); clearQuestionnaireViewOnLogout();
  now = Date.parse("2026-09-27T04:00:00Z") + ++serial * 86_400_000;
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  const permissions = [...new Set(formKeys.map(questionnaireReadPermission))];
  actor = { organizationId: id(1), branchId: id(2), userId: id(3), organizationName: "合成機構", branchName: "合成分支", displayName: "合成人員",
    roles: ["nurse"], scopes: ["clients.read", ...permissions, ...permissions.map(read => read.replace(/\.read$/u, ".manage"))], assuranceLevel: "aal1", recentAal2At: null, demo: false };
  admit();
});
afterEach(() => { interleave.write = null; interleave.read = null; clearQuestionnairePendingOnLogout(); clearQuestionnaireViewOnLogout(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("tab-local exact questionnaire original-operation journal", () => {
  it.each(formKeys)("permits ordinary approved AAL1 %s drafts with original wire/body retained", form => {
    admit(form); const original = wire(), before = JSON.stringify(original);
    const operation = beginQuestionnairePending(scope, { request: original, idempotencyKey: id(7) }, sourceAt)!;
    expect(operation).not.toBeNull(); expect(operation.body).toBe(before); expect(JSON.stringify(original)).toBe(before);
    expect(operation.input.request).not.toBe(original); expect(Object.isFrozen(operation.input.request)).toBe(true);
    expect(operation.input.request).toEqual(original); expect(Object.isFrozen(operation)).toBe(true);
    expect(operation.scope).toEqual(scope); expect(hasPendingOperations()).toBe(true);
  });
  it("accepts 250 unrelated scope entries without granting other form permissions or altering authority", () => {
    const context = { ...actor, scopes: ["clients.read", "questionnaire_cognition.read", "questionnaire_cognition.manage",
      ...Array.from({ length: 250 }, (_, index) => `unrelated_feature_${index}.inspect`)] };
    vi.setSystemTime(Date.now() + 1); admit("spmsq", id(4), context);
    const exactAuthority = questionnaireViewAuthority(context), operation = begin();
    expect(operation).not.toBeNull(); expect(operation.authority).toBe(exactAuthority); expect(operation.scope.authority).toBe(exactAuthority);
    expect(markQuestionnairePendingDenied(operation)).toBe(true);
    const otherForm = { ...scope, formKey: "gds_15" as const };
    expect(beginQuestionnairePending(otherForm, { request: wire("gds_15"), idempotencyKey: id(7) }, sourceAt)).toBeNull();
    expect(observeQuestionnairePendingSource(otherForm, sourceAt)).toBe(false);
    expect(getQuestionnairePending(otherForm).operation).toBeNull(); expect(hasPendingOperations()).toBe(false);
  });
  it("empty journal projection stays stable until its admitted source actually changes", () => {
    const before = getQuestionnairePending(scope); expect(before.operation).toBeNull(); expect(before.confirmed).toHaveLength(0);
    expect(observeQuestionnairePendingSource(scope, sourceAt)).toBe(true); expect(getQuestionnairePending(scope)).toBe(before);
    vi.setSystemTime(Date.now() + 1); const nextAt = stamp();
    expect(admitQuestionnaireViewSource(scope.authority, nextAt)).toBe(true); expect(observeQuestionnairePendingSource(scope, nextAt)).toBe(true);
    const next = getQuestionnairePending(scope); expect(next).not.toBe(before); expect(next.operation).toBeNull();
    expect(getQuestionnairePending(scope)).toBe(next); expect(observeQuestionnairePendingSource(scope, nextAt)).toBe(true); expect(getQuestionnairePending(scope)).toBe(next);
  });
  it("derived admission binds exact current source and returns false for null or old source", () => {
    const previousAt = sourceAt; expect(isQuestionnairePendingSourceAdmitted(scope, previousAt)).toBe(true);
    expect(isQuestionnairePendingSourceAdmitted(null, previousAt)).toBe(false);
    expect(isQuestionnairePendingSourceAdmitted({ ...scope, clientId: id(99) }, previousAt)).toBe(false);
    vi.setSystemTime(Date.now() + 1); const nextAt = stamp();
    expect(admitQuestionnaireViewSource(scope.authority, nextAt)).toBe(true); expect(observeQuestionnairePendingSource(scope, nextAt)).toBe(true);
    expect(isQuestionnairePendingSourceAdmitted(scope, previousAt)).toBe(false); expect(isQuestionnairePendingSourceAdmitted(scope, nextAt)).toBe(true);
    quarantineQuestionnaireView(scope.authority); expect(isQuestionnairePendingSourceAdmitted(scope, nextAt)).toBe(false);
  });
  it("retained owner gate rejects initial, null, wrong-scope and denied ownership", () => {
    expect(isQuestionnairePendingOwnerAdmitted(scope)).toBe(true);
    expect(isQuestionnairePendingOwnerAdmitted(null)).toBe(false);
    for (const other of [{ ...scope, clientId: id(99) }, { ...scope, formKey: "gds_15" as const },
      { ...scope, actorUserId: id(99) }, { ...scope, branchId: id(99) }, { ...scope, epoch: scope.epoch + 1 }]) {
      expect(isQuestionnairePendingOwnerAdmitted(other)).toBe(false);
    }
    clearQuestionnairePendingOnLogout(); observer();
    expect(isQuestionnairePendingOwnerAdmitted(scope)).toBe(false);
    expect(observeQuestionnairePendingSource(scope, sourceAt)).toBe(false);
    vi.setSystemTime(Date.now() + 1); admit();
    expect(isQuestionnairePendingOwnerAdmitted(scope)).toBe(true);
    quarantineQuestionnaireView(scope.authority);
    expect(isQuestionnairePendingOwnerAdmitted(scope)).toBe(false);
    expect(isQuestionnairePendingSourceAdmitted(scope, sourceAt)).toBe(false);
  });
  it.each(["empty", "unknown"])("retains %s owner during same-scope handoff without admitting the incoming source early", phase => {
    const originalAt = sourceAt, operation = phase === "unknown" ? unknown("revise") : null;
    const before = getQuestionnairePending(scope);
    vi.setSystemTime(Date.now() + 1); const nextAt = stamp();
    expect(isQuestionnairePendingSourceAdmitted(scope, nextAt)).toBe(false);
    expect(isQuestionnairePendingOwnerAdmitted(scope)).toBe(true);
    expect(getQuestionnairePending(scope)).toBe(before);
    expect(beginQuestionnairePending(scope, { request: wire(), idempotencyKey: id(9) }, nextAt)).toBeNull();
    // The parent's render verifies the new source before its child layout
    // observes it; merely keeping the old editor mounted grants no new write.
    expect(observeQuestionnairePendingSource(scope, nextAt)).toBe(true);
    expect(admitQuestionnaireViewSource(scope.authority, nextAt)).toBe(true);
    expect(isQuestionnairePendingOwnerAdmitted(scope)).toBe(true);
    expect(isQuestionnairePendingSourceAdmitted(scope, nextAt)).toBe(true);
    expect(isQuestionnairePendingSourceAdmitted(scope, originalAt)).toBe(false);
    expect(getQuestionnairePending(scope)).not.toBe(before);
    if (operation) {
      retained(operation); expect(getQuestionnairePending(scope).operation!.sourceAt).toBe(originalAt);
      expect(getQuestionnairePending(scope).operation!.attempt).not.toBe(operation.attempt);
      expect(markQuestionnairePendingCommitted(operation, receipt(operation))).toBe(false);
    } else {
      expect(beginQuestionnairePending(scope, { request: wire(), idempotencyKey: id(9) }, originalAt)).toBeNull();
      expect(beginQuestionnairePending(scope, { request: wire(), idempotencyKey: id(9) }, nextAt)).not.toBeNull();
    }
    quarantineQuestionnaireView(scope.authority);
    expect(isQuestionnairePendingOwnerAdmitted(scope)).toBe(false);
  });
  it("retains deep original values independently of editor mutations", () => {
    const original = wire(), operation = beginQuestionnairePending(scope, { request: original, idempotencyKey: id(7) }, sourceAt)!;
    original.context.qualitative_note = "重新輸入"; original.answers.spmsq_01 = { state: "answered", value: "correct" } as typeof original.answers[string];
    expect(operation.body).toContain("  原操作內容  "); expect(JSON.stringify(operation.input.request)).not.toContain("重新輸入");
  });
  it("unknown/remount/manual retry preserves exact original key/body and invalidates stale callbacks", () => {
    const sending = begin(); markQuestionnairePendingUnknown(sending); const first = getQuestionnairePending(scope).operation!;
    expect(getQuestionnairePending(scope)).toBe(getQuestionnairePending(scope));
    observer(); expect(observeQuestionnairePendingSource(scope, sourceAt)).toBe(true); retained(first);
    const retried = retryQuestionnairePending(first.token, scope)!;
    expect(retried.body).toBe(sending.body); expect(retried.input).toBe(sending.input); expect(retried.attempt).not.toBe(sending.attempt);
    expect(markQuestionnairePendingCommitted(sending, receipt(sending))).toBe(false);
    expect(markQuestionnairePendingUnknown(first)).toBe(false); expect(markQuestionnairePendingDenied(retried)).toBe(true); retained(first);
  });
  it("cannot begin over unresolved writes, shared foreign writes or a view transition", () => {
    const foreign = tryAcquirePendingOperation()!; expect(begin()).toBeNull(); foreign();
    const transition = tryAcquireViewTransition()!; expect(begin()).toBeNull(); transition();
    const operation = unknown(); expect(begin()).toBeNull(); retained(operation); expect(tryAcquireViewTransition()).toBeNull();
  });
  it("known first-attempt rejection alone releases the original write", () => {
    const operation = begin(); expect(markQuestionnairePendingDenied(operation)).toBe(true);
    expect(hasPendingOperations()).toBe(false); expect(begin()).not.toBeNull();
  });
  it.each(["client", "form", "source", "key", "extra", "invalidanswer"])("rejects malformed original %s before acquiring a lease", kind => {
    const input: Record<string, unknown> = wire();
    if (kind === "client") input.clientId = id(99);
    if (kind === "form") input.formKey = "gds_15";
    if (kind === "extra") input.extra = "never accepted";
    if (kind === "invalidanswer") input.answers = {};
    expect(beginQuestionnairePending(scope, { request: input, idempotencyKey: kind === "key" ? "bad" : id(7) }, kind === "source" ? stamp(-1) : sourceAt)).toBeNull();
    expect(hasPendingOperations()).toBe(false);
  });
  it("does not execute accessors while capturing original input or receipt", () => {
    const getter = vi.fn(() => "sensitive"), input = wire(); Object.defineProperty(input, "extra", { enumerable: true, get: getter });
    expect(beginQuestionnairePending(scope, { request: input, idempotencyKey: id(7) }, sourceAt)).toBeNull(); expect(getter).not.toHaveBeenCalled();
    const operation = begin(), result = receipt(operation); Object.defineProperty(result, "extra", { enumerable: true, get: getter });
    expect(markQuestionnairePendingCommitted(operation, result)).toBe(false); expect(getter).not.toHaveBeenCalled(); expect(hasPendingOperations()).toBe(true);
  });
  it("thin success unlocks only the write, retains original-content guard until exact history", () => {
    const operation = begin(); expect(markQuestionnairePendingCommitted(operation, receipt(operation))).toBe(true);
    const journal = getQuestionnairePending(scope); expect(journal.operation).toBeNull(); expect(journal.confirmed).toHaveLength(1);
    expect(journal.confirmed[0]?.operation.body).toBe(operation.body); expect(hasPendingOperations()).toBe(false); expect(begin()).toBeNull();
    expect(reconcileQuestionnairePendingExactHistory(scope, [], sourceAt)).toBe(false); expect(begin()).toBeNull();
    expect(reconcileQuestionnairePendingExactHistory(scope, [draft(operation)], sourceAt)).toBe(true); expect(begin()).not.toBeNull();
  });
  it.each(["assessmentKey", "versionId", "version", "assessedOn", "contentHash", "formVersion", "createdAt", "answers", "context"])("history wrong %s cannot drop the committed guard", field => {
    const operation = begin(); markQuestionnairePendingCommitted(operation, receipt(operation));
    const row: Record<string, unknown> = draft(operation);
    row[field] = field === "version" ? 9 : field === "answers" || field === "context" ? {} : field === "createdAt" ? stamp(1) : "wrong";
    expect(reconcileQuestionnairePendingExactHistory(scope, [row], sourceAt)).toBe(false); expect(begin()).toBeNull();
  });
  it("later latest version never substitutes for exact historical result", () => {
    const operation = begin("revise"); markQuestionnairePendingCommitted(operation, receipt(operation)); const row = draft(operation);
    expect(reconcileQuestionnairePendingExactHistory(scope, [{ ...row, versionId: id(90), version: 4 }], sourceAt)).toBe(false);
    expect(reconcileQuestionnairePendingExactHistory(scope, [{ ...row, versionId: id(90), version: 4 }, row], sourceAt)).toBe(true);
  });
  it("history matches original normalized semantics, not literal trim/uppercase or changed editor answers", () => {
    const operation = begin(); markQuestionnairePendingCommitted(operation, receipt(operation));
    expect(reconcileQuestionnairePendingExactHistory(scope, [draft(operation)], sourceAt)).toBe(true);
  });
  it("history semantic timestamp matches offsets but not lost microseconds", () => {
    const operation = begin(), result = { ...receipt(operation), committedAt: stamp().replace(".000Z", ".000001Z") };
    expect(markQuestionnairePendingCommitted(operation, result)).toBe(true);
    const row = { ...draft(operation), createdAt: stamp().replace(".000Z", ".000000Z") };
    expect(reconcileQuestionnairePendingExactHistory(scope, [row], sourceAt)).toBe(false);
    row.createdAt = stamp().replace(".000Z", ".000001+00:00");
    expect(reconcileQuestionnairePendingExactHistory(scope, [row], sourceAt)).toBe(true);
  });
  it.each(["actor", "branch", "roles", "scopes", "aal", "denial"])("%s ABA hides original clinical data and demands newer authorized source", boundary => {
    const operation = unknown(), before = scope, oldSource = sourceAt;
    if (boundary === "denial") { quarantineQuestionnaireView(scope.authority); observeQuestionnairePendingAuthority(scope.authority, getQuestionnaireViewState().epoch); }
    else observer({ ...actor, ...(boundary === "actor" ? { userId: id(91) } : boundary === "branch" ? { branchId: id(92) }
      : boundary === "roles" ? { roles: [] } : boundary === "scopes" ? { scopes: [] } : { assuranceLevel: "aal2" }) });
    expect(getQuestionnairePending(before).operation).toBeNull(); expect(hasPendingOperations()).toBe(true);
    observer(); scope = { ...before, epoch: getQuestionnaireViewState().epoch };
    expect(observeQuestionnairePendingSource(scope, oldSource)).toBe(false); expect(getQuestionnairePending(scope).operation).toBeNull();
    vi.setSystemTime(Date.now() + 1); admit(); retained(operation);
    expect(retryQuestionnairePending(operation.token, scope)?.body).toBe(operation.body);
  });
  it("current shared view quarantine hides data and denies callbacks even before pending observer runs", () => {
    const operation = begin(); quarantineQuestionnaireView(scope.authority);
    expect(getQuestionnairePending(scope).operation).toBeNull(); expect(markQuestionnairePendingCommitted(operation, receipt(operation))).toBe(false);
    expect(markQuestionnairePendingDenied(operation)).toBe(false); expect(hasPendingOperations()).toBe(true);
  });
  it("untrusted authority cannot resurrect identical source on restore even when shared observer did not change", () => {
    const operation = unknown(), original = scope, at = sourceAt;
    observeQuestionnairePendingAuthority("untrusted", scope.epoch);
    expect(getQuestionnairePending(original).operation).toBeNull(); expect(markQuestionnairePendingDenied(operation)).toBe(false);
    observeQuestionnairePendingAuthority(original.authority, original.epoch);
    expect(observeQuestionnairePendingSource(original, at)).toBe(false); expect(getQuestionnairePending(original).operation).toBeNull();
    vi.setSystemTime(Date.now() + 1); admit(); retained(operation);
  });
  it("known rejection callback after authority withdrawal cannot release or reveal the original", () => {
    const operation = begin(), previous = scope; observer({ ...actor, scopes: [] });
    expect(markQuestionnairePendingDenied(operation)).toBe(false); expect(getQuestionnairePending(previous).operation).toBeNull();
    expect(getQuestionnairePending(null).operation).toBeNull(); expect(hasPendingOperations()).toBe(true);
    vi.setSystemTime(Date.now() + 1); admit(); retained(operation);
  });
  it("long form retains exact admitted ownership without claiming a fresh source or auto-writing", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); const operation = unknown(), originalAt = sourceAt;
    vi.setSystemTime(Date.now() + 16 * 60_000);
    expect(observeQuestionnairePendingSource(scope, originalAt)).toBe(true); retained(operation);
    const check = getQuestionnaireRecoveryReadLease(scope)!; expect(check).not.toBeNull(); cancelQuestionnaireRecoveryRead(check);
    const retried = retryQuestionnairePending(operation.token, scope)!;
    expect(retried.body).toBe(operation.body); expect(retried.input).toBe(operation.input); expect(retried.sourceAt).toBe(originalAt);
    expect(markQuestionnairePendingCommitted(operation, receipt(operation))).toBe(false); expect(fetch).not.toHaveBeenCalled();
  });
  it("ordinary long-form composition can begin after a minute without fake new admission", () => {
    const originalAt = sourceAt; vi.setSystemTime(Date.now() + 120_000);
    expect(observeQuestionnairePendingSource(scope, originalAt)).toBe(true);
    const operation = begin(); expect(operation).not.toBeNull(); expect(operation.sourceAt).toBe(originalAt);
  });
  it("never admits an untrusted stale replacement as if it were fresh", () => {
    const operation = unknown(); vi.setSystemTime(Date.now() + 120_000);
    expect(observeQuestionnairePendingSource(scope, stamp(-60_001))).toBe(false);
    expect(getQuestionnairePending(scope).operation).toBeNull(); expect(hasPendingOperations()).toBe(true);
    expect(observeQuestionnairePendingSource(scope, sourceAt)).toBe(false);
    admit(); retained(operation);
  });
  it("logout synchronously clears clinical journal and old callbacks never unlock a newer operation", () => {
    const old = unknown(), check = getQuestionnaireRecoveryReadLease(scope)!, oldProof = proof(check);
    clearQuestionnairePendingOnLogout(); clearQuestionnaireViewOnLogout(); expect(hasPendingOperations()).toBe(false); expect(hasViewTransition()).toBe(false);
    vi.setSystemTime(Date.now() + 1); admit(); const newer = unknown();
    expect(settleQuestionnaireRecoveryRead(check, oldProof)).toBe("stale"); expect(markQuestionnairePendingDenied(old)).toBe(false); retained(newer);
  });
  it("own recovery read excludes double-click/retry/navigation while preserving original write", () => {
    const operation = unknown(), check = getQuestionnaireRecoveryReadLease(scope)!;
    expect(check).not.toBeNull(); expect(Object.isFrozen(check)).toBe(true); expect(isQuestionnaireRecoveryReadCurrent(check)).toBe(true);
    expect(hasPendingOperations()).toBe(true); expect(hasViewTransition()).toBe(true); expect(getQuestionnaireRecoveryReadLease(scope)).toBeNull();
    expect(retryQuestionnairePending(operation.token, scope)).toBeNull(); expect(tryAcquirePendingOperation()).toBeNull();
    expect(cancelQuestionnaireRecoveryRead(check)).toBe(true); expect(cancelQuestionnaireRecoveryRead(check)).toBe(false); retained(operation);
  });
  it("foreign lease prevents recovery and cancellation cannot release foreign read/write owners", () => {
    const operation = unknown(), foreign = tryAcquirePendingOperation()!;
    try { expect(getQuestionnaireRecoveryReadLease(scope)).toBeNull(); retained(operation); } finally { foreign(); }
    const check = getQuestionnaireRecoveryReadLease(scope)!, clone = { ...check };
    expect(cancelQuestionnaireRecoveryRead(clone)).toBe(false); expect(settleQuestionnaireRecoveryRead(clone, proof(check))).toBe("stale");
    expect(isQuestionnaireRecoveryReadCurrent(check)).toBe(true); retained(operation); cancelQuestionnaireRecoveryRead(check);
  });
  it("not_found retains original body/key and only releases its read lease", () => {
    const operation = unknown(), check = getQuestionnaireRecoveryReadLease(scope)!;
    expect(settleQuestionnaireRecoveryRead(check, proof(check, "not_found"))).toBe("not_found"); retained(operation);
    expect(hasViewTransition()).toBe(false); const second = getQuestionnaireRecoveryReadLease(scope)!; expect(second.nonce).not.toBe(check.nonce); cancelQuestionnaireRecoveryRead(second);
  });
  it.each(["organizationId", "branchId", "actorUserId", "clientId", "nonce", "idempotencyKey", "action", "request", "receipt", "draft", "verifiedAt"])("wrong receipt proof %s preserves unknown original intent", field => {
    const operation = unknown(), check = getQuestionnaireRecoveryReadLease(scope)!, evidence: Record<string, unknown> = proof(check);
    evidence[field] = field === "verifiedAt" ? stamp(-60_001) : field === "request" || field === "receipt" || field === "draft" ? {} : id(99);
    expect(settleQuestionnaireRecoveryRead(check, evidence)).toBe("unavailable"); retained(operation); expect(hasViewTransition()).toBe(false);
  });
  it("positive exact receipt confirms but does not claim history/list is fresh", () => {
    const operation = unknown(), check = getQuestionnaireRecoveryReadLease(scope)!, evidence = proof(check);
    expect(settleQuestionnaireRecoveryRead(check, evidence)).toBe("confirmed"); expect(hasPendingOperations()).toBe(false); expect(hasViewTransition()).toBe(false);
    expect(getQuestionnairePending(scope).confirmed).toHaveLength(1); expect(begin()).toBeNull();
    expect(reconcileQuestionnairePendingExactHistory(scope, [evidence.draft], sourceAt)).toBe(true); expect(begin()).not.toBeNull();
    expect(operation.body).toContain("  原操作內容  ");
  });
  it("read-only renewed authority can check original success without gaining write permission", () => {
    const operation = unknown(); vi.setSystemTime(Date.now() + 1);
    admit("spmsq", id(4), { ...actor, scopes: ["clients.read", "questionnaire_cognition.read"] });
    expect(retryQuestionnairePending(operation.token, scope)).toBeNull(); const check = getQuestionnaireRecoveryReadLease(scope)!;
    expect(settleQuestionnaireRecoveryRead(check, proof(check))).toBe("confirmed"); expect(begin()).toBeNull();
  });
  it.each(["unmount", "source", "authority", "denial"])("late receipt after %s cannot settle old attempt", boundary => {
    const operation = unknown(), check = getQuestionnaireRecoveryReadLease(scope)!, evidence = proof(check);
    if (boundary === "unmount") markQuestionnairePendingUnknown(operation);
    else if (boundary === "source") { vi.setSystemTime(Date.now() + 1); admit(); }
    else if (boundary === "authority") { observer({ ...actor, scopes: [] }); observer(); }
    else { quarantineQuestionnaireView(scope.authority); observeQuestionnairePendingAuthority(scope.authority, getQuestionnaireViewState().epoch); }
    expect(settleQuestionnaireRecoveryRead(check, evidence)).toBe("stale"); expect(hasPendingOperations()).toBe(true); expect(hasViewTransition()).toBe(false);
  });
  it.each(["write", "read"] as const)("synchronous %s lease observer invalidates before dispatch", kind => {
    const operation = kind === "read" ? unknown() : null;
    interleave[kind] = () => { quarantineQuestionnaireView(scope.authority); observeQuestionnairePendingAuthority(scope.authority, getQuestionnaireViewState().epoch); };
    expect(kind === "write" ? begin() : getQuestionnaireRecoveryReadLease(scope)).toBeNull();
    expect(hasViewTransition()).toBe(false); expect(hasPendingOperations()).toBe(kind === "read");
    if (operation) expect(operation.input.idempotencyKey).toBe(id(7));
  });
  it("32 committed guards fail closed without eviction, new keys or hidden writes", () => {
    for (let i = 0; i < 32; i++) { admit("spmsq", id(100 + i)); const operation = begin("create", id(200 + i)); expect(operation).not.toBeNull(); expect(markQuestionnairePendingCommitted(operation, receipt(operation))).toBe(true); }
    admit("spmsq", id(132)); expect(begin("create", id(232))).toBeNull(); expect(hasPendingOperations()).toBe(false);
    admit("spmsq", id(100)); expect(getQuestionnairePending(scope).confirmed).toHaveLength(1);
  });
  it("journal never uses fetch/storage or auto-replays an unknown operation", () => {
    const fetch = vi.fn(), storage = vi.spyOn(Storage.prototype, "setItem"); vi.stubGlobal("fetch", fetch);
    const operation = unknown(), check = getQuestionnaireRecoveryReadLease(scope)!; cancelQuestionnaireRecoveryRead(check); retained(operation);
    expect(fetch).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
  });
});
