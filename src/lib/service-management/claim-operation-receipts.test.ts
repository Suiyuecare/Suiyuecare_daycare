import { describe, expect, it } from "vitest";
import { ClaimOperationReceiptError, parseClaimExportDatabaseReceipt,
  parseClaimReconciliationDatabaseReceipt } from "./claim-operation-receipts";

const batch = "49000000-0000-4000-8000-000000000004";
const first = "49000000-0000-4000-8000-000000000005";
const second = "49000000-0000-4000-8000-000000000006";
const expected = { claimBatchId: batch, expectedTotalAmount: "1200.10" };
const exportReceipt = { claim_batch_id: batch, format_version: "synthetic-v1", status: "exported",
  snapshot_hash: "a".repeat(64), item_count: "2", total_amount: "1200.10", replayed: false };
const results = [{ claimItemId: first, outcome: "accepted" as const },
  { claimItemId: second, outcome: "rejected" as const }];
const reconciliationExpected = { ...expected, results };
const reconciliationReceipt = { claim_batch_id: batch, status: "reconciled", item_count: "2",
  accepted_count: "1", rejected_count: "1", total_amount: "1200.10", replayed: false };

describe("claim operation database receipts", () => {
  it("accepts PostgreSQL string counts and numeric amounts without floating-point sums", () => {
    expect(parseClaimExportDatabaseReceipt({ ...exportReceipt, total_amount: 1200.1 }, expected))
      .toEqual({ ...exportReceipt, item_count: 2 });
    expect(parseClaimReconciliationDatabaseReceipt({ ...reconciliationReceipt,
      item_count: 2, accepted_count: 1, rejected_count: 1, total_amount: 1200.1 }, reconciliationExpected))
      .toEqual({ ...reconciliationReceipt, item_count: 2, accepted_count: 1, rejected_count: 1 });
  });
  it("accepts the numeric(14,2) upper limit exactly as a string", () => {
    const upper = "999999999999.99";
    expect(parseClaimExportDatabaseReceipt({ ...exportReceipt, total_amount: upper },
      { ...expected, expectedTotalAmount: upper }).total_amount).toBe(upper);
  });
  it("normalizes UUID casing and an equivalent expected money scale", () => {
    const uppercase = "490ABC00-0000-4000-8000-000000000004";
    expect(parseClaimExportDatabaseReceipt({ ...exportReceipt, claim_batch_id: uppercase,
      total_amount: "1200.1" }, { claimBatchId: uppercase.toLowerCase(), expectedTotalAmount: "1200.10" }))
      .toMatchObject({ claim_batch_id: uppercase.toLowerCase(), total_amount: "1200.10" });
  });
  it.each([null, undefined, [], {}, { ...exportReceipt, claim_batch_id: first },
    { ...exportReceipt, status: "validated" }, { ...exportReceipt, snapshot_hash: "A".repeat(64) },
    { ...exportReceipt, snapshot_hash: "a".repeat(63) }, { ...exportReceipt, format_version: " " },
    { ...exportReceipt, format_version: "synthetic\nversion" }, { ...exportReceipt, format_version: "x".repeat(121) },
    { ...exportReceipt, item_count: 0 }, { ...exportReceipt, item_count: 1.5 },
    { ...exportReceipt, item_count: "01" }, { ...exportReceipt, item_count: "9007199254740992" },
    { ...exportReceipt, item_count: "5001" },
    { ...exportReceipt, total_amount: "1200.11" }, { ...exportReceipt, total_amount: "1200.100" },
    { ...exportReceipt, total_amount: -1 }, { ...exportReceipt, total_amount: Infinity },
    { ...exportReceipt, total_amount: "1e3" }, { ...exportReceipt, replayed: "false" },
    { ...exportReceipt, private_data: "synthetic-private" }])("rejects unconfirmed export data %#", (raw) => {
    expect(() => parseClaimExportDatabaseReceipt(raw, expected)).toThrow(ClaimOperationReceiptError);
  });
  it("does not echo untrusted metadata in its exception", () => {
    expect(() => parseClaimExportDatabaseReceipt({ ...exportReceipt, format_version: "synthetic-private\n" }, expected))
      .toThrow("申報回執尚未核對完成");
  });
  it.each([false, true])("requires the same binding for replayed=%s receipts", (replayed) => {
    expect(parseClaimExportDatabaseReceipt({ ...exportReceipt, replayed }, expected).replayed).toBe(replayed);
    expect(parseClaimReconciliationDatabaseReceipt({ ...reconciliationReceipt, replayed }, reconciliationExpected)
      .replayed).toBe(replayed);
    expect(() => parseClaimExportDatabaseReceipt({ ...exportReceipt, replayed },
      { ...expected, expectedTotalAmount: "1200.11" })).toThrow(ClaimOperationReceiptError);
  });
  it.each([null, undefined, {}, { ...reconciliationReceipt, claim_batch_id: first },
    { ...reconciliationReceipt, status: "accepted" }, { ...reconciliationReceipt, item_count: "3" },
    { ...reconciliationReceipt, item_count: "5001" }, { ...reconciliationReceipt, accepted_count: 2 },
    { ...reconciliationReceipt, rejected_count: 2 }, { ...reconciliationReceipt, accepted_count: -1 },
    { ...reconciliationReceipt, accepted_count: "1.0" }, { ...reconciliationReceipt, rejected_count: null },
    { ...reconciliationReceipt, total_amount: "1200.11" }, { ...reconciliationReceipt, replayed: 1 },
    { ...reconciliationReceipt, extra: "synthetic-private" }])("rejects unconfirmed reconciliation data %#", (raw) => {
    expect(() => parseClaimReconciliationDatabaseReceipt(raw, reconciliationExpected)).toThrow(ClaimOperationReceiptError);
  });
  it("checks exact accepted/rejected counts, not only the total", () => {
    expect(() => parseClaimReconciliationDatabaseReceipt({ ...reconciliationReceipt,
      accepted_count: 2, rejected_count: 0 }, reconciliationExpected)).toThrow(ClaimOperationReceiptError);
    expect(parseClaimReconciliationDatabaseReceipt({ ...reconciliationReceipt,
      accepted_count: 2, rejected_count: 0 }, { ...expected,
      results: results.map((result) => ({ ...result, outcome: "accepted" as const })) }))
      .toMatchObject({ item_count: 2, accepted_count: 2, rejected_count: 0 });
  });
  it("refuses missing, duplicate or unknown caller expectations", () => {
    expect(() => parseClaimExportDatabaseReceipt(exportReceipt,
      { ...expected, claimBatchId: "wrong" })).toThrow(ClaimOperationReceiptError);
    expect(() => parseClaimExportDatabaseReceipt(exportReceipt,
      { ...expected, expectedTotalAmount: "NaN" })).toThrow(ClaimOperationReceiptError);
    expect(() => parseClaimReconciliationDatabaseReceipt(reconciliationReceipt,
      { ...expected, results: [] })).toThrow(ClaimOperationReceiptError);
    expect(() => parseClaimReconciliationDatabaseReceipt(reconciliationReceipt,
      { ...expected, results: [results[0], results[0]] })).toThrow(ClaimOperationReceiptError);
  });
});
