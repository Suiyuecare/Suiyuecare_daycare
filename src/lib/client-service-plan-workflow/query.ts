import { CLIENT_SERVICE_PLAN_STATUS_FILTERS, type ClientServicePlanFilters } from "./types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const date = /^\d{4}-\d{2}-\d{2}$/u;

export function clientServicePlanTaipeiDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric",
    month: "2-digit", day: "2-digit" }).format(now);
}

export function emptyClientServicePlanFilters(now = new Date()): ClientServicePlanFilters {
  return { clientId: null, status: "all", asOf: clientServicePlanTaipeiDate(now), query: null };
}

export function parseClientServicePlanFilters(
  parameters: URLSearchParams,
  now = new Date(),
): ClientServicePlanFilters {
  const allowed = new Set(["client", "status", "as_of", "q"]);
  if ([...parameters.keys()].some((key) => !allowed.has(key)) ||
    [...allowed].some((key) => parameters.getAll(key).length > 1)) {
    throw new Error("INVALID_CLIENT_SERVICE_PLAN_FILTERS");
  }
  const client = parameters.get("client")?.trim() || null;
  const status = parameters.get("status")?.trim() || "all";
  const asOf = parameters.get("as_of")?.trim() || clientServicePlanTaipeiDate(now);
  const query = parameters.get("q")?.trim() || null;
  const validDate = date.test(asOf) && Number.isFinite(Date.parse(`${asOf}T12:00:00+08:00`)) &&
    clientServicePlanTaipeiDate(new Date(`${asOf}T12:00:00+08:00`)) === asOf;
  if ((client !== null && !uuid.test(client)) ||
    !CLIENT_SERVICE_PLAN_STATUS_FILTERS.includes(status as never) || !validDate ||
    (query !== null && (query.length > 120 || /[\u0000-\u001f\u007f]/u.test(query)))) {
    throw new Error("INVALID_CLIENT_SERVICE_PLAN_FILTERS");
  }
  return { clientId: client?.toLowerCase() ?? null,
    status: status as ClientServicePlanFilters["status"], asOf, query };
}
