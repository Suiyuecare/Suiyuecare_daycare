export type CarePlanVersionStatus = "draft" | "approved" | "signed" | "voided";

type CommonPlanVersion = {
  id: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  planKey: string;
  version: number;
  previousVersionId: string | null;
  status: CarePlanVersionStatus;
  effectiveFrom: string;
  effectiveTo: string;
  sourceSystem: string;
  sourceRecordId: string | null;
  correctionReason: string | null;
  createdAt: string;
  signedAt: string | null;
};

export type AuthorizedCarePlanSummary = CommonPlanVersion & {
  authorizedOn: string | null;
  hasAuthorizationReference: boolean;
  serviceLimitFieldCount: number;
};

export type ClientServicePlanSummary = CommonPlanVersion & {
  authorizedCarePlanId: string;
  goalCount: number;
  plannedServiceCount: number;
  responsibleUserId: string | null;
  reviewDueOn: string | null;
};

export type CarePlanSnapshot = {
  generatedAt: string;
  authorizedPlans: readonly AuthorizedCarePlanSummary[];
  servicePlans: readonly ClientServicePlanSummary[];
  demo: boolean;
};

export type EffectivePlan = Pick<
  CommonPlanVersion,
  "status" | "effectiveFrom" | "effectiveTo"
>;

