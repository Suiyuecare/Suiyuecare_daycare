import {
  DAILY_SUMMARY_COMPLETENESS_FILTERS,
  type DailyServiceSummaryFilters,
  type DailySummaryCompletenessFilter,
} from "./types";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function taipeiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(parsed.getTime()) &&
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(parsed) === value && Number(value.slice(0, 4)) >= 2000 &&
    Number(value.slice(0, 4)) <= 2200;
}

export function parseDailyServiceSummaryQuery(
  query: Record<string, string | string[] | undefined>,
): { filters: DailyServiceSummaryFilters; invalid: boolean } {
  const allowed = new Set(["date", "client", "completeness"]);
  let invalid = Object.entries(query).some(([key, value]) =>
    !allowed.has(key) || Array.isArray(value));
  const dateValue = typeof query.date === "string" ? query.date : taipeiToday();
  if (!validDate(dateValue)) invalid = true;
  const serviceDate = validDate(dateValue) ? dateValue : taipeiToday();
  const clientValue = typeof query.client === "string" ? query.client : "";
  const clientId = uuidPattern.test(clientValue) ? clientValue.toLowerCase() : null;
  if (clientValue !== "" && clientId === null) invalid = true;
  const completenessValue = typeof query.completeness === "string"
    ? query.completeness : "all";
  const completeness = DAILY_SUMMARY_COMPLETENESS_FILTERS.includes(
    completenessValue as DailySummaryCompletenessFilter,
  ) ? completenessValue as DailySummaryCompletenessFilter : "all";
  if (completeness !== completenessValue) invalid = true;
  return { filters: { serviceDate, clientId, completeness }, invalid };
}

export function dailyServiceSummaryHref(filters: DailyServiceSummaryFilters) {
  const params = new URLSearchParams({ date: filters.serviceDate });
  if (filters.clientId) params.set("client", filters.clientId);
  if (filters.completeness !== "all") {
    params.set("completeness", filters.completeness);
  }
  return `?${params.toString()}`;
}
