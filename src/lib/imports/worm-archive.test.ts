import { createHash } from "node:crypto";

import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImportError } from "./errors";
import { S3ComplianceArchive, type ArchivedObject, type ArchiveS3Client, wormArchiveInternals } from "./worm-archive";

const config = {
  region: "ap-northeast-1", bucket: "immutable-test-bucket",
  kmsKeyId: "arn:aws:kms:ap-northeast-1:000000000000:key/test",
} as const;
const scope = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  branchId: "20000000-0000-4000-8000-000000000001",
};
const batchId = "30000000-0000-4000-8000-000000000001";
const bytes = new TextEncoder().encode("<!doctype html><title>synthetic</title>");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const checksum = createHash("sha256").update(bytes).digest("base64");
const createdAt = new Date("2026-09-01T03:00:00.000Z");
const retainUntil = new Date("2033-09-01T03:00:00.000Z");
const reference: ArchivedObject = {
  key: wormArchiveInternals.objectKey(scope, batchId, sha256), versionId: "version-1",
  sha256, createdAt: createdAt.toISOString(), retainUntil: retainUntil.toISOString(), byteLength: bytes.byteLength,
};
const secret = "untrusted-html-and-AWS-secret-do-not-echo";

function sdkError(status: number) {
  return Object.assign(new Error(secret), { $metadata: { httpStatusCode: status } });
}

function headResult(overrides: Record<string, unknown> = {}) {
  return {
    VersionId: reference.versionId,
    Metadata: { sha256, import_batch_id: batchId, archive_created_at: createdAt.toISOString(), data_classification: "sensitive-central-html" },
    ObjectLockMode: "COMPLIANCE", ObjectLockRetainUntilDate: retainUntil,
    ServerSideEncryption: "aws:kms", SSEKMSKeyId: config.kmsKeyId,
    ContentLength: bytes.byteLength, ChecksumSHA256: checksum, ChecksumType: "FULL_OBJECT",
    ...overrides,
  };
}

function mockArchive(respond: ArchiveS3Client["send"]) {
  const send = vi.fn(respond);
  return { archive: new S3ComplianceArchive(config, { send }), send };
}

function uploadMock(overrides: Record<string, unknown> = {}) {
  return mockArchive(async (command) => {
    if (command instanceof HeadObjectCommand) {
      if (!command.input.VersionId) throw sdkError(404);
      return headResult(overrides);
    }
    if (command instanceof PutObjectCommand) return { VersionId: reference.versionId };
    throw new Error("unexpected command");
  });
}

