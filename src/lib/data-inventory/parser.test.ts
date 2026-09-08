import { describe, expect, it } from "vitest";
import { DATA_INVENTORY_ITEMS, dataInventoryReviewBlockers, emptyDataInventoryContent, type DataInventoryContent } from "./types";
import { dataInventoryContentSchema, parseDataInventoryMutation, parseDataInventoryReceipt, projectDataInventorySnapshot } from "./parser";
import { buildDemoDataInventorySnapshot } from "./demo";
const id = "83000000-0000-4000-8000-000000000001";
const other = "83000000-0000-4000-8000-000000000002";
const content: DataInventoryContent = { ...emptyDataInventoryContent(), status: "received", source: "previous_system", accountableRole: "branch_supervisor",
  periodStart: "2026-01-01", periodEnd: "2026-08-31", expectedCount: 3, actualCount: 3,
  missingRequired: 0, unmapped: 0, conflicts: 0, criticalDifferences: 0, keyFields: "passed", amounts: "passed", attachments: "passed", evidenceReference: id };
const input = { action: "save" as const, itemKey: "client_master" as const, expectedVersion: 0, content, idempotency_key: id };
describe("bounded inventory metadata contract", () => {
  it("has exactly twelve distinct datasets and six categories", () => {
    expect(DATA_INVENTORY_ITEMS).toHaveLength(12); expect(new Set(DATA_INVENTORY_ITEMS.map((r) => r.key)).size).toBe(12);
    expect(new Set(DATA_INVENTORY_ITEMS.map((r) => r.category)).size).toBe(6);
  });
  it("accepts complete metadata and body-bound idempotency", () => {
    expect(parseDataInventoryMutation(input, id).idempotencyKey).toBe(id);
    expect(dataInventoryReviewBlockers("client_master", content)).toEqual([]);
  });
  it.each([{ idempotency_key: undefined }, { idempotency_key: "raw-key" }, { unknown: "PHI" }, { itemKey: "anything" }])("rejects malformed request %#", (override) => {
    expect(() => parseDataInventoryMutation({ ...input, ...override })).toThrow();
  });
  it("rejects mismatched header and body key", () => expect(() => parseDataInventoryMutation(input, other)).toThrow());
  it("requires correction reason on revisions", () => expect(() => parseDataInventoryMutation({ ...input, expectedVersion: 1 })).toThrow());
  it.each([{ periodStart: "2026-02-30" }, { periodEnd: null }, { periodEnd: "2025-01-01" }, { evidenceReference: "https://example.org" }, { expectedCount: -1 }, { actualCount: 1.5 }, { name: "forbidden" }])("rejects invalid content %#", (override) => {
    expect(dataInventoryContentSchema.safeParse({ ...content, ...override }).success).toBe(false);
  });
  it.each(["expectedCount", "actualCount", "missingRequired", "unmapped", "conflicts", "criticalDifferences"] as const)("unknown %s cannot become complete", (key) => {
    expect(dataInventoryReviewBlockers("client_master", { ...content, [key]: null }).length).toBeGreaterThan(0);
  });
  it("requires count equality and no critical differences", () => {
    expect(dataInventoryReviewBlockers("client_master", { ...content, actualCount: 2 })).not.toEqual([]);
    expect(dataInventoryReviewBlockers("client_master", { ...content, criticalDifferences: 1 })).not.toEqual([]);
  });
  it("does not waive financial or attachment reconciliation", () => {
    expect(dataInventoryReviewBlockers("billing", { ...content, amounts: "not_applicable", reasonCode: "out_of_scope" })).not.toEqual([]);
    expect(dataInventoryReviewBlockers("history_attachments", { ...content, attachments: "not_applicable", reasonCode: "out_of_scope" })).not.toEqual([]);
  });
  it("requires substantive NA evidence and clears all counts", () => {
    const na = { ...emptyDataInventoryContent(), status: "not_applicable" as const, source: "organization_file" as const, accountableRole: "branch_supervisor" as const,
      keyFields: "not_applicable" as const, amounts: "not_applicable" as const, attachments: "not_applicable" as const, evidenceReference: id, reasonCode: "out_of_scope" as const };
    expect(dataInventoryContentSchema.safeParse(na).success).toBe(true);
    expect(dataInventoryReviewBlockers("consents", na)).toEqual([]);
    expect(dataInventoryContentSchema.safeParse({ ...na, actualCount: 0 }).success).toBe(false);
    expect(dataInventoryReviewBlockers("client_master", { ...content, attachments: "not_applicable", reasonCode: "data_correction" })).not.toEqual([]);
  });
  it("binds saved receipt content, actor and scope", () => {
    const { request, idempotencyKey } = parseDataInventoryMutation(input);
    const current = buildDemoDataInventorySnapshot(id, id).records[0].current;
    const receipt = { operationId: other, organizationId: id, branchId: id, actorUserId: id, idempotencyKey,
      request, result: { ...current, content, recordedBy: id, contentRecordedBy: id }, replayed: false };
    const expected = { request, idempotencyKey, organizationId: id, branchId: id, actorUserId: id };
    expect(parseDataInventoryReceipt(receipt, expected, 201)).toEqual(receipt);
    expect(() => parseDataInventoryReceipt({ ...receipt, branchId: other }, expected)).toThrow();
    expect(() => parseDataInventoryReceipt({ ...receipt, result: { ...receipt.result, content: { ...content, actualCount: 4 } } }, expected)).toThrow();
  });
  it("binds review receipt to viewed version and content hash, rejects self-review", () => {
    const request = { action: "verify" as const, itemKey: "client_master" as const, expectedVersion: 1, expectedVersionId: id, expectedContentHash: "a".repeat(64) };
    const current = buildDemoDataInventorySnapshot(id, id).records[0].current;
    const result = { ...current, versionId: other, previousVersionId: id, version: 2, content, recordedBy: other, contentRecordedBy: id,
      reviewState: "manually_verified", reviewedBy: other, reviewedAt: current.createdAt, reviewChallengeId: other };
    const receipt = { operationId: other, organizationId: id, branchId: id, actorUserId: other, idempotencyKey: id, request, result, replayed: false };
    const expected = { request, idempotencyKey: id, organizationId: id, branchId: id, actorUserId: other };
    expect(parseDataInventoryReceipt(receipt, expected, 201).result.reviewState).toBe("manually_verified");
    expect(() => parseDataInventoryReceipt({ ...receipt, result: { ...result, contentHash: "b".repeat(64) } }, expected)).toThrow();
    expect(() => parseDataInventoryReceipt({ ...receipt, result: { ...result, contentRecordedBy: other } }, expected)).toThrow();
  });
  it("formal projection rejects demo, stale data, duplicates and hidden history", () => {
    const demo = buildDemoDataInventorySnapshot(id, id);
    const now = Date.now();
    const snapshot = { ...demo, demo: false, generatedAt: new Date(now).toISOString(), staleAfter: new Date(now + 300000).toISOString() };
    expect(projectDataInventorySnapshot(snapshot, id, id).records).toHaveLength(1);
    expect(() => projectDataInventorySnapshot(demo, id, id)).toThrow();
    expect(() => projectDataInventorySnapshot({ ...snapshot, records: [...snapshot.records, ...snapshot.records] }, id, id)).toThrow();
    expect(() => projectDataInventorySnapshot({ ...snapshot, records: [{ ...snapshot.records[0], history: [] }] }, id, id)).toThrow();
  });
});
