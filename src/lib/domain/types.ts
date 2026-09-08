export type AssuranceLevel = "aal1" | "aal2";

export type RoleKey =
  | "platform_ops"
  | "organization_manager"
  | "branch_supervisor"
  | "case_manager_social_worker"
  | "nurse"
  | "care_worker"
  | "professional"
  | "transport_driver"
  | "finance_claims"
  | "family";

export interface TenantContext {
  organizationId: string;
  organizationName: string;
  branchId: string;
  branchName: string;
  userId: string;
  displayName: string;
  roles: RoleKey[];
  scopes: string[];
  assuranceLevel: AssuranceLevel;
  recentAal2At: string | null;
  demo: boolean;
}

export type RecordState =
  | "draft"
  | "submitted"
  | "signed"
  | "corrected"
  | "voided";

export interface SignedRecord {
  id: string;
  version: number;
  status: RecordState;
  effectiveAt: string;
  signedAt: string | null;
  signedBy: string | null;
  signedRole: RoleKey | null;
  contentHash: string;
  correctionOf: string | null;
}

export type FieldAuthority = "central" | "local" | "manual_review";

export interface SourceProvenance {
  sourceSystem: "central_html" | "local" | "migration" | "integration";
  sourceRecordId: string | null;
  importBatchId: string | null;
  authority: FieldAuthority;
  capturedAt: string;
}

export type ImportBatchStatus =
  | "queued"
  | "parsed"
  | "mapping_required"
  | "validation_failed"
  | "ready_for_approval"
  | "imported"
  | "duplicate"
  | "superseded";

export type DeliveryStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "confirmed"
  | "failed"
  | "suppressed";

export type ClaimStatus =
  | "draft"
  | "validated"
  | "exported"
  | "submitted"
  | "accepted"
  | "rejected"
  | "reconciled"
  | "voided";

export interface SyncOperation<TPayload = unknown> {
  idempotencyKey: string;
  entityType: string;
  entityId: string;
  baseVersion: number;
  occurredAt: string;
  deviceId: string;
  payloadHash: string;
  payload: TPayload;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export interface ApiEnvelope<T> {
  requestId: string;
  status: "ok" | "error" | "partial";
  data: T | null;
  errors: ApiErrorDetail[];
}