describe("S3 compliance archive", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-11T03:00:00.000Z")); });
  afterEach(() => vi.useRealTimers());

  it("verifies the exact PUT version before returning a seven-year KMS archive receipt", async () => {
    const { archive, send } = uploadMock();
    await expect(archive.archive(scope, batchId, bytes, sha256, createdAt)).resolves.toEqual(reference);
    const commands = send.mock.calls.map(([command]) => command);
    expect(commands.map((command) => command.constructor.name)).toEqual(["HeadObjectCommand", "PutObjectCommand", "HeadObjectCommand"]);
    expect(commands[1]!.input).toMatchObject({
      Bucket: config.bucket, ContentLength: bytes.byteLength,
      ObjectLockMode: "COMPLIANCE", ObjectLockRetainUntilDate: retainUntil,
      ServerSideEncryption: "aws:kms", SSEKMSKeyId: config.kmsKeyId,
      ChecksumAlgorithm: "SHA256", ChecksumSHA256: checksum, IfNoneMatch: "*",
      Metadata: { archive_created_at: createdAt.toISOString(), import_batch_id: batchId },
    });
    const put = commands[1] as PutObjectCommand;
    expect(put.input.Metadata).not.toHaveProperty("file_name");
    expect(commands[2]!.input).toMatchObject({ Key: reference.key, VersionId: reference.versionId, ChecksumMode: "ENABLED" });
    expect(commands[2]!.input).not.toHaveProperty("ServerSideEncryption");
  });

  it.each([
    ["wrong version", { VersionId: "other-version" }],
    ["null version", { VersionId: "null" }],
    ["missing lock", { ObjectLockMode: undefined }],
    ["governance lock", { ObjectLockMode: "GOVERNANCE" }],
    ["short retention", { ObjectLockRetainUntilDate: new Date(retainUntil.getTime() - 1) }],
    ["invalid retention", { ObjectLockRetainUntilDate: new Date("invalid") }],
    ["wrong KMS", { SSEKMSKeyId: "different-key" }],
    ["unencrypted", { ServerSideEncryption: undefined }],
    ["wrong length", { ContentLength: bytes.byteLength + 1 }],
    ["missing length", { ContentLength: undefined }],
    ["wrong checksum", { ChecksumSHA256: "invalid" }],
    ["composite checksum", { ChecksumType: "COMPOSITE" }],
    ["wrong hash", { Metadata: { ...headResult().Metadata, sha256: "0".repeat(64) } }],
    ["wrong batch", { Metadata: { ...headResult().Metadata, import_batch_id: "other" } }],
    ["wrong initial time", { Metadata: { ...headResult().Metadata, archive_created_at: "2026-09-01T04:00:00.000Z" } }],
    ["delete marker", { DeleteMarker: true }],
  ])("does not claim archive completion after %s verification failure", async (_label, overrides) => {
    const { archive } = uploadMock(overrides);
    await expect(archive.archive(scope, batchId, bytes, sha256, createdAt)).rejects.toMatchObject({ code: "WORM_ARCHIVE_INTEGRITY_FAILURE" });
  });

  it("checks the checksum when returned but accepts a server omitting it", async () => {
    const { archive } = uploadMock({ ChecksumSHA256: undefined, ChecksumType: undefined });
    await expect(archive.archive(scope, batchId, bytes, sha256, createdAt)).resolves.toEqual(reference);
  });

  it("retries after days with the immutable initial timestamp and never writes another version", async () => {
    const { archive, send } = mockArchive(async () => headResult());
    const initial = await archive.archive(scope, batchId, bytes, sha256, createdAt);
    vi.setSystemTime(new Date("2026-10-11T03:00:00.000Z"));
    await expect(archive.archive(scope, batchId, bytes, sha256, createdAt)).resolves.toEqual(initial);
    expect(send.mock.calls.every(([command]) => command instanceof HeadObjectCommand)).toBe(true);
    expect(send.mock.calls[1]![0].input).toHaveProperty("VersionId", reference.versionId);
  });

  it("rejects a rolling retry time even inside the previous 24-hour tolerance", async () => {
    const { archive, send } = mockArchive(async () => headResult());
    await expect(archive.archive(scope, batchId, bytes, sha256, new Date(createdAt.getTime() + 30 * 60_000)))
      .rejects.toMatchObject({ code: "WORM_ARCHIVE_INTEGRITY_FAILURE" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("pins the existing version and rejects a different version in its verification response", async () => {
    const { archive, send } = mockArchive(async (command) => {
      expect(command).toBeInstanceOf(HeadObjectCommand);
      const head = command as HeadObjectCommand;
      return head.input.VersionId ? headResult({ VersionId: "different-version" }) : headResult();
    });
    await expect(archive.archive(scope, batchId, bytes, sha256, createdAt)).rejects.toMatchObject({ code: "WORM_ARCHIVE_INTEGRITY_FAILURE" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("recovers a 412 race only through the same initial timestamp and pinned verification", async () => {
    let heads = 0;
    const { archive, send } = mockArchive(async (command) => {
      if (command instanceof HeadObjectCommand) {
        if (++heads === 1) throw sdkError(404);
        return headResult();
      }
      throw sdkError(412);
    });
    await expect(archive.archive(scope, batchId, bytes, sha256, createdAt)).resolves.toEqual(reference);
    expect(send.mock.calls.map(([command]) => command.constructor.name)).toEqual([
      "HeadObjectCommand", "PutObjectCommand", "HeadObjectCommand", "HeadObjectCommand",
    ]);
    expect(send.mock.calls[3]![0].input).toHaveProperty("VersionId", reference.versionId);
  });

  it.each([undefined, "null", "", "\nunsafe"])("rejects missing/invalid PUT version %s", async (VersionId) => {
    const { archive } = mockArchive(async (command) => {
      if (command instanceof HeadObjectCommand) throw sdkError(404);
      return { VersionId };
    });
    await expect(archive.archive(scope, batchId, bytes, sha256, createdAt)).rejects.toMatchObject({ code: "WORM_ARCHIVE_VERSION_MISSING" });
  });

  it.each([
    ["scope traversal", { ...scope, branchId: "../other" }, batchId, sha256, createdAt],
    ["batch traversal", scope, "../other", sha256, createdAt],
    ["noncanonical scope", { ...scope, organizationId: "invalid" }, batchId, sha256, createdAt],
    ["invalid hash", scope, batchId, "invalid", createdAt],
    ["invalid date", scope, batchId, sha256, new Date("invalid")],
    ["future date", scope, batchId, sha256, new Date("2027-09-01T03:00:00Z")],
    ["expired retention", scope, batchId, sha256, new Date("2010-09-01T03:00:00Z")],
  ])("rejects %s before any S3 request", async (_label, selectedScope, selectedBatch, selectedHash, initialTime) => {
    const { archive, send } = uploadMock();
    await expect(archive.archive(selectedScope, selectedBatch, bytes, selectedHash, initialTime))
      .rejects.toMatchObject({ code: "WORM_ARCHIVE_INVALID_REFERENCE" });
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects supplied hash mismatch without sending content", async () => {
    const { archive, send } = uploadMock();
    await expect(archive.archive(scope, batchId, bytes, "0".repeat(64), createdAt)).rejects.toMatchObject({ code: "WORM_ARCHIVE_HASH_MISMATCH" });
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["pre-head", "put", "post-head", "race-head"])("redacts %s SDK errors and does not report completion", async (step) => {
    let heads = 0;
    const { archive } = mockArchive(async (command) => {
      if (command instanceof HeadObjectCommand) {
        heads += 1;
        if (step === "pre-head" || heads > 1) throw sdkError(403);
        throw sdkError(404);
      }
      if (step === "put") throw sdkError(500);
      if (step === "race-head") throw sdkError(412);
      return { VersionId: reference.versionId };
    });
    const error = await archive.archive(scope, batchId, bytes, sha256, createdAt).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ImportError);
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(error).not.toHaveProperty("cause");
  });

  it("reads only the requested scoped version and rechecks metadata and returned bytes", async () => {
    const { archive, send } = mockArchive(async (command) => command instanceof HeadObjectCommand
      ? headResult() : { ...headResult(), Body: { transformToByteArray: async () => bytes } });
    await expect(archive.read(scope, batchId, reference)).resolves.toEqual(bytes);
    expect(send.mock.calls.map(([command]) => command.constructor.name)).toEqual(["HeadObjectCommand", "GetObjectCommand"]);
    for (const [command] of send.mock.calls) expect(command.input).toMatchObject({ Key: reference.key, VersionId: reference.versionId, ChecksumMode: "ENABLED" });
  });

  it.each([
    ["cross branch", { ...scope, branchId: "20000000-0000-4000-8000-000000000002" }, batchId, reference],
    ["cross batch", scope, "30000000-0000-4000-8000-000000000002", reference],
    ["arbitrary key", scope, batchId, { ...reference, key: "opaque" }],
    ["invalid retention", scope, batchId, { ...reference, retainUntil: "invalid" }],
    ["short retention", scope, batchId, { ...reference, retainUntil: "2027-09-01T03:00:00.000Z" }],
    ["invalid initial time", scope, batchId, { ...reference, createdAt: "invalid" }],
    ["invalid length", scope, batchId, { ...reference, byteLength: 0 }],
    ["null version", scope, batchId, { ...reference, versionId: "null" }],
  ])("rejects a read with %s before network access", async (_label, selectedScope, selectedBatch, selectedReference) => {
    const { archive, send } = uploadMock();
    await expect(archive.read(selectedScope, selectedBatch, selectedReference)).rejects.toMatchObject({ code: "WORM_ARCHIVE_INVALID_REFERENCE" });
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["head", "get", "stream"])("redacts errors from read %s", async (step) => {
    const { archive } = mockArchive(async (command) => {
      if (command instanceof HeadObjectCommand) {
        if (step === "head") throw sdkError(403);
        return headResult();
      }
      if (step === "get") throw sdkError(500);
      return { ...headResult(), Body: { transformToByteArray: async () => { throw new Error(secret); } } };
    });
    const error = await archive.read(scope, batchId, reference).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ImportError);
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(error).not.toHaveProperty("cause");
  });

  it("rejects changed bytes even when all version metadata matches", async () => {
    const { archive } = mockArchive(async (command) => command instanceof HeadObjectCommand
      ? headResult() : { ...headResult(), Body: { transformToByteArray: async () => new Uint8Array(bytes.byteLength) } });
    await expect(archive.read(scope, batchId, reference)).rejects.toMatchObject({ code: "WORM_ARCHIVE_HASH_MISMATCH" });
  });

  it("rejects GET returning another version despite a valid pinned HEAD", async () => {
    const readBody = vi.fn(async () => bytes);
    const { archive } = mockArchive(async (command) => command instanceof HeadObjectCommand
      ? headResult() : { ...headResult({ VersionId: "different-version" }), Body: { transformToByteArray: readBody } });
    await expect(archive.read(scope, batchId, reference)).rejects.toMatchObject({ code: "WORM_ARCHIVE_INTEGRITY_FAILURE" });
    expect(readBody).not.toHaveBeenCalled();
  });

  it("redacts an upstream error even when it uses the application error class", async () => {
    const { archive } = mockArchive(async () => { throw new ImportError("SECRET_CODE", secret, 503); });
    const error = await archive.archive(scope, batchId, bytes, sha256, createdAt).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "WORM_ARCHIVE_VERIFY_FAILED" });
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain("SECRET_CODE");
  });

  it("owns input bytes while asynchronous preflight is running", async () => {
    const mutable = Uint8Array.from(bytes);
    const { archive, send } = mockArchive(async (command) => {
      if (command instanceof HeadObjectCommand) {
        if (command.input.VersionId) return headResult();
        mutable.fill(0);
        throw sdkError(404);
      }
      return { VersionId: reference.versionId };
    });
    await expect(archive.archive(scope, batchId, mutable, sha256, createdAt)).resolves.toEqual(reference);
    const put = send.mock.calls[1]![0] as PutObjectCommand;
    expect(put.input.Body).toEqual(bytes);
    expect(put.input.Body).not.toBe(mutable);
  });

  it("rejects retention shortened between latest-version and pinned-version verification", async () => {
    const { archive } = mockArchive(async (command) => {
      const head = command as HeadObjectCommand;
      return head.input.VersionId ? headResult() : headResult({ ObjectLockRetainUntilDate: new Date("2034-09-01T03:00:00.000Z") });
    });
    await expect(archive.archive(scope, batchId, bytes, sha256, createdAt)).rejects.toMatchObject({ code: "WORM_ARCHIVE_INTEGRITY_FAILURE" });
  });

  it("accepts an independently extended retention without shortening its receipt", async () => {
    const extended = new Date("2034-09-01T03:00:00.000Z");
    const { archive } = uploadMock({ ObjectLockRetainUntilDate: extended });
    await expect(archive.archive(scope, batchId, bytes, sha256, createdAt)).resolves.toMatchObject({ retainUntil: extended.toISOString() });
  });

  it("keeps leap-day seven-calendar-year retention at least seven years", () => {
    expect(wormArchiveInternals.addCalendarYears(new Date("2024-02-29T03:00:00.000Z"), 7).toISOString()).toBe("2031-03-01T03:00:00.000Z");
  });
});
