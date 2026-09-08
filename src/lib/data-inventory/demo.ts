import { emptyDataInventoryContent, type DataInventorySnapshot, type DataInventoryVersion } from "./types";
/** Fixed authored metadata, never obtained from files, local storage or an external service. */
export function buildDemoDataInventorySnapshot(organizationId: string, branchId: string): DataInventorySnapshot {
  const generatedAt = "2026-09-08T12:00:00+08:00";
  const current: DataInventoryVersion = {
    versionId: "83000000-0000-4000-8000-000000000001", objectId: "83000000-0000-4000-8000-000000000002", itemKey: "client_master", version: 1,
    previousVersionId: null, content: { ...emptyDataInventoryContent(), status: "received", source: "central_html", accountableRole: "case_manager_social_worker",
      periodStart: "2026-09-01", periodEnd: "2026-09-08", expectedCount: 3, actualCount: 2, missingRequired: 1, unmapped: 2, conflicts: 0, criticalDifferences: 0,
      evidenceReference: "83000000-0000-4000-8000-000000000003" }, contentHash: "a".repeat(64),
    recordedBy: "83000000-0000-4000-8000-000000000004", contentRecordedBy: "83000000-0000-4000-8000-000000000004", createdAt: generatedAt,
    reviewState: "pending", reviewedBy: null, reviewedAt: null, reviewChallengeId: null,
  };
  return { organizationId, branchId, generatedAt, staleAfter: "2026-09-08T12:05:00+08:00", records: [{ itemKey: current.itemKey, current, history: [current], historyTotal: 1, historyTruncated: false }],
    demo: true, verificationKind: "manual_metadata_only", formalPromotionStatus: "not_configured" };
}
