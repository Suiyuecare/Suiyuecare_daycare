// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
let { hasPendingOperations, tryAcquirePendingOperation, tryAcquireViewTransition } = await import("@/lib/navigation/pending-operation-lock");
let { beginMedicationOperation, clearMedicationPendingOnLogout, confirmMedicationOperation, getMedicationPending,
  markMedicationUnknown, medicationAuthoritySignature, observeMedicationAuthority, observeMedicationTarget,
  rejectMedicationOperation, retryMedicationOperation } = await import("./pending");

const uuid = (suffix: number) => `11111111-1111-4111-8111-${String(suffix).padStart(12, "0")}`;
const actor: TenantContext = { organizationId: uuid(1), organizationName: "機構", branchId: uuid(2), branchName: "分支", userId: uuid(3),
  displayName: "護理人員", roles: ["nurse"], scopes: ["medications.administer", "medications.verify"], assuranceLevel: "aal2", recentAal2At: null, demo: false };
const scope = { organizationId: actor.organizationId, branchId: actor.branchId, userId: actor.userId };
const expectation = { kind: "record" as const, medicationAdministrationId: uuid(4), status: "administered" as const,
  occurredAt: "2026-09-01T00:30:00.000Z", mustRequireSecondVerification: false };
const body = JSON.stringify({ medication_administration_id: uuid(4), status: "administered", occurred_at: expectation.occurredAt, actual_dose: 1, dose_unit: "顆" });
const draft = { status: "administered" as const, occurredAt: "2026-09-01T08:30", reason: "" };
const begin = () => beginMedicationOperation(scope, body, expectation, draft, "original-source")!;
const error = (code: string) => ({ requestId: uuid(10), status: "error", data: null, errors: [{ code, message: "這次請求已拒絕。" }] });
const receipt = () => ({ requestId: uuid(10), status: "ok", data: { operationId: uuid(11), medicationAdministrationId: uuid(4), status: "administered",
  occurredAt: expectation.occurredAt, requiresSecondVerification: false, finalizationState: "signed", signedAt: expectation.occurredAt, replayed: false, persisted: true, demo: false }, errors: [] });
beforeEach(async () => {
  vi.resetModules();
  ({ hasPendingOperations, tryAcquirePendingOperation, tryAcquireViewTransition } = await import("@/lib/navigation/pending-operation-lock"));
  ({ beginMedicationOperation, clearMedicationPendingOnLogout, confirmMedicationOperation, getMedicationPending, markMedicationUnknown,
    medicationAuthoritySignature, observeMedicationAuthority, observeMedicationTarget, rejectMedicationOperation, retryMedicationOperation } = await import("./pending"));
  observeMedicationAuthority(medicationAuthoritySignature(actor));
});
afterEach(() => { clearMedicationPendingOnLogout(); document.body.innerHTML = ""; });

