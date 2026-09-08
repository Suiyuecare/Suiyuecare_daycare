import type { ClientLifecycleStatus } from "./types";

export type ClientMasterAuthority = "central" | "local";
export type ClientMasterSourceFilter = "all" | ClientMasterAuthority;
export type ClientMasterServiceState =
  | "pending_admission"
  | ClientLifecycleStatus;
export type ClientMasterStatusFilter = "all" | ClientMasterServiceState;

export type ClientMasterItem = {
  id: string;
  clientCode: string;
  displayName: string;
  dateOfBirth: string | null;
  status: ClientLifecycleStatus;
  serviceState: ClientMasterServiceState;
  admittedOn: string | null;
  endedOn: string | null;
  sourceSystem: string;
  sourceAuthority: ClientMasterAuthority;
  sourceUpdatedAt: string | null;
  rowVersion: number;
  updatedAt: string;
  editable: boolean;
  editBlockReason: "central_authority" | "terminal_status" | null;
};

export type ClientMasterSnapshot = {
  generatedAt: string;
  clients: readonly ClientMasterItem[];
  metrics: {
    active: number;
    pendingAdmission: number;
    localEditable: number;
    centralAuthority: number;
    terminal: number;
  };
  demographicsReadable: boolean;
  demo: boolean;
};

export type CreateLocalClientInput = {
  clientCode: string;
  displayName: string;
  dateOfBirth: string | null;
  idempotencyKey: string;
};

export type UpdateLocalClientInput = CreateLocalClientInput & {
  clientId: string;
  expectedRowVersion: number;
};

export type ClientMasterOperationResult = {
  operationId: string;
  clientId: string;
  rowVersion: number;
  replayed: boolean;
};
