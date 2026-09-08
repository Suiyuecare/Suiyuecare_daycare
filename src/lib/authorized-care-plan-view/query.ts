import {
  AUTHORIZED_CARE_PLAN_EFFECTIVE_STATES,
  type AuthorizedCarePlanFilters,
} from "./types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const isoDate = /^\d{4}-\d{2}-\d{2}$/u;

function taipeiDate(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function validDate(value: string) {
  if (!isoDate.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(parsed.getTime()) && taipeiDate(parsed) === value;
}

function positiveInteger(value: string | null, fallback: number, max: number) {
  if (value === null || value === "") return fallback;
  if (!/^[1-9]\d*$/u.test(value)) throw new Error("INVALID_AUTHORIZED_CARE_PLAN_FILTERS");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > max) {
    throw new Error("INVALID_AUTHORIZED_CARE_PLAN_FILTERS");
  }
  return parsed;
}

export function defaultAuthorizedCarePlanFilters(now = new Date()): AuthorizedCarePlanFilters {
  return {
    asOf: taipeiDate(now),
    clientId: null,
    authorizedFrom: null,
    authorizedTo: null,
    effectiveState: "all",
    sourceSystem: null,
    page: 1,
    pageSize: 25,
  };
}

export function parseAuthorizedCarePlanFilters(
  parameters: URLSearchParams,
  now = new Date(),
): AuthorizedCarePlanFilters {
  const allowed = new Set([
    "as_of",
    "client",
    "authorized_from",
    "authorized_to",
    "effective",
    "source",
    "page",
    "page_size",
  ]);
  if (
    [...parameters.keys()].some((key) => !allowed.has(key)) ||
    [...allowed].some((key) => parameters.getAll(key).length > 1)
  ) {
    throw new Error("INVALID_AUTHORIZED_CARE_PLAN_FILTERS");
  }

  const defaults = defaultAuthorizedCarePlanFilters(now);
  const asOf = parameters.get("as_of")?.trim() || defaults.asOf;
  const clientId = parameters.get("client")?.trim().toLowerCase() || null;
  const authorizedFrom = parameters.get("authorized_from")?.trim() || null;
  const authorizedTo = parameters.get("authorized_to")?.trim() || null;
  const effectiveState = parameters.get("effective")?.trim().toLowerCase() || "all";
  const sourceSystem = parameters.get("source")?.trim() || null;
  const page = positiveInteger(parameters.get("page"), 1, 200);
  const pageSize = positiveInteger(parameters.get("page_size"), 25, 25);

  if (
    !validDate(asOf) ||
    (clientId !== null && !uuid.test(clientId)) ||
    (authorizedFrom !== null && !validDate(authorizedFrom)) ||
    (authorizedTo !== null && !validDate(authorizedTo)) ||
    (authorizedFrom !== null && authorizedTo !== null && authorizedFrom > authorizedTo) ||
    !AUTHORIZED_CARE_PLAN_EFFECTIVE_STATES.includes(effectiveState as never) ||
    (sourceSystem !== null && (
      sourceSystem.length > 80 || /[\u0000-\u001f\u007f]/u.test(sourceSystem)
    ))
  ) {
    throw new Error("INVALID_AUTHORIZED_CARE_PLAN_FILTERS");
  }

  return {
    asOf,
    clientId,
    authorizedFrom,
    authorizedTo,
    effectiveState: effectiveState as AuthorizedCarePlanFilters["effectiveState"],
    sourceSystem,
    page,
    pageSize,
  };
}

export function authorizedCarePlanFilterHref(filters: AuthorizedCarePlanFilters) {
  const parameters = new URLSearchParams({
    as_of: filters.asOf,
    effective: filters.effectiveState,
    page: String(filters.page),
    page_size: String(filters.pageSize),
  });
  if (filters.clientId) parameters.set("client", filters.clientId);
  if (filters.authorizedFrom) parameters.set("authorized_from", filters.authorizedFrom);
  if (filters.authorizedTo) parameters.set("authorized_to", filters.authorizedTo);
  if (filters.sourceSystem) parameters.set("source", filters.sourceSystem);
  return `?${parameters.toString()}`;
}
