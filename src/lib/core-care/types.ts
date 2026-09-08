import type { PageCatalogEntry } from "@/lib/catalog";

export type DailyAttendanceSummary = {
  id: string;
  status: "present" | "absent" | "leave" | "cancelled";
  checkedInAt: string | null;
  checkedOutAt: string | null;
  source: string;
};

export type DailyVitalSummary = {
  measuredAt: string;
  systolic: number | null;
  diastolic: number | null;
  pulse: number | null;
  temperature: number | null;
  oxygenSaturation: number | null;
  capturedKinds: readonly string[];
};

export type DailyCareDiarySummary = {
  id: string;
  status: "draft" | "submitted" | "signed" | "corrected" | "voided";
  occurredAt: string;
  hasAbnormalFlag: boolean;
};

export type DailyClientSummary = {
  clientId: string;
  clientCode: string;
  displayName: string;
  attendance: DailyAttendanceSummary | null;
  vitalSigns: DailyVitalSummary | null;
  careDiary: DailyCareDiarySummary | null;
  completedServiceCount: number;
  sourceCoverage: number;
};

export type DailyCareSnapshot = {
  serviceDate: string;
  generatedAt: string;
  staleAfter: string;
  clients: readonly DailyClientSummary[];
  sourceCounts: {
    activeClients: number;
    attendanceRecords: number;
    clientsWithMeasurements: number;
    careDiaryRecords: number;
    completedServiceEvents: number;
  };
  sourceAccess: {
    clients: boolean;
    attendance: boolean;
    measurements: boolean;
    careDiaries: boolean;
    serviceEvents: boolean;
  };
  demo: boolean;
};

export const CORE_DAILY_PAGE_NUMBERS = Object.freeze([3, 6, 46] as const);

export function isCoreDailyPage(
  page: PageCatalogEntry,
): page is PageCatalogEntry & {
  number: (typeof CORE_DAILY_PAGE_NUMBERS)[number];
} {
  return CORE_DAILY_PAGE_NUMBERS.includes(
    page.number as (typeof CORE_DAILY_PAGE_NUMBERS)[number],
  );
}
