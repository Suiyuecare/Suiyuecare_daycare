import { describe, expect, it } from "vitest";
import { ClaimOperationReceiptError, parseClaimExportBoundDatabaseReceipt,
  parseClaimReconciliationBoundDatabaseReceipt } from "./claim-operation-receipts";

const batch = "490abc00-0000-4000-8000-000000000001";
const org = "490abc00-0000-4000-8000-000000000002";
const branch = "490abc00-0000-4000-8000-000000000003";
const key = "490abc00-0000-4000-8000-000000000004";
const expected = { claimBatchId: batch, expectedTotalAmount: "30.00",
  organizationId: org, branchId: branch, databaseIdempotencyKey: key, requestHash: "a".repeat(64) };
const metadata = { organization_id: org, branch_id: branch, idempotency_key: key,
  request_hash: expected.requestHash, snapshot_hash_version: "postgres-jsonb-v1",
  committed_at: "2026-09-26T04:00:00.123456+00:00" };
const exportReceipt = { ...metadata, claim_batch_id: batch, format_version: "synthetic-v1",
  status: "exported", snapshot_hash: "b".repeat(64), item_count: "2", total_amount: "30.00", replayed: false };
const reconciliationReceipt = { ...metadata, claim_batch_id: batch, status: "reconciled",
  item_count: "2", accepted_count: "1", rejected_count: "1", total_amount: "30.00", replayed: false };
const reconciliationExpected = { ...expected, results: [
  { claimItemId: org, outcome: "accepted" as const }, { claimItemId: branch, outcome: "rejected" as const },
] };

describe("claim operation receipts bind persisted evidence on success and replay", () => {
  it.each([false, true])("requires all stored evidence on replayed=%s", (replayed) => {
    expect(parseClaimExportBoundDatabaseReceipt({ ...exportReceipt, replayed }, expected))
      .toEqual({ ...exportReceipt, replayed, item_count: 2 });
    expect(parseClaimReconciliationBoundDatabaseReceipt({ ...reconciliationReceipt, replayed }, reconciliationExpected))
      .toEqual({ ...reconciliationReceipt, replayed, item_count: 2, accepted_count: 1, rejected_count: 1 });
  });

  it.each(Object.keys(metadata))("rejects missing persisted %s rather than echoing the request", (field) => {
    const raw: Record<string, unknown> = { ...exportReceipt }; delete raw[field];
    expect(() => parseClaimExportBoundDatabaseReceipt(raw, expected)).toThrow(ClaimOperationReceiptError);
    const reconciled: Record<string, unknown> = { ...reconciliationReceipt }; delete reconciled[field];
    expect(() => parseClaimReconciliationBoundDatabaseReceipt(reconciled, reconciliationExpected)).toThrow(ClaimOperationReceiptError);
  });

  it.each([
    { organization_id: key }, { branch_id: key }, { idempotency_key: branch },
    { request_hash: "b".repeat(64) }, { request_hash: "A".repeat(64) },
    { snapshot_hash_version: "legacy-js-v1" }, { committed_at: "2026-09-26" },
    { committed_at: "2026-09-26T04:00:00" }, { committed_at: null },
    { private_source: "synthetic-private" },
  ])("fails closed on mismatch, incomplete time or unknown columns %j", (patch) => {
    expect(() => parseClaimExportBoundDatabaseReceipt({ ...exportReceipt, ...patch }, expected)).toThrow(ClaimOperationReceiptError);
    expect(() => parseClaimReconciliationBoundDatabaseReceipt({ ...reconciliationReceipt, ...patch }, reconciliationExpected)).toThrow(ClaimOperationReceiptError);
  });

  it("normalizes mixed UUID casing but never accepts a different operation hash", () => {
    expect(parseClaimExportBoundDatabaseReceipt({ ...exportReceipt, organization_id: org.toUpperCase(),
      branch_id: branch.toUpperCase(), idempotency_key: key.toUpperCase() }, expected).organization_id).toBe(org);
    expect(() => parseClaimReconciliationBoundDatabaseReceipt(reconciliationReceipt,
      { ...reconciliationExpected, requestHash: "f".repeat(64) })).toThrow(ClaimOperationReceiptError);
  });

  it.each(["organizationId", "branchId", "databaseIdempotencyKey", "requestHash"])(
    "does not accept malformed caller binding %s", (field) => {
      expect(() => parseClaimExportBoundDatabaseReceipt(exportReceipt, { ...expected, [field]: "not-valid" }))
        .toThrow(ClaimOperationReceiptError);
    });
});
