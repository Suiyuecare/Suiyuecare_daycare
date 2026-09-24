export const FORM_VERSION_STATUSES = ["draft", "published", "retired"] as const;
export type FormVersionStatus = (typeof FORM_VERSION_STATUSES)[number];

export type FormPublicationStatus = "pending" | "approved" | "withdrawn" | "returned";
export type FormGovernanceScopeFilter = "all" | "tenant" | "official";
export type FormGovernanceStatusFilter =
  | "all"
  | FormVersionStatus
  | "pending";

export type FormGovernanceFilters = {
  query: string;
  status: FormGovernanceStatusFilter;
  scope: FormGovernanceScopeFilter;
  category: string;
};

export type FormPublicationEvidence = {
  id: string;
  status: FormPublicationStatus;
  requestedAt: string;
  requesterLabel: string;
  requestedByCurrentUser: boolean;
  approvedAt: string | null;
  approverLabel: string | null;
  approvedByCurrentUser: boolean;
  branchName?: string;
  baseRevision?: number;
  previousRequestId?: string | null;
  decisionReason?: string | null;
  decidedAt?: string | null;
  decidedByCurrentUser?: boolean;
};

export type FormGovernanceVersion = {
  id: string;
  definitionId: string;
  formKey: string;
  name: string;
  category: string;
  official: boolean;
  version: number;
  status: FormVersionStatus;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  schemaFieldCount: number;
  scoringRuleCount: number;
  publishedAt: string | null;
  contentHash: string | null;
  publication: FormPublicationEvidence | null;
  draftRevision?: number;
  customBuilderEligible?: boolean;
};

export type FormGovernanceMetrics = {
  active: number;
  drafts: number;
  pending: number;
  upcoming: number;
  overlapWarnings: number;
};

export type FormGovernanceSnapshot = {
  generatedAt: string;
  today: string;
  metrics: FormGovernanceMetrics;
  versions: FormGovernanceVersion[];
  definitionLoaded: number;
  versionLoaded: number;
  publicationLoaded: number;
  definitionTotal: number;
  versionTotal: number;
  publicationTotal: number;
  pendingTotal: number;
  definitionsTruncated: boolean;
  versionsTruncated: boolean;
  publicationsTruncated: boolean;
  incomplete: boolean;
  demo: boolean;
};

export type FormPublicationRequestInput = {
  formVersionId: string;
  idempotencyKey: string;
};

export type FormPublicationApprovalInput = {
  requestId: string;
  idempotencyKey: string;
};

export type FormPublicationRequestResult = {
  requestId: string;
  status: FormPublicationStatus;
  formContentHash: string;
  replayed: boolean;
};

export type FormPublicationApprovalResult = {
  requestId: string;
  formVersionId: string;
  status: "approved";
  publishedAt: string;
  replayed: boolean;
};
