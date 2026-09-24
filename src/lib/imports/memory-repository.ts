import { createHash } from "node:crypto";

import type { ImportBatchStatus } from "@/lib/domain/types";
import { ImportError } from "./errors";
import type {
  ImportActor, ImportApproval, ImportBatchRecord, ImportBatchRepository,
  ImportScope, ParsedHtmlImport,
  ImportUploadOperation, ImportUploadRequestIdentity,
} from "./types";

type OperationKind = "upload" | "reparse" | "approve";
type Operation = { kind: OperationKind; batchId: string; requestHash: string; result: ImportBatchRecord;
  upload?: { request: ImportUploadRequestIdentity; duplicate: boolean } };

function scopePrefix(scope: ImportScope) {
  return JSON.stringify([scope.organizationId, scope.branchId]);
}
function recordKey(scope: ImportScope, id: string) {
  return JSON.stringify([scopePrefix(scope), id]);
}
function operationKey(actor: ImportScope & { userId: string }, key: string) {
  return JSON.stringify([scopePrefix(actor), actor.userId, key]);
}
function cloneRecord(record: ImportBatchRecord) { return structuredClone(record); }
function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function uploadHash(request: ImportUploadRequestIdentity) {
  return hash([request.fileSha256, request.fileName, request.mimeType]);
}
function uploadOperation(operation: Operation): ImportUploadOperation {
  if (!operation.upload) throw new ImportError("INVALID_UPLOAD_RECEIPT", "上傳回執無法確認。", 503);
  return { batch: cloneRecord(operation.result), ...structuredClone(operation.upload), replayed: true };
}
function reused(): never {
  throw new ImportError("IDEMPOTENCY_KEY_REUSED", "同一操作識別碼不可用於不同操作或內容。", 409, "idempotency_key");
}
function assertMutable(record: ImportBatchRecord, expectedVersion: number) {
  if (record.approval || ["imported", "superseded"].includes(record.status)) {
    throw new ImportError("IMMUTABLE_IMPORT", "已核准的暫存不可修改，請建立新批次。", 409);
  }
  if (record.version !== expectedVersion) {
    throw new ImportError("IMPORT_VERSION_CONFLICT", "匯入批次已更新，請重新載入後再操作。", 409);
  }
}

/** Synthetic, process-memory storage only. Never an authorization or durability boundary. */
export class DemoMemoryImportRepository implements ImportBatchRepository {
  private readonly records = new Map<string, ImportBatchRecord>();
  private readonly operations = new Map<string, Operation>();

  private replay(actor: ImportScope & { userId: string }, key: string,
    kind: OperationKind, batchId?: string, requestHash?: string) {
    const existing = this.operations.get(operationKey(actor, key));
    if (!existing) return null;
    if (existing.kind !== kind || (batchId !== undefined && existing.batchId !== batchId) ||
        (requestHash !== undefined && existing.requestHash !== requestHash)) reused();
    // Return the immutable operation receipt, never the latest batch state.
    return structuredClone(existing);
  }

  private saveOperation(actor: ImportScope & { userId: string }, key: string,
    kind: OperationKind, requestHash: string, result: ImportBatchRecord,
    upload?: Operation["upload"]) {
    this.operations.set(operationKey(actor, key), {
      kind, requestHash, batchId: result.id, result: cloneRecord(result), upload: structuredClone(upload),
    });
  }

  async findById(scope: ImportScope, id: string) {
    const record = this.records.get(recordKey(scope, id));
    return record ? cloneRecord(record) : null;
  }

  async findByFileHash(scope: ImportScope, sha256: string) {
    for (const record of this.records.values()) {
      if (record.organizationId === scope.organizationId && record.branchId === scope.branchId &&
          record.fileSha256 === sha256) return cloneRecord(record);
    }
    return null;
  }

  async findByOperationKey(actor: ImportActor, key: string) {
    const replay = this.replay(actor, key, "upload");
    return replay ? uploadOperation(replay) : null;
  }

  async registerDuplicateUpload(actor: ImportScope & { userId: string }, id: string, request: ImportUploadRequestIdentity, key: string) {
    const replay = this.replay(actor, key, "upload", undefined, uploadHash(request));
    if (replay) return uploadOperation(replay);
    const current = this.records.get(recordKey(actor, id));
    if (!current || current.fileSha256 !== request.fileSha256) {
      throw new ImportError("IMPORT_DUPLICATE_MISMATCH", "重複檔案與批次不一致。", 409);
    }
    this.saveOperation(actor, key, "upload", uploadHash(request), current, { request, duplicate: true });
    return { batch: cloneRecord(current), request: structuredClone(request), duplicate: true, replayed: false };
  }

