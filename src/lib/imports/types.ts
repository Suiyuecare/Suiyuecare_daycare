import type {
  AssuranceLevel,
  ImportBatchStatus,
} from "@/lib/domain/types";

export const MAX_HTML_IMPORT_BYTES = 25 * 1024 * 1024;
export const CURRENT_MAPPING_VERSION = "central-care-plan-html@1";
export const SUPPORTED_MAPPING_VERSIONS = [CURRENT_MAPPING_VERSION] as const;

export type SupportedMappingVersion =
  (typeof SUPPORTED_MAPPING_VERSIONS)[number];

export type ImportWarningSeverity = "info" | "warning" | "error";
export type FieldMappingState = "mapped" | "unknown" | "conflict";

export interface ImportScope {
  organizationId: string;
  branchId: string;
}

export interface ImportActor extends ImportScope {
  userId: string;
  assuranceLevel: AssuranceLevel;
  recentAal2At: string | null;
}

export interface HtmlImportFile {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface ValidatedHtmlImport extends HtmlImportFile {
  charset: "utf-8";
  text: string;
  sha256: string;
}

export interface ImportSecurityReport {
  parser: "cheerio-static";
  scriptElementsBlocked: number;
  formElementsNeutralized: number;
  redirectElementsBlocked: number;
  activeElementsBlocked: number;
  inlineEventHandlersBlocked: number;
  externalReferencesBlocked: number;
  externalRequestCount: 0;
}

export interface ImportSection {
  id: string;
  index: number;
  code: string;
  title: string;
  sourceHeadingId: string | null;
  recognized: boolean;
}

export interface ImportFieldSource {
  sectionCode: string;
  sectionTitle: string;
  label: string;
  parentPath: string;
  controlName: string | null;
}

export interface ImportStagingField {
  id: string;
  mappingKey: string;
  mappingVersion: string;
  mappingState: FieldMappingState;
  targetPath: string | null;
  source: ImportFieldSource;
  rawValue: string;
  normalizedValue: string;
  sensitive: boolean;
  warnings: string[];
}

export interface ImportWarning {
  id: string;
  code: string;
  severity: ImportWarningSeverity;
  message: string;
  sectionCode?: string;
  fieldId?: string;
}

export interface ImportConflict {
  id: string;
  mappingKey: string;
  sectionCode: string;
  label: string;
  candidates: Array<{
    fieldId: string;
    value: string;
  }>;
  reason: "multiple_source_values" | "existing_value_differs";
}

export interface ParsedHtmlImport {
  mappingVersion: SupportedMappingVersion;
  sections: ImportSection[];
  fields: ImportStagingField[];
  warnings: ImportWarning[];
  conflicts: ImportConflict[];
  contentFingerprint: string;
  security: ImportSecurityReport;
}

export interface ImportApproval {
  approvedAt: string;
  approvedBy: string;
  idempotencyKey: string;
  conflictResolutions: Record<string, string>;
}

export interface ImportBatch extends ImportScope {
  id: string;
  version: number;
  status: ImportBatchStatus;
  fileName: string;
  mimeType: string;
  charset: "utf-8";
  byteLength: number;
  fileSha256: string;
  contentFingerprint: string;
  mappingVersion: SupportedMappingVersion;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  sections: ImportSection[];
  fields: ImportStagingField[];
  warnings: ImportWarning[];
  conflicts: ImportConflict[];
  security: ImportSecurityReport;
  approval: ImportApproval | null;
}

export interface ImportBatchRecord extends ImportBatch {
  /**
   * Only the demo repository may keep bytes in process memory. A production
   * adapter must archive these bytes encrypted in immutable object storage and
   * persist only its opaque reference here.
   */
  originalBytes?: Uint8Array;
  originalObjectReference?: string;
  operationKeys: Record<string, string>;
}

export interface ImportBatchSummary {
  id: string;
  version: number;
  status: ImportBatchStatus;
  fileName: string;
  byteLength: number;
  fileSha256: string;
  contentFingerprint: string;
  mappingVersion: string;
  createdAt: string;
  updatedAt: string;
  sectionCount: number;
  fieldCount: number;
  warningCount: number;
  conflictCount: number;
  security: ImportSecurityReport;
}

export interface ImportPreviewField {
  id: string;
  mappingKey: string;
  mappingState: FieldMappingState;
  targetPath: string | null;
  source: ImportFieldSource;
  displayValue: string;
  isMasked: boolean;
  warnings: string[];
}

export interface ImportPreview {
  batch: ImportBatchSummary;
  sections: ImportSection[];
  fields: ImportPreviewField[];
  warnings: ImportWarning[];
  conflicts: ImportConflict[];
}

export interface ImportUploadReceipt {
  status: ImportBatchStatus;
  duplicate: boolean;
  replayed: boolean;
  batch: ImportBatchSummary;
}

export interface ImportUploadRequestIdentity {
  fileSha256: string;
  fileName: string;
  mimeType: string;
}

/** The requested filename can differ from the original batch for duplicate bytes. */
export interface ImportUploadOperation {
  batch: ImportBatchRecord;
  request: ImportUploadRequestIdentity;
  duplicate: boolean;
  replayed: boolean;
}

export interface ReparseImportInput {
  mappingVersion: SupportedMappingVersion;
  idempotencyKey: string;
}

export interface ApproveImportInput {
  idempotencyKey: string;
  conflictResolutions: Record<string, string>;
}

/** A staging decision is not a write to any client or care-plan table. */
export interface ImportStagingApprovalReceipt {
  batch: ImportBatchSummary;
  staging_only: true;
  formally_imported: false;
}

export interface ImportBatchRepository {
  findById(scope: ImportScope, id: string): Promise<ImportBatchRecord | null>;
  findByFileHash(
    scope: ImportScope,
    sha256: string,
  ): Promise<ImportBatchRecord | null>;
  findByOperationKey(
    actor: ImportActor,
    idempotencyKey: string,
  ): Promise<ImportUploadOperation | null>;
  registerDuplicateUpload(
    actor: ImportActor,
    id: string,
    request: ImportUploadRequestIdentity,
    idempotencyKey: string,
  ): Promise<ImportUploadOperation>;
  readOriginal(scope: ImportScope, id: string): Promise<Uint8Array>;
  create(
    record: ImportBatchRecord,
    idempotencyKey: string,
  ): Promise<ImportUploadOperation>;
  findReparseOperation(
    actor: ImportActor,
    id: string,
    parsed: ParsedHtmlImport,
    nextStatus: ImportBatchStatus,
    idempotencyKey: string,
  ): Promise<ImportBatchRecord | null>;
  replaceParsedResult(
    actor: ImportActor,
    id: string,
    expectedVersion: number,
    parsed: ParsedHtmlImport,
    nextStatus: ImportBatchStatus,
    idempotencyKey: string,
  ): Promise<ImportBatchRecord>;
  approveAtomically(
    actor: ImportActor,
    id: string,
    expectedVersion: number,
    approval: ImportApproval,
  ): Promise<ImportBatchRecord>;
}

/**
 * Required production boundary. An adapter must implement tenant-scoped
 * reads, optimistic concurrency, a single transaction for staging approval,
 * and encrypted WORM archiving before `create` succeeds.
 * approveAtomically never promotes data into client or care-plan tables.
 */
export interface ProductionImportStorage extends ImportBatchRepository {
  readonly kind: "production";
}
