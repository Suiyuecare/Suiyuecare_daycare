import { CASE_SERVICE_RECORD_STATES, type CaseServiceRecordFilters } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const ALLOWED = new Set(["from", "to", "client", "type", "author", "status"]);

function validDate(value: string | null) {
  if (value === null) return null;
  if (!DATE.test(value)) return undefined;
  const instant = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(instant.getTime()) && new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant) === value ? value : undefined;
}

function optional(value: string | null) {
  return value === "" ? null : value;
}

export function emptyCaseServiceRecordFilters(): CaseServiceRecordFilters {
  return {
    dateFrom: null,
    dateTo: null,
    clientId: null,
    serviceType: null,
    authorUserId: null,
    recordState: "all",
  };
}

export function parseCaseServiceRecordFilters(parameters: URLSearchParams): CaseServiceRecordFilters {
  if ([...parameters.keys()].some((key) => !ALLOWED.has(key)) ||
    [...ALLOWED].some((key) => parameters.getAll(key).length > 1)) {
    throw new Error("INVALID_CASE_SERVICE_RECORD_FILTERS");
  }
  const dateFrom = validDate(optional(parameters.get("from")));
  const dateTo = validDate(optional(parameters.get("to")));
  const client = optional(parameters.get("client"));
  const author = optional(parameters.get("author"));
  const rawType = optional(parameters.get("type"));
  const rawState = parameters.get("status") ?? "all";
  const serviceType = rawType?.trim() ?? null;
  if (dateFrom === undefined || dateTo === undefined ||
    (dateFrom !== null && dateTo !== null && dateFrom > dateTo) ||
    (client !== null && !UUID.test(client)) || (author !== null && !UUID.test(author)) ||
    (serviceType !== null && (serviceType.length < 1 || serviceType.length > 120 ||
      /[\u0000-\u001f\u007f]/u.test(serviceType))) ||
    (rawState !== "all" && !CASE_SERVICE_RECORD_STATES.includes(rawState as never))) {
    throw new Error("INVALID_CASE_SERVICE_RECORD_FILTERS");
  }
  return {
    dateFrom,
    dateTo,
    clientId: client?.toLowerCase() ?? null,
    serviceType,
    authorUserId: author?.toLowerCase() ?? null,
    recordState: rawState as CaseServiceRecordFilters["recordState"],
  };
}
