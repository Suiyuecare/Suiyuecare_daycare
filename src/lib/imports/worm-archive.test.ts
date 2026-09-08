import { createHash } from "node:crypto";

import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import { ImportError } from "./errors";
import { S3ComplianceArchive, type ArchiveS3Client } from "./worm-archive";

const config = {
  region: "ap-northeast-1",
  bucket: "immutable-test-bucket",
  kmsKeyId: "arn:aws:kms:ap-northeast-1:000000000000:key/test",
} as const;
const scope = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  branchId: "20000000-0000-4000-8000-000000000001",
};
const batchId = "30000000-0000-4000-8000-000000000001";
const bytes = new TextEncoder().encode("<!doctype html><title>synthetic</title>");
const sha256 = createHash("sha256").update(bytes).digest("hex");

describe("S3 compliance archive", () => {
  it("writes KMS-encrypted SHA-256 checked content with seven-year compliance retention", async () => {
    const commands: unknown[] = [];
    const client: ArchiveS3Client = {
      async send(command) {
        commands.push(command);
        if (command instanceof HeadObjectCommand) {
          const notFound = new Error("not found") as Error & { name: string; $metadata: { httpStatusCode: number } };
          notFound.name = "NotFound";
          notFound.$metadata = { httpStatusCode: 404 };
          throw notFound;
        }
        return { VersionId: "version-1" };
      },
    };
    const archive = new S3ComplianceArchive(config, client);
    const now = new Date("2026-09-01T03:00:00.000Z");
    const result = await archive.archive(scope, batchId, bytes, sha256, now);

    expect(result).toMatchObject({ versionId: "version-1", sha256 });
    const put = commands.find((command) => command instanceof PutObjectCommand) as PutObjectCommand;
    expect(put.input).toMatchObject({
      Bucket: config.bucket,
      ObjectLockMode: "COMPLIANCE",
      ObjectLockRetainUntilDate: new Date("2033-09-01T03:00:00.000Z"),
      ServerSideEncryption: "aws:kms",
      SSEKMSKeyId: config.kmsKeyId,
      ChecksumAlgorithm: "SHA256",
      IfNoneMatch: "*",
    });
    expect(put.input.Metadata).not.toHaveProperty("file_name");
  });

  it("reuses only a matching already-locked object version", async () => {
    const client: ArchiveS3Client = {
      async send(command) {
        expect(command).toBeInstanceOf(HeadObjectCommand);
        return {
          VersionId: "existing-version",
          Metadata: { sha256 },
          ObjectLockMode: "COMPLIANCE",
          ObjectLockRetainUntilDate: new Date("2033-09-01T03:00:00.000Z"),
          ServerSideEncryption: "aws:kms",
          SSEKMSKeyId: config.kmsKeyId,
        };
      },
    };
    const archive = new S3ComplianceArchive(config, client);
    const result = await archive.archive(
      scope,
      batchId,
      bytes,
      sha256,
      new Date("2026-09-01T03:30:00.000Z"),
    );
    expect(result.versionId).toBe("existing-version");
  });

  it("rejects content whose supplied hash is not its actual hash", async () => {
    const archive = new S3ComplianceArchive(config, { async send() { return {}; } });
    await expect(archive.archive(scope, batchId, bytes, "0".repeat(64))).rejects.toMatchObject({ code: "WORM_ARCHIVE_HASH_MISMATCH" } satisfies Partial<ImportError>);
  });

  it("verifies the immutable version hash again when reading", async () => {
    const client: ArchiveS3Client = {
      async send(command) {
        expect(command).toBeInstanceOf(GetObjectCommand);
        return { Body: { transformToByteArray: async () => bytes } };
      },
    };
    const archive = new S3ComplianceArchive(config, client);
    await expect(archive.read({ key: "opaque", versionId: "v1", retainUntil: "2033-09-01T00:00:00Z", sha256 })).resolves.toEqual(bytes);
  });
});
