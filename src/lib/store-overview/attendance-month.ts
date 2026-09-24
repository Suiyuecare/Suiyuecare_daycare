import { z } from "zod";
export const STORE_ATTENDANCE_MONTH_PATH = "/app/store-attendance-month";
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const counts = z.object({ present: count, leave: count, absent: count }).strict();
const schema = z.object({
  organization_id: z.uuid(), branch_id: z.uuid(), month: z.string(),
  generated_at: z.iso.datetime({ offset: true }),
  days: z.array(counts.extend({ date: z.iso.date() })).min(28).max(31),
  totals: counts, distinct_present_clients: count,
}).strict();
export type AttendanceMonth = {
  month: string; generatedAt: string;
  days: { date: string; present: number; leave: number; absent: number }[];
  totals: { present: number; leave: number; absent: number };
  distinctPresentClients: number;
};
export function calendarMonthDays(month: string): string[] {
  if (!/^(20\d{2}|21\d{2}|2200)-(0[1-9]|1[0-2])$/u.test(month)) throw new Error("INVALID_MONTH");
  const [year, number] = month.split("-").map(Number);
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}
/** Validate scope, complete date range and same-snapshot arithmetic before releasing an aggregate. */
export function projectAttendanceMonth(input: unknown, scope: { organizationId: string; branchId: string }, month: string,
  now = new Date()): AttendanceMonth {
  const source = schema.parse(input);
  const expected = calendarMonthDays(month);
  const age = now.getTime() - Date.parse(source.generated_at);
  if (source.organization_id !== scope.organizationId || source.branch_id !== scope.branchId || source.month !== month ||
    age > 60_000 || age < -30_000 || source.days.length !== expected.length ||
    source.days.some((day, i) => day.date !== expected[i]) ||
    (["present", "leave", "absent"] as const).some((key) => source.totals[key] !== source.days.reduce((sum, day) => sum + day[key], 0)) ||
    source.distinct_present_clients > source.totals.present ||
    source.distinct_present_clients < Math.max(...source.days.map((day) => day.present))) throw new Error("INVALID_ATTENDANCE_MONTH");
  return { month, generatedAt: source.generated_at, days: source.days, totals: source.totals,
    distinctPresentClients: source.distinct_present_clients };
}
