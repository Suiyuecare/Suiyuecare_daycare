export const NURSING_FORM_VERSION = "manual-nursing-v1" as const;
export const NURSING_DOMAIN_LABELS = {
  observations: "護理觀察",
  problems: "護理問題",
  measures: "護理措施",
  response: "處置後反應與追蹤",
} as const;
export type NursingDomainKey = keyof typeof NURSING_DOMAIN_LABELS;
export type NursingField = {
  state: "recorded" | "missing" | "not_applicable";
  detail: string | null;
  reason: string | null;
};
export type NursingContent = {
  formVersionReference: typeof NURSING_FORM_VERSION;
  assessedOn: string;
  domains: Record<NursingDomainKey, NursingField>;
  reassessment: {
    state: "recorded" | "missing" | "not_applicable";
    dueOn: string | null;
    reason: string;
  };
};
type Existing = {
  clientId: string;
  assessmentKey: string;
  previousVersionId: string;
  expectedVersion: number;
  expectedContentHash: string;
};
export type NursingRequest =
  | { action: "create_draft"; clientId: string; content: NursingContent }
  | (Existing & { action: "revise_draft"; content: NursingContent })
  | (Existing & { action: "sign" })
  | (Existing & { action: "correct"; content: NursingContent; correctionReason: string });
export type NursingVersion = {
  versionId: string;
  assessmentKey: string;
  version: number;
  previousVersionId: string | null;
  state: "draft" | "signed" | "corrected";
  content: NursingContent;
  contentHash: string;
  previousContentHash: string | null;
  recordedBy: string;
  recorderDisplayName: string;
  correctionReason: string | null;
  signedAt: string | null;
  signedBy: string | null;
  signerDisplayName: string | null;
  signaturePurpose: string | null;
  signatureChallengeId: string | null;
  createdAt: string;
};
export type NursingReceipt = {
  operationId: string;
  organizationId: string;
  branchId: string;
  actorUserId: string;
  idempotencyKey: string;
  request: NursingRequest;
  result: NursingVersion;
  replayed: boolean;
  persisted: true;
  demo: false;
};
export type NursingAssessmentSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  clients: {
    clientId: string;
    displayName: string;
    serviceStatus: "active" | "suspended" | "transferred" | "closed" | "deceased";
    versions: NursingVersion[];
    versionsTotal: number;
    versionsTruncated: boolean;
  }[];
  clientTotal: number;
  clientsTruncated: boolean;
  officialScoreStatus: "not_configured";
  attachmentStatus: "not_configured";
  exportStatus: "not_configured";
  notificationStatus: "not_configured";
  offlineStatus: "not_configured";
  demo: boolean;
};
