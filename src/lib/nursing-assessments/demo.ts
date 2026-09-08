import type { NursingAssessmentSnapshot, NursingContent, NursingVersion } from "./types";

export function blankNursingContent(): NursingContent {
  const missing = { state: "missing" as const, detail: null, reason: "尚未取得，待護理人員補充。" };
  return { formVersionReference: "manual-nursing-v1", assessedOn: new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()), domains: { observations: { ...missing }, problems: { ...missing },
    measures: { ...missing }, response: { ...missing } },
  reassessment: { state: "missing", dueOn: null, reason: "尚未排定，待護理人員確認。" } };
}
export function buildDemoNursingAssessmentSnapshot(organizationId: string, branchId: string): NursingAssessmentSnapshot {
  const now = new Date();
  const content = blankNursingContent();
  content.domains.observations = { state: "recorded", detail: "合成示例：到班後主動表達需求，活動時由工作人員陪同。", reason: null };
  content.domains.problems = { state: "recorded", detail: "合成示例：活動後休息需求仍需觀察。", reason: null };
  content.domains.measures = { state: "recorded", detail: "合成示例：提供休息並記錄本人回應。", reason: null };
  const version: NursingVersion = { versionId: "51000000-0000-4000-8000-000000000011", assessmentKey: "51000000-0000-4000-8000-000000000012",
    version: 1, previousVersionId: null, state: "draft", content, contentHash: "a".repeat(64), previousContentHash: null,
    recordedBy: "51000000-0000-4000-8000-000000000013", recorderDisplayName: "合成護理人員", correctionReason: null,
    signedAt: null, signedBy: null, signerDisplayName: null, signaturePurpose: null, signatureChallengeId: null, createdAt: now.toISOString() };
  return { organizationId, branchId, generatedAt: now.toISOString(), staleAfter: new Date(now.getTime() + 300000).toISOString(),
    clients: [{ clientId: "51000000-0000-4000-8000-000000000001", displayName: "合成個案甲", serviceStatus: "active", versions: [version], versionsTotal: 1, versionsTruncated: false },
      { clientId: "51000000-0000-4000-8000-000000000002", displayName: "合成個案乙", serviceStatus: "active", versions: [], versionsTotal: 0, versionsTruncated: false }],
    clientTotal: 2, clientsTruncated: false, officialScoreStatus: "not_configured", attachmentStatus: "not_configured",
    exportStatus: "not_configured", notificationStatus: "not_configured", offlineStatus: "not_configured", demo: true };
}
