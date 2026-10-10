export type ActualTransportEventStatus = "not_scheduled" | "scheduled_unreported" | "boarded" | "alighted" | "exception";

export type ActualTransportCaseRow = {
  clientId: string;
  pickupStatus: ActualTransportEventStatus;
  dropoffStatus: ActualTransportEventStatus;
};

export type ActualTransportCaseSnapshot = {
  status: "ready" | "unavailable";
  serviceDate: string;
  generatedAt: string | null;
  rows: ActualTransportCaseRow[];
};
