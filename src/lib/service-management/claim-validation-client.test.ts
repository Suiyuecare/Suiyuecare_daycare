import { describe, expect, it } from "vitest";
import { isConfirmedClaimValidationRejection, parseClaimValidationDatabaseReceipt,
  parseClaimValidationEnvelope } from "./claim-validation-client";

const BATCH = "49000000-0000-4000-8000-000000000001";
const KEY = "49000000-0000-4000-8000-000000000002";
const expected = { claimBatchId: BATCH, totalAmount: "1200.10", itemCount: 2, demo: false, idempotencyKey: KEY };
const data = { ...expected, status: "validated", replayed: false, persisted: true };
const envelope = { requestId: KEY, status: "ok", data, errors: [] };
const scope = { organizationId: BATCH, branchId: KEY, databaseIdempotencyKey: KEY, expectedItemCount: 2 };
const db = { organization_id: BATCH, branch_id: KEY, idempotency_key: KEY, request_hash: "a".repeat(64),
  claim_batch_id: BATCH, total_amount: "1200.10", item_count: "2", status: "validated", replayed: false };

describe("claim validation exact receipt", () => {
  it("normalizes decimal strings without floating-point arithmetic", () => {
    expect(parseClaimValidationDatabaseReceipt({ ...db, total_amount: 1200.1 }, {
      ...scope, claimBatchId: BATCH, expectedTotalAmount: "1200.10" })).toMatchObject({ item_count: 2, total_amount: "1200.10" });
    expect(parseClaimValidationEnvelope({ ...envelope, data: { ...data, totalAmount: "1200.1" } }, 200, expected).data.totalAmount).toBe("1200.10");
  });
  it("accepts exact replay as the original validated outcome", () => {
    expect(parseClaimValidationEnvelope({ ...envelope, data: { ...data, replayed: true } }, 200, expected).data.replayed).toBe(true);
  });
  it.each([{ claimBatchId: KEY }, { totalAmount: "1200.11" }, { itemCount: 3 }, { status: "draft" },
    { status: "exported" }, { persisted: false }, { demo: true }, { idempotencyKey: BATCH },
    { extra: "untrusted" }, { itemCount: 0 }, { totalAmount: "1.201e3" }])("rejects mismatched browser data %j", (patch) => {
    expect(() => parseClaimValidationEnvelope({ ...envelope, data: { ...data, ...patch } }, 200, expected)).toThrow();
  });
  it.each([null, {}, { ...envelope, requestId: "bad" }, { ...envelope, status: "partial" },
    { ...envelope, errors: [{ code: "FAILED" }] }])("rejects incomplete success envelopes %j", (value) => {
    expect(() => parseClaimValidationEnvelope(value, 200, expected)).toThrow();
  });
  it("does not accept HTTP202 or a demo receipt as persisted data", () => {
    expect(() => parseClaimValidationEnvelope(envelope, 202, expected)).toThrow();
    const preview = { ...envelope, data: { ...data, demo: true, persisted: false, status: "draft", itemCount: null } };
    expect(() => parseClaimValidationEnvelope(preview, 200, expected)).toThrow();
    expect(parseClaimValidationEnvelope(preview, 200, { ...expected, demo: true }).data.persisted).toBe(false);
  });
  it.each([{ claim_batch_id: KEY }, { total_amount: "1200.11" }, { total_amount: -1 },
    { total_amount: 0.1 + 0.2 }, { item_count: 5001 }, { item_count: "2x" }, { item_count: 3 },
    { status: "draft" }, { replayed: "false" }, { personal_data: "must not escape" },
    { organization_id: KEY }, { branch_id: BATCH }, { idempotency_key: BATCH },
    { request_hash: "invalid" }])("rejects invalid database receipts %j", (patch) => {
    expect(() => parseClaimValidationDatabaseReceipt({ ...db, ...patch }, {
      ...scope, claimBatchId: BATCH, expectedTotalAmount: "1200.10" })).toThrow();
  });
  it("only classifies bounded known rejection envelopes as confirmed", () => {
    const rejected = { requestId: KEY, status: "error", data: null,
      errors: [{ code: "CLAIM_VALIDATION_REJECTED", message: "not eligible" }] };
    expect(isConfirmedClaimValidationRejection(rejected, 422)).toBe(true);
    expect(isConfirmedClaimValidationRejection(rejected, 200)).toBe(false);
    expect(isConfirmedClaimValidationRejection({ ...rejected,
      errors: [{ code: "CLAIM_VALIDATION_FAILED", message: "unknown" }] }, 409)).toBe(false);
    expect(isConfirmedClaimValidationRejection({ ...rejected,
      errors: [{ code: "CLAIM_VALIDATION_RECEIPT_INVALID", message: "unknown" }] }, 502)).toBe(false);
  });
});
