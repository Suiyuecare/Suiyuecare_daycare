import { ASSESSMENT_MATRIX_PATH } from "./config";

export interface AssessmentMatrixFilters {
  month: string;
  page: number;
}

export type AssessmentMatrixQuery =
  | { ok: true; filters: AssessmentMatrixFilters }
  | { ok: false; message: string };

export function currentTaipeiMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) throw new Error("Taipei month unavailable");
  return `${year}-${month}`;
}

export function parseAssessmentMatrixQuery(
  params: Record<string, string | string[] | undefined>,
  todayMonth = currentTaipeiMonth(),
): AssessmentMatrixQuery {
  const month = params.month ?? todayMonth;
  const page = params.page ?? "1";
  if (typeof month !== "string" || !/^(?:20\d{2})-(?:0[1-9]|1[0-2])$/u.test(month) ||
    month < "2000-01" || month > todayMonth) {
    return { ok: false, message: "請選擇有效的月份，且不得晚於本月。" };
  }
  if (typeof page !== "string" || !/^[1-9]\d{0,3}$/u.test(page)) {
    return { ok: false, message: "頁碼無效，請重新選擇。" };
  }
  return { ok: true, filters: { month, page: Number(page) } };
}

export function assessmentMatrixHref(filters: AssessmentMatrixFilters): string {
  return `${ASSESSMENT_MATRIX_PATH}?${new URLSearchParams({
    month: filters.month, page: String(filters.page),
  })}`;
}
