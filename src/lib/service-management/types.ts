export type ServiceEventStatus =
  | "planned"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "voided";

export type ClaimStatus =
  | "draft"
  | "validated"
  | "exported"
  | "submitted"
  | "accepted"
  | "rejected"
  | "reconciled"
  | "voided";

export type ServiceUsageItem = {
  id: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  serviceCode: string;
  status: ServiceEventStatus;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
  hasStaff: boolean;
  hasEffectivePlanLink: boolean;
  signedAt: string | null;
};

export type ServiceUsageClientOption = {
  id: string;
  code: string;
  name: string;
  status: "active" | "suspended" | "transferred" | "closed" | "deceased";
  admittedOn: string | null;
  endedOn: string | null;
};

export type ServiceUsageSnapshot = {
  serviceDate: string;
  generatedAt: string;
  clients: readonly ServiceUsageClientOption[];
  items: readonly ServiceUsageItem[];
  demo: boolean;
};

export type ClaimBatchSummary = {
  id: string;
  periodStart: string;
  periodEnd: string;
  formatVersion: string;
  status: ClaimStatus;
  itemCount: number | null;
  totalAmount: string | null;
  respondedItemCount: number | null;
  rejectedItemCount: number | null;
  legacyResponseUnknown: boolean;
  hasImmutableSnapshot: boolean;
  exportedAt: string | null;
  submittedAt: string | null;
  reconciledAt: string | null;
  updatedAt: string;
};

export type ClaimReadSnapshot = {
  generatedAt: string;
  batches: readonly ClaimBatchSummary[];
  demo: boolean;
};
