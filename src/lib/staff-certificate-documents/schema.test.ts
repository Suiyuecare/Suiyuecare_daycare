import { describe, expect, it } from "vitest";
import { DOCUMENT_BUCKET, MAX_STAFF_CERTIFICATE_DOCUMENT_BYTES, STAFF_CERTIFICATE_DOCUMENT_BUCKET,
  documentReceiptSchema, documentsSnapshotSchema, downloadInputSchema, downloadReceiptSchema,
  reservationSchema, reviewInputSchema, reviewReceiptSchema, uploadFormInputSchema, uploadMetadataSchema } from "./schema";

const id = (n: number) => `aa12000b-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = "a".repeat(64), bytesHash = "b".repeat(64);
const upload = () => ({ staffMembershipId: id(3), certificateKey: id(5), recordVersionId: id(6), recordContentHash: hash, idempotency_key: id(9) });
const document = () => ({ documentId: id(7), organizationId: id(1), branchId: id(2), staffMembershipId: id(3), staffUserId: id(4),
  certificateKey: id(5), recordVersionId: id(6), recordContentHash: hash, sha256: bytesHash, mimeType: "application/pdf" as const,
  fileSizeBytes: 99, uploadedBy: id(8), uploadedAt: "2026-09-27T04:00:00.123456Z", scanStatus: "clean" as const,
  persisted: true as const, serviceEligibility: "not_evaluated" as const, signable: false as const, demo: false as const });
const path = (value = document()) => `${value.organizationId}/${value.branchId}/${value.staffMembershipId}/${value.certificateKey}/${value.documentId}`;
const reservation = () => ({ ...document(), scanStatus: "reserved" as const, objectPath: path(), replayed: false, terminalReceipt: null });
const review = () => ({ ...document(), reviewId: id(10), reviewedBy: id(11), reviewedAt: "2026-09-27T04:00:01.123456Z", decision: "verified" as const, reason: "核對原件", replayed: false });
const snapshot = () => ({ organizationId: id(1), branchId: id(2), actorUserId: id(12), staffMembershipId: id(3), staffUserId: id(4),
  certificateKey: id(5), recordVersionId: id(6), recordContentHash: hash, generatedAt: "2026-09-27T04:01:00Z",
  documents: [{ ...document(), review: review(), canDownload: true }], total: 1, truncated: false,
  serviceEligibility: "not_evaluated" as const, signable: false as const, demo: false as const });
const download = () => ({ ...document(), objectPath: path(), expiresSeconds: 60, canDownload: true });

describe("staff certificate private evidence wire, not clinical qualification", () => {
  it("fixes private bucket and bounded upload size", () => {
    expect(DOCUMENT_BUCKET).toBe("staff-certificate-documents"); expect(STAFF_CERTIFICATE_DOCUMENT_BUCKET).toBe(DOCUMENT_BUCKET);
    expect(MAX_STAFF_CERTIFICATE_DOCUMENT_BYTES).toBe(4 * 1024 * 1024);
  });
  it("admits exact browser pointers and server-derived metadata without mutating original", () => {
    const input = upload(), before = JSON.stringify(input);
    expect(uploadFormInputSchema.parse(input)).toEqual(input); expect(JSON.stringify(input)).toBe(before);
    expect(uploadFormInputSchema.parse({ ...input, certificateKey: input.certificateKey.toUpperCase() }).certificateKey).toBe(input.certificateKey);
    const metadata = { ...input, sha256: bytesHash, mimeType: "image/png", fileSizeBytes: MAX_STAFF_CERTIFICATE_DOCUMENT_BYTES };
    expect(uploadMetadataSchema.parse(metadata)).toEqual(metadata);
  });
  it.each(["documentId", "fileName", "objectPath", "actorUserId", "sha256", "mimeType", "fileSizeBytes", "scanStatus", "verificationStatus", "signable"])("rejects browser-computed or privileged %s", field => {
    expect(uploadFormInputSchema.safeParse({ ...upload(), [field]: "forged" }).success).toBe(false);
  });
  it.each(["staffMembershipId", "certificateKey", "recordVersionId", "idempotency_key"])("rejects malformed/missing upload pointer %s", field => {
    expect(uploadFormInputSchema.safeParse({ ...upload(), [field]: "not-a-uuid" }).success).toBe(false);
    expect(uploadFormInputSchema.safeParse({ ...upload(), [field]: undefined }).success).toBe(false);
  });
  it.each(["A".repeat(64), "a".repeat(63), "g".repeat(64), `${hash}\n`, "https://example.invalid/proof", null])("rejects invalid content hash %s", value => {
    expect(uploadFormInputSchema.safeParse({ ...upload(), recordContentHash: value }).success).toBe(false);
    expect(uploadMetadataSchema.safeParse({ ...upload(), sha256: value, mimeType: "application/pdf", fileSizeBytes: 1 }).success).toBe(false);
  });
  it.each([0, -1, 1.2, MAX_STAFF_CERTIFICATE_DOCUMENT_BYTES + 1, NaN, Infinity, "1", null])("rejects invalid byte bound %s", value => {
    expect(uploadMetadataSchema.safeParse({ ...upload(), sha256: bytesHash, mimeType: "application/pdf", fileSizeBytes: value }).success).toBe(false);
  });
  it.each(["text/html", "image/svg+xml", "application/msword", "application/octet-stream", "application/pdf\n"])("rejects unsupported MIME %s", value => {
    expect(uploadMetadataSchema.safeParse({ ...upload(), sha256: bytesHash, mimeType: value, fileSizeBytes: 1 }).success).toBe(false);
  });
  it.each(["reserved", "clean", "infected", "failed"])("keeps %s evidence persisted but never formally signable", scanStatus => {
    const result = documentReceiptSchema.parse({ ...document(), scanStatus });
    expect(result.scanStatus).toBe(scanStatus); expect(result.signable).toBe(false); expect(result.serviceEligibility).toBe("not_evaluated");
  });
  it.each([{ signable: true }, { serviceEligibility: "eligible" }, { demo: true }, { persisted: false }, { scanStatus: "verified" },
    { qualificationStatus: "approved" }, { fileName: "private.pdf" }, { signedUrl: "https://example.invalid" }])("rejects forged receipt %j", forged => {
    expect(documentReceiptSchema.safeParse({ ...document(), ...forged }).success).toBe(false);
  });
  it.each(["2026-02-30T04:00:00Z", "2026-09-27T25:00:00Z", "2026-09-27T04:00:00", "2026-09-27T04:00:00+24:00",
    "2026-09-27T04:00:00.1234567Z", "2026-09-27T04:00:00Z\n", "invalid"]) ("rejects malformed evidence timestamp %s without throwing", value => {
    expect(documentReceiptSchema.safeParse({ ...document(), uploadedAt: value }).success).toBe(false);
    expect(() => reviewReceiptSchema.safeParse({ ...review(), reviewedAt: value })).not.toThrow();
    expect(reviewReceiptSchema.safeParse({ ...review(), reviewedAt: value }).success).toBe(false);
  });
  it("admits only exact server-derived reservation paths and original terminal replay", () => {
    expect(reservationSchema.parse(reservation()).objectPath).toBe(path());
    const original = document();
    const replay = { ...original, objectPath: path(), replayed: true, terminalReceipt: original };
    expect(reservationSchema.parse(replay).terminalReceipt).toEqual(original);
    expect(reservationSchema.safeParse({ ...replay, replayed: false }).success).toBe(false);
    expect(reservationSchema.safeParse({ ...replay, terminalReceipt: null }).success).toBe(false);
    expect(reservationSchema.safeParse({ ...reservation(), terminalReceipt: reservation() }).success).toBe(false);
  });
  it.each(["../private.pdf", "https://example.invalid/attachment", `${path()}.pdf`, path().replace(id(3), id(99)), path().replace(id(2), id(99)), `${path()}\n`])("rejects substituted reservation and download path %s", objectPath => {
    expect(reservationSchema.safeParse({ ...reservation(), objectPath }).success).toBe(false);
    expect(downloadReceiptSchema.safeParse({ ...download(), objectPath }).success).toBe(false);
  });
  it.each(["documentId", "organizationId", "branchId", "staffMembershipId", "staffUserId", "certificateKey", "recordVersionId", "uploadedBy",
    "recordContentHash", "sha256", "mimeType", "fileSizeBytes", "uploadedAt", "scanStatus"])("rejects terminal replay mismatched %s", field => {
    const original = document(), changed = { ...original, [field]: field.endsWith("Hash") || field === "sha256" ? "c".repeat(64)
      : field === "mimeType" ? "image/png" : field === "fileSizeBytes" ? 100 : field === "uploadedAt" ? "2026-09-27T04:00:00.123457Z"
        : field === "scanStatus" ? "failed" : id(99) };
    expect(reservationSchema.safeParse({ ...original, objectPath: path(), replayed: true, terminalReceipt: changed }).success).toBe(false);
  });
  it("requires explicit pointer-bound review/download input, without browser approver or URL", () => {
    const pointer = { documentId: id(7), recordVersionId: id(6), recordContentHash: hash, idempotency_key: id(9) };
    expect(reviewInputSchema.parse({ ...pointer, decision: "verified", reason: "  核對原件  " }).reason).toBe("核對原件");
    expect(downloadInputSchema.parse(pointer)).toEqual(pointer);
    expect(reviewInputSchema.safeParse({ ...pointer, decision: "verified", reason: "核對原件", reviewedBy: id(11) }).success).toBe(false);
    expect(downloadInputSchema.safeParse({ ...pointer, url: "https://example.invalid" }).success).toBe(false);
    expect(downloadInputSchema.safeParse({ ...pointer, idempotency_key: undefined }).success).toBe(false);
  });
  it.each(["", "一字", "x\ny", "x\u007fy", "x\u0000y", "x".repeat(301)])("rejects invalid review reason %s", reason => {
    expect(reviewInputSchema.safeParse({ documentId: id(7), recordVersionId: id(6), recordContentHash: hash, idempotency_key: id(9), decision: "verified", reason }).success).toBe(false);
  });
  it("allows independent verified or rejected evidence without a qualification grant", () => {
    for (const decision of ["verified", "rejected"] as const) {
      const parsed = reviewReceiptSchema.parse({ ...review(), decision, replayed: true });
      expect(parsed.decision).toBe(decision); expect(parsed.signable).toBe(false); expect(parsed.serviceEligibility).toBe("not_evaluated");
    }
  });
  it.each([id(8), id(4)])("rejects reviewer equal to uploader or target %s", reviewedBy => {
    expect(reviewReceiptSchema.safeParse({ ...review(), reviewedBy }).success).toBe(false);
  });
  it.each(["reserved", "infected", "failed"])("cannot independently review or download %s bytes", scanStatus => {
    expect(reviewReceiptSchema.safeParse({ ...review(), scanStatus }).success).toBe(false);
    expect(downloadReceiptSchema.safeParse({ ...download(), scanStatus }).success).toBe(false);
  });
  it("preserves microseconds and accepts equivalent timezones without backdating review", () => {
    const original = review();
    expect(reviewReceiptSchema.parse({ ...original, reviewedAt: "2026-09-27T12:00:00.123456+08:00" }).reviewedAt).toBe("2026-09-27T12:00:00.123456+08:00");
    expect(reviewReceiptSchema.safeParse({ ...original, reviewedAt: "2026-09-27T12:00:00.123455+08:00" }).success).toBe(false);
  });
  it("admits bounded snapshot only for the exact actor/employee/certificate version", () => {
    const parsed = documentsSnapshotSchema.parse(snapshot());
    expect(parsed.documents).toHaveLength(1); expect(parsed.signable).toBe(false); expect(parsed.serviceEligibility).toBe("not_evaluated");
    expect(documentsSnapshotSchema.parse({ ...snapshot(), documents: [], total: 0 }).documents).toHaveLength(0);
  });
  it.each(["organizationId", "branchId", "staffMembershipId", "staffUserId", "certificateKey", "recordVersionId", "recordContentHash"])("rejects snapshot document pointing to a different %s", field => {
    const value = snapshot(), documents = [{ ...value.documents[0], [field]: field === "recordContentHash" ? "c".repeat(64) : id(99), review: null }];
    expect(documentsSnapshotSchema.safeParse({ ...value, documents }).success).toBe(false);
  });
  it.each(["documentId", "sha256", "recordVersionId", "recordContentHash", "organizationId", "branchId"])("rejects review attached to another document's %s", field => {
    const value = snapshot(); value.documents[0].review = { ...review(), [field]: field === "sha256" || field === "recordContentHash" ? "c".repeat(64) : id(99) };
    expect(documentsSnapshotSchema.safeParse(value).success).toBe(false);
  });
  it("never makes rejected or unclean documents downloadable while permitting clean original review access", () => {
    const value = snapshot();
    expect(documentsSnapshotSchema.parse({ ...value, documents: [{ ...document(), review: null, canDownload: true }] })).toBeTruthy();
    expect(documentsSnapshotSchema.safeParse({ ...value, documents: [{ ...document(), review: { ...review(), decision: "rejected" }, canDownload: true }] }).success).toBe(false);
    expect(documentsSnapshotSchema.parse({ ...value, documents: [{ ...document(), review: { ...review(), decision: "rejected" }, canDownload: false }] })).toBeTruthy();
    expect(documentsSnapshotSchema.safeParse({ ...value, documents: [{ ...document(), scanStatus: "infected", review: null, canDownload: true }] }).success).toBe(false);
  });
  it("rejects duplicate documents, dishonest counts and hidden truncation", () => {
    const value = snapshot();
    expect(documentsSnapshotSchema.safeParse({ ...value, documents: [value.documents[0], value.documents[0]], total: 2 }).success).toBe(false);
    expect(documentsSnapshotSchema.safeParse({ ...value, total: 2 }).success).toBe(false);
    expect(documentsSnapshotSchema.safeParse({ ...value, truncated: true }).success).toBe(false);
    const documents = Array.from({ length: 50 }, (_, index) => ({ ...document(), documentId: id(100 + index), review: null, canDownload: false }));
    expect(documentsSnapshotSchema.parse({ ...value, documents, total: 51, truncated: true }).documents).toHaveLength(50);
    expect(documentsSnapshotSchema.safeParse({ ...value, documents, total: 51, truncated: false }).success).toBe(false);
    expect(documentsSnapshotSchema.safeParse({ ...value, documents: [...documents, { ...documents[0], documentId: id(900) }], total: 51, truncated: true }).success).toBe(false);
  });
  it("rejects snapshot generation predating uploaded or reviewed evidence at microsecond precision", () => {
    const value = snapshot();
    expect(documentsSnapshotSchema.safeParse({ ...value, generatedAt: "2026-09-27T04:00:00.123455Z" }).success).toBe(false);
    expect(documentsSnapshotSchema.safeParse({ ...value, generatedAt: "2026-09-27T04:00:01.123455Z" }).success).toBe(false);
    expect(documentsSnapshotSchema.parse({ ...value, generatedAt: "2026-09-27T12:00:01.123456+08:00" })).toBeTruthy();
  });
  it.each([0, 59, 61, 3600])("does not grant download lifetime %s", expiresSeconds => {
    expect(downloadReceiptSchema.safeParse({ ...download(), expiresSeconds }).success).toBe(false);
  });
  it("does not treat an evidence receipt as a qualification, signer, source-adoption or document URL", () => {
    expect(downloadReceiptSchema.parse(download()).canDownload).toBe(true);
    for (const forged of [{ signable: true }, { adopted: true }, { qualified: true }, { signedBy: id(11) }, { url: "https://example.invalid" }]) {
      expect(documentsSnapshotSchema.safeParse({ ...snapshot(), ...forged }).success).toBe(false);
      expect(reviewReceiptSchema.safeParse({ ...review(), ...forged }).success).toBe(false);
    }
  });
});
