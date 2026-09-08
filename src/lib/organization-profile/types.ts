export const ORGANIZATION_PROFILE_STATUS_FILTERS = [
  "all", "pending", "approved", "rejected",
] as const;
export type OrganizationProfileStatusFilter =
  (typeof ORGANIZATION_PROFILE_STATUS_FILTERS)[number];

export type OrganizationProfileFilters = {
  status: OrganizationProfileStatusFilter;
  effectiveOn: string | null;
  query: string;
};

export type OrganizationProfileServiceItem = {
  serviceKey: string;
  name: string;
  description: string | null;
  taxonomyStatus: "manual_unstandardized";
};

export type OrganizationProfileRateItem = {
  rateKey: string;
  label: string;
  amountDecimalText: string;
  currencyCode: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  taxonomyStatus: "manual_unstandardized";
};

export type OrganizationProfileContent = {
  effectiveFrom: string;
  effectiveTo: string | null;
  permitNumber: string;
  permitIssuingAuthority: string;
  permitIssuedOn: string;
  permitValidThrough: string | null;
  permitStatusText: string;
  organizationTypeText: string;
  serviceItems: readonly OrganizationProfileServiceItem[];
  rateItems: readonly OrganizationProfileRateItem[];
  approvedCapacity: number;
  capacityUnitText: string;
  capacityBasisText: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  contactAddress: string;
  changeReason: string;
  taxonomyStatus: "manual_unstandardized";
  attachmentPipelineStatus: "not_configured";
  contentHash: string;
};

export type OrganizationProfileVersion = OrganizationProfileContent & {
  versionId: string;
  profileKey: string;
  version: number;
  previousVersionId: string | null;
  sourceProposalId: string;
  approvedBy: string;
  approvedByDisplayName: string;
  approvedAt: string;
};

export type OrganizationProfileHistory = Pick<OrganizationProfileVersion,
  "versionId" | "profileKey" | "version" | "previousVersionId" |
  "sourceProposalId" | "effectiveFrom" | "effectiveTo" | "contentHash" |
  "approvedByDisplayName" | "approvedAt" | "changeReason">;

export type OrganizationProfileProposal = OrganizationProfileContent & {
  proposalId: string;
  proposalKey: string;
  proposalNumber: number;
  action: "create" | "correct";
  profileKey: string;
  baseVersionId: string | null;
  expectedBaseVersion: number;
  proposedBy: string;
  proposedByDisplayName: string;
  proposedAt: string;
  status: "pending" | "approved" | "rejected";
  decisionId: string | null;
  decision: "approve" | "reject" | null;
  decisionReason: string | null;
  decidedBy: string | null;
  decidedByDisplayName: string | null;
  decidedAt: string | null;
  resultVersionId: string | null;
};

export type OrganizationProfileSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  snapshotDate: string;
  staleAfter: string;
  filters: OrganizationProfileFilters;
  versions: readonly OrganizationProfileVersion[];
  visibleVersions: readonly OrganizationProfileVersion[];
  versionTotal: number;
  versionsTruncated: boolean;
  history: readonly OrganizationProfileHistory[];
  historyTotal: number;
  historyTruncated: boolean;
  proposals: readonly OrganizationProfileProposal[];
  visibleProposals: readonly OrganizationProfileProposal[];
  proposalTotal: number;
  proposalsTruncated: boolean;
  activeVersionTotal: number;
  pendingProposalTotal: number;
  expiredPermitTotal: number;
  activeCapacity: number | null;
  officialTaxonomyStatus: "not_configured";
  manualTaxonomyStatus: "manual_unstandardized";
  permitExpiryReminderStatus: "not_configured";
  attachmentPipelineStatus: "not_configured";
  exportStatus: "disabled";
  regulatorSyncStatus: "disabled";
  offlineStatus: "disabled";
  recentAal2MaxAgeMinutes: 15;
  demo: boolean;
};

export type OrganizationProfileProposalInput = {
  action: "propose";
  proposalAction: "create" | "correct";
  proposalKey: string;
  profileKey: string;
  baseVersionId: string | null;
  expectedBaseVersion: number;
  content: Omit<OrganizationProfileContent,
    "taxonomyStatus" | "attachmentPipelineStatus" | "contentHash">;
  idempotencyKey: string;
};

export type OrganizationProfileDecisionInput = {
  action: "decide";
  proposalId: string;
  expectedProposalNumber: number;
  expectedBaseVersion: number;
  expectedProfileKey: string;
  expectedContentHash: string;
  expectedEffectiveFrom: string;
  expectedEffectiveTo: string | null;
  decision: "approve" | "reject";
  decisionReason: string;
  idempotencyKey: string;
};

export type OrganizationProfileProposalReceipt = {
  organizationId: string;
  branchId: string;
  proposalId: string;
  proposalKey: string;
  proposalNumber: number;
  proposalStatus: "pending";
  proposalAction: "create" | "correct";
  profileKey: string;
  expectedBaseVersion: number;
  contentHash: string;
  proposedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};

export type OrganizationProfileDecisionReceipt = {
  organizationId: string;
  branchId: string;
  proposalId: string;
  decisionId: string;
  decision: "approve" | "reject";
  proposalStatus: "approved" | "rejected";
  resultVersionId: string | null;
  profileKey: string;
  resultVersion: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  contentHash: string;
  decidedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
