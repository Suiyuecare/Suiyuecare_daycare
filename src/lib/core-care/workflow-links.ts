import { taipeiDayBoundsUtc } from "./date";

export type DailyWorkflowPage = 46 | 3 | 6;
export type DailyWorkflowShift = "morning" | "afternoon" | "full_day";

export function isDailyWorkflowShift(value: unknown): value is DailyWorkflowShift {
  return value === "morning" || value === "afternoon" || value === "full_day";
}

export const DAILY_WORKFLOW_STEPS = [
  { page: 46, label: "出勤", source: "attendance" },
  { page: 3, label: "量測", source: "measurements" },
  { page: 6, label: "日誌", source: "careDiaries" },
] as const;

const paths: Record<DailyWorkflowPage, string> = {
  46: "/app/staff/service-management/attendance",
  3: "/app/staff/daily-care/vital-signs",
  6: "/app/staff/daily-care/care-diary",
};

/** A fixed internal route; never carry labels, record contents or arbitrary query keys. */
export function dailyWorkflowHref(page: DailyWorkflowPage, date: string, clientId?: string, shift?: DailyWorkflowShift) {
  if (!Object.hasOwn(paths, page)) throw new Error("INVALID_WORKFLOW_PAGE");
  taipeiDayBoundsUtc(date);
  if (clientId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(clientId)) {
    throw new Error("INVALID_WORKFLOW_CLIENT");
  }
  const query = new URLSearchParams({ date });
  if (clientId !== undefined) query.set("client", clientId);
  if (shift !== undefined) {
    if (!isDailyWorkflowShift(shift)) throw new Error("INVALID_WORKFLOW_SHIFT");
    query.set("shift", shift);
  }
  return `${paths[page]}?${query.toString()}`;
}
