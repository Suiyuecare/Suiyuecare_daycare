import type { ClientLifecycleStatus } from "@/lib/clients/types";

export const INDIVIDUAL_PLAN_PROGRESS = [
  "not_started",
  "in_progress",
  "completed",
] as const;

export type IndividualPlanProgress =
  (typeof INDIVIDUAL_PLAN_PROGRESS)[number];

export type IndividualPlanItemInput = {
  goal: string;
  activity: string;
  frequency: string;
  responsibleUserId: string;
  progressStatus: IndividualPlanProgress;
  progressNote: string | null;
};

export type IndividualPlanItem = IndividualPlanItemInput & {
  itemOrder: number;
  responsibleDisplayName: string;
};

export type IndividualServicePlan = {
  id: string;
  clientId: string;
  planMonth: string;
  version: number;
  previousPlanId: string | null;
  correctionReason: string | null;
  items: readonly IndividualPlanItem[];
  signedAt: string;
};

export type IndividualPlanClient = {
  clientId: string;
  clientCode: string;
  displayName: string;
  clientStatus: ClientLifecycleStatus;
  admittedOn: string | null;
  endedOn: string | null;
  canPlanMonth: boolean;
  latestPlan: IndividualServicePlan | null;
};

export type IndividualPlanResponsible = {
  userId: string;
  displayName: string;
};

export type IndividualServicePlanSnapshot = {
  generatedAt: string;
  staleAfter: string;
  planMonth: string;
  demo: boolean;
  clients: readonly IndividualPlanClient[];
  responsibles: readonly IndividualPlanResponsible[];
  counts: {
    plans: number;
    notStarted: number;
    inProgress: number;
    completed: number;
  };
};

export type IndividualPlanFilters = {
  query: string;
  responsible: string;
  progress: "all" | IndividualPlanProgress;
};

export type IndividualPlanWriteInput = {
  clientId: string;
  planMonth: string;
  previousPlanId: string | null;
  correctionReason: string | null;
  items: readonly IndividualPlanItemInput[];
  idempotencyKey: string;
};

export type IndividualPlanWriteResult = {
  planId: string;
  clientId: string;
  planMonth: string;
  planVersion: number;
  previousPlanId: string | null;
  signedAt: string;
  replayed: boolean;
  persisted: true;
  demo: false;
};
