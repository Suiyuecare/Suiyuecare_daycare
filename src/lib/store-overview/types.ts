export const STORE_OVERVIEW_PATH = "/app/store-overview";
export const STORE_OVERVIEW_TITLE = "單店出勤與收支";

export interface StorePeriods { date: string; month: string }
export interface AttendanceSummary {
  present: number;
  leave: number;
  absent: number;
  generatedAt: string;
}
export interface FinanceSummary {
  income: string;
  expenses: string;
  entryCount: number;
  generatedAt: string;
}
export type SummarySource<T> =
  | { status: "ready"; data: T }
  | { status: "not_connected" | "unavailable" | "timeout" };

/** Only aggregate values cross the server/client boundary. No client identities or ledger rows. */
export interface StoreOverview {
  organizationName: string;
  branchName: string;
  periods: StorePeriods;
  invalid: boolean;
  demo: boolean;
  attendance: SummarySource<AttendanceSummary>;
  finance: SummarySource<FinanceSummary>;
}

/** Format exact decimal strings without floating point rounding or losing reversal signs. */
export function formatTwd(value: string): string {
  if (!/^-?(?:0|[1-9]\d{0,17})\.\d{2}$/u.test(value)) return "—";
  const [whole, fraction] = value.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",")}${fraction === "00" ? "" : `.${fraction}`}`;
}
