// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { emptyIntakeProfile } from "./model";
let journal: typeof import("./write-pending"), locks: typeof import("@/lib/navigation/pending-operation-lock");
const id = "c1600000-0000-4000-8000-000000000001", other = "c1600000-0000-4000-8000-000000000002";
const actor: TenantContext = { organizationId: id, organizationName: "合成機構", branchId: id, branchName: "合成分支", userId: id,
  displayName: "合成人員", roles: ["nurse"], scopes: ["clients.read", "clients.manage", "clients.demographics.read", "clients.view_all", "imports.manage", "imports.approve"],
  assuranceLevel: "aal1", recentAal2At: null, demo: false };
const input = () => ({ action: "create", profile: { ...emptyIntakeProfile, displayName: "合成個案", clientCode: "TEST-01" }, idempotency_key: other });
const receipt = () => ({ clientId: id, profileVersion: 1, clientRowVersion: 1, pending: true, replayed: false, operationId: other, persisted: true });
beforeEach(async () => { vi.resetModules(); locks = await import("@/lib/navigation/pending-operation-lock"); journal = await import("./write-pending"); journal.observeIntakeWriteAuthority(journal.intakeWriteAuthority(actor)); });
afterEach(() => { journal.clearIntakeWritesOnLogout(); vi.restoreAllMocks(); });
describe("same-tab original intake intent", () => {
  it("freezes the actual wire body/key and only explicitly retries that original intent", () => {
    const value = input(), first = journal.beginIntakeWrite(actor, "profile", null, value)!;
    value.profile.displayName = "不能改寫原筆";
    expect(JSON.parse(first.body).profile.displayName).toBe("合成個案");
    expect(journal.beginIntakeWrite(actor, "profile", null, input())).toBeNull();
    journal.markIntakeWriteUnknown(first);
    const recovered = journal.getIntakeWriteOperation(actor, "profile", null)!;
    expect(recovered.phase).toBe("unknown"); expect(locks.hasPendingOperations()).toBe(true);
    const retry = journal.retryIntakeWrite(recovered, actor)!;
    expect(retry.body).toBe(first.body); expect(retry.key).toBe(first.key); expect(retry.token).toBe(first.token);
    expect(retry.attempt).not.toBe(first.attempt); expect(journal.saveIntakeWriteReceipt(first, receipt())).toBeNull();
  });
  it("only a first structured rejection may release the original write lease", () => {
    const first = journal.beginIntakeWrite(actor, "profile", null, input())!;
    expect(journal.rejectIntakeWrite(first)).toBe(true); expect(locks.hasPendingOperations()).toBe(false);
    const next = journal.beginIntakeWrite(actor, "profile", null, input())!;
    journal.markIntakeWriteUnknown(next);
    const retry = journal.retryIntakeWrite(journal.getIntakeWriteOperation(actor, "profile", null)!, actor)!;
    journal.rejectIntakeWrite(retry);
    expect(journal.getIntakeWriteState().operation?.phase).toBe("unknown"); expect(locks.hasPendingOperations()).toBe(true);
  });
  it("scope/authority ABA preserves the unknown lock but cannot revive old content or callbacks", () => {
    const first = journal.beginIntakeWrite(actor, "profile", null, input())!;
    journal.observeIntakeWriteAuthority(journal.intakeWriteAuthority({ ...actor, branchId: other }));
    expect(journal.getIntakeWriteOperation({ ...actor, branchId: other }, "profile", null)).toBeNull();
    journal.observeIntakeWriteAuthority(journal.intakeWriteAuthority(actor));
    expect(journal.getIntakeWriteOperation(actor, "profile", null)).toBeNull();
    expect(journal.saveIntakeWriteReceipt(first, receipt())).toBeNull(); expect(locks.hasPendingOperations()).toBe(true);
    expect(journal.beginIntakeWrite(actor, "cms", null, {})).toBeNull();
  });
  it("logout clears only this journal and prevents old props and late callbacks reviving it", () => {
    const first = journal.beginIntakeWrite(actor, "profile", null, input())!;
    journal.clearIntakeWritesOnLogout(); journal.observeIntakeWriteAuthority(journal.intakeWriteAuthority(actor));
    expect(journal.hasIntakeWriteOperation()).toBe(false); expect(locks.hasPendingOperations()).toBe(false);
    expect(journal.saveIntakeWriteReceipt(first, receipt())).toBeNull(); expect(journal.beginIntakeWrite(actor, "profile", null, input())).toBeNull();
  });
  it.each(["revoke", "logout"])("lease listeners may %s synchronously without installing an old operation", kind => {
    const acquire = locks.tryAcquirePendingOperation;
    vi.spyOn(locks, "tryAcquirePendingOperation").mockImplementation(() => {
      const held = acquire();
      if (kind === "logout") journal.clearIntakeWritesOnLogout(); else journal.observeIntakeWriteAuthority(null);
      return held;
    });
    expect(journal.beginIntakeWrite(actor, "profile", null, input())).toBeNull();
    expect(journal.hasIntakeWriteOperation()).toBe(false); expect(locks.hasPendingOperations()).toBe(false);
  });
  it("a saved receipt never proves latest content; exact original readback releases the guard", () => {
    const first = journal.beginIntakeWrite(actor, "profile", null, input())!;
    const saved = journal.saveIntakeWriteReceipt(first, receipt())!;
    const snapshot = { clientId: id, profileVersion: 1, clientRowVersion: 1, pending: true, profile: input().profile, fieldAuthority: {}, sourceBatchId: null };
    expect(journal.retryIntakeWrite(saved, actor)).toBeNull();
    expect(journal.confirmIntakeWriteReadback(saved, { ...snapshot, profileVersion: 2 })).toBe(false);
    expect(journal.confirmIntakeWriteReadback(saved, { ...snapshot, profile: { ...snapshot.profile, displayName: "其他內容" } })).toBe(false);
    expect(locks.hasPendingOperations()).toBe(true);
    expect(journal.confirmIntakeWriteReadback(saved, snapshot)).toBe(true); expect(locks.hasPendingOperations()).toBe(false);
  });
  it.each(["operationId", "profileVersion", "clientId"])("mismatched %s receipt cannot claim saved", field => {
    const value = { action: "update", profile: input().profile, clientId: id, expectedVersion: 1, expectedClientVersion: 1, idempotency_key: other };
    const first = journal.beginIntakeWrite(actor, "profile", id, value)!;
    const wrong = { ...receipt(), profileVersion: 2, clientRowVersion: 2, [field]: field === "profileVersion" ? 9 : field === "operationId" ? id : other };
    expect(() => journal.saveIntakeWriteReceipt(first, wrong)).toThrow("INTAKE_RECEIPT_UNCERTAIN");
    expect(journal.hasIntakeWriteOperation()).toBe(true);
  });
  it("CMS uses the original source batch and versions for receipt and readback", () => {
    const first = journal.beginIntakeWrite(actor, "cms", null, { batchId: other, payloadSha256: "a".repeat(64), clientId: null,
      expectedVersion: 0, expectedClientVersion: 0, clientCode: "TEST-01", sourceReviewReason: null, decisions: [], idempotency_key: other })!;
    expect(() => journal.saveIntakeWriteReceipt(first, { ...receipt(), formallyImported: true, batchId: id })).toThrow();
    const saved = journal.saveIntakeWriteReceipt(first, { ...receipt(), formallyImported: true, batchId: other })!;
    const snapshot = { clientId: id, profileVersion: 1, clientRowVersion: 1, pending: true, profile: input().profile, fieldAuthority: {}, sourceBatchId: id };
    expect(journal.confirmIntakeWriteReadback(saved, snapshot)).toBe(false);
    expect(journal.confirmIntakeWriteReadback(saved, { ...snapshot, sourceBatchId: other })).toBe(true);
  });
});
