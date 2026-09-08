export const ABCD_ASSESSMENT_TYPES = ["A", "B", "C", "D"] as const;
export const ABCD_ASSESSMENT_STATES = ["draft", "signed", "corrected"] as const;
export const ABCD_VALUE_STATES = ["recorded", "missing", "not_applicable"] as const;

export type AbcdAssessmentType = (typeof ABCD_ASSESSMENT_TYPES)[number];
export type AbcdAssessmentState = (typeof ABCD_ASSESSMENT_STATES)[number];
export type AbcdValueState = (typeof ABCD_VALUE_STATES)[number];

export type AbcdResult = {
  state: AbcdValueState;
  text: string | null;
  reason: string | null;
};

export type AbcdReassessment = {
  state: AbcdValueState;
  date: string | null;
  basis: string;
};

export type AbcdAssessmentFilters = {
  clientId: string | null;
  assessmentYear: number | null;
  assessmentType: AbcdAssessmentType | "all";
  reassessmentState: AbcdValueState | "all";
  status: AbcdAssessmentState | "all";
  query: string | null;
};

export type AbcdClientOption = { clientId: string; displayName: string };

export type AbcdAssessmentVersion = {
  versionId: string;
  assessmentKey: string;
  version: number;
  previousVersionId: string | null;
  contentHash: string;
  assessmentState: AbcdAssessmentState;
  clientId: string;
  clientDisplayName: string;
  assessmentType: AbcdAssessmentType;
  assessmentYear: number;
  assessmentDate: string;
  manualSummary: string;
  result: AbcdResult;
  reassessment: AbcdReassessment;
  authorUserId: string;
  authorDisplayName: string;
  revisionReason: string | null;
  correctionReason: string | null;
  signedAt: string | null;
  signedByUserId: string | null;
  signerDisplayName: string | null;
  signerRoleKeys: readonly string[] | null;
  signaturePurpose: string | null;
  signatureReauthChallengeId: string | null;
  formKind: "manual_unstandardized";
  formalRuleStatus: "not_configured";
  createdAt: string;
};

export type AbcdAssessment = AbcdAssessmentVersion & {
  history: readonly AbcdAssessmentVersion[];
  historyTotal: number;
  historyTruncated: boolean;
};

export type AbcdAssessmentSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  filters: AbcdAssessmentFilters;
  assessments: readonly AbcdAssessment[];
  matchingTotal: number;
  assessmentsTruncated: boolean;
  metrics: {
    assessmentTotal: number;
    aTotal: number;
    bTotal: number;
    cTotal: number;
    dTotal: number;
    reassessmentMissingTotal: number;
    draftTotal: number;
    signedTotal: number;
  };
  clients: readonly AbcdClientOption[];
  clientTotal: number;
  clientsTruncated: boolean;
  years: readonly number[];
  yearTotal: number;
  yearsTruncated: boolean;
  formKind: "manual_unstandardized";
  formalRuleStatus: "not_configured";
  attachmentStatus: "not_configured";
  notificationStatus: "not_configured";
  exportStatus: "not_configured";
  offlineStatus: "not_configured";
  demo: boolean;
};

export type AbcdAssessmentFields = {
  clientId: string;
  assessmentType: AbcdAssessmentType;
  assessmentYear: number;
  assessmentDate: string;
  manualSummary: string;
  result: AbcdResult;
  reassessment: AbcdReassessment;
};

export type SaveAbcdAssessmentInput = AbcdAssessmentFields & {
  action: "save_assessment";
  mode: "create" | "revise";
  assessmentKey: string | null;
  previousVersionId: string | null;
  expectedVersion: number;
  expectedContentHash: string | null;
  revisionReason: string;
  idempotencyKey: string;
};

export type SignAbcdAssessmentInput = {
  action: "sign_assessment";
  clientId: string;
  assessmentKey: string;
  assessmentType: AbcdAssessmentType;
  assessmentYear: number;
  previousVersionId: string;
  expectedVersion: number;
  expectedContentHash: string;
  idempotencyKey: string;
};

export type CorrectAbcdAssessmentInput = AbcdAssessmentFields & {
  action: "correct_assessment";
  assessmentKey: string;
  previousVersionId: string;
  expectedVersion: number;
  expectedContentHash: string;
  reason: string;
  idempotencyKey: string;
};

export type AbcdAssessmentMutationInput =
  | SaveAbcdAssessmentInput
  | SignAbcdAssessmentInput
  | CorrectAbcdAssessmentInput;

export type AbcdAssessmentReceipt = {
  organizationId: string;
  branchId: string;
  clientId: string;
  operationId: string;
  idempotencyKey: string;
  action: AbcdAssessmentMutationInput["action"];
  assessmentKey: string;
  versionId: string;
  version: number;
  assessmentState: AbcdAssessmentState;
  assessmentType: AbcdAssessmentType;
  assessmentYear: number;
  previousVersionId: string | null;
  sourceContentHash: string | null;
  contentHash: string;
  recordPayload: AbcdAssessmentFields & {
    formKind: "manual_unstandardized";
    formalRuleStatus: "not_configured";
  };
  committedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
