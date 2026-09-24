import "server-only";
import type { TenantContext } from "@/lib/domain/types";
import { isSyntheticReadMode } from "@/lib/env";
import { parseReportPeriods } from "@/lib/reports/entry";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canReadStoreOverview } from "./access";
import { calendarMonthDays, projectAttendanceMonth, type AttendanceMonth } from "./attendance-month";
import type { SummarySource } from "./types";

export type AttendanceMonthSnapshot = {
  branchName: string; month: string; demo: boolean; invalid: boolean; source: SummarySource<AttendanceMonth>;
};
export async function loadAttendanceMonth(context: TenantContext,
  query: Record<string, string | string[] | undefined>): Promise<AttendanceMonthSnapshot | null> {
  if (!await canReadStoreOverview(context)) return null;
  const parsed = parseReportPeriods({ month: query.month });
  const month = parsed.periods.month;
  const base = { branchName: context.branchName, month, demo: isSyntheticReadMode(),
    invalid: parsed.invalid || Object.keys(query).some((key) => key !== "month") };
  if (base.invalid) return { ...base, source: { status: "unavailable" } };
  if (base.demo) {
    const days = calendarMonthDays(month).map((date, i) => ({ date, present: i === 0 ? 2 : 0, leave: i === 0 ? 1 : 0, absent: 0 }));
    return { ...base, source: { status: "ready", data: { month, days, generatedAt: new Date().toISOString(),
      totals: { present: 2, leave: 1, absent: 0 }, distinctPresentClients: 2 } } };
  }
  const signal = AbortSignal.timeout(5_000);
  try {
    const db = await createServerSupabaseClient();
    if (!db) return { ...base, source: { status: "unavailable" } };
    const { data, error } = await db.rpc("read_store_attendance_month", {
      p_organization_id: context.organizationId, p_branch_id: context.branchId, p_month: month,
    }).abortSignal(signal);
    if (error) throw new Error("ATTENDANCE_MONTH_UNAVAILABLE");
    return { ...base, source: { status: "ready", data: projectAttendanceMonth(data, context, month) } };
  } catch { return { ...base, source: { status: signal.aborted ? "timeout" : "unavailable" } }; }
}
