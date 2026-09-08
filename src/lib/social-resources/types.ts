export const SOCIAL_RESOURCE_INFORMATION_STATES = [
  "provided",
  "not_applicable",
  "missing",
] as const;

export const SOCIAL_RESOURCE_VALIDITY_STATES = [
  "date_range",
  "open_ended",
  "not_applicable",
  "missing",
] as const;

export const SOCIAL_RESOURCE_STATUSES = ["active", "inactive"] as const;

export type SocialResourceInformationState =
  (typeof SOCIAL_RESOURCE_INFORMATION_STATES)[number];
export type SocialResourceValidityState =
  (typeof SOCIAL_RESOURCE_VALIDITY_STATES)[number];
export type SocialResourceStatus = (typeof SOCIAL_RESOURCE_STATUSES)[number];
export type SocialResourceStatusFilter = "all" | SocialResourceStatus;

export type SocialResourceItem = {
  id: string;
  referenceYear: number;
  name: string;
  resourceType: string;
  audienceState: SocialResourceInformationState;
  audienceDetail: string | null;
  eligibilityState: SocialResourceInformationState;
  eligibilityDetail: string | null;
  contactState: SocialResourceInformationState;
  contactDetail: string | null;
  validityState: SocialResourceValidityState;
  validFrom: string | null;
  validUntil: string | null;
  lastConfirmedOn: string | null;
  status: SocialResourceStatus;
  rowVersion: number;
  updatedAt: string;
  expired: boolean;
  effective: boolean;
};

export type SocialResourceFilters = {
  referenceYear: number | null;
  resourceType: string | null;
  status: SocialResourceStatusFilter;
  audience: string | null;
  query: string;
};

export type SocialResourceSnapshot = {
  organizationId: string;
  branchId: string;
  generatedAt: string;
  staleAfter: string;
  items: readonly SocialResourceItem[];
  itemTotal: number;
  metrics: {
    effective: number;
    pendingConfirmation: number;
    inactive: number;
    expired: number;
    expiringSoon: null;
  };
  itemsTruncated: boolean;
  typeOptions: readonly string[];
  audienceOptions: readonly string[];
  typeOptionsTruncated: boolean;
  audienceOptionsTruncated: boolean;
  expiryRuleStatus: "not_configured";
  confirmationRuleStatus: "missing_date_only";
  demo: boolean;
};

export type SocialResourceFields = {
  referenceYear: number;
  name: string;
  resourceType: string;
  audienceState: SocialResourceInformationState;
  audienceDetail: string | null;
  eligibilityState: SocialResourceInformationState;
  eligibilityDetail: string | null;
  contactState: SocialResourceInformationState;
  contactDetail: string | null;
  validityState: SocialResourceValidityState;
  validFrom: string | null;
  validUntil: string | null;
};

export type CreateSocialResourceInput = SocialResourceFields & {
  action: "create";
  idempotencyKey: string;
};

export type UpdateSocialResourceInput = SocialResourceFields & {
  action: "update";
  resourceId: string;
  expectedRowVersion: number;
  idempotencyKey: string;
};

export type ConfirmSocialResourceInput = {
  action: "confirm";
  resourceId: string;
  expectedRowVersion: number;
  idempotencyKey: string;
};

export type DeactivateSocialResourceInput = {
  action: "deactivate";
  resourceId: string;
  expectedRowVersion: number;
  reason: string;
  idempotencyKey: string;
};

export type SocialResourceMutationInput =
  | UpdateSocialResourceInput
  | ConfirmSocialResourceInput
  | DeactivateSocialResourceInput;

export type SocialResourceOperationResult = {
  operationId: string;
  resourceId: string;
  rowVersion: number;
  status: SocialResourceStatus;
  lastConfirmedOn: string | null;
  replayed: boolean;
  persisted: true;
  demo: false;
};
