import { describe, expect, it } from "vitest";

import { parseStaffAnnouncementReceipt, parseStaffAnnouncementReceiptEnvelope,
  type StaffAnnouncementReceiptRequest } from "./receipt";

const uuid = (number: number) => `cafe0000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const request: StaffAnnouncementReceiptRequest = { organizationId: uuid(1), branchId: uuid(2), userId: uuid(3),
  action: "draft", idempotencyKey: uuid(4), nonce: uuid(5) };
const verifiedAt = "2026-09-26T10:02:00.000Z";
const recordedAt = "2026-09-26T10:01:00.000Z";
const base = { schemaVersion: 1, status: "committed", persisted: true, demo: false,
  organizationId: request.organizationId, branchId: request.branchId, actorUserId: request.userId,
  action: request.action, idempotencyKey: request.idempotencyKey, nonce: request.nonce, verifiedAt,
  evidence: { announcementKey: uuid(6), versionId: uuid(7), version: 1,
    sourceVersionId: null, releaseVersionId: null, effectiveAt: null, recordedAt } };
const envelope = (data: unknown) => ({ requestId: uuid(8), status: "ok", data, errors: [] });

describe("exact original announcement receipt contract", () => {
  it("uses the same strict normalized contract for RPC object and API envelope", () => {
    const upper = { ...base, organizationId: base.organizationId.toUpperCase(),
      evidence: { ...base.evidence, versionId: base.evidence.versionId.toUpperCase(),
        recordedAt: "2026-09-26T18:01:00+08:00" }, verifiedAt: "2026-09-26T18:02:00+08:00" };
    const parsed = parseStaffAnnouncementReceipt(upper, request);
    expect(parsed).toEqual(base);
    expect(parseStaffAnnouncementReceiptEnvelope(envelope(upper), request)).toEqual({ requestId: uuid(8), data: base });
  });
  it.each(["organizationId", "branchId", "actorUserId", "action", "idempotencyKey", "nonce"] as const)(
    "rejects wrong request tuple %s", (field) => {
      expect(() => parseStaffAnnouncementReceipt({ ...base, [field]: field === "action" ? "read" : uuid(99) }, request)).toThrow();
    });
  it.each(["organizationId", "branchId", "userId", "idempotencyKey", "nonce"] as const)(
    "validates the expected request UUID %s rather than trusting typed callers", (field) => {
      expect(() => parseStaffAnnouncementReceipt(base, { ...request, [field]: "not-a-uuid" })).toThrow();
    });
  it.each([
    { ...base, schemaVersion: 2 }, { ...base, persisted: false }, { ...base, demo: true },
    { ...base, evidence: null }, { ...base, private: "sensitive" },
    { ...base, evidence: { ...base.evidence, hidden: "sensitive" } },
    { ...base, evidence: { ...base.evidence, version: 0 } },
    { ...base, evidence: { ...base.evidence, version: Number.MAX_SAFE_INTEGER + 1 } },
    { ...base, evidence: { ...base.evidence, versionId: "invalid" } },
  ])("rejects malformed or overstated database evidence %#", (raw) => {
    expect(() => parseStaffAnnouncementReceipt(raw, request)).toThrow();
  });
  it("not_found is explicitly non-proof, with no evidence or persistence assertion", () => {
    const missing = { ...base, status: "not_found", persisted: false, evidence: null };
    expect(parseStaffAnnouncementReceipt(missing, request).status).toBe("not_found");
    expect(() => parseStaffAnnouncementReceipt({ ...missing, persisted: true }, request)).toThrow();
    expect(() => parseStaffAnnouncementReceipt({ ...missing, evidence: base.evidence }, request)).toThrow();
  });
  it.each(["verifiedAt", "recordedAt", "effectiveAt"])("rejects invalid or non-offset timestamp %s", (field) => {
    for (const invalid of ["2026-02-30T10:00:00Z", "2026-09-26T10:00:00", "not-a-date"]) {
      const raw = field === "verifiedAt" ? { ...base, verifiedAt: invalid }
        : { ...base, evidence: { ...base.evidence, [field]: invalid } };
      expect(() => parseStaffAnnouncementReceipt(raw, request)).toThrow();
    }
  });
  it("requires recordedAt and effectiveAt to be no later than verifiedAt", () => {
    expect(() => parseStaffAnnouncementReceipt({ ...base, evidence: { ...base.evidence,
      recordedAt: "2026-09-26T10:03:00.000Z" } }, request)).toThrow();
    expect(() => parseStaffAnnouncementReceipt({ ...base, evidence: { ...base.evidence,
      effectiveAt: "2026-09-26T10:03:00.000Z" } }, request)).toThrow();
  });
  it("retains an old read_at before recordedAt without inventing a newer read or commit time", () => {
    const readRequest = { ...request, action: "read" as const };
    const effectiveAt = "2025-09-26T10:00:00.000Z";
    const raw = { ...base, action: "read", evidence: { ...base.evidence,
      sourceVersionId: base.evidence.versionId, releaseVersionId: base.evidence.versionId, effectiveAt } };
    const proof = parseStaffAnnouncementReceipt(raw, readRequest);
    expect(proof.status).toBe("committed");
    if (proof.status === "committed") expect(proof.evidence.effectiveAt).toBe(effectiveAt);
    expect(() => parseStaffAnnouncementReceipt({ ...raw, evidence: { ...raw.evidence, sourceVersionId: null } }, readRequest)).toThrow();
    expect(() => parseStaffAnnouncementReceipt({ ...raw, evidence: { ...raw.evidence, releaseVersionId: uuid(99) } }, readRequest)).toThrow();
    expect(() => parseStaffAnnouncementReceipt({ ...raw, evidence: { ...raw.evidence, effectiveAt: null } }, readRequest)).toThrow();
  });
  it("distinguishes immutable result/source/release shapes for each action", () => {
    const published = { ...base, action: "publish", evidence: { ...base.evidence, version: 2,
      sourceVersionId: uuid(9), releaseVersionId: base.evidence.versionId } };
    const publishRequest = { ...request, action: "publish" as const };
    expect(parseStaffAnnouncementReceipt(published, publishRequest).status).toBe("committed");
    expect(() => parseStaffAnnouncementReceipt({ ...published, evidence: { ...published.evidence,
      sourceVersionId: published.evidence.versionId } }, publishRequest)).toThrow();
    expect(() => parseStaffAnnouncementReceipt({ ...published, evidence: { ...published.evidence,
      releaseVersionId: uuid(99) } }, publishRequest)).toThrow();
    const withdrawn = { ...base, action: "withdraw", evidence: { ...base.evidence, version: 3,
      sourceVersionId: uuid(9), releaseVersionId: uuid(10), effectiveAt: recordedAt } };
    const withdrawRequest = { ...request, action: "withdraw" as const };
    expect(parseStaffAnnouncementReceipt(withdrawn, withdrawRequest).status).toBe("committed");
    expect(() => parseStaffAnnouncementReceipt({ ...withdrawn, evidence: { ...withdrawn.evidence,
      releaseVersionId: withdrawn.evidence.versionId } }, withdrawRequest)).toThrow();
    expect(() => parseStaffAnnouncementReceipt({ ...base, evidence: { ...base.evidence, version: 2 } }, request)).toThrow();
    expect(parseStaffAnnouncementReceipt({ ...base, evidence: { ...base.evidence, version: 2,
      sourceVersionId: uuid(9) } }, request).status).toBe("committed");
  });
  it.each([
    { requestId: "bad", status: "ok", data: base, errors: [] },
    { ...envelope(base), status: "partial" }, { ...envelope(base), errors: [{ code: "unexpected" }] },
    { ...envelope(base), private: "sensitive" }, { ...envelope(base), data: [base] },
  ])("rejects noncanonical API envelope %#", (raw) => {
    expect(() => parseStaffAnnouncementReceiptEnvelope(raw, request)).toThrow();
  });
});
