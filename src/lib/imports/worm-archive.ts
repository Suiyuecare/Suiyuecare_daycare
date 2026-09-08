import { createHash } from "node:crypto";

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";

import { ImportError } from "./errors";
import type { ImportScope } from "./types";

type ArchiveCommand = GetObjectCommand | HeadObjectCommand | PutObjectCommand;

export interface ArchiveS3Client {
  send(command: ArchiveCommand): Promise<unknown>;
}

export interface WormArchiveConfig {
  region: "ap-northeast-1";
  bucket: string;
  kmsKeyId: string;
  retentionYears?: 7;
}

export interface ArchivedObject {
  key: string;
  versionId: string;
  retainUntil: string;
  sha256: string;
}

function addCalendarYears(date: Date, years: number) {
  const next = new Date(date);
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}

function objectKey(scope: ImportScope, batchId: string, sha256: string) {
  return `organizations/${scope.organizationId}/branches/${scope.branchId}/central-html/${sha256}/${batchId}.html`;
}

function base64Sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("base64");
}

function hexSha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertConfig(config: WormArchiveConfig) {
  if (config.region !== "ap-northeast-1" || !config.bucket || !config.kmsKeyId) {
    throw new ImportError(
      "WORM_ARCHIVE_NOT_CONFIGURED",
      "原始 HTML 必須使用東京區域、KMS 加密及七年不可變封存。",
      503,
    );
  }
}

type HeadResult = {
  VersionId?: string;
  Metadata?: Record<string, string>;
  ObjectLockMode?: string;
  ObjectLockRetainUntilDate?: Date;
  ServerSideEncryption?: string;
  SSEKMSKeyId?: string;
};

export class S3ComplianceArchive {
  private readonly client: ArchiveS3Client;

  constructor(
    private readonly config: WormArchiveConfig,
    client?: ArchiveS3Client,
  ) {
    assertConfig(config);
    this.client = client ?? new S3Client({ region: config.region });
  }

  private async head(key: string) {
    try {
      return (await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      )) as HeadResult;
    } catch (error) {
      const statusCode =
        typeof error === "object" &&
        error !== null &&
        "$metadata" in error &&
        typeof error.$metadata === "object" &&
        error.$metadata !== null &&
        "httpStatusCode" in error.$metadata
          ? error.$metadata.httpStatusCode
          : null;
      if (
        statusCode === 404 ||
        (error instanceof S3ServiceException && error.name === "NotFound")
      ) {
        return null;
      }
      throw error;
    }
  }

  private assertExistingObject(
    existing: HeadResult,
    sha256: string,
    earliestAcceptableRetention: Date,
  ): ArchivedObject {
    if (
      !existing.VersionId ||
      existing.Metadata?.sha256 !== sha256 ||
      existing.ObjectLockMode !== "COMPLIANCE" ||
      !existing.ObjectLockRetainUntilDate ||
      existing.ObjectLockRetainUntilDate < earliestAcceptableRetention ||
      existing.ServerSideEncryption !== "aws:kms" ||
      existing.SSEKMSKeyId !== this.config.kmsKeyId
    ) {
      throw new ImportError(
        "WORM_ARCHIVE_INTEGRITY_FAILURE",
        "既有原始檔封存未通過雜湊、加密或保留期限驗證。",
        409,
      );
    }
    return {
      key: "",
      versionId: existing.VersionId,
      retainUntil: existing.ObjectLockRetainUntilDate.toISOString(),
      sha256,
    };
  }

  async archive(
    scope: ImportScope,
    batchId: string,
    bytes: Uint8Array,
    expectedSha256: string,
    now = new Date(),
  ): Promise<ArchivedObject> {
    const actualSha256 = hexSha256(bytes);
    if (actualSha256 !== expectedSha256) {
      throw new ImportError(
        "WORM_ARCHIVE_HASH_MISMATCH",
        "原始 HTML 在封存前完整性驗證失敗。",
        409,
      );
    }

    const key = objectKey(scope, batchId, expectedSha256);
    const retainUntil = addCalendarYears(now, this.config.retentionYears ?? 7);
    const earliestRetryRetention = addCalendarYears(
      new Date(now.getTime() - 24 * 60 * 60 * 1000),
      this.config.retentionYears ?? 7,
    );
    const existing = await this.head(key);
    if (existing) {
      return { ...this.assertExistingObject(existing, expectedSha256, earliestRetryRetention), key };
    }

    try {
      const stored = (await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Body: bytes,
          ContentLength: bytes.byteLength,
          ContentType: "text/html; charset=utf-8",
          CacheControl: "private, no-store, max-age=0",
          ServerSideEncryption: "aws:kms",
          SSEKMSKeyId: this.config.kmsKeyId,
          ChecksumAlgorithm: "SHA256",
          ChecksumSHA256: base64Sha256(bytes),
          ObjectLockMode: "COMPLIANCE",
          ObjectLockRetainUntilDate: retainUntil,
          IfNoneMatch: "*",
          Metadata: {
            sha256: expectedSha256,
            import_batch_id: batchId,
            data_classification: "sensitive-central-html",
          },
        }),
      )) as { VersionId?: string };
      if (!stored.VersionId) {
        throw new ImportError(
          "WORM_ARCHIVE_VERSION_MISSING",
          "S3 未回傳不可變物件版本，匯入已停止。",
          503,
        );
      }
      return {
        key,
        versionId: stored.VersionId,
        retainUntil: retainUntil.toISOString(),
        sha256: expectedSha256,
      };
    } catch (error) {
      if (error instanceof ImportError) throw error;
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 412) {
        const raced = await this.head(key);
        if (raced) {
          return { ...this.assertExistingObject(raced, expectedSha256, earliestRetryRetention), key };
        }
      }
      throw new ImportError(
        "WORM_ARCHIVE_WRITE_FAILED",
        "原始 HTML 未確認完成不可變封存，正式資料未變更。",
        503,
      );
    }
  }

  async read(archived: ArchivedObject) {
    let result: unknown;
    try {
      result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: archived.key,
          VersionId: archived.versionId,
        }),
      );
    } catch {
      throw new ImportError(
        "WORM_ARCHIVE_READ_FAILED",
        "無法讀取指定版本的原始 HTML。",
        503,
      );
    }
    const body = (result as { Body?: { transformToByteArray?: () => Promise<Uint8Array> } }).Body;
    if (!body?.transformToByteArray) {
      throw new ImportError("WORM_ARCHIVE_READ_FAILED", "原始 HTML 內容不可用。", 503);
    }
    const bytes = await body.transformToByteArray();
    if (hexSha256(bytes) !== archived.sha256) {
      throw new ImportError(
        "WORM_ARCHIVE_HASH_MISMATCH",
        "原始 HTML 讀取後雜湊不一致，系統已停止解析。",
        409,
      );
    }
    return bytes;
  }
}

export const wormArchiveInternals = { addCalendarYears, objectKey };