describe("medication original intent journal", () => {
  it("freezes the original key, body and input before its lease admits a write", () => {
    const operation = begin();
    expect(operation).not.toBeNull(); expect(Object.isFrozen(operation)).toBe(true); expect(Object.isFrozen(operation.draft)).toBe(true);
    expect(operation.body).toBe(body); expect(hasPendingOperations()).toBe(true);
    expect(begin()).toBeNull(); expect(tryAcquireViewTransition()).toBeNull();
  });
  it("manual retries retain exact body/key and reject stale earlier attempts", () => {
    const first = begin(); markMedicationUnknown(first);
    const unknown = getMedicationPending().operation!;
    const retry = retryMedicationOperation(unknown, scope, "original-source")!;
    expect(retry.body).toBe(first.body); expect(retry.key).toBe(first.key); expect(retry.token).toBe(first.token); expect(retry.attempt).not.toBe(first.attempt);
    expect(confirmMedicationOperation(first, receipt(), 201)).toBeNull();
    expect(getMedicationPending().operation).toBe(retry); expect(hasPendingOperations()).toBe(true);
    expect(confirmMedicationOperation(retry, receipt(), 201)).not.toBeNull(); expect(hasPendingOperations()).toBe(false);
    expect(getMedicationPending().saved).toHaveLength(1); expect(begin()).toBeNull();
  });
  it("structured first rejection may release, but later rejection cannot erase uncertainty", () => {
    const first = begin(); expect(rejectMedicationOperation(first, error("MEDICATION_STATE_CONFLICT"), 409)).toBe(true);
    expect(hasPendingOperations()).toBe(false); expect(getMedicationPending().operation).toBeNull();
    const next = begin(); markMedicationUnknown(next);
    const retry = retryMedicationOperation(getMedicationPending().operation!, scope, "original-source")!;
    expect(rejectMedicationOperation(retry, error("MEDICATION_NOT_AUTHORIZED"), 403)).toBe(false);
    expect(getMedicationPending().operation?.phase).toBe("unknown"); expect(hasPendingOperations()).toBe(true);
    expect(getMedicationPending().operation?.body).toBe(next.body); expect(getMedicationPending().operation?.key).toBe(next.key);
  });
  it.each([["MEDICATION_RESULT_INVALID", 409], ["MEDICATION_SAVE_FAILED", 503], ["UNRECOGNIZED_ERROR", 400]])("%s keeps a potentially committed operation", (code, status) => {
    const operation = begin(); expect(rejectMedicationOperation(operation, error(String(code)), Number(status))).toBe(false);
    expect(getMedicationPending().operation?.everUnknown).toBe(true); expect(hasPendingOperations()).toBe(true);
  });
  it("malformed error and wrong-slot success never announce saving or release", () => {
    const first = begin(); expect(rejectMedicationOperation(first, { status: "error" }, 409)).toBe(false);
    const retry = retryMedicationOperation(getMedicationPending().operation!, scope, "original-source")!;
    const wrong = receipt(); wrong.data.medicationAdministrationId = uuid(99);
    expect(confirmMedicationOperation(retry, wrong, 201)).toBeNull(); expect(getMedicationPending().saved).toHaveLength(0); expect(hasPendingOperations()).toBe(true);
  });
  it.each(["branch", "actor", "permission", "role", "aal"])("%s ABA invalidates retry and late response", kind => {
    const first = begin();
    const changed: TenantContext = kind === "branch" ? { ...actor, branchId: uuid(99) } : kind === "actor" ? { ...actor, userId: uuid(99) } :
      kind === "permission" ? { ...actor, scopes: [] } : kind === "role" ? { ...actor, roles: ["branch_supervisor"] } : { ...actor, assuranceLevel: "aal1" };
    observeMedicationAuthority(medicationAuthoritySignature(changed)); observeMedicationAuthority(medicationAuthoritySignature(actor));
    const retained = getMedicationPending().operation!;
    expect(retained.quarantined).toBe(true); expect(retained.key).toBe(first.key); expect(retained.body).toBe(first.body);
    expect(retryMedicationOperation(retained, scope, "original-source")).toBeNull(); expect(confirmMedicationOperation(first, receipt(), 201)).toBeNull(); expect(hasPendingOperations()).toBe(true);
  });
  it.each(["source", "capability"])("%s ABA cannot revive original admission", kind => {
    const first = begin(); observeMedicationTarget(scope, uuid(4), kind === "source" ? "changed-source" : "original-source", kind !== "capability");
    observeMedicationTarget(scope, uuid(4), "original-source", true);
    expect(getMedicationPending().operation?.quarantined).toBe(true); expect(confirmMedicationOperation(first, receipt(), 201)).toBeNull(); expect(hasPendingOperations()).toBe(true);
  });
  it("malformed authority fails closed without crashing the shared shell", () => {
    const operation = begin(); expect(() => observeMedicationAuthority("invalid authority")).not.toThrow();
    expect(getMedicationPending().authority).toBeNull(); expect(getMedicationPending().operation?.quarantined).toBe(true);
    expect(confirmMedicationOperation(operation, receipt(), 201)).toBeNull(); expect(hasPendingOperations()).toBe(true);
  });
  it("logout clears its own content and makes a late callback unable to release a new lease", () => {
    const old = begin(); clearMedicationPendingOnLogout();
    expect(getMedicationPending().operation).toBeNull(); expect(getMedicationPending().saved).toHaveLength(0); expect(hasPendingOperations()).toBe(false);
    observeMedicationAuthority(medicationAuthoritySignature({ ...actor, userId: uuid(99) }));
    observeMedicationAuthority(medicationAuthoritySignature(actor));
    expect(getMedicationPending().authority).toBeNull(); expect(begin()).toBeNull();
    const newer = tryAcquirePendingOperation()!;
    expect(confirmMedicationOperation(old, receipt(), 201)).toBeNull(); expect(markMedicationUnknown(old)).toBe(false);
    expect(getMedicationPending().operation).toBeNull(); expect(hasPendingOperations()).toBe(true); newer();
  });
  it("does not clear another workflow's lease on logout", () => {
    const foreign = tryAcquirePendingOperation()!; expect(begin()).toBeNull(); clearMedicationPendingOnLogout(); expect(hasPendingOperations()).toBe(true); foreign();
  });
  it("retains navigation protection without a mounted dialog and admits only its own form", () => {
    const first = begin(); markMedicationUnknown(first);
    const link = document.createElement("a"); link.href = "/another-page"; document.body.append(link);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }); expect(link.dispatchEvent(click)).toBe(false);
    const filter = document.createElement("form"); document.body.append(filter); expect(filter.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))).toBe(false);
    const ownForm = document.createElement("form"); ownForm.setAttribute("data-medication-action-form", ""); document.body.append(ownForm);
    expect(ownForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))).toBe(true);
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(false); expect(getMedicationPending().navigationBlocked).toBe(true);
  });
});
