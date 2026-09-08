import type { ImportBatchStatus } from "@/lib/domain/types";

import { ImportError } from "./errors";
import type {
  ImportActor,
  ImportApproval,
  ImportBatchRecord,
  ImportBatchRepository,
  ImportScope,
  ParsedHtmlImport,
} from "./types";

function scopePrefix(scope: ImportScope) {
  return `${scope.organizationId}\u001f${scope.branchId}`;
}

function recordKey(scope: ImportScope, id: string) {
  return `${scopePrefix(scope)}\u001f${id}`;
}

function operationKey(scope: ImportScope, idempotencyKey: string) {
  return `${scopePrefix(scope)}\u001f${idempotencyKey}`;
}

function cloneRecord(record: ImportBatchRecord) {
  return structuredClone(record);
}

export class DemoMemoryImportRepository implements ImportBatchRepository {
  private readonly records = new Map<string, ImportBatchRecord>();
  private readonly operations = new Map<string, string>();

  async findById(scope: ImportScope, id: string) {
    const record = this.records.get(recordKey(scope, id));
    return record ? cloneRecord(record) : null;
  }

  async findByFileHash(scope: ImportScope, sha256: string) {
    for (const record of this.records.values()) {
      if (
        record.organizationId === scope.organizationId &&
        record.branchId === scope.branchId &&
        record.fileSha256 === sha256
      ) {
        return cloneRecord(record);
      }
    }
    return null;
  }

  async findByOperationKey(scope: ImportScope, idempotencyKey: string) {
    const id = this.operations.get(operationKey(scope, idempotencyKey));
    return id ? this.findById(scope, id) : null;
  }

  async readOriginal(scope: ImportScope, id: string) {
    const record = this.records.get(recordKey(scope, id));
    if (!record?.originalBytes) {
      throw new ImportError(
        "IMPORT_ORIGINAL_UNAVAILABLE",
        "找不到可重新解析的原始 HTML。",
        409,
      );
    }
    return structuredClone(record.originalBytes);
  }

  async create(record: ImportBatchRecord, idempotencyKey: string) {
    const key = recordKey(record, record.id);
    const opKey = operationKey(record, idempotencyKey);
    if (this.records.has(key) || this.operations.has(opKey)) {
      throw new ImportError(
        "IMPORT_CONCURRENT_WRITE",
        "匯入批次已由另一個請求建立，請重新整理。",
        409,
      );
    }
    const stored = cloneRecord(record);
    stored.operationKeys.upload = idempotencyKey;
    this.records.set(key, stored);
    this.operations.set(opKey, stored.id);
    return cloneRecord(stored);
  }

  async replaceParsedResult(
    scope: ImportScope,
    id: string,
    expectedVersion: number,
    parsed: ParsedHtmlImport,
    nextStatus: ImportBatchStatus,
    idempotencyKey: string,
  ) {
    const key = recordKey(scope, id);
    const current = this.records.get(key);
    if (!current) {
      throw new ImportError("IMPORT_NOT_FOUND", "找不到匯入批次。", 404);
    }
    const replay = this.operations.get(operationKey(scope, idempotencyKey));
    if (replay) {
      if (replay !== id) {
        throw new ImportError(
          "IDEMPOTENCY_KEY_REUSED",
          "此冪等鍵已用於不同的匯入批次。",
          409,
          "idempotency_key",
        );
      }
      return cloneRecord(current);
    }
    if (current.version !== expectedVersion) {
      throw new ImportError(
        "IMPORT_VERSION_CONFLICT",
        "匯入批次已被更新，請重新整理後再操作。",
        409,
      );
    }

    const next: ImportBatchRecord = {
      ...current,
      version: current.version + 1,
      status: nextStatus,
      mappingVersion: parsed.mappingVersion,
      contentFingerprint: parsed.contentFingerprint,
      sections: parsed.sections,
      fields: parsed.fields,
      warnings: parsed.warnings,
      conflicts: parsed.conflicts,
      security: parsed.security,
      updatedAt: new Date().toISOString(),
      operationKeys: {
        ...current.operationKeys,
        [`reparse:${parsed.mappingVersion}`]: idempotencyKey,
      },
    };
    this.records.set(key, cloneRecord(next));
    this.operations.set(operationKey(scope, idempotencyKey), id);
    return cloneRecord(next);
  }

  async approveAtomically(
    actor: ImportActor,
    id: string,
    expectedVersion: number,
    approval: ImportApproval,
  ) {
    const key = recordKey(actor, id);
    const current = this.records.get(key);
    if (!current) {
      throw new ImportError("IMPORT_NOT_FOUND", "找不到匯入批次。", 404);
    }
    const replay = this.operations.get(
      operationKey(actor, approval.idempotencyKey),
    );
    if (replay) {
      if (replay !== id) {
        throw new ImportError(
          "IDEMPOTENCY_KEY_REUSED",
          "此冪等鍵已用於不同的匯入批次。",
          409,
          "idempotency_key",
        );
      }
      return cloneRecord(current);
    }
    if (current.version !== expectedVersion) {
      throw new ImportError(
        "IMPORT_VERSION_CONFLICT",
        "匯入批次已被更新，請重新整理後再操作。",
        409,
      );
    }
    if (current.status !== "ready_for_approval") {
      throw new ImportError(
        "IMPORT_NOT_READY",
        "匯入批次尚未符合核准條件。",
        409,
      );
    }

    // The demo repository has no production domain tables. This transition
    // emulates the same all-or-nothing boundary required of a production
    // adapter: no partial status or field promotion can be observed.
    const next: ImportBatchRecord = {
      ...current,
      version: current.version + 1,
      status: "imported",
      updatedAt: approval.approvedAt,
      approval,
      operationKeys: {
        ...current.operationKeys,
        approve: approval.idempotencyKey,
      },
    };
    this.records.set(key, cloneRecord(next));
    this.operations.set(operationKey(actor, approval.idempotencyKey), id);
    return cloneRecord(next);
  }

  /** Test-only observability; never exposes stored content. */
  get size() {
    return this.records.size;
  }
}
