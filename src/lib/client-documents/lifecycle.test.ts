import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boundedDocumentRpc, DocumentLifecycleTimeoutError, documentHistoryQuerySchema,
  documentLifecycleInputSchema, validateDocumentHistoryPage, validateDocumentLifecycleReceipt,
} from "./lifecycle";

const clientId = "c1600000-0000-4000-8000-000000000001";
const documentId = "d1600000-0000-4000-8000-000000000001";
const input = { clientId, documentId, category: "identity_front" as const, expectedReviewRevision: 1,
  disposition: "reviewed" as const, reason: "合成附件已核對", idempotency_key: "c1800000-0000-4000-8000-000000000001" };
const now = Date.parse("2026-09-15T00:00:00Z");
const expected = { organizationId: "a1600000-0000-4000-8000-000000000001", branchId: "b1600000-0000-4000-8000-000000000001", clientId, category: null, limit: 50 };
const page = { ...expected, snapshotId: "e1600000-0000-4000-8000-000000000001", generatedAt: "2026-09-15T00:00:00Z", expiresAt: "2026-09-15T00:05:00Z", rows: [], nextCursor: null, pageSize: 50 };
const validPage = (() => { const { limit: _limit, ...value } = page; void _limit; return value; })();
const receipt = { clientId, documentId, category: "identity_front", reviewRevision: 2, disposition: "reviewed", persisted: true, replayed: false };
afterEach(() => vi.useRealTimers());

describe("document lifecycle contracts", () => {
  it("defaults bounded history to 50 and only permits opaque UUID cursors", () => {
    expect(documentHistoryQuerySchema.parse({ client: clientId }).limit).toBe(50);
    expect(documentHistoryQuerySchema.parse({ client: clientId, limit: "100" }).limit).toBe(100);
    for (const limit of ["0", "101", "1.1", "-1", "050", "1e2", "1000"]) {
      expect(documentHistoryQuerySchema.safeParse({ client: clientId, limit }).success).toBe(false);
    }
    expect(documentHistoryQuerySchema.safeParse({ client: clientId, cursor: "2026-01-01" }).success).toBe(false);
    expect(documentHistoryQuerySchema.safeParse({ client: clientId, offset: "200" }).success).toBe(false);
  });
  it("validates exact lifecycle payload and trims required reason", () => {
    expect(documentLifecycleInputSchema.parse({ ...input, reason: "  核對完成  " }).reason).toBe("核對完成");
    for (const bad of [{ reason: "  " }, { reason: "x" }, { reason: "a\nbc" }, { expectedReviewRevision: -1 }, { expectedReviewRevision: 0.1 }, { expectedReviewRevision: 1_000_000 }, { disposition: "deleted" }, { objectPath: "private/path" }]) {
      expect(documentLifecycleInputSchema.safeParse({ ...input, ...bad }).success).toBe(false);
    }
    expect(documentLifecycleInputSchema.safeParse({ ...input, expectedReviewRevision: 999_999 }).success).toBe(true);
  });
  it("checks identity, category, disposition and exact next revision even for replay", () => {
    expect(validateDocumentLifecycleReceipt(receipt, input)).toEqual(receipt);
    expect(validateDocumentLifecycleReceipt({ ...receipt, replayed: true }, input)?.replayed).toBe(true);
    for (const bad of [{ clientId: documentId }, { documentId: clientId }, { category: "health_exam" }, { disposition: "inactive" }, { reviewRevision: 3 }, { persisted: false }, { objectPath: "secret" }]) {
      expect(validateDocumentLifecycleReceipt({ ...receipt, ...bad }, input)).toBeNull();
    }
  });
  it("validates exact page scope, lifetime, limit and no extra metadata", () => {
    expect(validateDocumentHistoryPage(validPage, expected, now)).toEqual(validPage);
    for (const bad of [{ organizationId: clientId }, { branchId: clientId }, { clientId: documentId }, { category: "health_exam" }, { pageSize: 100 },
      { generatedAt: "2026-09-15T00:02:00Z" }, { expiresAt: "2026-09-15T00:00:00Z" }, { expiresAt: "2026-09-15T00:30:00Z" }, { secret: "never expose" }]) {
      expect(validateDocumentHistoryPage({ ...validPage, ...bad }, expected, now)).toBeNull();
    }
  });
  it("aborts and bounds a hung RPC, then clears its timer", async () => {
    vi.useFakeTimers(); let signal: AbortSignal | undefined;
    const result = boundedDocumentRpc((value) => { signal = value; return new Promise<never>(() => {}); });
    const rejected = expect(result).rejects.toBeInstanceOf(DocumentLifecycleTimeoutError);
    await vi.advanceTimersByTimeAsync(10_000); await rejected;
    expect(signal?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it("clears timeout for both successful and rejected RPC", async () => {
    vi.useFakeTimers(); expect(await boundedDocumentRpc(async () => 7)).toBe(7);
    await expect(boundedDocumentRpc(async () => { throw new Error("synthetic"); })).rejects.toThrow("synthetic");
    expect(vi.getTimerCount()).toBe(0);
  });
});
