import type {
  BloodGlucoseMealContext,
  BloodGlucoseUnit,
} from "./constants";

export type BloodGlucoseRecord = {
  id: string;
  measuredAt: string;
  mealContext: BloodGlucoseMealContext;
  value: number;
  unit: BloodGlucoseUnit;
  source: string;
};

export type BloodGlucoseClientSummary = {
  clientId: string;
  clientCode: string;
  displayName: string;
  measurements: readonly BloodGlucoseRecord[];
  latestMeasuredAt: string | null;
};

export type BloodGlucoseSnapshot = {
  serviceDate: string;
  generatedAt: string;
  staleAfter: string;
  clients: readonly BloodGlucoseClientSummary[];
  counts: {
    accessibleClients: number;
    measuredClients: number;
    unmeasuredClients: number;
    measurements: number;
  };
  demo: boolean;
};

export type BloodGlucoseMeasurementStatus = "all" | "measured" | "unmeasured";

export type BloodGlucoseFilters = {
  clientId?: string;
  mealContext?: BloodGlucoseMealContext;
  measurementStatus: BloodGlucoseMeasurementStatus;
};
