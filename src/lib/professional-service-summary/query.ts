import {
  PROFESSIONAL_SUMMARY_KINDS,
  PROFESSIONAL_SUMMARY_STATUSES,
  type ProfessionalServiceSummaryFilters,
  type ProfessionalSummaryKind,
  type ProfessionalSummaryStatusFilter,
} from "./types";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function taipeiMonth() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
}

function validMonth(value: string) {
  if (!/^\d{4}-\d{2}$/u.test(value)) return false;
  const month = Number(value.slice(5));
  const year = Number(value.slice(0, 4));
  return year >= 2000 && year <= 2200 && month >= 1 && month <= 12;
}

export function parseProfessionalServiceSummaryQuery(
  query: Record<string, string | string[] | undefined>,
): { filters: ProfessionalServiceSummaryFilters; invalid: boolean } {
  const allowed = new Set(["month", "client", "professional", "status"]);
  let invalid = Object.entries(query).some(([key, value]) =>
    !allowed.has(key) || Array.isArray(value)
  );
  const monthValue = typeof query.month === "string"
    ? query.month : taipeiMonth();
  if (!validMonth(monthValue)) invalid = true;
  const month = validMonth(monthValue) ? monthValue : taipeiMonth();

  const clientValue = typeof query.client === "string" ? query.client : "";
  const clientId = uuidPattern.test(clientValue)
    ? clientValue.toLowerCase() : null;
  if (clientValue !== "" && clientId === null) invalid = true;

  const professionalValue = typeof query.professional === "string"
    ? query.professional : "all";
  const professionalKind = PROFESSIONAL_SUMMARY_KINDS.includes(
    professionalValue as ProfessionalSummaryKind,
  ) ? professionalValue as ProfessionalSummaryKind : "all";
  if (professionalKind !== professionalValue) invalid = true;

  const statusValue = typeof query.status === "string"
    ? query.status : "all";
  const status = PROFESSIONAL_SUMMARY_STATUSES.includes(
    statusValue as ProfessionalSummaryStatusFilter,
  ) ? statusValue as ProfessionalSummaryStatusFilter : "all";
  if (status !== statusValue) invalid = true;

  return {
    filters: { month, clientId, professionalKind, status },
    invalid,
  };
}

export function professionalServiceSummaryHref(
  filters: ProfessionalServiceSummaryFilters,
) {
  const params = new URLSearchParams({ month: filters.month });
  if (filters.clientId) params.set("client", filters.clientId);
  if (filters.professionalKind !== "all") {
    params.set("professional", filters.professionalKind);
  }
  if (filters.status !== "all") params.set("status", filters.status);
  return `?${params.toString()}`;
}
