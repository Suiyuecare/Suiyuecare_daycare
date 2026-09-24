import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type { ImportBatchStatus } from "@/lib/domain/types";

import { ImportError } from "./errors";
import { parseCentralCareHtml } from "./parser";
import type {
  ApproveImportInput,
  HtmlImportFile,
  ImportActor,
  ImportBatch,
  ImportBatchRecord,
  ImportBatchRepository,
  ImportBatchSummary,
  ImportPreview,
  ImportScope,
  ImportStagingApprovalReceipt,
  ImportUploadReceipt,
  ReparseImportInput,
  SupportedMappingVersion,
} from "./types";
import {
  CURRENT_MAPPING_VERSION,
  SUPPORTED_MAPPING_VERSIONS,
} from "./types";
import { validateHtmlImportFile } from "./validation";

function parsedStatus(
  parsed: ReturnType<typeof parseCentralCareHtml>,
): ImportBatchStatus {
  const hasUnknown =
    parsed.sections.some((section) => !section.recognized) ||
    parsed.fields.some((field) => field.mappingState === "unknown");
  return hasUnknown ? "mapping_required" : "ready_for_approval";
}

function deterministicBatchId(actor: ImportActor, idempotencyKey: string) {
  const bytes = createHash("sha256")
    .update(`${actor.organizationId}\u001f${actor.branchId}\u001f${actor.userId}\u001f${idempotencyKey}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function summarizeImportBatch(
  batch: ImportBatch,
  statusOverride?: ImportBatchStatus,
): ImportBatchSummary {
  return {
    id: batch.id,
    version: batch.version,
    status: statusOverride ?? batch.status,
    fileName: batch.fileName,
    byteLength: batch.byteLength,
    fileSha256: batch.fileSha256,
    contentFingerprint: batch.contentFingerprint,
    mappingVersion: batch.mappingVersion,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    sectionCount: batch.sections.length,
    fieldCount: batch.fields.length,
    warningCount: batch.warnings.length,
    conflictCount: batch.conflicts.length,
    security: batch.security,
  };
}

function maskValue(value: string) {
  return value ? "••••" : "";
}

function assertSupportedMappingVersion(
  value: string,
): asserts value is SupportedMappingVersion {
  if (!(SUPPORTED_MAPPING_VERSIONS as readonly string[]).includes(value)) {
    throw new ImportError(
      "UNSUPPORTED_MAPPING_VERSION",
      "指定的欄位映射版本不存在或尚未發布。",
      422,
      "mapping_version",
    );
  }
}

function assertRecentAal2(actor: ImportActor) {
  const recentAt = actor.recentAal2At
    ? new Date(actor.recentAal2At).getTime()
    : Number.NaN;
  const age = Date.now() - recentAt;
  if (
    actor.assuranceLevel !== "aal2" ||
    !Number.isFinite(age) ||
    age < -60_000 ||
    age > 15 * 60_000
  ) {
    throw new ImportError(
      "RECENT_AAL2_REQUIRED",
      "核准匯入前須在最近 15 分鐘內重新完成多因素驗證。",
      403,
    );
  }
}

export async function uploadHtmlImport(
  repository: ImportBatchRepository,
  actor: ImportActor,
  file: HtmlImportFile,
  idempotencyKey: string,
): Promise<ImportUploadReceipt> {
  if (!idempotencyKey.trim()) {
    throw new ImportError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "上傳匯入檔案必須提供冪等鍵。",
      400,
      "idempotency_key",
    );
  }

  const validated = validateHtmlImportFile(file);
  const replay = await repository.findByOperationKey(actor, idempotencyKey);
  if (replay) {
    if (replay.request.fileSha256 !== validated.sha256 ||
        replay.request.fileName !== validated.fileName || replay.request.mimeType !== validated.mimeType) {
      throw new ImportError(
        "IDEMPOTENCY_KEY_REUSED",
        "同一冪等鍵不可用於不同內容的檔案。",
        409,
        "idempotency_key",
      );
    }
    return {
      status: replay.duplicate ? "duplicate" : replay.batch.status,
      duplicate: replay.duplicate,
      replayed: true,
      batch: summarizeImportBatch(replay.batch, replay.duplicate ? "duplicate" : undefined),
    };
  }

  const exactDuplicate = await repository.findByFileHash(
    actor,
    validated.sha256,
  );
  if (exactDuplicate) {
    const operation = await repository.registerDuplicateUpload(actor, exactDuplicate.id, {
      fileSha256: validated.sha256, fileName: validated.fileName, mimeType: validated.mimeType,
    }, idempotencyKey);
    return {
      status: operation.duplicate ? "duplicate" : operation.batch.status,
      duplicate: operation.duplicate,
      replayed: operation.replayed,
      batch: summarizeImportBatch(operation.batch, operation.duplicate ? "duplicate" : undefined),
    };
  }

  const parsed = parseCentralCareHtml(validated, CURRENT_MAPPING_VERSION);
  const now = new Date().toISOString();
  const record: ImportBatchRecord = {
    id: deterministicBatchId(actor, idempotencyKey),
    organizationId: actor.organizationId,
    branchId: actor.branchId,
    version: 1,
    status: parsedStatus(parsed),
    fileName: validated.fileName,
    mimeType: validated.mimeType,
    charset: validated.charset,
    byteLength: validated.bytes.byteLength,
    fileSha256: validated.sha256,
    contentFingerprint: parsed.contentFingerprint,
    mappingVersion: parsed.mappingVersion,
    createdAt: now,
    createdBy: actor.userId,
    updatedAt: now,
    sections: parsed.sections,
    fields: parsed.fields,
    warnings: parsed.warnings,
    conflicts: parsed.conflicts,
    security: parsed.security,
    approval: null,
    originalBytes: structuredClone(validated.bytes),
    operationKeys: {},
  };
  const created = await repository.create(record, idempotencyKey);
  return {
    status: created.duplicate ? "duplicate" : created.batch.status,
    duplicate: created.duplicate,
    replayed: created.replayed,
    batch: summarizeImportBatch(created.batch, created.duplicate ? "duplicate" : undefined),
  };
}

export async function getImportPreview(
  repository: ImportBatchRepository,
  scope: ImportScope,
  id: string,
): Promise<ImportPreview> {
  const batch = await repository.findById(scope, id);
  if (!batch) {
    throw new ImportError("IMPORT_NOT_FOUND", "找不到匯入批次。", 404);
  }

  const sensitiveConflictIds = new Set(
    batch.fields
      .filter((field) => field.sensitive)
      .map((field) => field.mappingKey),
  );
  return {
    batch: summarizeImportBatch(batch),
    sections: batch.sections,
    fields: batch.fields.map((field) => ({
      id: field.id,
      mappingKey: field.mappingKey,
      mappingState: field.mappingState,
      targetPath: field.targetPath,
      source: field.source,
      displayValue: field.sensitive
        ? maskValue(field.normalizedValue)
        : field.normalizedValue,
      isMasked: field.sensitive,
      warnings: field.warnings,
    })),
    warnings: batch.warnings,
    conflicts: batch.conflicts.map((conflict) => ({
      ...conflict,
      candidates: conflict.candidates.map((candidate) => ({
        ...candidate,
        value: sensitiveConflictIds.has(conflict.mappingKey)
          ? maskValue(candidate.value)
          : candidate.value,
      })),
    })),
  };
}

export async function reparseHtmlImport(
  repository: ImportBatchRepository,
  actor: ImportActor,
  id: string,
  input: ReparseImportInput,
) {
  assertSupportedMappingVersion(input.mappingVersion);
  if (!input.idempotencyKey.trim()) {
    throw new ImportError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "重新解析必須提供冪等鍵。",
      400,
      "idempotency_key",
    );
  }

  const batch = await repository.findById(actor, id);
  if (!batch) {
    throw new ImportError("IMPORT_NOT_FOUND", "找不到匯入批次。", 404);
  }
  const originalBytes = await repository.readOriginal(actor, id);
  const validated = validateHtmlImportFile({
    fileName: batch.fileName,
    mimeType: batch.mimeType,
    bytes: originalBytes,
  });
  if (validated.sha256 !== batch.fileSha256) {
    throw new ImportError(
      "ORIGINAL_INTEGRITY_FAILURE",
      "原始 HTML 完整性驗證失敗，系統已停止重新解析。",
      409,
    );
  }
  const parsed = parseCentralCareHtml(validated, input.mappingVersion);
  const replay = await repository.findReparseOperation(actor, id, parsed, parsedStatus(parsed), input.idempotencyKey);
  if (replay) return summarizeImportBatch(replay);
  if (batch.approval || ["imported", "superseded"].includes(batch.status)) {
    throw new ImportError("IMMUTABLE_IMPORT", "已核准或已被取代的匯入不可重新解析，請建立新批次。", 409);
  }
  const updated = await repository.replaceParsedResult(
    actor,
    id,
    batch.version,
    parsed,
    parsedStatus(parsed),
    input.idempotencyKey,
  );
  return summarizeImportBatch(updated);
}

export async function approveHtmlImport(
  repository: ImportBatchRepository,
  actor: ImportActor,
  id: string,
  input: ApproveImportInput,
): Promise<ImportStagingApprovalReceipt> {
  assertRecentAal2(actor);
  if (!input.idempotencyKey.trim()) {
    throw new ImportError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "核准匯入必須提供冪等鍵。",
      400,
      "idempotency_key",
    );
  }

  const batch = await repository.findById(actor, id);
  if (!batch) {
    throw new ImportError("IMPORT_NOT_FOUND", "找不到匯入批次。", 404);
  }
  if (batch.status !== "ready_for_approval") {
    throw new ImportError(
      "IMPORT_NOT_READY",
      "請先完成未知欄位映射與驗證，再核准匯入。",
      409,
    );
  }

  // Decisions must describe this exact snapshot; silently ignoring unknown
  // entries would lose reviewer intent and weaken idempotent payload binding.
  if (Object.keys(input.conflictResolutions).some((key) =>
    !batch.conflicts.some((conflict) => conflict.id === key))) {
    throw new ImportError("UNKNOWN_CONFLICT_RESOLUTION", "核對項目已變更，請重新載入後再選擇。", 422);
  }
  if (batch.fields.length === 0 || batch.fields.some((field) => field.mappingState === "unknown") ||
      batch.sections.some((section) => !section.recognized) ||
      batch.warnings.some((warning) => warning.severity === "error")) {
    throw new ImportError("IMPORT_NOT_READY", "尚有未完成的來源核對或解析錯誤，無法核准暫存。", 409);
  }

  for (const conflict of batch.conflicts) {
    const selectedFieldId = input.conflictResolutions[conflict.id];
    if (!conflict.candidates.some((candidate) => candidate.fieldId === selectedFieldId)) {
      throw new ImportError(
        "CONFLICT_RESOLUTION_REQUIRED",
        "每一個欄位衝突都必須明確選擇來源值。",
        422,
        `conflict_resolutions.${conflict.id}`,
      );
    }
  }

  const approvedAt = new Date().toISOString();
  const approved = await repository.approveAtomically(
    actor,
    id,
    batch.version,
    {
      approvedAt,
      approvedBy: actor.userId,
      idempotencyKey: input.idempotencyKey,
      conflictResolutions: input.conflictResolutions,
    },
  );
  const receiptTime = Date.parse(approved?.approval?.approvedAt ?? "");
  const expectedVersion = batch.approval ? batch.version : batch.version + 1;
  const decisions = (value: Record<string, string>) => Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  // Approval may only add its receipt/version; source data and scope must not change.
  const basis = (value: ImportBatchRecord) => ({ ...value, version: 0, updatedAt: "", approval: null, operationKeys: {} });
  if (!approved?.approval || approved.status !== "ready_for_approval" ||
      approved.id !== id || approved.organizationId !== actor.organizationId || approved.branchId !== actor.branchId ||
      approved.version !== expectedVersion || approved.updatedAt !== approved.approval.approvedAt ||
      !Number.isFinite(receiptTime) || receiptTime < Date.parse(batch.createdAt) || receiptTime > Date.now() + 60_000 ||
      (batch.approval !== null && approved.approval.approvedAt !== batch.approval.approvedAt) ||
      approved.approval.approvedBy !== actor.userId ||
      approved.approval.idempotencyKey !== input.idempotencyKey ||
      !isDeepStrictEqual(decisions(approved.approval.conflictResolutions), decisions(input.conflictResolutions)) ||
      !isDeepStrictEqual(approved.operationKeys, { ...batch.operationKeys, approve: input.idempotencyKey }) ||
      !isDeepStrictEqual(basis(approved), basis(batch))) {
    throw new ImportError("INVALID_STAGING_RECEIPT", "暫存核准結果無法確認，請勿視為正式入檔。", 503);
  }
  return { batch: summarizeImportBatch(approved), staging_only: true, formally_imported: false };
}

export { CURRENT_MAPPING_VERSION };
