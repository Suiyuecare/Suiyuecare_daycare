import { emptyDataInventoryContent, type DataInventoryContent, type DataInventoryMutation,
  type DataInventorySnapshot, type DataInventoryVersion } from "@/lib/data-inventory/types";
import type { InventoryOperation } from "./data-inventory-request";

// Developer-authored synthetic metadata only; never copied from source HTML.
export const inventoryIds = {
  organizationId: "83000000-0000-4000-8000-000000000001", branchId: "83000000-0000-4000-8000-000000000002",
  actorUserId: "83000000-0000-4000-8000-000000000003", recorder: "83000000-0000-4000-8000-000000000004",
  versionId: "83000000-0000-4000-8000-000000000005", objectId: "83000000-0000-4000-8000-000000000006",
  operationId: "83000000-0000-4000-8000-000000000007", key: "83000000-0000-4000-8000-000000000008",
  challenge: "83000000-0000-4000-8000-000000000009", evidence: "83000000-0000-4000-8000-000000000010",
};
export function completeInventoryContent(): DataInventoryContent {
  return { ...emptyDataInventoryContent(), status: "received", source: "previous_system", accountableRole: "branch_supervisor",
    periodStart: "2026-08-01", periodEnd: "2026-08-31", expectedCount: 3, actualCount: 3,
    missingRequired: 0, unmapped: 0, conflicts: 0, criticalDifferences: 0,
    keyFields: "passed", amounts: "passed", attachments: "passed", evidenceReference: inventoryIds.evidence };
}
export function inventoryTestVersion(overrides: Partial<DataInventoryVersion> = {}): DataInventoryVersion {
  return { versionId: inventoryIds.versionId, objectId: inventoryIds.objectId, itemKey: "client_master", version: 1,
    previousVersionId: null, content: completeInventoryContent(), contentHash: "a".repeat(64),
    recordedBy: inventoryIds.recorder, contentRecordedBy: inventoryIds.recorder, createdAt: new Date().toISOString(),
    reviewState: "pending", reviewedBy: null, reviewedAt: null, reviewChallengeId: null, ...overrides };
}
export function inventoryTestSnapshot(version?: DataInventoryVersion): DataInventorySnapshot {
  return { organizationId: inventoryIds.organizationId, branchId: inventoryIds.branchId,
    generatedAt: new Date().toISOString(), staleAfter: new Date(Date.now() + 300_000).toISOString(),
    records: version ? [{ itemKey: version.itemKey, current: version, history: [version], historyTotal: 1, historyTruncated: false }] : [],
    demo: false, verificationKind: "manual_metadata_only", formalPromotionStatus: "not_configured" };
}
export function inventoryTestOperation(request?: DataInventoryMutation): InventoryOperation {
  return { organizationId: inventoryIds.organizationId, branchId: inventoryIds.branchId, actorUserId: inventoryIds.actorUserId,
    idempotencyKey: inventoryIds.key,
    request: request ?? { action: "save", itemKey: "client_master", expectedVersion: 0, content: emptyDataInventoryContent() } };
}
export function inventoryReceiptEnvelope(operation: InventoryOperation) {
  const isVerify = operation.request.action === "verify";
  const at = new Date().toISOString();
  const result = inventoryTestVersion({ itemKey: operation.request.itemKey, version: operation.request.expectedVersion + 1,
    previousVersionId: operation.request.expectedVersion === 0 ? null : inventoryIds.versionId,
    versionId: "83000000-0000-4000-8000-000000000020", recordedBy: operation.actorUserId,
    contentRecordedBy: isVerify ? inventoryIds.recorder : operation.actorUserId, createdAt: at,
    content: operation.request.action === "save" ? operation.request.content : completeInventoryContent(),
    contentHash: "a".repeat(64), reviewState: isVerify ? "manually_verified" : "pending",
    reviewedBy: isVerify ? operation.actorUserId : null, reviewedAt: isVerify ? at : null,
    reviewChallengeId: isVerify ? inventoryIds.challenge : null });
  return { requestId: inventoryIds.operationId, status: "ok", errors: [], data: {
    operationId: inventoryIds.operationId, ...operation, result, replayed: false,
  } };
}
