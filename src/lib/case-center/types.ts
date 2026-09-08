import type {
  ClientLifecycleStatus,
  ClientServiceState,
} from "@/lib/clients/types";

export const CASE_CENTER_LIFECYCLE_FILTERS = Object.freeze([
  "all",
  "pending_admission",
  "active",
  "suspended",
  "transferred",
  "closed",
  "deceased",
] as const);

export const CASE_CENTER_SERVICE_FILTERS = Object.freeze([
  "all",
  "serving",
  "paused",
  "pending",
  "ended",
] as const);

export type CaseCenterLifecycleFilter =
  (typeof CASE_CENTER_LIFECYCLE_FILTERS)[number];
export type CaseCenterServiceStatus = Exclude<
  (typeof CASE_CENTER_SERVICE_FILTERS)[number],
  "all"
>;
export type CaseCenterServiceFilter =
  (typeof CASE_CENTER_SERVICE_FILTERS)[number];
export type CaseCenterResponsibleFilter = "all" | "me" | string;
export type CaseCenterAssignmentAccess =
  | "full_for_visible_clients"
  | "self_only";

export type CaseCenterFilters = {
  date: string;
  query: string;
  lifecycle: CaseCenterLifecycleFilter;
  service: CaseCenterServiceFilter;
  responsible: CaseCenterResponsibleFilter;
  page: number;
};

export type CaseCenterResponsiblePerson = {
  userId: string;
  label: string;
  currentUser: boolean;
};

export type CaseCenterClient = {
  id: string;
  clientCode: string;
  displayName: string;
  lifecycleStatus: ClientLifecycleStatus;
  lifecycleState: ClientServiceState;
  serviceStatus: CaseCenterServiceStatus;
  admittedOn: string | null;
  endedOn: string | null;
  updatedAt: string;
  responsibility: {
    state: "known" | "restricted";
    people: readonly CaseCenterResponsiblePerson[];
  };
};

export type CaseCenterSnapshot = {
  generatedAt: string;
  serviceDate: string;
  clients: readonly CaseCenterClient[];
  total: number;
  visibleTotal: number;
  page: number;
  pageSize: number;
  pageCount: number;
  summary: {
    serving: number;
    paused: number;
    pending: number;
    ended: number;
  };
  responsibleOptions: readonly CaseCenterResponsiblePerson[];
  access: {
    assignments: CaseCenterAssignmentAccess;
    profileLabels: "names" | "codes";
    responsibleFilterRestricted: boolean;
  };
  demo: boolean;
};
