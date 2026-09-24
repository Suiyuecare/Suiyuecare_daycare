import { createHash } from "node:crypto";

import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { ImportError } from "./errors";
import { MAX_HTML_IMPORT_BYTES, type ImportScope } from "./types";

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
  /** Initial batch creation time, not the time of the latest upload retry. */
  createdAt: string;
  byteLength: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const CLASSIFICATION = "sensitive-central-html";

function failure(code: string, message: string, status = 503): never {
  // Never retain SDK errors/causes: their messages can contain keys or credentials.
  throw new ImportError(code, message, status);
}

function addCalendarYears(date: Date, years: number) {
  const next = new Date(date);
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validVersion(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1024 &&
    value !== "null" && !/[\s\u0000-\u001f\u007f]/u.test(value);
}

function objectKey(scope: ImportScope, batchId: string, sha256: string) {
  if (!scope || !UUID.test(scope.organizationId) || !UUID.test(scope.branchId) ||
      !UUID.test(batchId) || !SHA256.test(sha256)) {
    failure("WORM_ARCHIVE_INVALID_REFERENCE", "原始檔封存識別資料無效。", 422);
  }
  return `organizations/${scope.organizationId}/branches/${scope.branchId}/central-html/${sha256}/${batchId}.html`;
}

function base64Sha256(sha256: string) {
  return Buffer.from(sha256, "hex").toString("base64");
}

function hexSha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertConfig(config: WormArchiveConfig) {
  if (config.region !== "ap-northeast-1" ||
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(config.bucket) || config.bucket.includes("..") ||
      !/^arn:aws:kms:ap-northeast-1:\d{12}:key\/[a-zA-Z0-9-]+$/u.test(config.kmsKeyId) ||
      (config.retentionYears !== undefined && config.retentionYears !== 7)) {
    failure("WORM_ARCHIVE_NOT_CONFIGURED", "原始 HTML 必須使用東京區域、KMS 加密及七年不可變封存。");
  }
}

function retentionFrom(createdAt: Date) {
  if (!validDate(createdAt) || createdAt.getTime() > Date.now() + 60_000) {
    failure("WORM_ARCHIVE_INVALID_REFERENCE", "原始檔初始封存時間無效。", 422);
  }
  const retainUntil = addCalendarYears(createdAt, 7);
  if (!validDate(retainUntil) || retainUntil.getTime() <= Date.now()) {
    failure("WORM_ARCHIVE_INVALID_REFERENCE", "原始檔初始封存時間或保留期限無效。", 422);
  }
  return retainUntil;
}

function httpStatus(error: unknown) {
  if (typeof error !== "object" || error === null || !("$metadata" in error)) return null;
  const metadata = error.$metadata;
  return typeof metadata === "object" && metadata !== null && "httpStatusCode" in metadata
    ? metadata.httpStatusCode : null;
}

type HeadResult = {
  VersionId?: string;
  Metadata?: Record<string, string>;
  ObjectLockMode?: string;
  ObjectLockRetainUntilDate?: Date;
  ServerSideEncryption?: string;
  SSEKMSKeyId?: string;
  ContentLength?: number;
  ChecksumSHA256?: string;
  ChecksumType?: string;
  DeleteMarker?: boolean;
};

export class S3ComplianceArchive {
  private readonly client: ArchiveS3Client;

  constructor(private readonly config: WormArchiveConfig, client?: ArchiveS3Client) {
    assertConfig(config);
    this.client = client ?? new S3Client({ region: config.region });
  }

  private async head(key: string, versionId?: string): Promise<HeadResult | null> {
    let result: unknown;
    try {
      result = await this.client.send(new HeadObjectCommand({
        Bucket: this.config.bucket, Key: key,
        ...(versionId ? { VersionId: versionId } : {}), ChecksumMode: "ENABLED",
      }));
    } catch (error) {
      if (httpStatus(error) === 404) return null;
      failure("WORM_ARCHIVE_VERIFY_FAILED", "無法確認原始檔封存狀態，操作已停止。");
    }
    if (typeof result !== "object" || result === null) {
      failure("WORM_ARCHIVE_INTEGRITY_FAILURE", "原始檔封存驗證回應無效。", 409);
    }
    return result as HeadResult;
  }

  private assertObject(
    existing: HeadResult | null,
    reference: Omit<ArchivedObject, "versionId">,
    batchId: string,
    expectedVersion?: string,
  ): ArchivedObject {
    if (!existing || !validVersion(existing.VersionId) ||
        (expectedVersion !== undefined && existing.VersionId !== expectedVersion) ||
        existing.DeleteMarker === true ||
        existing.Metadata?.sha256 !== reference.sha256 ||
        existing.Metadata?.import_batch_id !== batchId ||
        existing.Metadata?.archive_created_at !== reference.createdAt ||
        existing.Metadata?.data_classification !== CLASSIFICATION ||
        existing.ObjectLockMode !== "COMPLIANCE" ||
        !validDate(existing.ObjectLockRetainUntilDate) ||
        existing.ObjectLockRetainUntilDate.getTime() < new Date(reference.retainUntil).getTime() ||
        existing.ServerSideEncryption !== "aws:kms" || existing.SSEKMSKeyId !== this.config.kmsKeyId ||
        existing.ContentLength !== reference.byteLength ||
        (existing.ChecksumSHA256 !== undefined && existing.ChecksumSHA256 !== base64Sha256(reference.sha256)) ||
        (existing.ChecksumType !== undefined && existing.ChecksumType !== "FULL_OBJECT")) {
      failure("WORM_ARCHIVE_INTEGRITY_FAILURE", "原始檔未通過版本、雜湊、加密或保留期限驗證。", 409);
    }
    return { ...reference, versionId: existing.VersionId, retainUntil: existing.ObjectLockRetainUntilDate.toISOString() };
  }

  private async verifyVersion(reference: Omit<ArchivedObject, "versionId">, batchId: string, versionId: string) {
    return this.assertObject(await this.head(reference.key, versionId), reference, batchId, versionId);
  }

  async archive(
    scope: ImportScope, batchId: string, bytes: Uint8Array, expectedSha256: string, createdAt: Date,
  ): Promise<ArchivedObject> {
    const key = objectKey(scope, batchId, expectedSha256);
    const retainUntil = retentionFrom(createdAt);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_HTML_IMPORT_BYTES) {
      failure("WORM_ARCHIVE_INVALID_REFERENCE", "原始 HTML 大小無效。", 422);
    }
    // Own the bytes across asynchronous HEAD/PUT calls so callers cannot mutate them.
    const originalBytes = Uint8Array.from(bytes);
    if (hexSha256(originalBytes) !== expectedSha256) {
      failure("WORM_ARCHIVE_HASH_MISMATCH", "原始 HTML 在封存前完整性驗證失敗。", 409);
    }
    const reference = {
      key, retainUntil: retainUntil.toISOString(), sha256: expectedSha256,
      createdAt: createdAt.toISOString(), byteLength: originalBytes.byteLength,
    };
    const existing = await this.head(key);
    if (existing) {
      const candidate = this.assertObject(existing, reference, batchId);
      return this.verifyVersion(candidate, batchId, candidate.versionId);
    }
    let stored: unknown;
    try {
      stored = await this.client.send(new PutObjectCommand({
        Bucket: this.config.bucket, Key: key, Body: originalBytes, ContentLength: originalBytes.byteLength,
        ContentType: "text/html; charset=utf-8", CacheControl: "private, no-store, max-age=0",
        ServerSideEncryption: "aws:kms", SSEKMSKeyId: this.config.kmsKeyId,
        ChecksumAlgorithm: "SHA256", ChecksumSHA256: base64Sha256(expectedSha256),
        ObjectLockMode: "COMPLIANCE", ObjectLockRetainUntilDate: retainUntil, IfNoneMatch: "*",
        Metadata: {
          sha256: expectedSha256, import_batch_id: batchId,
          archive_created_at: reference.createdAt, data_classification: CLASSIFICATION,
        },
      }));
    } catch (error) {
      if (httpStatus(error) === 412) {
        const raced = this.assertObject(await this.head(key), reference, batchId);
        return this.verifyVersion(raced, batchId, raced.versionId);
      }
      failure("WORM_ARCHIVE_WRITE_FAILED", "原始 HTML 未確認完成不可變封存，正式資料未變更。");
    }
    const versionId = typeof stored === "object" && stored !== null && "VersionId" in stored ? stored.VersionId : undefined;
    if (!validVersion(versionId)) {
      failure("WORM_ARCHIVE_VERSION_MISSING", "S3 未回傳不可變物件版本，匯入已停止。");
    }
    // PUT success alone does not establish retention/encryption of the returned version.
    return this.verifyVersion(reference, batchId, versionId);
  }

  async read(scope: ImportScope, batchId: string, archived: ArchivedObject) {
    const key = objectKey(scope, batchId, archived.sha256);
    const createdAt = new Date(archived.createdAt);
    const requiredRetention = retentionFrom(createdAt);
    const retainUntil = new Date(archived.retainUntil);
    if (archived.key !== key || !validVersion(archived.versionId) ||
        archived.createdAt !== createdAt.toISOString() || !validDate(retainUntil) ||
        archived.retainUntil !== retainUntil.toISOString() || retainUntil < requiredRetention ||
        !Number.isSafeInteger(archived.byteLength) || archived.byteLength < 1 || archived.byteLength > MAX_HTML_IMPORT_BYTES) {
      failure("WORM_ARCHIVE_INVALID_REFERENCE", "原始檔版本參照或資料範圍無效。", 422);
    }
    await this.verifyVersion(archived, batchId, archived.versionId);
    let result: HeadResult & { Body?: { transformToByteArray?: () => Promise<Uint8Array> } };
    let bytes: Uint8Array;
    try {
      result = await this.client.send(new GetObjectCommand({
        Bucket: this.config.bucket, Key: key, VersionId: archived.versionId, ChecksumMode: "ENABLED",
      })) as typeof result;
    } catch {
      failure("WORM_ARCHIVE_READ_FAILED", "無法讀取指定版本的原始 HTML。");
    }
    this.assertObject(result, archived, batchId, archived.versionId);
    try {
      if (!result?.Body?.transformToByteArray) throw new Error();
      bytes = await result.Body.transformToByteArray();
    } catch {
      failure("WORM_ARCHIVE_READ_FAILED", "無法讀取指定版本的原始 HTML。");
    }
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== archived.byteLength || hexSha256(bytes) !== archived.sha256) {
      failure("WORM_ARCHIVE_HASH_MISMATCH", "原始 HTML 讀取後完整性驗證失敗，系統已停止解析。", 409);
    }
    return bytes;
  }
}

export const wormArchiveInternals = { addCalendarYears, objectKey };