  async readOriginal(scope: ImportScope, id: string) {
    const record = this.records.get(recordKey(scope, id));
    if (!record?.originalBytes) {
      throw new ImportError("IMPORT_ORIGINAL_UNAVAILABLE", "找不到可重新解析的原始 HTML。", 409);
    }
    return structuredClone(record.originalBytes);
  }

  async create(record: ImportBatchRecord, key: string) {
    const actor = { ...record, userId: record.createdBy };
    const request = { fileSha256: record.fileSha256, fileName: record.fileName, mimeType: record.mimeType };
    const requestHash = uploadHash(request);
    const replay = this.replay(actor, key, "upload", undefined, requestHash);
    if (replay) return uploadOperation(replay);
    const duplicate = [...this.records.values()].find((other) =>
      other.organizationId === record.organizationId && other.branchId === record.branchId &&
      other.fileSha256 === record.fileSha256);
    if (duplicate) return this.registerDuplicateUpload(actor, duplicate.id, request, key);
    if (this.records.has(recordKey(record, record.id))) {
      throw new ImportError("IMPORT_CONCURRENT_WRITE", "相同檔案已由另一個請求建立，請重新載入。", 409);
    }
    const stored = cloneRecord(record);
    stored.operationKeys.upload = key;
    this.records.set(recordKey(record, record.id), stored);
    this.saveOperation(actor, key, "upload", requestHash, stored, { request, duplicate: false });
    return { batch: cloneRecord(stored), request, duplicate: false, replayed: false };
  }

  async findReparseOperation(actor: ImportActor, id: string, parsed: ParsedHtmlImport,
    nextStatus: ImportBatchStatus, key: string) {
    const replay = this.replay(actor, key, "reparse", id, hash([id, parsed, nextStatus]));
    return replay ? cloneRecord(replay.result) : null;
  }

  async replaceParsedResult(actor: ImportActor, id: string, expectedVersion: number,
    parsed: ParsedHtmlImport, nextStatus: ImportBatchStatus, key: string) {
    const requestHash = hash([id, parsed, nextStatus]);
    const replay = this.replay(actor, key, "reparse", id, requestHash);
    if (replay) return cloneRecord(replay.result);
    const current = this.records.get(recordKey(actor, id));
    if (!current) throw new ImportError("IMPORT_NOT_FOUND", "找不到匯入批次。", 404);
    assertMutable(current, expectedVersion);
    if (!["mapping_required", "ready_for_approval", "validation_failed", "parsed"].includes(nextStatus)) {
      throw new ImportError("INVALID_PARSE_STATUS", "重新解析不能標示為正式入檔。", 422);
    }
    const next: ImportBatchRecord = {
      ...current, ...parsed, version: current.version + 1, status: nextStatus,
      updatedAt: new Date().toISOString(),
      operationKeys: { ...current.operationKeys, ["reparse:" + parsed.mappingVersion]: key },
    };
    this.records.set(recordKey(actor, id), cloneRecord(next));
    this.saveOperation(actor, key, "reparse", requestHash, next);
    return cloneRecord(next);
  }

  async approveAtomically(actor: ImportActor, id: string, expectedVersion: number, approval: ImportApproval) {
    const decisions = Object.entries(approval.conflictResolutions).sort(([a], [b]) => a.localeCompare(b));
    const requestHash = hash([id, decisions]);
    if (approval.approvedBy !== actor.userId) {
      throw new ImportError("IMPORT_ACTOR_MISMATCH", "核對人員與目前操作人員不一致。", 403);
    }
    const replay = this.replay(actor, approval.idempotencyKey, "approve", id, requestHash);
    if (replay) return cloneRecord(replay.result);
    const current = this.records.get(recordKey(actor, id));
    if (!current) throw new ImportError("IMPORT_NOT_FOUND", "找不到匯入批次。", 404);
    assertMutable(current, expectedVersion);
    if (current.status !== "ready_for_approval") {
      throw new ImportError("IMPORT_NOT_READY", "匯入批次尚未符合暫存核准條件。", 409);
    }
    // Freeze a staging decision, not client data. No production signature is created.
    const next: ImportBatchRecord = {
      ...current, version: current.version + 1, status: "ready_for_approval",
      updatedAt: approval.approvedAt, approval,
      operationKeys: { ...current.operationKeys, approve: approval.idempotencyKey },
    };
    this.records.set(recordKey(actor, id), cloneRecord(next));
    this.saveOperation(actor, approval.idempotencyKey, "approve", requestHash, next);
    return cloneRecord(next);
  }

  /** Test-only observability; never exposes stored content. */
  get size() { return this.records.size; }
}
