import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { closureInputSchema, closureReceiptSchema, operationBindingSchema, operationReceiptInputSchema, operationReceiptSchema,
  parseStaffCertificateDocumentClosureReceipt, parseStaffCertificateDocumentOperationReceipt, reserveBindingSchema, reviewBindingSchema,
  sourceQuerySchema, sourcesSnapshotSchema, StaffCertificateDocumentRecoveryError } from "./recovery-schema";

const id = (n: number) => `bf31000a-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-09-27T06:00:00Z");
const scope = { organizationId: id(1), branchId: id(2), actorUserId: id(8) };
const reserveBinding = () => ({ staffMembershipId: id(3), certificateKey: id(5), recordVersionId: id(6), recordContentHash: "a".repeat(64),
  sha256: "b".repeat(64), mimeType: "image/png", fileSizeBytes: 67 });
const reason = "核對合成原件 ✅";
const reasonHash = createHash("sha256").update(reason, "utf8").digest("hex");
const reviewBinding = () => ({ documentId: id(7), recordVersionId: id(6), recordContentHash: "a".repeat(64), decision: "verified", reasonSha256: reasonHash });
const document = () => ({ documentId: id(7), organizationId: id(1), branchId: id(2), ...reserveBinding(), staffUserId: id(4),
  uploadedBy: id(8), uploadedAt: new Date(now - 3000).toISOString(), scanStatus: "clean", persisted: true,
  serviceEligibility: "not_evaluated", signable: false, demo: false });
const common = () => ({ schemaVersion: 1, ...scope, idempotencyKey: id(9), nonce: id(10), checkedAt: new Date(now).toISOString(),
  serviceEligibility: "not_evaluated", signable: false, demo: false });
const expected = () => ({ ...scope, action: "reserve", idempotencyKey: id(9), nonce: id(10), binding: reserveBinding() });
const expectedReview = () => ({ ...scope, action: "review", idempotencyKey: id(9), nonce: id(10), binding: reviewBinding() });
const committed = () => ({ ...common(), action: "reserve", binding: reserveBinding(), status: "completed", receipt: document(),
  persisted: true, reservationState: null, closure: null });
const reviewed = () => ({ ...common(), action: "review", binding: reviewBinding(), status: "completed", receipt: {
  ...document(), uploadedBy: id(12), reviewId: id(13), reviewedBy: scope.actorUserId, reviewedAt: new Date(now - 2000).toISOString(),
  decision: "verified", reason, replayed: false }, persisted: true, reservationState: null, closure: null });
const reserved = (reservationState = "pending") => ({ ...committed(), status: "reserved", receipt: { ...document(), scanStatus: "reserved" }, reservationState });
const notFound = (action = "reserve") => ({ ...common(), action, binding: action === "reserve" ? reserveBinding() : reviewBinding(),
  status: "not_found", receipt: null, persisted: false, reservationState: null, closure: null });
const closed = () => ({ ...committed(), status: "expired_closed", receipt: { ...document(), scanStatus: "reserved" }, closure: {
  terminationId: id(14), documentId: id(7), originalIdempotencyKey: id(9), reconciliationKey: id(11), closedBy: scope.actorUserId,
  closedAt: new Date(now - 1000).toISOString(), reason: "reservation_expired" } });
const closureInput = () => ({ originalIdempotencyKey: id(9), reconciliationKey: id(11), nonce: id(10), binding: reserveBinding() });
const expectedClosure = () => ({ ...scope, ...closureInput() });
const closureProof = () => ({ ...closed(), reconciliationKey: id(11), replayed: false });
const sourceRow = () => ({ staffMembershipId: id(3), staffUserId: id(4), displayName: "合成員工", certificateKey: id(5), recordVersionId: id(6),
  recordContentHash: "a".repeat(64), version: 1, recordStatus: "active", certificateType: "合成證照", effectiveOn: "2026-01-01", expiresOn: "2027-01-01", canUpload: true });
const source = () => ({ ...scope, staffMembershipId: null, generatedAt: new Date(now).toISOString(), page: 1, pageSize: 50,
  rows: [sourceRow()], total: 1, hasMore: false, canManageDocuments: true, serviceEligibility: "not_evaluated", signable: false, demo: false });
const invalid = async (value: unknown, target: unknown = expected()) => {
  await expect(parseStaffCertificateDocumentOperationReceipt(value, target, now)).rejects.toBeInstanceOf(StaffCertificateDocumentRecoveryError);
};

describe("strict document source discovery contracts", () => {
  it("defaults exact query scope and accepts canonical one-based page", () => {
    expect(sourceQuerySchema.parse({})).toEqual({ staffMembershipId: null, page: 1 });
    expect(sourceQuerySchema.parse({ staffMembershipId: id(3).toUpperCase(), page: "2" })).toEqual({ staffMembershipId: id(3), page: 2 });
  });
  it.each([0, -1, 1.5, 10001, "", " ", "NaN", "1x", Infinity])("rejects malformed source page %s", page => {
    expect(sourceQuerySchema.safeParse({ page }).success).toBe(false);
  });
  it.each([{ actorUserId: id(8) }, { staffMembershipId: "bad" }, { canManageDocuments: true }])("rejects query-injected authority %j", query => {
    expect(sourceQuerySchema.safeParse(query).success).toBe(false);
  });
  it("admits only exact paged current source identities without qualification", () => {
    expect(sourcesSnapshotSchema.parse(source())).toEqual(source());
    const rows = Array.from({ length: 50 }, (_, n) => ({ ...sourceRow(), certificateKey: id(100 + n), recordVersionId: id(200 + n) }));
    expect(sourcesSnapshotSchema.safeParse({ ...source(), rows, total: 51, hasMore: true }).success).toBe(true);
    expect(sourcesSnapshotSchema.safeParse({ ...source(), page: 2, total: 51, hasMore: false }).success).toBe(true);
    expect(sourcesSnapshotSchema.safeParse({ ...source(), page: 3, rows: [], total: 51, hasMore: false }).success).toBe(true);
  });
  it.each(["extra", "eligibility", "sign", "demo", "length", "hasMore", "duplicate", "wrong-member", "upload-without-manage", "other-self", "voided-upload", "date", "name-control"])("rejects source contradiction %s", kind => {
    const value = kind === "extra" ? { ...source(), rawJwt: "never permitted" } : kind === "eligibility" ? { ...source(), serviceEligibility: "qualified" }
      : kind === "sign" ? { ...source(), signable: true } : kind === "demo" ? { ...source(), demo: true }
        : kind === "length" ? { ...source(), total: 2 } : kind === "hasMore" ? { ...source(), hasMore: true }
          : kind === "duplicate" ? { ...source(), rows: [sourceRow(), sourceRow()], total: 2 }
            : kind === "wrong-member" ? { ...source(), staffMembershipId: id(99) }
              : kind === "upload-without-manage" ? { ...source(), canManageDocuments: false }
                : kind === "other-self" ? { ...source(), canManageDocuments: false, rows: [{ ...sourceRow(), canUpload: false }] }
                  : kind === "voided-upload" ? { ...source(), rows: [{ ...sourceRow(), recordStatus: "voided" }] }
                    : kind === "date" ? { ...source(), rows: [{ ...sourceRow(), effectiveOn: "2026-02-30" }] }
                      : { ...source(), rows: [{ ...sourceRow(), displayName: "unsafe\nname" }] };
    expect(sourcesSnapshotSchema.safeParse(value).success).toBe(false);
  });
  it("allows read-only self discovery but never upload authority", () => {
    expect(sourcesSnapshotSchema.safeParse({ ...source(), canManageDocuments: false,
      rows: [{ ...sourceRow(), staffUserId: scope.actorUserId, canUpload: false }] }).success).toBe(true);
  });
});

describe("strict original-operation inputs", () => {
  it("keeps only original metadata bindings, never filename, reason plaintext or service flags", () => {
    expect(reserveBindingSchema.parse(reserveBinding())).toEqual(reserveBinding());
    expect(reviewBindingSchema.parse(reviewBinding())).toEqual(reviewBinding());
    expect(operationBindingSchema.safeParse(reserveBinding()).success).toBe(true);
    expect(operationReceiptInputSchema.parse({ action: "reserve", idempotencyKey: id(9), nonce: id(10), binding: reserveBinding() })).toMatchObject({ action: "reserve" });
    expect(closureInputSchema.parse(closureInput())).toEqual(closureInput());
  });
  it.each(["sha", "mime", "size", "pointer", "key", "nonce", "action", "extra", "wrong-binding"])("rejects malformed or substituted original input %s", kind => {
    const changes: Record<string, unknown> = kind === "key" ? { idempotencyKey: "bad" }
      : kind === "nonce" ? { nonce: null } : kind === "action" ? { action: "complete_scan" } : kind === "extra" ? { serviceRole: true }
        : { binding: kind === "sha" ? { ...reserveBinding(), sha256: "B".repeat(64) } : kind === "mime" ? { ...reserveBinding(), mimeType: "text/html" }
          : kind === "size" ? { ...reserveBinding(), fileSizeBytes: 4194305 } : kind === "pointer" ? { ...reserveBinding(), recordVersionId: "bad" } : reviewBinding() };
    const value = { action: "reserve", idempotencyKey: id(9), nonce: id(10), binding: reserveBinding(), ...changes };
    expect(operationReceiptInputSchema.safeParse(value).success).toBe(false);
  });
  it.each(["reason", "replayed", "actor", "path"])("rejects review supplied %s instead of original digest binding", field => {
    expect(reviewBindingSchema.safeParse({ ...reviewBinding(), [field]: "not permitted" }).success).toBe(false);
  });
  it("requires a distinct explicit reconciliation key without adding browser-controlled verdict", () => {
    expect(closureInputSchema.safeParse({ ...closureInput(), reconciliationKey: id(9) }).success).toBe(false);
    expect(closureInputSchema.safeParse({ ...closureInput(), reservationExpired: true }).success).toBe(false);
    expect(closureInputSchema.safeParse({ ...closureInput(), binding: reviewBinding() }).success).toBe(false);
  });
});

describe("exact original operation receipt proof, never automatic retry permission", () => {
  it.each(["clean", "infected", "failed"])("admits original persisted %s scan without qualification", async scanStatus => {
    const value = { ...committed(), receipt: { ...document(), scanStatus } };
    expect(await parseStaffCertificateDocumentOperationReceipt(value, expected(), now)).toEqual(value);
  });
  it.each(["pending", "expired"])("keeps reserved %s informative only, without completed or closed proof", async reservationState => {
    const value = reserved(reservationState); expect(await parseStaffCertificateDocumentOperationReceipt(value, expected(), now)).toEqual(value);
    expect(value.receipt.scanStatus).toBe("reserved"); expect(value.closure).toBeNull();
  });
  it.each(["reserve", "review"])("accepts exact own not_found %s only as non-persisted informational response", async action => {
    const value = notFound(action); expect(await parseStaffCertificateDocumentOperationReceipt(value, action === "reserve" ? expected() : expectedReview(), now)).toEqual(value);
  });
  it("verifies the original UTF-8 qualitative review reason with WebCrypto", async () => {
    expect(await parseStaffCertificateDocumentOperationReceipt(reviewed(), expectedReview(), now)).toEqual(reviewed());
    await invalid({ ...reviewed(), receipt: { ...reviewed().receipt, reason: "核對合成原件 不同" } }, expectedReview());
  });
  it("accepts explicit immutable expired closure only when all original identities match", async () => {
    expect(await parseStaffCertificateDocumentOperationReceipt(closed(), expected(), now)).toEqual(closed());
  });
  it.each(["organizationId", "branchId", "actorUserId", "idempotencyKey", "nonce"])("rejects wrong operation %s", async field => {
    await invalid({ ...committed(), [field]: id(99) });
  });
  it.each(["staffMembershipId", "certificateKey", "recordVersionId", "recordContentHash", "sha256", "mimeType", "fileSizeBytes"])("rejects uncorrelated reserve binding %s", async field => {
    await invalid({ ...committed(), binding: { ...reserveBinding(), [field]: field.includes("Hash") || field === "sha256" ? "c".repeat(64) : field === "mimeType" ? "image/jpeg" : field === "fileSizeBytes" ? 68 : id(99) } });
  });
  it.each(["organizationId", "branchId", "uploadedBy", "recordVersionId", "sha256", "fileSizeBytes"])("rejects returned original document mismatch %s", async field => {
    await invalid({ ...committed(), receipt: { ...document(), [field]: field === "sha256" ? "c".repeat(64) : field === "fileSizeBytes" ? 68 : id(99) } });
  });
  it.each(["reviewedBy", "documentId", "recordVersionId", "recordContentHash", "decision", "replayed"])("rejects original review mismatch %s", async field => {
    await invalid({ ...reviewed(), receipt: { ...reviewed().receipt, [field]: field === "recordContentHash" ? "c".repeat(64) : field === "decision" ? "rejected" : field === "replayed" ? true : id(99) } }, expectedReview());
  });
  it.each(["documentId", "originalIdempotencyKey", "closedBy", "reason"])("rejects closure wrong %s", async field => {
    await invalid({ ...closed(), closure: { ...closed().closure, [field]: field === "reason" ? "manual_clear" : id(99) } });
  });
  it.each(["persisted", "state", "extra", "sign", "eligibility", "demo", "not-found-receipt", "closed-clean", "review-reserved"])("rejects tagged contradiction %s", async kind => {
    const value = kind === "persisted" ? { ...committed(), persisted: false } : kind === "state" ? { ...committed(), reservationState: "pending" }
      : kind === "extra" ? { ...committed(), sensitiveSource: "denied" } : kind === "sign" ? { ...committed(), signable: true }
        : kind === "eligibility" ? { ...committed(), serviceEligibility: "qualified" } : kind === "demo" ? { ...committed(), demo: true }
          : kind === "not-found-receipt" ? { ...notFound(), receipt: document() } : kind === "closed-clean" ? { ...closed(), receipt: document() }
            : { ...reserved(), action: "review", binding: reviewBinding() };
    expect(operationReceiptSchema.safeParse(value).success).toBe(false); await invalid(value);
  });
  it.each([-60000, 1000])("accepts inclusive proof clock boundary %i ms", async offset => {
    const value = { ...committed(), checkedAt: new Date(now + offset).toISOString(), receipt: { ...document(), uploadedAt: new Date(now - 120000).toISOString() } };
    expect(await parseStaffCertificateDocumentOperationReceipt(value, expected(), now)).toEqual(value);
  });
  it.each([-60001, 1001])("rejects stale/future proof clock %i ms", async offset => {
    await invalid({ ...committed(), checkedAt: new Date(now + offset).toISOString(), receipt: { ...document(), uploadedAt: new Date(now - 120000).toISOString() } });
  });
  it.each(["2026-09-27T05:58:59.999999Z", "2026-09-27T06:00:01.000001Z", "2026-02-30T06:00:00Z", "2026-09-27T06:00:00", "2026-09-27T06:00:00.0000001Z"])("rejects invalid or just-outside microsecond clock %s", async checkedAt => {
    await invalid({ ...committed(), checkedAt, receipt: { ...document(), uploadedAt: new Date(now - 120000).toISOString() } });
  });
  it("retains exact offset spelling and compares evidence microseconds, not milliseconds", async () => {
    const value = { ...committed(), checkedAt: "2026-09-27T14:00:00.000001+08:00", receipt: { ...document(), uploadedAt: "2026-09-27T06:00:00.000001Z" } };
    expect(await parseStaffCertificateDocumentOperationReceipt(value, expected(), now)).toEqual(value);
    await invalid({ ...value, receipt: { ...value.receipt, uploadedAt: "2026-09-27T06:00:00.000002Z" } });
    await invalid({ ...reviewed(), receipt: { ...reviewed().receipt, reviewedAt: "2026-09-27T06:00:00.000001Z" } }, expectedReview());
    await invalid({ ...closed(), closure: { ...closed().closure, closedAt: "2026-09-27T06:00:00.000001Z" } });
  });
  it.each([NaN, Infinity, -Infinity, now + 0.5])("rejects invalid observer clock %s", async clock => {
    await expect(parseStaffCertificateDocumentOperationReceipt(committed(), expected(), clock)).rejects.toBeInstanceOf(StaffCertificateDocumentRecoveryError);
  });
  it("does not rewrite the original proof or request, including UUID input spelling", async () => {
    const raw = committed(), target = { ...expected(), organizationId: scope.organizationId.toUpperCase() };
    const before = JSON.stringify({ raw, target }); await parseStaffCertificateDocumentOperationReceipt(raw, target, now);
    expect(JSON.stringify({ raw, target })).toBe(before);
  });
  it("fails closed if WebCrypto is absent or rejects without exposing sensitive reason", async () => {
    const original = globalThis.crypto;
    try {
      vi.stubGlobal("crypto", undefined); await invalid(reviewed(), expectedReview());
      vi.stubGlobal("crypto", { subtle: { digest: vi.fn().mockRejectedValue(new Error("synthetic private reason")) } });
      await expect(parseStaffCertificateDocumentOperationReceipt(reviewed(), expectedReview(), now)).rejects.toThrow("員工附件查證結果尚未完整確認。");
    } finally { vi.stubGlobal("crypto", original); vi.unstubAllGlobals(); }
  });
  it("rechecks real default-clock freshness after awaiting a slow reason digest", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
    const original = globalThis.crypto; let resolve!: (value: ArrayBuffer) => void;
    try {
      vi.stubGlobal("crypto", { subtle: { digest: () => new Promise<ArrayBuffer>(done => { resolve = done; }) } });
      const payload = { ...reviewed(), checkedAt: new Date(now - 59000).toISOString(), receipt: { ...reviewed().receipt,
        uploadedAt: new Date(now - 120000).toISOString(), reviewedAt: new Date(now - 60000).toISOString() } };
      const pending = parseStaffCertificateDocumentOperationReceipt(payload, expectedReview());
      const assertion = expect(pending).rejects.toBeInstanceOf(StaffCertificateDocumentRecoveryError);
      vi.setSystemTime(now + 2000); resolve(Uint8Array.from(Buffer.from(reasonHash, "hex")).buffer); await assertion;
    } finally { vi.stubGlobal("crypto", original); vi.unstubAllGlobals(); vi.useRealTimers(); }
  });
});

describe("explicit expired reconciliation receipts", () => {
  it("validates new closure and immutable replay with a fresh correlated read stamp", async () => {
    expect(await parseStaffCertificateDocumentClosureReceipt(closureProof(), expectedClosure(), now)).toEqual(closureProof());
    const replay = { ...closureProof(), replayed: true, nonce: id(17), checkedAt: new Date(now + 1000).toISOString() };
    expect(await parseStaffCertificateDocumentClosureReceipt(replay, { ...expectedClosure(), nonce: id(17) }, now)).toEqual(replay);
  });
  it("returns pre-existing terminal receipt only as completed replay, never fabricated closure", async () => {
    const value = { ...committed(), reconciliationKey: id(11), replayed: true };
    expect(await parseStaffCertificateDocumentClosureReceipt(value, expectedClosure(), now)).toEqual(value);
    expect(closureReceiptSchema.safeParse({ ...value, replayed: false }).success).toBe(false);
  });
  it.each(["organizationId", "branchId", "actorUserId", "idempotencyKey", "reconciliationKey", "nonce"])("rejects closure response substituted %s", async field => {
    await expect(parseStaffCertificateDocumentClosureReceipt({ ...closureProof(), [field]: id(99) }, expectedClosure(), now)).rejects.toBeInstanceOf(StaffCertificateDocumentRecoveryError);
  });
  it("requires the exact new reconciliation key in both outer and immutable inner receipt", async () => {
    expect(closureReceiptSchema.safeParse({ ...closureProof(), reconciliationKey: id(99) }).success).toBe(false);
    await expect(parseStaffCertificateDocumentClosureReceipt(closureProof(), { ...expectedClosure(), binding: { ...reserveBinding(), fileSizeBytes: 68 } }, now)).rejects.toBeInstanceOf(StaffCertificateDocumentRecoveryError);
  });
  it("rejects reserved/not_found responses to a termination POST", async () => {
    expect(closureReceiptSchema.safeParse({ ...reserved("expired"), reconciliationKey: id(11), replayed: false }).success).toBe(false);
    expect(closureReceiptSchema.safeParse({ ...notFound(), reconciliationKey: id(11), replayed: false }).success).toBe(false);
  });
});

describe("bounded unknown proof admission before reading properties", () => {
  it.each(["getter", "nonenumerable", "symbol", "cycle", "nonplain", "hole", "huge"])("rejects hostile %s in proof and expected without invoking getters", async kind => {
    for (const side of ["proof", "expected"] as const) {
      let read = 0; const payload = side === "proof" ? committed() : expected();
      let raw: unknown = payload;
      if (kind === "getter") Object.defineProperty(payload, "actorUserId", { get() { read++; return scope.actorUserId; }, enumerable: true });
      if (kind === "nonenumerable") Object.defineProperty(payload, "hidden", { value: "sensitive", enumerable: false });
      if (kind === "symbol") Object.defineProperty(payload, Symbol("sensitive"), { value: "sensitive" });
      if (kind === "cycle") Object.assign(payload, { cycle: payload });
      if (kind === "nonplain") Object.setPrototypeOf(payload, { inherited: "sensitive" });
      if (kind === "hole") raw = [payload, , payload];
      if (kind === "huge") Object.assign(payload, { oversized: "x".repeat(128 * 1024 + 1) });
      await invalid(side === "proof" ? raw : committed(), side === "expected" ? raw : expected()); expect(read).toBe(0);
    }
  });
  it("applies the same hostile-object admission to explicit closure expected and proof", async () => {
    let invoked = 0; const payload = closureProof(); Object.defineProperty(payload, "closure", { get() { invoked++; return closed().closure; }, enumerable: true });
    await expect(parseStaffCertificateDocumentClosureReceipt(payload, expectedClosure(), now)).rejects.toBeInstanceOf(StaffCertificateDocumentRecoveryError); expect(invoked).toBe(0);
    const target = expectedClosure(); Object.defineProperty(target, "nonce", { get() { invoked++; return id(10); }, enumerable: true });
    await expect(parseStaffCertificateDocumentClosureReceipt(closureProof(), target, now)).rejects.toBeInstanceOf(StaffCertificateDocumentRecoveryError); expect(invoked).toBe(0);
  });
});
